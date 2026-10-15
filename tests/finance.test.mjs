import { readFile } from "node:fs/promises";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, query, where } from "firebase/firestore";
import { saveFinanceEvent, recordOperation, closeCash, appendFinanceLink, syncFinanceLink } from "../src/finance-store.js";
import { OWNER_UID, OPERATOR_UID, summarize, inventoryAt } from "../src/finance-core.js";

let env, ownerDb, operatorDb;
const owner = { uid: OWNER_UID, email: "matiasromanruiz33@gmail.com" };
const operator = { uid: OPERATOR_UID, email: "vmc.ecuador@gmail.com" };
const date = "2026-10-15";
const eventId = "isolated-financial-test";
const root = (...parts) => ["financeEvents", eventId, ...parts];
const record = async (input, id = crypto.randomUUID()) => {
  try { return await recordOperation(operatorDb, operator, eventId, { date, concept: "Prueba", ...input }, id); }
  catch (error) { error.message = `${input.kind}: ${error.message}`; throw error; }
};

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-mirage-finance", firestore: { host: "127.0.0.1", port: 8085, rules: await readFile("firestore.rules", "utf8") } });
  ownerDb = env.authenticatedContext(OWNER_UID, { email: owner.email }).firestore();
  operatorDb = env.authenticatedContext(OPERATOR_UID, { email: operator.email, email_verified: true }).firestore();
  await setDoc(doc(ownerDb, "users", OPERATOR_UID), { email: operator.email, role: "operator", active: true, updatedAt: serverTimestamp() });
  await setDoc(doc(ownerDb, "events", eventId), { name: "Evento de prueba" });
  await saveFinanceEvent(ownerDb, owner, { id: eventId, name: "Evento de prueba" }, { assigned: true, budget: 500, allowDiscounts: true, allowRefunds: true });
});
after(async () => { await env?.cleanup(); });

