import "./finance.css";
import "./audit.css";
import { collection, query, where, orderBy, limit, startAfter, getDocsFromServer } from "firebase/firestore";
import { OWNER_UID, escape as h, ecuadorTime, money } from "./finance-core.js";
import { normalizeAudit, filterAudit, auditDetailSections, AUDIT_MODULES, OUTCOMES, ROLES } from "./audit-core.js";
import { tryActivity } from "./audit-store.js";
import { exportAuditExcel, exportAuditPdf } from "./audit-reports.js";

const select = (name, title, values, value) => `<label class="fin-field">${title}<select name="${name}"><option value="">Todos</option>${Object.entries(values).map(([key, label]) => `<option value="${h(key)}" ${key === value ? "selected" : ""}>${h(label)}</option>`).join("")}</select></label>`;
const input = (name, title, value = "", type = "text") => `<label class="fin-field">${title}<input name="${name}" type="${type}" value="${h(value)}" ${type === "text" ? 'maxlength="150"' : ""} /></label>`;

function renderDetails(row) {
  return `<details><summary>Ver detalle</summary><p>${h(row.evidence)}</p>
    <p><b>Usuario:</b> ${h(row.actorEmail)}<br><b>Perfil:</b> ${h(ROLES[row.role] || row.role)}<br><b>Acción:</b> ${h(row.action)}<br><b>Resultado:</b> ${h(OUTCOMES[row.outcome])}${row.targetPath ? `<br><b>Documento:</b> ${h(row.targetPath)}` : ""}</p>
    ${auditDetailSections(row).map(({ label, text }) => `<b>${h(label)}</b><pre>${h(text)}</pre>`).join("")}</details>`;
}

export async function readAuditSources(db, filters, cancelled = () => false) {
  async function read(ref, dated = true) {
    const constraints = [];
    if (dated) {
      if (filters.from) constraints.push(where("createdAt", ">=", new Date(`${filters.from}T00:00:00-05:00`)));
      if (filters.to) constraints.push(where("createdAt", "<=", new Date(`${filters.to}T23:59:59.999-05:00`)));
      constraints.push(orderBy("createdAt", "desc"));
    }
    const rows = [];
    let cursor;
    do {
      if (cancelled()) throw new Error("Carga cancelada");
      const page = await getDocsFromServer(query(ref, ...constraints, ...(cursor ? [startAfter(cursor)] : []), limit(250)));
      rows.push(...page.docs);
      if (page.size < 250) break;
      cursor = page.docs[page.docs.length - 1];
    } while (!cancelled());
    return rows;
  }
  const [logs, permissionLogs, financeEvents, originalEvents] = await Promise.all([
    read(collection(db, "systemAudit")), read(collection(db, "userAudit")),
    read(collection(db, "financeEvents"), false), read(collection(db, "events"), false),
  ]);
  const names = new Map(originalEvents.map((event) => [event.id, event.data().name]));
  const result = [...logs.map((entry) => normalizeAudit("system", entry.id, entry.data())),
    ...permissionLogs.map((entry) => normalizeAudit("users", entry.id, entry.data()))];
  for (const event of financeEvents) {
    const context = { id: event.id, name: names.get(event.id) || event.data().name };
    names.set(context.id, context.name);
    if (filters.event && filters.event !== event.id) continue;
    for (const source of ["operations", "audit", "closures", "attachments"]) {
      const entries = await read(collection(event.ref, source));
      result.push(...entries.map((entry) => normalizeAudit(source === "audit" ? "configuration" : source, entry.id, entry.data(), context)));
    }
  }
  for (const row of result) if (row.eventId && row.eventName && row.eventName !== "Sin evento") names.set(row.eventId, row.eventName);
  return { rows: result, names };
}

