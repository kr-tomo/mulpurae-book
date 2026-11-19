/** @typedef {import('../core/types.js').Receipt} Receipt */
/** @typedef {import('../core/types.js').Item} Item */

/**
 * Strings are always written as stringValue so sheet formulas can never be injected.
 * @param {string|number|null} v
 * @returns {object} CellData
 */
export function toCell(v) {
  if (v === null) return {};
  if (typeof v === 'string') return { userEnteredValue: { stringValue: v } };
  if (typeof v === 'number' && Number.isFinite(v)) return { userEnteredValue: { numberValue: v } };
  throw new TypeError(`unsupported cell value: ${String(v)}`);
}

/**
 * @param {Receipt} r
 * @param {string} [deletedAt]
 * @returns {object[]}
 */
export function receiptToCells(r, deletedAt) {
  const values = [
    r.receiptId,
    r.purchasedAt,
    r.merchantName,
    r.businessNo,
    r.supplyAmount,
    r.taxAmount,
    r.totalAmount,
    r.currency,
    r.paymentMethod,
    r.category,
    r.memo,
    r.createdAt,
    r.updatedAt,
  ];
  if (deletedAt !== undefined) values.push(deletedAt);
  return values.map(toCell);
}

/**
 * @param {Item} i
 * @param {string} [deletedAt]
 * @returns {object[]}
 */
export function itemToCells(i, deletedAt) {
  const values = [i.itemId, i.receiptId, i.lineNo, i.name, i.quantity, i.unitPrice, i.amount, i.taxAmount, i.category];
  if (deletedAt !== undefined) values.push(deletedAt);
  return values.map(toCell);
}

/** @param {unknown} v @returns {string|null} */
function str(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v !== '') return v;
  return null;
}

/** @param {unknown} v @returns {number|null} */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * @param {unknown[]} row
 * @returns {Receipt|null}
 */
export function rowToReceipt(row) {
  const r = {
    receiptId: str(row[0]),
    purchasedAt: str(row[1]),
    merchantName: str(row[2]),
    businessNo: str(row[3]),
    supplyAmount: num(row[4]),
    taxAmount: num(row[5]),
    totalAmount: num(row[6]),
    currency: str(row[7]),
    paymentMethod: str(row[8]),
    category: str(row[9]),
    memo: str(row[10]),
    createdAt: str(row[11]),
    updatedAt: str(row[12]),
  };
  if (r.receiptId === null || r.purchasedAt === null || r.merchantName === null || r.totalAmount === null || r.currency === null) {
    return null;
  }
  return /** @type {Receipt} */ (r);
}

/**
 * @param {unknown[]} row
 * @returns {Item|null}
 */
export function rowToItem(row) {
  const lineNo = num(row[2]);
  const i = {
    itemId: str(row[0]),
    receiptId: str(row[1]),
    lineNo,
    name: str(row[3]),
    quantity: num(row[4]),
    unitPrice: num(row[5]),
    amount: num(row[6]),
    taxAmount: num(row[7]),
    category: str(row[8]),
  };
  if (i.itemId === null || i.receiptId === null || i.name === null || i.amount === null) return null;
  if (lineNo === null || !Number.isInteger(lineNo) || lineNo < 1) return null;
  return /** @type {Item} */ (i);
}
