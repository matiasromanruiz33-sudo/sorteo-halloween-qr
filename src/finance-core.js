export const OWNER_UID = "FGmxXhvrahb1KGV9NCy6oikmSfH3";
export const OPERATOR_UID = "8ViPQPIFNpYuSkzYDwLD3waQNPn1";
export const OPERATOR_EMAIL = "vmc.ecuador@gmail.com";
export const METHODS = { cash: "Efectivo", transfer: "Transferencia", card: "Tarjeta", other: "Otros" };
export const KINDS = {
  product: "Ficha de producto", purchase: "Compra de inventario", sale: "Venta", refund: "Devolución de venta",
  funding: "Inversión / aporte", expense: "Gasto operativo", payment: "Pago pendiente",
  loss: "Pérdida", damage: "Producto dañado", adjustmentIn: "Ajuste de entrada",
  adjustmentOut: "Ajuste de salida", supplierReturn: "Devolución a proveedor",
  cashIn: "Ingreso de caja", cashOut: "Retiro de caja",
};
export const DEFAULT_CATEGORIES = ["Bebidas", "Alimentos", "Entradas", "Merchandising", "Otros productos"];
export const money = (cents = 0) => new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(cents / 100);
export const ecuadorTime = (date = new Date()) => new Intl.DateTimeFormat("es-EC", {
  timeZone: "America/Guayaquil", dateStyle: "medium", timeStyle: "short",
}).format(date?.toDate ? date.toDate() : new Date(date));
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const escape = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

export function cents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) throw new Error("Ingresa un importe válido, hasta USD 10.000.000.");
  return Math.round(amount * 100);
}

export function units(value, allowZero = false) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < (allowZero ? 0 : 1) || quantity > 1000000) throw new Error("La cantidad debe ser un entero válido.");
  return quantity;
}

export function cashEffect(op) {
  return ["purchase", "expense", "payment", "refund", "cashOut"].includes(op.kind) ? -op.paidCents : op.paidCents;
}

export function summarize(operations, products = [], budgetCents = 0) {
  const result = { investment: 0, purchases: 0, expenses: 0, income: 0, cogs: 0, losses: 0, sold: 0,
    available: 0, exhausted: 0, stockValue: 0, cash: 0, flow: 0, pending: 0,
    payments: { cash: 0, transfer: 0, card: 0, other: 0 } };
  for (const op of operations) {
    result.flow += cashEffect(op);
    if (op.method === "cash") result.cash += cashEffect(op);
    if (op.kind === "funding") result.investment += op.amountCents;
    if (op.kind === "purchase") result.purchases += op.amountCents;
    if (op.kind === "supplierReturn") result.purchases -= op.amountCents;
    if (op.kind === "expense") result.expenses += op.amountCents;
    if (["expense", "purchase"].includes(op.kind)) result.pending += op.amountCents - op.paidCents;
    if (op.kind === "payment") result.pending -= op.paidCents;
    if (op.kind === "sale" || op.kind === "refund") {
      const sign = op.kind === "sale" ? 1 : -1;
      result.income += sign * op.amountCents;
      result.cogs += sign * op.costCents;
      result.sold += sign * op.quantity;
      result.payments[op.method] += sign * op.paidCents;
    }
    if (["loss", "damage", "adjustmentOut"].includes(op.kind)) result.losses += op.costCents;
  }
  for (const product of products) {
    result.available += product.stock;
    result.stockValue += product.inventoryValueCents;
    if (product.stock === 0 && product.status === "active") result.exhausted++;
  }
  result.profit = result.income - result.cogs - result.expenses - result.losses;
  result.budgetAvailable = budgetCents - result.purchases - result.expenses;
  return result;
}

export function filterOperations(operations, filters = {}) {
  return operations.filter((op) => (!filters.from || op.date >= filters.from)
    && (!filters.to || op.date <= filters.to)
    && (!filters.category || op.category === filters.category)
    && (!filters.kind || op.kind === filters.kind));
}

export function inventoryAt(products, operations, endDate = "9999-12-31", startDate = "") {
  return products.map((product) => {
    const rows = operations.filter((op) => op.productId === product.id);
    return { ...product,
      initial: rows.filter((op) => startDate && op.date < startDate).reduce((n, op) => n + op.stockDelta, 0),
      stock: rows.filter((op) => op.date <= endDate).reduce((n, op) => n + op.stockDelta, 0),
      inventoryValueCents: rows.filter((op) => op.date <= endDate).reduce((n, op) => n + op.valueDelta, 0),
    };
  });
}
