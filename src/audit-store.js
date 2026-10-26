import { collection, doc, setDoc, serverTimestamp, runTransaction } from "firebase/firestore";
import { OWNER_UID, OPERATOR_UID } from "./finance-core.js";

export const SCANNER_UID = "9GPk0CuI60fz8oQ7FAtPvcX49VI3";
export const auditRole = (uid) => uid === OWNER_UID ? "admin" : uid === OPERATOR_UID ? "operator" : uid === SCANNER_UID ? "scanner" : "unknown";
const privateKey = /^(password|loginPassword|token|idToken|accessToken|refreshToken|apiKey|code|payload|data|image|flyer|auditId)$/i;

// Never put login secrets, QR bearer codes or attachment contents in the ledger.
export function auditSafe(value, depth = 0) {
  if (depth > 5) return "[Detalle anidado]";
  if (value === undefined || value === null) return null;
  if (value?.toDate) return value.toDate().toISOString();
  if (value?._methodName === "serverTimestamp") return "[Fecha del servidor]";
  if (typeof value === "string") {
    if (/^(data:|SN2:|eyJ[A-Za-z0-9_-]+\.)/.test(value)) return "[Contenido protegido]";
    return value.slice(0, 3000);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 500).map((entry) => auditSafe(entry, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 100);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKey.test(key))
    .slice(0, 50).map(([key, val]) => [key, auditSafe(val, depth + 1)]));
}

export function auditJson(value) {
  const text = JSON.stringify(auditSafe(value));
  if (text.length > 240000) throw new Error("El detalle de auditoría supera el tamaño permitido. Divide la operación.");
  return text;
}

export function auditData(user, input) {
  if (!user || auditRole(user.uid) === "unknown") throw new Error("Usuario de auditoría no autorizado.");
  return {
    actorUid: user.uid, actorEmail: user.email, role: auditRole(user.uid), createdAt: serverTimestamp(),
    eventId: input.eventId || "", eventName: (input.eventName || "").slice(0, 160),
    module: input.module || "activity", action: input.action,
    outcome: input.outcome || "success", targetPath: input.targetPath || "",
    summary: (input.summary || input.action).slice(0, 500),
    beforeJson: auditJson(input.before || null), afterJson: auditJson(input.after || null),
    origin: "application", schemaVersion: 1,
  };
}

export const deletionAuditId = (path) => `delete_${path.replaceAll("/", "_")}`;

export function appendEventAudit(writer, db, user, ref, operation, data, context = {}, id) {
  const parts = ref.path.split("/");
  const eventId = parts[1];
  const auditId = operation === "delete" ? deletionAuditId(ref.path) : id || doc(collection(db, "systemAudit")).id;
  const previous = context.lookup?.(ref.path) || context.before || null;
  const module = parts[2] || "events";
  const entry = auditData(user, {
    ...context, eventId, module, targetPath: ref.path,
    action: context.action || `${module}.${operation}`,
    before: previous, after: operation === "delete" ? null : data,
  });
  writer.set(doc(db, "systemAudit", auditId), entry);
  if (operation === "delete") writer.delete(ref);
  else if (operation === "update") writer.update(ref, { ...data, auditId });
  else writer.set(ref, { ...data, auditId });
  return auditId;
}

// Domain write and its audit entry are committed together, including deletion.
export function auditedEventBatch(db, user, context = {}) {
  const auditId = context.deleteEvent ? deletionAuditId(`events/${context.eventId}`) : doc(collection(db, "systemAudit")).id;
  const changes = [], writes = [];
  let eventId = context.eventId || "";
  function write(ref, operation, data) {
    if (!ref.path.startsWith("events/")) {
      writes.push({ ref, operation, data });
      return;
    }
    eventId ||= ref.path.split("/")[1];
    if (eventId !== ref.path.split("/")[1]) throw new Error("Cada lote auditado debe pertenecer a un solo evento.");
    changes.push({ ref, path: ref.path, operation, after: data || null });
    writes.push({ ref, operation, data: data ? { ...data, auditId } : null });
  }
  const result = {
    set(ref, data) { write(ref, "create", data); return result; },
    update(ref, data) { write(ref, "update", data); return result; },
    delete(ref) { write(ref, "delete", null); return result; },
    commit() {
      return runTransaction(db, async (tx) => {
        // Read before any writes: snapshots and mutation share the same transaction.
        const previous = await Promise.all(changes.map(async (change) => change.operation === "create" ? null : (await tx.get(change.ref)).data() || null));
        for (const item of writes) {
          if (item.operation === "delete") tx.delete(item.ref);
          else if (item.operation === "update") tx.update(item.ref, item.data);
          else tx.set(item.ref, item.data);
        }
        if (changes.length) tx.set(doc(db, "systemAudit", auditId), auditData(user, { ...context, eventId,
          module: context.module || "events", targetPath: `events/${eventId}`, action: context.action || "events.update",
          before: changes.map(({ path }, index) => ({ path, fields: previous[index] })),
          after: changes.map(({ path, operation, after }) => ({ path, operation, fields: after })),
        }));
      });
    },
  };
  return result;
}

export function recordActivity(db, user, input, id) {
  const ref = id ? doc(db, "systemAudit", id) : doc(collection(db, "systemAudit"));
  return setDoc(ref, auditData(user, { ...input, module: "activity" }));
}

// Non-mutating activity is supplementary. A logging outage must not lock logout.
export async function tryActivity(db, user, input) {
  if (!user || auditRole(user.uid) === "unknown") return false;
  try {
    await Promise.race([recordActivity(db, user, input), new Promise((_, reject) => setTimeout(() => reject(new Error("audit-timeout")), 4000))]);
    return true;
  } catch (error) { console.warn("No se pudo confirmar el log de actividad", error.code || error.name); return false; }
}