test("complete financial flow, weighted cost, idempotency, concurrency and permissions", async () => {
  await assertSucceeds(getDoc(doc(operatorDb, ...root())));
  const assigned = await getDocs(query(collection(operatorDb, "financeEvents"), where("assignedUids", "array-contains", OPERATOR_UID)));
  assert.equal(assigned.size, 1);
  await assertFails(getDocs(collection(operatorDb, "events")));
  await assertFails(updateDoc(doc(operatorDb, ...root()), { ownerUid: OPERATOR_UID }));
  await assertFails(deleteDoc(doc(operatorDb, "events", eventId)));
  const unverifiedDb = env.authenticatedContext(OPERATOR_UID, { email: operator.email, email_verified: false }).firestore();
  await assertFails(getDoc(doc(unverifiedDb, ...root())));
  const scannerDb = env.authenticatedContext("9GPk0CuI60fz8oQ7FAtPvcX49VI3", { email: "anderson.2008.cobos@gmail.com" }).firestore();
  await assertFails(getDoc(doc(scannerDb, ...root())));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), ...root())));

  await record({ kind: "funding", amount: 500 });
  const purchaseId = await record({ kind: "purchase", productId: "water", quantity: 100, unitCost: 1, paid: 40,
    product: { name: "Agua", category: "Bebidas", salePrice: 3, unitCost: 1 }, category: "Bebidas" });
  let product = (await getDoc(doc(operatorDb, ...root("products", "water")))).data();
  assert.equal(product.stock, 100);
  await record({ kind: "payment", originalId: purchaseId, amount: 60 });
  const saleId = await record({ kind: "sale", productId: "water", quantity: 25, discount: 5 }, "idempotent-sale");
  await record({ kind: "sale", productId: "water", quantity: 25, discount: 5 }, "idempotent-sale");
  product = (await getDoc(doc(operatorDb, ...root("products", "water")))).data();
  assert.equal(product.stock, 75);
  assert.equal(product.inventoryValueCents, 7500);
  await assert.rejects(() => record({ kind: "sale", productId: "water", quantity: 76 }), /Stock insuficiente/);
  const expenseId = await record({ kind: "expense", amount: 50, paid: 20, category: "DJ" });
  await record({ kind: "payment", originalId: expenseId, amount: 30 });
  const ops = (await getDocs(collection(operatorDb, ...root("operations")))).docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const metrics = summarize(ops, [{ id: "water", ...product }], 50000);
  assert.equal(metrics.income, 7000);
  assert.equal(metrics.cogs, 2500);
  assert.equal(metrics.expenses, 5000);
  assert.equal(metrics.profit, -500);
  assert.equal(metrics.cash, 42000);
  assert.equal(metrics.pending, 0);
  await closeCash(operatorDb, operator, eventId, 419, "Diferencia de conteo", "closing-1");
  const closure = (await getDoc(doc(operatorDb, ...root("closures", "closing-1")))).data();
  assert.equal(closure.expectedCents, 42000);
  assert.equal(closure.differenceCents, -100);

  await record({ kind: "refund", originalId: saleId, note: "Cliente devolvió la compra" });
  await record({ kind: "refund", originalId: saleId, note: "Segundo intento idéntico" });
  assert.equal((await getDoc(doc(operatorDb, ...root("products", "water")))).data().stock, 100);
  await record({ kind: "purchase", productId: "water", quantity: 100, unitCost: 2 });
  await record({ kind: "sale", productId: "water", quantity: 10 });
  product = (await getDoc(doc(operatorDb, ...root("products", "water")))).data();
  assert.equal(product.stock, 190);
  assert.equal(product.inventoryValueCents, 28500);
  const latestOps = (await getDocs(collection(operatorDb, ...root("operations")))).docs.map((d) => ({ id: d.id, ...d.data() }));
  assert.equal(latestOps.find((op) => op.kind === "sale" && op.quantity === 10).costCents, 1500);
  await assertFails(updateDoc(doc(operatorDb, ...root("products", "water")), { stock: 999 }));
  await assertFails(updateDoc(doc(operatorDb, ...root("operations", saleId)), { amountCents: 1 }));
  await assertFails(deleteDoc(doc(ownerDb, ...root("operations", saleId))));

  // A forged stock update and ledger entry cannot bypass the arithmetic rules.
  const forgedId = "forged-sale";
  const batch = writeBatch(operatorDb);
  const template = latestOps.find((op) => op.kind === "sale");
  const { id: ignoredId, ...forged } = template;
  void ignoredId;
  batch.set(doc(operatorDb, ...root("operations", forgedId)), { ...forged, quantity: 999, createdAt: serverTimestamp() });
  batch.update(doc(operatorDb, ...root("products", "water")), { stock: 0, lastOperationId: forgedId, updatedAt: serverTimestamp() });
  await assertFails(batch.commit());

  const simultaneous = await Promise.allSettled([
    record({ kind: "sale", productId: "water", quantity: 150 }, "race-a"),
    record({ kind: "sale", productId: "water", quantity: 150 }, "race-b"),
  ]);
  assert.equal(simultaneous.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await getDoc(doc(operatorDb, ...root("products", "water")))).data().stock, 40);

  await record({ kind: "damage", productId: "water", quantity: 2, note: "Botellas dañadas en transporte" });
  await record({ kind: "adjustmentIn", productId: "water", quantity: 3, unitCost: 2, note: "Mercadería de reposición sin pago" });
  await record({ kind: "supplierReturn", productId: "water", quantity: 1 });
  await record({ kind: "cashIn", amount: 10 });
  await record({ kind: "cashOut", amount: 5, note: "Retiro autorizado de fondos" });
  await record({ kind: "product", productId: "water", quantity: 0, product: { name: "Agua editada", category: "Bebidas", salePrice: 4, unitCost: 2, status: "active" } });
  const edited = (await getDoc(doc(operatorDb, ...root("products", "water")))).data();
  assert.equal(edited.name, "Agua editada");
  assert.equal(edited.stock, 40);
  assert.equal(edited.inventoryValueCents, 6146);

  // Existing ticket validation remains unchanged for the scanner profile.
  await setDoc(doc(ownerDb, "events", eventId, "tickets", "qr-test"), { status: "active", code: "UNCHANGED", holderName: "Temporal" });
  await assertSucceeds(updateDoc(doc(scannerDb, "events", eventId, "tickets", "qr-test"), { status: "used", usedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(scannerDb, "events", eventId, "tickets", "qr-test"), { status: "active", updatedAt: serverTimestamp() }));

  const event2 = "not-assigned";
  await saveFinanceEvent(ownerDb, owner, { id: event2, name: "Privado" }, { assigned: false, budget: 20 });
  await assertFails(getDoc(doc(operatorDb, "financeEvents", event2)));
  await updateDoc(doc(ownerDb, ...root()), { allowDiscounts: false, allowRefunds: false, updatedAt: serverTimestamp() });
  await assert.rejects(() => record({ kind: "sale", productId: "water", quantity: 1, discount: 1 }), /autorizado descuentos/);
  await updateDoc(doc(ownerDb, "users", OPERATOR_UID), { active: false, updatedAt: serverTimestamp() });
  await assertFails(getDoc(doc(operatorDb, ...root("products", "water"))));
});

