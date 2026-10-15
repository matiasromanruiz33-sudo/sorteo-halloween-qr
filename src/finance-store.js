import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { cashEffect, cents, units, OWNER_UID, OPERATOR_UID, DEFAULT_CATEGORIES } from "./finance-core.js";

export const financeRef = (db, eventId, ...path) => doc(db, "financeEvents", eventId, ...path);

export async function saveFinanceEvent(db, user, source, input) {
  const ref = financeRef(db, source.id);
  const auditRef = doc(collection(ref, "audit"));
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    const previous = snapshot.data() || {};
    const data = {
      name: source.name, sourceEventId: source.id, ownerUid: OWNER_UID,
      eventDate: input.eventDate || source.eventDate || "", eventTime: input.eventTime || "", location: input.location || "",
      organizer: input.organizer || "Mirage Producciones", flyer: input.flyer || "", phase: input.phase || "planning",
      budgetCents: cents(input.budget || 0), categories: input.categories || previous.categories || DEFAULT_CATEGORIES,
      assignedUids: input.assigned ? [OPERATOR_UID] : [], allowDiscounts: Boolean(input.allowDiscounts), allowRefunds: Boolean(input.allowRefunds),
      createdAt: previous.createdAt || serverTimestamp(), updatedAt: serverTimestamp(),
    };
    tx.set(ref, data);
    tx.set(auditRef, { actorUid: user.uid, actorEmail: user.email, createdAt: serverTimestamp(), action: snapshot.exists() ? "Configuración y permisos actualizados" : "Gestión financiera habilitada", before: JSON.stringify(previous), after: JSON.stringify(input) });
  });
}

