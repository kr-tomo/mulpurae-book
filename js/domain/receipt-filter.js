/** @typedef {import('../core/types.js').Receipt} Receipt */
/** @typedef {{from?: string, to?: string, merchant?: string, minTotal?: number|string, maxTotal?: number|string}} Filter */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} v */
const present = (v) => v !== undefined && v !== null && v !== '';
/** @param {number|string|undefined} v */
const toNumber = (v) => (typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')));
/** @param {string} s */
const fold = (s) => s.normalize('NFC').toLowerCase();

/**
 * @param {Filter} f
 * @returns {string[]}
 */
export function validateFilter(f) {
  const errors = [];
  if (present(f.from) && !DATE.test(String(f.from))) errors.push('시작일 형식이 올바르지 않습니다');
  if (present(f.to) && !DATE.test(String(f.to))) errors.push('종료일 형식이 올바르지 않습니다');
  if (present(f.from) && present(f.to) && DATE.test(String(f.from)) && DATE.test(String(f.to)) && String(f.from) > String(f.to)) {
    errors.push('시작일이 종료일보다 늦습니다');
  }
  const minOk = !present(f.minTotal) || Number.isFinite(toNumber(f.minTotal));
  const maxOk = !present(f.maxTotal) || Number.isFinite(toNumber(f.maxTotal));
  if (!minOk) errors.push('최소 금액은 숫자여야 합니다');
  if (!maxOk) errors.push('최대 금액은 숫자여야 합니다');
  if (minOk && maxOk && present(f.minTotal) && present(f.maxTotal) && toNumber(f.minTotal) > toNumber(f.maxTotal)) {
    errors.push('최소 금액이 최대 금액보다 큽니다');
  }
  return errors;
}

/**
 * @param {Receipt[]} list
 * @param {Filter} f
 * @returns {Receipt[]}
 */
export function filterReceipts(list, f) {
  const merchant = present(f.merchant) ? fold(String(f.merchant).trim()) : '';
  const min = present(f.minTotal) ? toNumber(f.minTotal) : null;
  const max = present(f.maxTotal) ? toNumber(f.maxTotal) : null;
  return list.filter((r) => {
    const day = r.purchasedAt.slice(0, 10);
    if (present(f.from) && day < String(f.from)) return false;
    if (present(f.to) && day > String(f.to)) return false;
    if (merchant && !fold(r.merchantName).includes(merchant)) return false;
    if (min !== null && r.totalAmount < min) return false;
    if (max !== null && r.totalAmount > max) return false;
    return true;
  });
}
