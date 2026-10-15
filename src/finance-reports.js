import { KINDS, METHODS, summarize, money, ecuadorTime, inventoryAt, filterOperations, cashEffect } from "./finance-core.js";

export function prepareReport(events, records, filters) {
  const all = events.flatMap((event) => (records[event.id]?.operations || []).map((op) => ({ ...op, eventId: event.id, eventName: event.name })));
  const operations = filterOperations(all, filters).sort((a, b) => a.date.localeCompare(b.date));
  const products = events.flatMap((event) => inventoryAt(records[event.id]?.products || [], records[event.id]?.operations || [], filters.to || undefined, filters.from)
    .filter((p) => !filters.category || p.category === filters.category).map((p) => ({ ...p, eventId: event.id, eventName: event.name })));
  const summary = summarize(operations, products, events.reduce((sum, event) => sum + event.budgetCents, 0));
  const opening = filterOperations(all, { category: filters.category, kind: filters.kind })
    .filter((op) => filters.from && op.date < filters.from).reduce((sum, op) => sum + cashEffect(op), 0);
  const closures = events.flatMap((event) => (records[event.id]?.closures || []).map((c) => ({ ...c, eventName: event.name })))
    .filter((c) => {
      const date = c.createdAt?.toDate?.().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }) || "";
      return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
    });
  return { events, operations, products, summary, filters, opening, closures, generated: ecuadorTime() };
}

export const reportSummary = (report) => [
  ["Presupuesto planificado", report.summary.budgetAvailable + report.summary.purchases + report.summary.expenses],
  ["Aportes recibidos (no son ventas)", report.summary.investment],
  ["Compras de inventario netas", report.summary.purchases], ["Gastos operativos devengados", report.summary.expenses],
  ["Ingresos netos por ventas", report.summary.income], ["Costo de productos vendidos", report.summary.cogs],
  ["Pérdidas / daños / ajustes de salida", report.summary.losses], ["Ganancia o pérdida", report.summary.profit],
  ["Flujo neto del período", report.summary.flow], ["Saldo inicial de fondos", report.opening],
  ["Saldo final de fondos (filtros aplicados)", report.opening + report.summary.flow],
  ["Inventario final valorizado", report.summary.stockValue], ["Presupuesto restante", report.summary.budgetAvailable],
];

const filename = (name) => `Mirage-${name}-${Date.now()}`;
const operationRows = (ops) => ops.map((op) => [op.eventName, op.date, op.createdAt ? ecuadorTime(op.createdAt) : "Sincronizando", KINDS[op.kind], op.concept, op.category, op.quantity,
  op.unitPriceCents / 100, op.discountCents / 100, op.amountCents / 100, op.paidCents / 100, op.costCents / 100,
  cashEffect(op) / 100, METHODS[op.method], op.actorEmail, op.payee, op.id, op.originalId, op.note, op.attachmentId, op.details || ""]);