test("period inventory is reconstructed from ledger, not current stock", () => {
  const rows = inventoryAt([{ id: "x" }], [
    { productId: "x", date: "2026-10-01", stockDelta: 100, valueDelta: 10000 },
    { productId: "x", date: "2026-10-02", stockDelta: -25, valueDelta: -2500 },
    { productId: "x", date: "2026-10-03", stockDelta: 50, valueDelta: 5000 },
  ], "2026-10-02", "2026-10-02");
  assert.equal(rows[0].initial, 100); assert.equal(rows[0].stock, 75); assert.equal(rows[0].inventoryValueCents, 7500);
});

test("automatic links preserve source data, existing finances and explicit revocations", async () => {
  const id = "automatic-link-test";
  const sourceRef = doc(ownerDb, "events", id);
  const financeRef = doc(ownerDb, "financeEvents", id);
  const source = { name: "Evento anterior", eventDate: date, participantCount: 21, status: "drawn" };
  await setDoc(sourceRef, source);
  await syncFinanceLink(ownerDb, owner, id);
  assert.deepEqual((await getDoc(sourceRef)).data(), source);
  assert.deepEqual((await getDoc(financeRef)).data().assignedUids, [OPERATOR_UID]);
  await updateDoc(financeRef, { budgetCents: 12345, assignedUids: [], updatedAt: serverTimestamp() });
  const auditBefore = (await getDocs(collection(financeRef, "audit"))).size;
  await syncFinanceLink(ownerDb, owner, id);
  assert.equal((await getDocs(collection(financeRef, "audit"))).size, auditBefore);
  assert.deepEqual((await getDoc(financeRef)).data().assignedUids, []);
  await syncFinanceLink(ownerDb, owner, id, { eventUpdate: { name: "Nombre actualizado", eventDate: "2026-10-31" } });
  const updated = (await getDoc(financeRef)).data();
  assert.equal(updated.name, "Nombre actualizado");
  assert.equal(updated.eventDate, "2026-10-31");
  assert.equal(updated.budgetCents, 12345);
  assert.deepEqual(updated.assignedUids, []);
  assert.equal((await getDoc(sourceRef)).data().participantCount, 21);

  const batch = writeBatch(ownerDb);
  const newSource = { id: "atomic-new-event", name: "Nuevo evento", eventDate: date };
  batch.set(doc(ownerDb, "events", newSource.id), { name: newSource.name, eventDate: date });
  appendFinanceLink(batch, ownerDb, owner, newSource);
  await batch.commit();
  assert.deepEqual((await getDoc(doc(ownerDb, "financeEvents", newSource.id))).data().assignedUids, [OPERATOR_UID]);
  await assert.rejects(() => syncFinanceLink(operatorDb, operator, id), /Solo el organizador/);
});
