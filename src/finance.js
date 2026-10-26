import "./finance.css";
import { collection, doc, getDoc, onSnapshot, query, where, setDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { OPERATOR_UID, OPERATOR_EMAIL, METHODS, KINDS, DEFAULT_CATEGORIES, money, ecuadorTime, today, escape as h, summarize, cents, units, cashEffect } from "./finance-core.js";
import { saveFinanceEvent, recordOperation, closeCash, financeRef, syncFinanceLink } from "./finance-store.js";
import { prepareReport, downloadExcel, downloadPdf } from "./finance-reports.js";
import { tryActivity } from "./audit-store.js";

const sections = [["home", "◫", "Inicio"], ["events", "◇", "Mis eventos"], ["products", "▤", "Productos e inventario"],
  ["funding", "+", "Inversiones"], ["expenses", "↗", "Gastos"], ["sales", "$", "Ventas"], ["cash", "⇄", "Control de caja"],
  ["stats", "▥", "Estadísticas"], ["reports", "↓", "Reportes"], ["settings", "⚙", "Configuración"]];
const phases = { planning: "Planificación", upcoming: "Próximo", live: "En desarrollo", finished: "Finalizado" };
const stamp = (value) => value?.toMillis?.() || 0;
const number = (value = 0) => value / 100;
const options = (values, selected = "") => Object.entries(Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values)
  .map(([key, label]) => `<option value="${h(key)}" ${key === selected ? "selected" : ""}>${h(label)}</option>`).join("");
const button = (action, text, id = "", style = "outline-button") => `<button type="button" class="${style}" data-fin="${action}" data-id="${h(id)}">${text}</button>`;
const field = (name, label, value = "", type = "text", extra = "") => `<label class="fin-field">${h(label)}<input name="${name}" type="${type}" value="${h(value)}" ${extra} /></label>`;
const select = (name, label, values, selected = "", extra = "") => `<label class="fin-field">${h(label)}<select name="${name}" ${extra}>${options(values, selected)}</select></label>`;
const noteField = (required = false) => `<label class="fin-field fin-wide">Observaciones / motivo${required ? " (obligatorio)" : ""}<textarea name="note" rows="2" maxlength="3000" ${required ? 'required minlength="5"' : ""}></textarea></label>`;
const empty = (text) => `<p class="fin-empty">${text}</p>`;

export function createFinanceModule({ root, db, notify }) {
  let user, role, unsubscribes = [], eventSubscriptions = new Map(), records = {}, events = [], sourceEvents = [], profile;
  let selectedId = "", section = "home", search = "", category = "", stockFilter = "", filters = {}, charts = [], renderVersion = 0, loading = true;
  const dialog = document.createElement("dialog");
  dialog.className = "fin-dialog";
  document.body.append(dialog);
  let modal;

  const allowedEvents = () => events.filter((event) => !selectedId || event.id === selectedId);
  const selected = () => events.find((event) => event.id === selectedId);
  const selectedRecords = () => records[selectedId] || { products: [], operations: [], closures: [], payables: [], audit: [] };
  const combined = (key) => allowedEvents().flatMap((event) => (records[event.id]?.[key] || []).map((row) => ({ ...row, eventName: event.name, eventId: event.id })));
  const ready = () => !loading && allowedEvents().every((event) => records[event.id]?.ready.size === 5);
  const isOwner = () => role === "admin";
  const can = (permission) => isOwner() || selected()?.[permission];
  const requireEvent = () => {
    if (!selected()) throw new Error("Selecciona un evento con gestión habilitada antes de registrar operaciones.");
    if (!ready()) throw new Error("Espera a que termine la sincronización.");
    return selected();
  };

  function stop() {
    unsubscribes.forEach((unsubscribe) => unsubscribe()); unsubscribes = [];
    eventSubscriptions.forEach((callbacks) => callbacks.forEach((fn) => fn())); eventSubscriptions = new Map();
    charts.forEach((chart) => chart.destroy()); charts = [];
    dialog.close(); root.innerHTML = ""; records = {}; events = []; sourceEvents = []; profile = null;
    selectedId = ""; section = "home"; user = null; role = null; renderVersion++;
  }

  function start(currentUser, currentRole) {
    stop(); user = currentUser; role = currentRole; loading = true;
    const eventsQuery = isOwner() ? collection(db, "financeEvents") : query(collection(db, "financeEvents"), where("assignedUids", "array-contains", user.uid));
    unsubscribes.push(onSnapshot(eventsQuery, (snapshot) => {
      events = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })); loading = false;
      if (selectedId && !events.some((event) => event.id === selectedId) && !isOwner()) selectedId = "";
      syncEventSubscriptions(); render();
    }, showError));
    if (isOwner()) unsubscribes.push(onSnapshot(collection(db, "events"), async (snapshot) => {
      sourceEvents = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })); render();
      for (const source of sourceEvents) {
        if (user?.uid !== currentUser.uid || !isOwner()) return;
        if (!events.some((event) => event.id === source.id)) {
          try { await syncFinanceLink(db, currentUser, source.id); }
          catch (error) { if (user?.uid === currentUser.uid) showError(error); }
        }
      }
    }, showError));
    unsubscribes.push(onSnapshot(doc(db, "users", OPERATOR_UID), (snapshot) => {
      profile = snapshot.data();
      if (!isOwner() && !profile?.active) {
        stop(); root.innerHTML = empty("El organizador ha desactivado tu acceso operativo. Cierra sesión para volver al inicio.");
        return;
      }
      render();
    }, showError));
    render();
  }

  function showError(error) { console.error(error); notify("No se pudo sincronizar la gestión financiera. Revisa tu conexión y permisos.", true); }
  function syncEventSubscriptions() {
    for (const [id, callbacks] of eventSubscriptions) {
      if (!events.some((event) => event.id === id)) { callbacks.forEach((fn) => fn()); eventSubscriptions.delete(id); delete records[id]; }
    }
    for (const event of events) {
      if (eventSubscriptions.has(event.id)) continue;
      records[event.id] = { products: [], operations: [], closures: [], payables: [], audit: [], ready: new Set() };
      const callbacks = ["products", "operations", "closures", "payables", "audit"].map((key) => onSnapshot(collection(db, "financeEvents", event.id, key), (snapshot) => {
        if (!records[event.id]) return;
        records[event.id][key] = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));
        records[event.id].ready.add(key); render();
      }, showError));
      eventSubscriptions.set(event.id, callbacks);
    }
  }

  function metrics() {
    const summary = summarize(combined("operations"), combined("products"), allowedEvents().reduce((n, e) => n + e.budgetCents, 0));
    return `<div class="fin-metrics">${[
      ["Inversión total", money(summary.investment), "Aportes de capital efectivamente recibidos"],
      ["Gastos registrados", money(summary.expenses), "Devengados, incluidos pendientes"],
      ["Ingresos por ventas", money(summary.income), "Netos de descuentos y devoluciones"],
      ["Ganancia / pérdida", money(summary.profit), "Ventas − costo vendido − gastos − pérdidas"],
      ["Productos disponibles", summary.available, `Valor en stock: ${money(summary.stockValue)}`],
      ["Productos vendidos", summary.sold, "Unidades netas de devoluciones"],
      ["Productos agotados", summary.exhausted, "Productos activos sin existencias"],
      ["Dinero en caja", money(summary.cash), `Flujo total de fondos: ${money(summary.flow)}`],
      ["Presupuesto disponible", money(summary.budgetAvailable), `Compras netas: ${money(summary.purchases)} · Pendientes: ${money(summary.pending)}`],
    ].map(([name, value, copy]) => `<article><span>${name}</span><strong>${value}</strong><small>${copy}</small></article>`).join("")}</div>`;
  }

  function render() {
    if (!user) return;
    renderVersion++;
    charts.forEach((chart) => chart.destroy()); charts = [];
    root.innerHTML = `<div class="finance-layout">
      <aside class="finance-sidebar"><p class="eyebrow">MIRAGE · FINANZAS</p><nav aria-label="Gestión financiera">${sections.map(([key, icon, label]) => `<button type="button" data-fin="section" data-id="${key}" class="${section === key ? "active" : ""}"><span aria-hidden="true">${icon}</span>${label}</button>`).join("")}</nav></aside>
      <div class="finance-content"><header class="finance-toolbar"><div><span class="fin-badge">${isOwner() ? "ORGANIZADOR" : "CONTROL OPERATIVO"}</span><small>${h(user.email)}</small></div>
      <label>Evento<select id="fin-event-select"><option value="">Resumen general · eventos autorizados</option>${events.map((e) => `<option value="${h(e.id)}" ${selectedId === e.id ? "selected" : ""}>${h(e.name)}</option>`).join("")}</select></label></header>
      <div class="fin-page-heading"><div><p class="eyebrow">${selected() ? h(selected().name) : "TODOS MIS EVENTOS"}</p><h2>${sections.find(([key]) => key === section)?.[2] || "Inicio"}</h2></div>${selected() && isOwner() ? button("configure", "Configurar evento", selectedId) : ""}</div>
      ${!ready() ? empty("Sincronizando registros...") : content()}
      <p class="fin-footnote">USD · Hora de Ecuador (America/Guayaquil) · Los movimientos financieros son independientes del registro histórico de QR. Una entrada sin importe registrado no se contabiliza como venta.</p></div></div>`;
    if (ready() && ["home", "stats"].includes(section)) drawCharts(renderVersion);
  }

  function content() {
    if (section === "events") return eventCards();
    if (section === "settings") return settings();
    if (!events.length) return eventCards();
    if (["home", "stats"].includes(section)) return `${eventHeader()}${metrics()}<div class="fin-charts"><article><h3>Ventas y gastos diarios</h3><div><canvas id="fin-daily-chart"></canvas></div></article><article><h3>Ventas por método de pago</h3><div><canvas id="fin-payments-chart"></canvas></div></article><article><h3>Destino de inversiones</h3><div><canvas id="fin-spend-chart"></canvas></div></article></div>${operationTable(combined("operations").slice(0, 15), "Últimos movimientos")}`;
    if (section === "reports") return reports();
    if (!selected()) return `${empty("Selecciona un evento en el selector superior para registrar operaciones. Cada evento conserva su propio inventario, ventas y caja.")}${eventCards()}`;
    if (section === "products") return products();
    if (section === "funding") return `<div class="fin-actions">${button("funding", "＋ Registrar inversión", "", "primary-button")}</div>${operationTable(selectedRecords().operations.filter((op) => op.kind === "funding"), "Aportes de capital")}`;
    if (section === "expenses") return expenses();
    if (section === "sales") return sales();
    if (section === "cash") return cash();
    return "";
  }

  function eventHeader() {
    const event = selected();
    if (!event) return `<p class="fin-notice">Resumen consolidado de ${events.length} evento(s) autorizados. Selecciona uno para trabajar con sus registros.</p>`;
    return `<div class="fin-event-header">${event.flyer ? `<img src="${safeImage(event.flyer)}" alt="Flyer de ${h(event.name)}" />` : ""}<div><h3>${h(event.name)}</h3><p>${h(event.eventDate || "Fecha pendiente")} ${h(event.eventTime)} · ${h(event.location || "Lugar pendiente")}</p><p>${h(event.organizer)} · ${phases[event.phase]} · Presupuesto ${money(event.budgetCents)}</p></div></div>`;
  }

  function eventCards() {
    const disabled = isOwner() ? sourceEvents.filter((source) => !events.some((e) => e.id === source.id)) : [];
    return `<div class="fin-event-grid">${events.map((event) => {
      const summary = summarize(records[event.id]?.operations || [], records[event.id]?.products || [], event.budgetCents);
      return `<article>${event.flyer ? `<img src="${safeImage(event.flyer)}" alt="Flyer" />` : ""}<span class="fin-badge">${phases[event.phase]}</span><h3>${h(event.name)}</h3><p>${h(event.eventDate)} ${h(event.eventTime)} · ${h(event.location)}</p><p>Resultado ${money(summary.profit)} · Caja ${money(summary.cash)}</p>${button("open-event", "Abrir dashboard →", event.id)}${isOwner() ? button("configure", "Asignación y configuración", event.id) : ""}</article>`;
    }).join("")}${disabled.map((event) => `<article><span class="fin-badge">EVENTO EXISTENTE</span><h3>${h(event.name)}</h3><p>Su sorteo y entradas siguen disponibles en Eventos. Habilita aquí su gestión financiera sin modificar esos datos.</p>${button("configure", "Habilitar gestión financiera", event.id)}</article>`).join("")}</div>${!events.length && !disabled.length ? empty(isOwner() ? "Crea un evento en la sección Eventos del panel principal y luego habilítalo aquí." : "Todavía no tienes eventos asignados. El organizador puede asignarlos desde Gestión → Mis eventos.") : ""}`;
  }

  function operationTable(rows, title = "Historial de movimientos") {
    return `<section class="fin-panel"><h3>${title}</h3><div class="fin-table-wrap"><table><thead><tr><th>Fecha / responsable</th><th>Concepto / tipo</th><th>Categoría</th><th>Unidades</th><th>Importe</th><th>Pagado</th><th>Método</th><th>Detalle</th></tr></thead><tbody>${rows.map((op) => `<tr><td>${h(op.date)}<small>${op.createdAt ? h(ecuadorTime(op.createdAt)) : "Sincronizando"}<br>${h(op.actorEmail)}</small></td><td>${h(op.concept)}<small>${h(KINDS[op.kind])}${op.eventName ? ` · ${h(op.eventName)}` : ""}</small></td><td>${h(op.category)}</td><td>${op.quantity || "—"}</td><td>${money(op.amountCents)}</td><td>${money(op.paidCents)}</td><td>${METHODS[op.method]}</td><td>${h(op.note || "—")}${op.details ? `<details><summary>Ficha antes / después</summary><pre class="fin-audit-detail">${h(op.details)}</pre></details>` : ""}${op.attachmentId ? button("attachment", "Comprobante", op.id) : ""}</td></tr>`).join("") || '<tr><td colspan="8">Sin movimientos.</td></tr>'}</tbody></table></div></section>`;
  }

  function products() {
    const rows = selectedRecords().products.filter((p) => (!search || `${p.name} ${p.supplier}`.toLowerCase().includes(search.toLowerCase())) && (!category || p.category === category) && (!stockFilter || (stockFilter === "empty" ? p.stock === 0 : p.stock > 0)));
    return `<div class="fin-actions">${button("new-product", "＋ Agregar producto", "", "primary-button")}${button("purchase", "Nueva compra / entrada")}</div>
      <form id="fin-product-filter" class="fin-filters">${field("search", "Buscar producto / proveedor", search)}${select("category", "Categoría", { "": "Todas", ...Object.fromEntries([...new Set(selectedRecords().products.map((p) => p.category))].map((v) => [v, v])) }, category)}${select("stock", "Disponibilidad", { "": "Todas", available: "Con existencias", empty: "Agotados" }, stockFilter)}<button class="outline-button">Filtrar</button></form>
      <div class="fin-table-wrap"><table><thead><tr><th>Producto</th><th>Categoría</th><th>Stock</th><th>Costo promedio</th><th>Precio venta</th><th>Margen estimado/u.</th><th>Acciones</th></tr></thead><tbody>${rows.map((p) => `<tr><td>${p.image ? `<img class="fin-product-image" src="${safeImage(p.image)}" alt="" />` : ""}<b>${h(p.name)}</b><small>${h(p.supplier)} · ${p.status === "active" ? "Activo" : "Inactivo"}</small></td><td>${h(p.category)}</td><td class="${p.stock ? "" : "fin-negative"}">${p.stock}</td><td>${money(p.stock ? Math.round(p.inventoryValueCents / p.stock) : p.costCents)}</td><td>${money(p.saleCents)}</td><td>${money(p.saleCents - (p.stock ? Math.round(p.inventoryValueCents / p.stock) : p.costCents))}</td><td><div class="fin-row-actions">${button("edit-product", "Editar", p.id)}${button("product-history", "Historial", p.id)}${button("stock", "Movimiento", p.id)}${p.stock > 0 && p.status === "active" ? button("sale", "Vender", p.id) : ""}</div></td></tr>`).join("") || '<tr><td colspan="7">No hay productos para este filtro.</td></tr>'}</tbody></table></div>`;
  }

  function expenses() {
    const { operations, payables } = selectedRecords();
    const debts = payables;
    return `<div class="fin-actions">${button("expense", "＋ Registrar gasto", "", "primary-button")}${button("purchase", "Compra de mercadería")}</div><p class="fin-notice">Las compras se registran en inventario. Su costo se reconoce al vender o perder unidades; no vuelvas a registrarlas como gasto operativo.</p>
      <div class="fin-panel"><h3>Estado de gastos y compras</h3>${debts.map((debt) => { const op = operations.find((o) => o.id === debt.id); const status = debt.remainingCents === 0 ? "Pagado" : (op?.amountCents || 0) > debt.remainingCents ? "Parcial" : "Pendiente"; return `<div class="fin-debt"><span>${h(op?.concept)}<small>${h(op?.payee)} · ${status} · Total ${money(op?.amountCents)}</small></span><strong>Pendiente ${money(debt.remainingCents)}</strong>${debt.remainingCents > 0 ? button("payment", "Registrar pago", debt.id) : ""}</div>`; }).join("") || empty("No hay gastos o compras registrados.")}</div>
      ${operationTable(operations.filter((o) => ["expense", "payment", "purchase", "supplierReturn"].includes(o.kind)), "Gastos, compras y pagos")}`;
  }

  function sales() {
    const { operations, products } = selectedRecords();
    const returned = new Set(operations.filter((o) => o.kind === "refund").map((o) => o.originalId));
    return `<div class="fin-actions">${button("sale", "＋ Registrar venta", "", "primary-button")}</div><div class="fin-quick-products">${products.filter((p) => p.status === "active" && p.stock > 0).map((p) => `<button type="button" data-fin="sale" data-id="${p.id}"><b>${h(p.name)}</b><strong>${money(p.saleCents)}</strong><small>${p.stock} disponibles</small></button>`).join("") || empty("Registra productos y existencias para comenzar a vender.")}</div>
      <section class="fin-panel"><h3>Ventas · anulaciones / devoluciones</h3><div class="fin-table-wrap"><table><thead><tr><th>Fecha</th><th>Producto / responsable</th><th>Cantidad</th><th>Ingreso neto</th><th>Método</th><th>Acción</th></tr></thead><tbody>${operations.filter((o) => o.kind === "sale").map((op) => `<tr><td>${h(ecuadorTime(op.createdAt || new Date()))}</td><td>${h(op.concept)}<small>${h(op.actorEmail)}</small></td><td>${op.quantity}</td><td>${money(op.amountCents)}</td><td>${METHODS[op.method]}</td><td>${returned.has(op.id) ? "Devuelta / anulada" : can("allowRefunds") ? button("refund", "Devolver / anular", op.id) : "Sin permiso de devolución"}</td></tr>`).join("") || '<tr><td colspan="6">Sin ventas.</td></tr>'}</tbody></table></div></section>`;
  }

  function cash() {
    const ops = selectedRecords().operations;
    const summary = summarize(ops);
    const balances = Object.fromEntries(Object.keys(METHODS).map((method) => [method, ops.filter((op) => op.method === method).reduce((n, op) => n + cashEffect(op), 0)]));
    return `<div class="fin-actions">${button("cashIn", "Ingreso no comercial")}${button("cashOut", "Retiro de fondos")}${button("closure", "Realizar cierre de caja", "", "primary-button")}</div>
      <div class="fin-metrics">${Object.entries(balances).map(([method, value]) => `<article><span>${METHODS[method]}</span><strong>${money(value)}</strong><small>Saldo acumulado registrado</small></article>`).join("")}</div>
      <p class="fin-notice">Efectivo esperado: ${money(summary.cash)}. El cierre compara el saldo acumulado con el conteo físico y conserva diferencias; no borra ni reinicia movimientos. Transferencias y tarjetas no se incluyen en el efectivo contado.</p>
      <div class="fin-panel"><h3>Historial de cierres</h3>${selectedRecords().closures.map((c) => `<div class="fin-debt"><span>${h(ecuadorTime(c.createdAt || new Date()))}<small>${h(c.actorEmail)} · ${h(c.note)}</small></span><span>Esperado ${money(c.expectedCents)}<small>Contado ${money(c.countedCents)} · Diferencia ${money(c.differenceCents)}</small></span></div>`).join("") || empty("Aún no hay cierres.")}</div>
      ${operationTable(ops.filter((o) => o.paidCents), "Movimientos de fondos · todos los métodos")}`;
  }

  function reports() {
    const categories = [...new Set(combined("operations").map((op) => op.category))].sort();
    return `<p class="fin-notice">Exportación de los eventos seleccionados, con las mismas operaciones y fórmulas del dashboard. El inventario muestra existencias iniciales y finales del período por categoría; no se recorta por tipo de movimiento.</p><form id="fin-report-filter" class="fin-filters">${field("from", "Desde", filters.from, "date")}${field("to", "Hasta", filters.to, "date")}${select("category", "Categoría", { "": "Todas", ...Object.fromEntries(categories.map((c) => [c, c])) }, filters.category)}${select("kind", "Tipo de movimiento", { "": "Todos", ...KINDS }, filters.kind)}<button class="outline-button">Aplicar filtros</button></form>
      <div class="fin-actions">${button("pdf", "↓ DESCARGAR PDF", "", "primary-button")}${button("excel", "↓ DESCARGAR EXCEL (.XLSX)")}</div>
      ${operationTable(prepareReport(allowedEvents(), records, filters).operations, "Registros incluidos en el reporte")}`;
  }

  function settings() {
    const event = selected();
    return `${isOwner() ? `<div class="fin-panel"><h3>Personal y permisos</h3><p>${OPERATOR_EMAIL} · ${profile?.active ? "Acceso operativo activo" : "Acceso desactivado"} · Correo verificado obligatorio</p>${button("toggle-access", profile?.active ? "Desactivar acceso operativo" : "Activar acceso operativo")}
      <p>Asigna eventos desde Mis eventos → Asignación y configuración. Los descuentos y devoluciones se autorizan por evento. El perfil operativo no puede eliminar eventos, asignar usuarios ni cambiar presupuestos.</p></div>` : `<p class="fin-notice">Cuenta operativa con correo verificado. Las asignaciones y autorizaciones son administradas por el organizador.</p>`}
      ${event ? `<div class="fin-panel"><h3>${h(event.name)}</h3><p>Categorías: ${h(event.categories.join(", "))}</p><p>Descuentos: ${event.allowDiscounts ? "Autorizados" : "Solo organizador"} · Devoluciones: ${event.allowRefunds ? "Autorizadas" : "Solo organizador"}</p></div>
      <div class="fin-panel"><h3>Auditoría de configuración</h3>${selectedRecords().audit.map((entry) => `<p>${h(entry.action)}<small>${h(entry.actorEmail)} · ${h(ecuadorTime(entry.createdAt || new Date()))}</small></p>`).join("") || empty("Sin cambios de configuración.")}</div>${operationTable(selectedRecords().operations, "Auditoría operativa · historial inmutable")}` : empty("Selecciona un evento para consultar su auditoría.")}`;
  }

  async function drawCharts(version) {
    const { default: Chart } = await import("chart.js/auto");
    if (version !== renderVersion) return;
    const ops = combined("operations");
    const days = [...new Set(ops.map((op) => op.date))].sort();
    const sum = (rows, kind) => rows.filter((op) => kind.includes(op.kind)).reduce((n, op) => n + (op.kind === "refund" ? -1 : 1) * op.amountCents / 100, 0);
    const summary = summarize(ops);
    const spending = {};
    ops.filter((op) => ["purchase", "expense"].includes(op.kind)).forEach((op) => { spending[op.category] = (spending[op.category] || 0) + op.amountCents / 100; });
    const colors = ["#d9ff43", "#94a55a", "#ffb95c", "#8b8df7", "#ff6259", "#70c6b0"];
    const create = (id, type, labels, datasets) => {
      const canvas = root.querySelector(`#${id}`);
      if (!canvas) return;
      charts.push(new Chart(canvas, { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c6c6bf" } }, tooltip: { callbacks: { label: (context) => `${context.dataset.label || context.label}: ${money(Math.round(Number(context.raw) * 100))}` } } },
        ...(type === "bar" ? { scales: { x: { ticks: { color: "#9a9a90" } }, y: { ticks: { color: "#9a9a90" }, beginAtZero: true } } } : {}),
      } }));
    };
    create("fin-daily-chart", "bar", days, [{ label: "Ventas netas USD", data: days.map((day) => sum(ops.filter((o) => o.date === day), ["sale", "refund"])), backgroundColor: colors[0] }, { label: "Gastos USD", data: days.map((day) => sum(ops.filter((o) => o.date === day), ["expense"])), backgroundColor: colors[4] }]);
    create("fin-payments-chart", "doughnut", Object.values(METHODS), [{ data: Object.values(summary.payments).map((value) => value / 100), backgroundColor: colors }]);
    create("fin-spend-chart", "doughnut", Object.keys(spending), [{ data: Object.values(spending), backgroundColor: colors }]);
  }

  function safeImage(value) { return /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(value || "") ? h(value) : ""; }
  function showModal(title, fields, context = {}) {
    modal = { ...context, requestId: crypto.randomUUID() };
    dialog.innerHTML = `<button class="dialog-close" type="button" data-fin-close aria-label="Cerrar">×</button><p class="eyebrow">MIRAGE · GESTIÓN</p><h2>${h(title)}</h2><form id="fin-modal-form"><div class="fin-form-grid">${fields}</div><p class="form-error" id="fin-modal-error" role="alert"></p><button class="primary-button full-button" id="fin-submit"><span>Guardar registro</span><span>→</span></button></form>`;
    dialog.querySelector("[data-fin-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("form").addEventListener("submit", submitModal);
    dialog.querySelector("form").addEventListener("input", preview);
    dialog.querySelector("form").addEventListener("change", preview);
    dialog.showModal(); preview();
  }

  function openConfigure(id) {
    if (!isOwner()) throw new Error("Solo el organizador configura eventos.");
    const event = events.find((e) => e.id === id);
    const source = sourceEvents.find((e) => e.id === id) || event;
    if (!source) return;
    showModal("Configuración del evento", `<p class="fin-wide">${h(source.name)} · Los datos del sorteo y sus QR no se modifican.</p>
      ${field("eventDate", "Fecha", event?.eventDate || source.eventDate, "date")}${field("eventTime", "Hora Ecuador", event?.eventTime, "time")}
      ${field("location", "Lugar", event?.location, "text", 'maxlength="150"')}${field("organizer", "Organizador", event?.organizer || "Mirage Producciones")}
      ${field("budget", "Presupuesto USD", number(event?.budgetCents), "number", 'min="0" step="0.01" required')}${select("phase", "Estado", phases, event?.phase || "planning")}
      ${field("flyer", "URL de flyer HTTPS (opcional)", event?.flyer?.startsWith("https:") ? event.flyer : "", "url")}${field("flyerFile", "O subir flyer (imagen)", "", "file", 'accept="image/png,image/jpeg,image/webp"')}
      ${field("categories", "Categorías, separadas por coma", (event?.categories || DEFAULT_CATEGORIES).join(", "), "text", 'required maxlength="800"')}
      <label class="fin-check"><input name="assigned" type="checkbox" ${!event || event.assignedUids.includes(OPERATOR_UID) ? "checked" : ""} /> Acceso operativo de ${OPERATOR_EMAIL} (automático al crear el evento)</label>
      <label class="fin-check"><input name="allowDiscounts" type="checkbox" ${event?.allowDiscounts ? "checked" : ""} /> Autorizar descuentos al operador</label>
      <label class="fin-check"><input name="allowRefunds" type="checkbox" ${event?.allowRefunds ? "checked" : ""} /> Autorizar devoluciones / anulaciones</label>`, { action: "configure", eventId: id, source, previousFlyer: event?.flyer || "" });
  }

  function openProduct(id) {
    requireEvent();
    const p = selectedRecords().products.find((item) => item.id === id);
    showModal(p ? "Editar producto" : "Nuevo producto", `${field("name", "Nombre", p?.name, "text", 'required maxlength="100"')}
      ${select("category", "Categoría", selected().categories, p?.category)}${field("description", "Descripción", p?.description, "text", 'maxlength="500"')}
      ${field("supplier", "Proveedor", p?.supplier, "text", 'maxlength="150"')}${field("unitCost", "Compra unitaria USD (referencia)", number(p?.costCents), "number", 'min="0" step="0.01" required')}
      ${field("salePrice", "Venta unitaria USD", number(p?.saleCents), "number", 'min="0" step="0.01" required')}
      ${!p ? field("quantity", "Cantidad adquirida inicialmente", 0, "number", 'min="0" max="1000000" step="1" required') + field("date", "Fecha de compra", today(), "date", "required") + select("method", "Método de pago", METHODS) : `<p class="fin-wide">Stock actual: ${p.stock}. Para cambiar cantidades, registra una compra o un movimiento. Los costos de existencias anteriores se conservan.</p>`}
      ${select("status", "Estado", { active: "Activo", inactive: "Inactivo" }, p?.status || "active")}
      ${field("image", "URL de imagen HTTPS (opcional)", p?.image?.startsWith("https:") ? p.image : "", "url")}${field("imageFile", "O subir imagen", "", "file", 'accept="image/png,image/jpeg,image/webp"')}
      <div class="fin-notice fin-wide" id="fin-preview"></div>${noteField()}`, { action: "product", eventId: selectedId, productId: p?.id || crypto.randomUUID(), existing: p });
    if (p) dialog.querySelector('[name="note"]').value = p.note || "";
  }

  function openStock(productId, purchase = false) {
    requireEvent();
    if (!selectedRecords().products.length) return openProduct();
    const p = selectedRecords().products.find((item) => item.id === productId);
    showModal(purchase ? "Compra de inventario" : "Movimiento de inventario", `${select("productId", "Producto", Object.fromEntries(selectedRecords().products.map((p) => [p.id, `${p.name} · ${p.stock} disponibles`])), productId)}
      ${select("kind", "Tipo de movimiento", purchase ? { purchase: KINDS.purchase } : { purchase: KINDS.purchase, loss: KINDS.loss, damage: KINDS.damage, adjustmentIn: KINDS.adjustmentIn, adjustmentOut: KINDS.adjustmentOut, supplierReturn: KINDS.supplierReturn })}
      ${field("quantity", "Cantidad", 1, "number", 'min="1" step="1" required')}${field("unitCost", "Compra / entrada: costo unitario USD", number(p?.costCents || selectedRecords().products[0]?.costCents), "number", 'min="0" step="0.01" required')}
      ${field("paid", "Compra: pagado USD (vacío = total)", "", "number", 'min="0" step="0.01"')}${field("date", "Fecha", today(), "date", "required")}${select("method", "Método", METHODS)}${field("payee", "Proveedor / beneficiario", p?.supplier, "text", 'maxlength="200"')}
      ${field("receipt", "Comprobante opcional (PDF o imagen, hasta 300 KB)", "", "file", 'accept="application/pdf,image/jpeg,image/png,image/webp"')}
      <div class="fin-notice fin-wide" id="fin-preview"></div>${noteField(true)}`, { action: "operation", eventId: selectedId });
  }

  function openSale(productId) {
    requireEvent();
    const available = selectedRecords().products.filter((p) => p.stock > 0 && p.status === "active");
    if (!available.length) throw new Error("No hay productos activos con stock disponible.");
    showModal("Registrar venta", `${select("productId", "Producto", Object.fromEntries(available.map((p) => [p.id, `${p.name} · ${p.stock} disponibles`])), productId)}
      ${field("quantity", "Cantidad", 1, "number", 'min="1" step="1" required')}${field("discount", "Descuento total USD", 0, "number", `min="0" step="0.01" ${can("allowDiscounts") ? "" : "readonly"}`)}
      ${select("method", "Método de pago", METHODS)}${field("date", "Fecha", today(), "date", "required")}
      <div class="fin-sale-total fin-wide" id="fin-preview"></div>${noteField()}`, { action: "operation", kind: "sale", eventId: selectedId });
  }

  function openMoney(kind, originalId) {
    requireEvent();
    if (kind === "refund" && !can("allowRefunds")) throw new Error("El organizador debe autorizar esta operación.");
    const original = selectedRecords().operations.find((o) => o.id === originalId);
    showModal(KINDS[kind], `${original ? `<p class="fin-wide">${h(original.concept)} · ${money(original.amountCents)}. ${kind === "refund" ? "Se devolverá el total y se repondrá el inventario. La venta original permanece en el historial." : "El pago disminuirá el saldo pendiente sin volver a sumar el gasto."}</p>` : ""}
      ${kind !== "refund" ? field("concept", "Concepto", original ? `Pago: ${original.concept}` : "", "text", 'required maxlength="200"') + field("amount", "Monto total USD", "", "number", 'required min="0.01" step="0.01"') : ""}
      ${kind === "expense" ? field("paid", "Pagado USD (vacío = total, 0 = pendiente)", "", "number", 'min="0" step="0.01"') + field("category", "Categoría de gasto", "", "text", 'required maxlength="100" placeholder="Ej. DJ, sonido, publicidad, seguridad..."') : ""}
      ${field("date", "Fecha", today(), "date", "required")}${kind !== "refund" ? select("method", "Método de pago", METHODS) : ""}
      ${field("payee", "Proveedor / beneficiario / aportante", "", "text", 'maxlength="200"')}${field("receipt", "Comprobante opcional (PDF o imagen, hasta 300 KB)", "", "file", 'accept="application/pdf,image/jpeg,image/png,image/webp"')}
      ${noteField(["refund", "cashOut"].includes(kind))}`, { action: "operation", kind, originalId, eventId: selectedId, original });
  }

  function preview() {
    const output = dialog.querySelector("#fin-preview");
    if (!output) return;
    const data = Object.fromEntries(new FormData(dialog.querySelector("form")));
    try {
      const qty = units(data.quantity || 0, true);
      if (modal.action === "product") output.textContent = `Costo total adquirido: ${money(qty * cents(data.unitCost))} · Margen estimado por unidad: ${money(cents(data.salePrice) - cents(data.unitCost))}`;
      else if (modal.kind === "sale") {
        const product = records[modal.eventId].products.find((p) => p.id === data.productId);
        output.textContent = `${money(product.saleCents)} × ${qty} · Total a cobrar: ${money(qty * product.saleCents - cents(data.discount || 0))}`;
      } else output.textContent = `Compra / entrada: ${money(qty * cents(data.unitCost))}. Las salidas se valorizan al costo promedio actual, no al costo escrito en este campo.`;
    } catch { output.textContent = "Revisa los importes y las cantidades."; }
  }

  async function submitModal(event) {
    event.preventDefault();
    const form = event.target;
    const submit = dialog.querySelector("#fin-submit");
    if (submit.disabled) return;
    const context = modal;
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    dialog.querySelector("#fin-modal-error").textContent = "";
    try {
      if (context.action === "configure") {
        const flyer = data.flyerFile?.size ? await imageData(data.flyerFile) : data.flyer || context.previousFlyer;
        const categories = [...new Set(data.categories.split(",").map((s) => s.trim()).filter(Boolean))];
        if (!categories.length || categories.some((c) => c.length > 100)) throw new Error("Ingresa al menos una categoría válida.");
        await saveFinanceEvent(db, user, context.source, { ...data, flyer, categories, assigned: data.assigned === "on", allowDiscounts: data.allowDiscounts === "on", allowRefunds: data.allowRefunds === "on" });
        selectedId = context.eventId;
      } else if (context.action === "product") {
        const image = data.imageFile?.size ? await imageData(data.imageFile) : data.image || context.existing?.image || "";
        const quantity = context.existing ? 0 : units(data.quantity, true);
        await recordOperation(db, user, context.eventId, { ...data, kind: quantity ? "purchase" : "product", quantity,
          productId: context.productId, date: data.date || today(), concept: `${quantity ? "Compra inicial" : "Ficha"}: ${data.name}`,
          product: { ...data, image }, payee: data.supplier }, context.requestId);
      } else if (context.action === "closure") {
        await closeCash(db, user, context.eventId, data.counted, data.note, context.requestId);
      } else {
        let attachmentId = "";
        if (data.receipt?.size) attachmentId = await uploadAttachment(context.eventId, data.receipt, context.requestId);
        const product = records[context.eventId].products.find((p) => p.id === data.productId);
        await recordOperation(db, user, context.eventId, { ...data, kind: context.kind || data.kind, originalId: context.originalId || "", attachmentId,
          concept: data.concept || (product ? `${KINDS[context.kind || data.kind]}: ${product.name}` : `Devolución: ${context.original?.concept}`),
          category: data.category || (context.kind === "funding" ? "Capital" : context.kind === "payment" ? context.original.category : "Caja"),
        }, context.requestId);
      }
      dialog.close(); notify("Registro guardado y sincronizado.");
    } catch (error) {
      console.error(error);
      void tryActivity(db, user, { action: "finance.error", eventId: context.eventId, eventName: events.find((e) => e.id === context.eventId)?.name || "", outcome: "error",
        summary: "Operación financiera no confirmada", after: { operation: context.kind || context.action, errorCode: error.code || error.name } });
      dialog.querySelector("#fin-modal-error").textContent = error.code === "permission-denied" ? "No tienes permiso para esta operación. Verifica la asignación y las autorizaciones del evento." : error.message;
    }
    finally { submit.disabled = false; }
  }

  async function imageData(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10000000) throw new Error("Usa PNG, JPG o WebP hasta 10 MB.");
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    const result = canvas.toDataURL("image/webp", .7);
    if (result.length > 400000) throw new Error("La imagen es demasiado grande. Reduce su resolución.");
    return result;
  }

  async function uploadAttachment(eventId, file, id) {
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) || file.size > 300000) throw new Error("El comprobante debe ser PDF o imagen, de hasta 300 KB.");
    const ref = financeRef(db, eventId, "attachments", id);
    if ((await getDoc(ref)).exists()) return id;
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    await setDoc(ref, { name: file.name, mime: file.type, data, actorUid: user.uid, createdAt: serverTimestamp() });
    return id;
  }

  async function showAttachment(id) {
    const op = combined("operations").find((o) => o.id === id);
    const snapshot = await getDoc(financeRef(db, op.eventId, "attachments", op.attachmentId));
    if (!snapshot.exists()) throw new Error("No se encontró el comprobante.");
    const attachment = snapshot.data();
    const response = await fetch(attachment.data);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = attachment.name; link.click();
    void tryActivity(db, user, { action: "attachment.download", eventId: op.eventId, eventName: op.eventName, summary: `Descarga de comprobante: ${attachment.name}`, targetPath: `financeEvents/${op.eventId}/attachments/${op.attachmentId}` });
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  root.addEventListener("change", (event) => {
    if (event.target.id === "fin-event-select") { selectedId = event.target.value; search = ""; category = ""; stockFilter = ""; render(); }
  });
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    if (event.target.id === "fin-product-filter") { search = data.search; category = data.category; stockFilter = data.stock; }
    if (event.target.id === "fin-report-filter") {
      if (data.from && data.to && data.from > data.to) { notify("La fecha inicial debe ser anterior a la final.", true); return; }
      filters = data;
    }
    render();
  });
  root.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-fin]");
    if (!target || target.disabled) return;
    const action = target.dataset.fin, id = target.dataset.id;
    try {
      if (action === "section") { section = id; render(); }
      else if (action === "open-event") { selectedId = id; section = "home"; render(); }
      else if (action === "configure") openConfigure(id);
      else if (action === "new-product") openProduct();
      else if (action === "edit-product") openProduct(id);
      else if (action === "stock") openStock(id);
      else if (action === "purchase") openStock("", true);
      else if (action === "sale") openSale(id);
      else if (action === "product-history") {
        const p = selectedRecords().products.find((p) => p.id === id);
        dialog.innerHTML = `<button class="dialog-close" aria-label="Cerrar">×</button><h2>${h(p.name)}</h2>${operationTable(selectedRecords().operations.filter((op) => op.productId === id), "Historial de inventario")}`;
        dialog.querySelector("button").onclick = () => dialog.close(); dialog.showModal();
      } else if (["funding", "expense", "cashIn", "cashOut", "payment", "refund"].includes(action)) openMoney(action, id);
      else if (action === "closure") {
        requireEvent(); showModal("Cierre de caja", `<p class="fin-notice fin-wide">Se comparará con el efectivo esperado al confirmar. Este cierre no altera los fondos ni las ventas.</p>${field("counted", "Efectivo contado USD", "", "number", 'required min="0" step="0.01"')}${noteField()}`, { action: "closure", eventId: selectedId });
      } else if (action === "toggle-access") {
        if (!isOwner() || !confirm(`${profile?.active ? "Desactivar" : "Activar"} el acceso operativo de ${OPERATOR_EMAIL}?`)) return;
        const batch = writeBatch(db);
        const auditRef = doc(collection(db, "userAudit"));
        batch.set(doc(db, "users", OPERATOR_UID), { email: OPERATOR_EMAIL, role: "operator", active: !profile?.active, auditId: auditRef.id, updatedAt: serverTimestamp() });
        batch.set(auditRef, { action: profile?.active ? "Acceso desactivado" : "Acceso activado", subjectUid: OPERATOR_UID, actorUid: user.uid, actorEmail: user.email, createdAt: serverTimestamp(), before: JSON.stringify({ active: Boolean(profile?.active) }), after: JSON.stringify({ active: !profile?.active }) });
        await batch.commit(); notify("Permiso actualizado.");
      } else if (action === "attachment") await showAttachment(id);
      else if (action === "pdf" || action === "excel") {
        if (!ready()) throw new Error("Espera la sincronización antes de exportar.");
        target.disabled = true;
        const report = prepareReport(allowedEvents(), records, filters);
        await (action === "pdf" ? downloadPdf(report) : downloadExcel(report));
        await tryActivity(db, user, { action: "finance.export", eventId: selectedId, eventName: selected()?.name || "Resumen general", summary: `Reporte financiero descargado en ${action === "pdf" ? "PDF" : "Excel"}`, after: { format: action, filters, eventIds: allowedEvents().map((e) => e.id), operations: report.operations.length } });
        notify("Reporte generado con los filtros seleccionados.");
      }
    } catch (error) { console.error(error); notify(error.message, true); }
    finally { target.disabled = false; }
  });
  return { start, stop };
}