export async function downloadExcel(report) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mirage Producciones";
  workbook.created = new Date();
  const add = (title, columns, rows, monetary = []) => {
    const sheet = workbook.addWorksheet(title);
    sheet.columns = columns.map((header, i) => ({ header, key: `c${i}`, width: i === 0 ? 30 : 24 }));
    rows.forEach((row) => sheet.addRow(row.map((value) => typeof value === "string" ? value.replace(/^[=+@]/, "'$&") : value)));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: columns.length } };
    sheet.getRow(1).height = 30;
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF101010" } };
      cell.font = { bold: true, color: { argb: "FFD9FF43" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    sheet.eachRow((row, i) => {
      if (i > 1 && i % 2 === 0) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2ED" } }; });
    });
    monetary.forEach((column) => { sheet.getColumn(column).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00'; });
    return sheet;
  };
  const summary = add("Resumen general", ["Indicador", "USD"], reportSummary(report).map(([key, value]) => [key, value / 100]), [2]);
  summary.addRow(["Generado (Ecuador)", report.generated]);
  summary.addRow(["Desde / hasta", `${report.filters.from || "Inicio"} / ${report.filters.to || "Actualidad"}`]);
  summary.addRow(["Categoría / movimiento", `${report.filters.category || "Todas"} / ${KINDS[report.filters.kind] || "Todos"}`]);
  summary.addRow(["Eventos", report.events.map((event) => event.name).join(" / ")]);
  const inventory = add("Productos e inventario", ["Evento", "Producto", "Categoría", "Stock inicial período", "Stock final", "Valor final USD", "Precio venta USD", "Proveedor"],
    report.products.map((p) => [p.eventName, p.name, p.category, p.initial, p.stock, p.inventoryValueCents / 100, p.saleCents / 100, p.supplier]), [6, 7]);
  inventory.addRow(["TOTAL", "", "", report.products.length ? { formula: `SUM(D2:D${report.products.length + 1})`, result: report.products.reduce((s, p) => s + p.initial, 0) } : 0,
    report.summary.available, report.summary.stockValue / 100]);
  const cols = ["Evento", "Fecha contable", "Registro Ecuador", "Tipo", "Concepto", "Categoría", "Unidades", "Precio unitario USD", "Descuento USD", "Importe USD", "Pagado USD", "Costo inventario USD", "Flujo USD", "Método", "Responsable", "Proveedor / beneficiario", "ID operación", "ID origen", "Observaciones", "ID comprobante", "Auditoría ficha antes / después"];
  const moneyCols = [8, 9, 10, 11, 12, 13];
  add("Ventas", cols, operationRows(report.operations.filter((op) => ["sale", "refund"].includes(op.kind))), moneyCols);
  add("Inversiones y compras", cols, operationRows(report.operations.filter((op) => ["funding", "purchase", "supplierReturn"].includes(op.kind))), moneyCols);
  add("Gastos", cols, operationRows(report.operations.filter((op) => ["expense", "payment"].includes(op.kind))), moneyCols);
  add("Movimientos de caja", ["Evento", "Fecha", "Concepto", "Tipo", "Método", "Flujo USD", "Responsable"], report.operations.filter((op) => op.paidCents).map((op) => [op.eventName, op.date, op.concept, KINDS[op.kind], METHODS[op.method], cashEffect(op) / 100, op.actorEmail]), [6]);
  const results = add("Resultados financieros", ["Concepto", "USD"], [
    ["Ventas netas", report.summary.income / 100], ["Costo de ventas", report.summary.cogs / 100],
    ["Gastos operativos", report.summary.expenses / 100], ["Pérdidas de inventario", report.summary.losses / 100],
    ["Resultado económico", { formula: "B2-B3-B4-B5", result: report.summary.profit / 100 }],
    ...Object.entries(report.summary.payments).map(([key, value]) => [`Ventas netas / ${METHODS[key]}`, value / 100]),
  ], [2]);
  results.addRow(["Criterio", "Costo promedio ponderado; compras no se restan otra vez de la utilidad."]);
  add("Auditoría y movimientos", cols, operationRows(report.operations), moneyCols);
  add("Cierres de caja", ["Evento", "Fecha Ecuador", "Esperado USD", "Contado USD", "Diferencia USD", "Responsable", "Notas"], report.closures.map((c) => [c.eventName, ecuadorTime(c.createdAt), c.expectedCents / 100, c.countedCents / 100, c.differenceCents / 100, c.actorEmail, c.note]), [3, 4, 5]);
  const buffer = await workbook.xlsx.writeBuffer();
  saveBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename("Finanzas")}.xlsx`);
}

export async function downloadPdf(report) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const pdf = new jsPDF();
  pdf.setFillColor(8, 8, 8);
  pdf.rect(0, 0, 210, 32, "F");
  try {
    const image = await fetch("./logo.png").then((response) => response.blob());
    const data = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(image); });
    pdf.addImage(data, "PNG", 14, 9, 50, 9);
  } catch { /* Brand name remains available if the image cannot be fetched. */ }
  pdf.setTextColor(217, 255, 67);
  pdf.setFontSize(13);
  pdf.text("INFORME FINANCIERO", 116, 19);
  pdf.setTextColor(20);
  pdf.setFontSize(16);
  pdf.text("Mirage Producciones", 14, 44);
  pdf.setFontSize(9);
  pdf.text(`Generado: ${report.generated} - Ecuador / USD`, 14, 52);
  pdf.text(`Período: ${report.filters.from || "Inicio"} a ${report.filters.to || "Actualidad"}`, 14, 58);
  pdf.text(`Filtros: ${report.filters.category || "Todas las categorías"} / ${KINDS[report.filters.kind] || "Todos los movimientos"}`, 14, 64);
  let y = 70;
  const table = (title, headers, body) => {
    if (y > 245) { pdf.addPage(); y = 20; }
    pdf.setFontSize(12); pdf.text(title, 14, y);
    autoTable(pdf, { startY: y + 5, head: [headers], body: body.length ? body : [["Sin movimientos en el filtro seleccionado"]],
      theme: "striped", styles: { fontSize: 7, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: [16, 16, 16], textColor: [217, 255, 67] }, margin: { top: 18, bottom: 20 }, rowPageBreak: "avoid" });
    y = pdf.lastAutoTable.finalY + 12;
  };
  const phaseLabels = { planning: "Planificación", upcoming: "Próximo", live: "En desarrollo", finished: "Finalizado" };
  table("Eventos incluidos", ["Evento", "Fecha / hora", "Lugar", "Organizador", "Estado"], report.events.map((e) => [e.name, `${e.eventDate} ${e.eventTime}`, e.location, e.organizer, phaseLabels[e.phase] || e.phase]));
  table("Resumen ejecutivo", ["Indicador", "Importe USD"], reportSummary(report).map(([name, value]) => [name, money(value)]));
  table("Productos: inventario inicial y final", ["Evento / producto", "Categoría", "Inicial", "Final", "Valor final"], report.products.map((p) => [`${p.eventName} / ${p.name}`, p.category, p.initial, p.stock, money(p.inventoryValueCents)]));
  table("Inversiones, compras y gastos", ["Fecha", "Tipo / concepto", "Total", "Pagado", "Responsable"], report.operations.filter((o) => ["funding", "purchase", "expense", "payment", "supplierReturn"].includes(o.kind)).map((o) => [o.date, `${KINDS[o.kind]} / ${o.concept}`, money(o.amountCents), money(o.paidCents), o.actorEmail]));
  table("Ventas y devoluciones", ["Fecha", "Producto / concepto", "Unidades", "Importe", "Método"], report.operations.filter((o) => ["sale", "refund"].includes(o.kind)).map((o) => [o.date, o.concept, o.quantity, `${o.kind === "refund" ? "-" : ""}${money(o.amountCents)}`, METHODS[o.method]]));
  table("Ingresos netos por método de pago", ["Método", "Ingreso neto"], Object.entries(report.summary.payments).map(([key, value]) => [METHODS[key], money(value)]));
  table("Cierres de caja", ["Fecha", "Esperado", "Contado", "Diferencia", "Responsable"], report.closures.map((c) => [ecuadorTime(c.createdAt), money(c.expectedCents), money(c.countedCents), money(c.differenceCents), c.actorEmail]));
  if (y > 205) { pdf.addPage(); y = 20; }
  pdf.setFontSize(12); pdf.text("Distribución económica", 14, y);
  const bars = [["Ventas netas", report.summary.income], ["Costo de ventas", report.summary.cogs], ["Gastos operativos", report.summary.expenses], ["Pérdidas inventario", report.summary.losses]];
  const max = Math.max(1, ...bars.map(([, n]) => Math.abs(n)));
  bars.forEach(([label, value], index) => {
    const top = y + 8 + index * 10;
    pdf.setFontSize(8); pdf.text(label, 14, top + 4);
    pdf.setFillColor(130, 150, 36); pdf.rect(55, top, Math.max(0.2, Math.abs(value) / max * 90), 6, "F");
    pdf.text(money(value), 155, top + 4);
  });
  y += 59;
  if (y > 230) { pdf.addPage(); y = 20; }
  pdf.setFontSize(9);
  const conclusion = `Resultado: ${money(report.summary.profit)} (${report.summary.profit >= 0 ? "ganancia" : "pérdida"}). Flujo neto: ${money(report.summary.flow)}. La utilidad descuenta el costo de unidades vendidas y los gastos devengados; la caja registra exclusivamente cobros y pagos. Aportes y retiros no son ventas ni gastos. Los registros de entradas QR anteriores no se importan como ingresos sin precio o pago registrados. Inventario por costo promedio ponderado, al cierre de la fecha indicada; sus existencias no se limitan por el filtro de tipo de movimiento.`;
  pdf.text(pdf.splitTextToSize(conclusion, 180), 14, y);
  const count = pdf.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(100);
    pdf.text(`Mirage Producciones | Confidencial | ${i} / ${count}`, 14, 287);
  }
  pdf.save(`${filename("Reporte")}.pdf`);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