export function createAuditModule({ root, db, notify }) {
  let user, rows = [], names = new Map(), filters = {}, loadedFilters = {}, page = 0, busy = false, exporting = false, error = "", version = 0;
  const pageSize = 50;
  function start(currentUser) {
    stop();
    if (currentUser.uid !== OWNER_UID) return;
    user = currentUser; void load();
  }
  function stop() { user = null; rows = []; names = new Map(); filters = {}; loadedFilters = {}; page = 0; busy = false; exporting = false; error = ""; version++; root.innerHTML = ""; }
  async function load() {
    if (!user || busy) return;
    const request = ++version;
    busy = true; error = ""; render();
    const selection = { ...filters };
    try {
      const data = await readAuditSources(db, selection, () => request !== version || !user);
      if (request !== version || !user) return;
      rows = data.rows; names = data.names; loadedFilters = selection; page = 0;
    } catch (failure) {
      if (request !== version) return;
      console.error(failure); rows = [];
      error = "No se pudo obtener el historial completo del servidor. Revisa la conexión y tus permisos. Las exportaciones están desactivadas hasta actualizar correctamente.";
    } finally { if (request === version && user) { busy = false; render(); } }
  }
  function render() {
    if (!user) return;
    const filtered = filterAudit(rows, filters);
    page = Math.max(0, Math.min(page, Math.ceil(filtered.length / pageSize) - 1));
    const users = Object.fromEntries(rows.filter((row) => row.actorUid).map((row) => [row.actorUid, row.actorEmail]));
    const outdated = filters.from !== loadedFilters.from || filters.to !== loadedFilters.to || filters.event !== loadedFilters.event;
    const disabled = busy || exporting || Boolean(error) || outdated;
    root.innerHTML = `<div class="audit-heading"><div><p class="eyebrow">MIRAGE · CONTROL DEL SISTEMA</p><h1>Auditoría</h1><p>Logs, reportes y trazabilidad de operaciones. Acceso exclusivo del organizador.</p></div><button class="outline-button" data-audit="refresh" ${busy ? "disabled" : ""}>${busy ? "Cargando del servidor..." : "Actualizar historial"}</button></div>
      <p class="fin-notice">Incluye el historial financiero disponible y los nuevos movimientos auditados de eventos, participantes, sorteos, QR, sesiones, permisos y descargas. Las acciones antiguas sin log no se reconstruyen. No se muestran contraseñas, tokens ni códigos QR utilizables.</p>
      <form id="audit-filters" class="fin-filters">${input("from", "Desde · Ecuador", filters.from, "date")}${input("to", "Hasta · Ecuador", filters.to, "date")}${select("event", "Evento", Object.fromEntries(names), filters.event)}${select("actor", "Usuario", users, filters.actor)}${select("module", "Módulo", AUDIT_MODULES, filters.module)}${select("outcome", "Resultado", OUTCOMES, filters.outcome)}${input("search", "Buscar acción, detalle, ID o usuario", filters.search)}<button class="outline-button" ${busy ? "disabled" : ""}>Aplicar y cargar</button></form>
      ${error ? `<p role="alert" class="form-error">${error}</p>` : ""}
      <div class="fin-metrics audit-metrics"><article><span>Registros filtrados</span><strong>${filtered.length}</strong></article><article><span>Realizados</span><strong>${filtered.filter((row) => row.outcome === "success").length}</strong></article><article><span>Rechazados / errores</span><strong>${filtered.filter((row) => row.outcome !== "success").length}</strong></article></div>
      <div class="fin-actions"><button class="primary-button" data-audit="pdf" ${disabled ? "disabled" : ""}>↓ DESCARGAR PDF</button><button class="outline-button" data-audit="excel" ${disabled ? "disabled" : ""}>↓ DESCARGAR EXCEL (.XLSX)</button></div>
      <p class="fin-footnote">Se exportan los ${filtered.length} registros filtrados, incluidos los de otras páginas de la tabla. Actualiza el historial para incluir movimientos recientes. Los resultados de sesiones y errores son actividad de la aplicación autenticada; las mutaciones de eventos y QR se guardan junto a su log.</p>
      <div class="fin-table-wrap"><table class="audit-table"><thead><tr><th>Fecha / hora Ecuador</th><th>Usuario / perfil</th><th>Evento / módulo</th><th>Acción / resultado</th><th>Descripción</th><th>Cambios</th></tr></thead><tbody>${filtered.slice(page * pageSize, (page + 1) * pageSize).map((row) => `<tr><td>${row.createdAt ? h(ecuadorTime(row.createdAt)) : "Fecha no registrada"}<small>${h(row.documentId)}</small></td><td>${h(row.actorEmail)}<small>${h(ROLES[row.role])}</small></td><td>${h(row.eventName || "Sin evento")}<small>${h(AUDIT_MODULES[row.module])}</small></td><td>${h(row.action)}<small class="audit-${row.outcome}">${OUTCOMES[row.outcome]}</small></td><td>${h(row.summary)}${row.amountCents == null ? "" : `<small>Importe: ${money(row.amountCents)}</small>`}</td><td>${renderDetails(row)}</td></tr>`).join("") || `<tr><td colspan="6">${busy ? "Cargando..." : "Pulsa Actualizar historial o ajusta los filtros para consultar los registros."}</td></tr>`}</tbody></table></div>
      <div class="audit-pagination"><button class="outline-button" data-audit="previous" ${page === 0 ? "disabled" : ""}>← Anterior</button><span>Página ${page + 1} / ${Math.max(1, Math.ceil(filtered.length / pageSize))}</span><button class="outline-button" data-audit="next" ${(page + 1) * pageSize >= filtered.length ? "disabled" : ""}>Siguiente →</button></div>`;
  }
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || exporting) return;
    const next = Object.fromEntries(new FormData(event.target));
    if (next.from && next.to && next.from > next.to) { notify("La fecha inicial debe ser anterior a la final.", true); return; }
    filters = next; void load();
  });
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-audit]");
    if (!button || button.disabled || !user) return;
    const action = button.dataset.audit;
    if (action === "refresh") return load();
    if (action === "previous" || action === "next") { page += action === "next" ? 1 : -1; render(); return; }
    if (exporting || busy || error) return;
    const currentUser = user, snapshot = filterAudit(rows, filters), selection = { ...filters };
    exporting = true; render();
    try {
      await (action === "pdf" ? exportAuditPdf(snapshot, selection) : exportAuditExcel(snapshot, selection));
      const logged = await tryActivity(db, currentUser, { action: "audit.export", summary: `Auditoría exportada en ${action === "pdf" ? "PDF" : "Excel"}: ${snapshot.length} registros`, after: { format: action, records: snapshot.length, filters: selection } });
      notify(logged ? "Auditoría descargada. La descarga aparecerá al actualizar el historial." : "Archivo descargado; no se pudo confirmar el log de descarga.");
    } catch (failure) {
      console.error(failure); notify("No se pudo generar el reporte de auditoría.", true);
      void tryActivity(db, currentUser, { action: "audit.export", outcome: "error", summary: "Error al generar reporte de auditoría", after: { format: action, errorCode: failure.code || failure.name } });
    } finally { exporting = false; if (user) render(); }
  });
  return { start, stop };
}
