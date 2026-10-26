import { auditRole, auditSafe } from "./audit-store.js";
import { KINDS, money } from "./finance-core.js";

export const AUDIT_MODULES = { events: "Eventos y sorteos", participants: "Participantes", tickets: "Entradas y QR", activity: "Sesiones y actividad", finance: "Finanzas e inventario", configuration: "Configuración y permisos", cash: "Cierres de caja", attachments: "Comprobantes" };
export const OUTCOMES = { success: "Realizado", rejected: "Rechazado", error: "Error" };
export const ROLES = { admin: "Organizador", operator: "Control operativo", scanner: "Escáner", unknown: "No registrado" };
const emails = { admin: "matiasromanruiz33@gmail.com", operator: "vmc.ecuador@gmail.com", scanner: "anderson.2008.cobos@gmail.com" };
const parse = (value) => { try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return { detalle: String(value || "") }; } };
export const millis = (value) => value?.toMillis?.() || (value ? new Date(value).getTime() || 0 : 0);
export const auditDate = (row) => row.createdAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(millis(row.createdAt))) : "";

export function normalizeAudit(source, id, data, event = {}) {
  const role = data.role || auditRole(data.actorUid);
  const row = { id: `${source}:${event.id || ""}:${id}`, documentId: id, source,
    actorUid: data.actorUid || "", actorEmail: data.actorEmail || emails[role] || "No registrado",
    role, createdAt: data.createdAt || null, eventId: event.id || data.eventId || "",
    eventName: event.name || data.eventName || "Sin evento", outcome: "success", amountCents: null,
    targetPath: "", module: "configuration", action: data.action || source, summary: data.action || source,
    before: null, after: null, evidence: source === "system" ? "Registro de aplicación" : "Historial persistente existente",
  };
  if (source === "system") return { ...row, ...data, id: row.id, documentId: id, source,
    before: auditSafe(parse(data.beforeJson)), after: auditSafe(parse(data.afterJson)), evidence: row.evidence };
  row.targetPath = source === "users" ? `userAudit/${id}` : `financeEvents/${event.id}/${source === "configuration" ? "audit" : source}/${id}`;
  if (source === "operations") {
    const changes = parse(data.details) || {};
    Object.assign(row, { module: "finance", action: `finance.${data.kind}`, summary: `${KINDS[data.kind] || data.kind}: ${data.concept}`,
      amountCents: data.amountCents, before: auditSafe(changes.before || null), after: auditSafe({ ...data, details: changes.after || null }) });
  } else if (source === "closures") {
    Object.assign(row, { module: "cash", action: "cash.close", summary: `Cierre: esperado ${money(data.expectedCents)}, contado ${money(data.countedCents)}, diferencia ${money(data.differenceCents)}`, after: auditSafe(data) });
  } else if (source === "attachments") {
    Object.assign(row, { module: "attachments", action: "attachment.upload", summary: `Comprobante adjunto: ${data.name}`, after: auditSafe({ name: data.name, mime: data.mime }) });
  } else {
    row.action = source === "users" ? "permissions.change" : "configuration.change";
    row.before = auditSafe(parse(data.before)); row.after = auditSafe(parse(data.after) || { subjectUid: data.subjectUid || "", action: data.action });
  }
  return row;
}

export function filterAudit(rows, filters = {}) {
  const query = (filters.search || "").trim().toLocaleLowerCase("es");
  return rows.filter((row) => (!filters.from || auditDate(row) >= filters.from) && (!filters.to || auditDate(row) <= filters.to)
    && (!filters.event || row.eventId === filters.event)
    && (!filters.module || row.module === filters.module) && (!filters.outcome || row.outcome === filters.outcome)
    && (!filters.actor || row.actorUid === filters.actor)
    && (!query || `${row.summary} ${row.action} ${row.actorEmail} ${row.eventName} ${row.targetPath} ${row.documentId}`.toLocaleLowerCase("es").includes(query)))
    .sort((a, b) => millis(b.createdAt) - millis(a.createdAt) || a.id.localeCompare(b.id));
}
