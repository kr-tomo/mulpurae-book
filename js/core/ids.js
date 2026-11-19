/** @returns {string} */
export function newReceiptId() {
  return crypto.randomUUID();
}

/**
 * @param {string} receiptId
 * @param {number} lineNo
 * @returns {string}
 */
export function itemId(receiptId, lineNo) {
  if (!Number.isInteger(lineNo) || lineNo < 1) throw new RangeError(`lineNo must be a positive integer: ${lineNo}`);
  return `${receiptId}-${lineNo}`;
}