export async function recordOperation(db, user, eventId, input, requestId) {
  const root = financeRef(db, eventId);
  const opId = input.kind === "refund" ? `refund_${input.originalId}` : requestId || doc(collection(root, "operations")).id;
  const opRef = doc(root, "operations", opId);
  await runTransaction(db, async (tx) => {
    const balanceRef = doc(root, "balances", "current");
    const [eventSnapshot, existing, balanceSnapshot] = await Promise.all([tx.get(root), tx.get(opRef), tx.get(balanceRef)]);
    if (existing.exists()) return;
    if (!eventSnapshot.exists()) throw new Error("Habilita primero la gestión del evento.");
    const event = eventSnapshot.data();
    const isOwner = user.uid === OWNER_UID;
    const op = {
      kind: input.kind, productId: input.productId || "", originalId: input.originalId || "",
      concept: (input.concept || "").trim().slice(0, 200), category: input.category || "Otros",
      date: input.date, method: input.method || "cash", payee: input.payee || "", note: input.note || "",
      details: "",
      attachmentId: input.attachmentId || "", actorUid: user.uid, actorEmail: user.email,
      createdAt: serverTimestamp(), quantity: 0, amountCents: 0, paidCents: 0, costCents: 0,
      unitPriceCents: 0, discountCents: 0, stockDelta: 0, valueDelta: 0, soldDelta: 0,
    };
    let productRef, product, original, payableRef, payable;
    if (op.originalId) {
      const originalSnapshot = await tx.get(doc(root, "operations", op.originalId));
      if (!originalSnapshot.exists()) throw new Error("El movimiento de origen no existe.");
      original = originalSnapshot.data();
      if (op.kind === "refund") op.productId = original.productId;
      if (op.kind === "payment") {
        payableRef = doc(root, "payables", op.originalId);
        const payableSnapshot = await tx.get(payableRef);
        if (!payableSnapshot.exists()) throw new Error("No existe un saldo pendiente.");
        payable = payableSnapshot.data();
      }
    }
    if (op.productId) {
      productRef = doc(root, "products", op.productId);
      const snapshot = await tx.get(productRef);
      product = snapshot.data();
      if (!snapshot.exists() && !input.product) throw new Error("Producto no encontrado.");
      if (!product) product = { stock: 0, sold: 0, inventoryValueCents: 0, createdAt: serverTimestamp() };
      op.category = input.product?.category || product.category;
    }
    const proportionalCost = (quantity) => {
      if (!product || quantity > product.stock) throw new Error("Stock insuficiente. No puedes vender o retirar más unidades de las disponibles.");
      return Math.round(product.inventoryValueCents * quantity / product.stock);
    };
    if (["product", "purchase", "adjustmentIn", "sale", "loss", "damage", "adjustmentOut", "supplierReturn"].includes(op.kind)) {
      if (!product) throw new Error("Selecciona un producto.");
      op.quantity = units(input.quantity || 0, op.kind === "product");
      if (op.kind === "product" && op.quantity !== 0) throw new Error("Usa una compra para ingresar existencias.");
      if (["purchase", "adjustmentIn"].includes(op.kind)) {
        op.unitPriceCents = cents(input.unitCost);
        op.costCents = op.quantity * op.unitPriceCents;
        op.stockDelta = op.quantity;
        op.valueDelta = op.costCents;
        if (op.kind === "purchase") {
          op.amountCents = op.costCents;
          op.paidCents = input.paid === "" || input.paid == null ? op.amountCents : cents(input.paid);
        }
      } else if (op.kind !== "product") {
        op.costCents = proportionalCost(op.quantity);
        op.stockDelta = -op.quantity;
        op.valueDelta = -op.costCents;
        if (op.kind === "sale") {
          if (product.status !== "active") throw new Error("Este producto está inactivo.");
          op.unitPriceCents = product.saleCents;
          op.discountCents = cents(input.discount || 0);
          if (op.discountCents && !isOwner && !event.allowDiscounts) throw new Error("El organizador no ha autorizado descuentos.");
          op.amountCents = op.quantity * op.unitPriceCents - op.discountCents;
          op.paidCents = op.amountCents;
          op.soldDelta = op.quantity;
        } else if (op.kind === "supplierReturn") {
          op.amountCents = op.costCents;
          op.paidCents = op.amountCents;
        }
      }
    } else if (op.kind === "refund") {
      if (!isOwner && !event.allowRefunds) throw new Error("El organizador no ha autorizado devoluciones.");
      if (original.kind !== "sale") throw new Error("Solo se pueden devolver ventas, una vez y por el total.");
      Object.assign(op, { quantity: original.quantity, amountCents: original.amountCents, paidCents: original.paidCents,
        costCents: original.costCents, category: original.category, method: original.method,
        stockDelta: original.quantity, valueDelta: original.costCents, soldDelta: -original.quantity });
    } else {
      op.amountCents = cents(input.amount);
      if (op.amountCents <= 0) throw new Error("El monto debe ser mayor que cero.");
      op.paidCents = op.kind === "expense" && input.paid !== "" && input.paid != null ? cents(input.paid) : op.amountCents;
      if (op.kind === "payment" && op.paidCents > payable.remainingCents) throw new Error("El pago supera la deuda pendiente.");
    }
    if (op.amountCents < 0 || op.paidCents < 0 || op.paidCents > op.amountCents) throw new Error("Revisa el descuento y el monto pagado.");
    if (!op.concept || !/^\d{4}-\d{2}-\d{2}$/.test(op.date)) throw new Error("Completa concepto y fecha.");
    if (input.product) {
      const { name, category, description, supplier, status, saleCents, costCents } = product;
      op.details = JSON.stringify({ before: { name, category, description, supplier, status, saleCents, costCents },
        after: { name: input.product.name, category: input.product.category, description: input.product.description || "", supplier: input.product.supplier || "", status: input.product.status || "active", saleCents: cents(input.product.salePrice), costCents: cents(input.product.unitCost) } });
    }
    if (["loss", "damage", "adjustmentIn", "adjustmentOut", "refund", "cashOut"].includes(op.kind) && op.note.trim().length < 5) throw new Error("Indica el motivo (mínimo 5 caracteres).");

    // One immutable operation and all derived balances commit atomically.
    tx.set(opRef, op);
    if (productRef) {
      const metadata = input.product ? {
        name: input.product.name.trim(), category: input.product.category, description: input.product.description || "",
        image: input.product.image || "", supplier: input.product.supplier || "", status: input.product.status || "active",
        note: input.product.note || "", saleCents: cents(input.product.salePrice), costCents: cents(input.product.unitCost),
      } : {};
      tx.set(productRef, { ...product, ...metadata, stock: product.stock + op.stockDelta,
        sold: product.sold + op.soldDelta, inventoryValueCents: product.inventoryValueCents + op.valueDelta,
        lastOperationId: opId, updatedAt: serverTimestamp(), actorUid: user.uid });
    }
    if (["expense", "purchase"].includes(op.kind)) {
      tx.set(doc(root, "payables", opId), { remainingCents: op.amountCents - op.paidCents, lastOperationId: opId, updatedAt: serverTimestamp() });
    } else if (op.kind === "payment") {
      tx.update(payableRef, { remainingCents: payable.remainingCents - op.paidCents, lastOperationId: opId, updatedAt: serverTimestamp() });
    }
    const balance = balanceSnapshot.data() || { cash: 0, transfer: 0, card: 0, other: 0 };
    tx.set(balanceRef, { ...balance, [op.method]: balance[op.method] + cashEffect(op), lastOperationId: opId, updatedAt: serverTimestamp() });
  });
  return opId;
}

export async function closeCash(db, user, eventId, counted, note, requestId) {
  const ref = financeRef(db, eventId, "closures", requestId);
  return runTransaction(db, async (tx) => {
    const [balance, existing] = await Promise.all([tx.get(financeRef(db, eventId, "balances", "current")), tx.get(ref)]);
    if (existing.exists()) return;
    const expectedCents = balance.data()?.cash || 0;
    const countedCents = cents(counted);
    tx.set(ref, { expectedCents, countedCents, differenceCents: countedCents - expectedCents,
      balanceOperationId: balance.data()?.lastOperationId || "", note, actorUid: user.uid, actorEmail: user.email, createdAt: serverTimestamp() });
  });
}
