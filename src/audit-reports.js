import { ecuadorTime, money } from "./finance-core.js";
import { AUDIT_MODULES, OUTCOMES, ROLES } from "./audit-core.js";

const detailText = (value) => value == null ? "—" : JSON.stringify(value, null, 2);
const formatDate = (row) => row.createdAt ? ecuadorTime(row.createdAt) : "Fecha no registrada";
export function auditReportRows(rows) {
  return rows.map((row) => [row.documentId, formatDate(row), row.actorEmail, row.actorUid, ROLES[row.role] || row.role,
    row.eventName || "Sin evento", row.eventId, AUDIT_MODULES[row.module] || row.module, row.action,
    OUTCOMES[row.outcome], row.summary, row.amountCents == null ? null : row.amountCents / 100, row.targetPath, row.evidence]);
}

export async function exportAuditExcel(rows, filters, generated = new Date()) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook(); book.creator = "Mirage Producciones"; book.created = generated;
  const summary = book.addWorksheet("Resumen"); summary.columns = [{ width: 32 }, { width: 100 }];
  summary.addRows([["MIRAGE · AUDITORÍA", "Historial del sistema"], ["Generado en Ecuador", ecuadorTime(generated)], ["Registros exportados", rows.length],
    ["Desde / hasta", `${filters.from || "Inicio"} / ${filters.to || "Actualidad"}`], ["Filtros", JSON.stringify(filters)],
    ["Cobertura", "Movimientos con registro persistente disponible. Los cambios nuevos de eventos/QR llevan auditoría atómica; no se inventan responsables ni fechas anteriores."],
    ["Privacidad", "No contiene contraseñas, tokens, códigos QR utilizables ni contenido de comprobantes."],
    ["Resultados", "Realizado = operación guardada. Rechazado / error = actividad informada por el cliente autenticado."],
  ]);
  const sheet = book.addWorksheet("Auditoría");
  const headers = ["ID registro", "Fecha / hora Ecuador", "Usuario", "UID", "Perfil", "Evento", "ID evento", "Módulo", "Acción", "Resultado", "Descripción", "Importe USD (si aplica)", "Documento", "Origen"];
  sheet.columns = headers.map((header, index) => ({ header, width: [2, 5, 10, 12].includes(index) ? 38 : 25 }));
  auditReportRows(rows).forEach((row) => sheet.addRow(row));
  sheet.getColumn(12).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
  if (rows.length) sheet.autoFilter = { from: "A1", to: `N${rows.length + 1}` };
  const changes = book.addWorksheet("Cambios y detalles");
  changes.columns = [{ header: "ID registro", width: 32 }, { header: "Tipo de detalle", width: 24 }, { header: "Parte", width: 10 }, { header: "Datos", width: 110 }];
  for (const row of rows) {
    for (const [label, value] of [["Antes", row.before], ["Después / cambios", row.after]]) {
      const text = detailText(value);
      for (let index = 0; index < text.length; index += 30000) changes.addRow([row.documentId, label, index / 30000 + 1, text.slice(index, index + 30000)]);
    }
  }
  for (const item of book.worksheets) {
    item.views = [{ state: "frozen", ySplit: 1 }];
    item.getRow(1).height = 28;
    item.getRow(1).eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF101010" } }; cell.font = { bold: true, color: { argb: "FFD9FF43" } }; });
    item.eachRow((row, i) => { if (i > 1 && i % 2 === 0) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4EF" } }; }); });
  }
  save(new Blob([await book.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Mirage-Auditoria-${generated.getTime()}.xlsx`);
}

export async function exportAuditPdf(rows, filters, generated = new Date()) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const pdf = new jsPDF({ orientation: "landscape" });
  const heading = () => {
    pdf.setFillColor(8, 8, 8); pdf.rect(0, 0, 297, 26, "F");
    pdf.setTextColor(217, 255, 67); pdf.setFontSize(15); pdf.text("MIRAGE PRODUCCIONES · AUDITORÍA", 14, 16); pdf.setTextColor(30);
  };
  heading(); pdf.setFontSize(9);
  pdf.text(`Generado: ${ecuadorTime(generated)} · USD · Registros: ${rows.length}`, 14, 35);
  pdf.text(`Período: ${filters.from || "Inicio"} a ${filters.to || "Actualidad"}`, 14, 41);
  pdf.text(pdf.splitTextToSize(`Filtros: ${JSON.stringify(filters)}`, 265), 14, 47);
  autoTable(pdf, { startY: 60, margin: { top: 32, bottom: 17 }, head: [["Fecha Ecuador", "Usuario / perfil", "Evento / módulo", "Acción / resultado", "Descripción", "ID / documento"]],
    body: rows.length ? rows.map((row) => [formatDate(row), `${row.actorEmail}\n${ROLES[row.role] || row.role}`, `${row.eventName || "Sin evento"}\n${AUDIT_MODULES[row.module]}`, `${row.action}\n${OUTCOMES[row.outcome]}`, `${row.summary}${row.amountCents == null ? "" : `\nImporte: ${money(row.amountCents)}`}`, `${row.documentId}\n${row.targetPath}`]) : [["Sin registros para los filtros aplicados"]],
    styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [16, 16, 16], textColor: [217, 255, 67] }, rowPageBreak: "avoid", didDrawPage: heading });
  if (rows.length) {
    pdf.addPage(); heading(); pdf.setFontSize(11); pdf.text("Detalle de cambios · antes y después", 14, 36);
    autoTable(pdf, { startY: 42, margin: { top: 32, bottom: 17 }, head: [["ID / acción", "Antes", "Después / campos modificados"]],
      body: rows.map((row) => [row.documentId + "\n" + row.action, detailText(row.before), detailText(row.after)]),
      styles: { fontSize: 6, overflow: "linebreak", cellPadding: 2 }, headStyles: { fillColor: [16, 16, 16], textColor: [217, 255, 67] },
      columnStyles: { 0: { cellWidth: 48 } }, didDrawPage: heading });
  }
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page); pdf.setTextColor(100); pdf.setFontSize(8);
    pdf.text(`Confidencial · Historial disponible, sin reconstrucción de acciones no registradas · ${page} / ${pdf.getNumberOfPages()}`, 14, 203);
  }
  pdf.save(`Mirage-Auditoria-${generated.getTime()}.pdf`);
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
