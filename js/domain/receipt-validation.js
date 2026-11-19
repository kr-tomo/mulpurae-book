import { AppError } from '../core/errors.js';
import { nowIso } from '../core/clock.js';
import { itemId } from '../core/ids.js';

/** @typedef {import('../core/types.js').Receipt} Receipt */
/** @typedef {import('../core/types.js').Item} Item */
/** @typedef {import('../core/types.js').Draft} Draft */
/** @typedef {import('../core/types.js').DraftItem} DraftItem */
/** @typedef {import('../core/types.js').FieldError} FieldError */
/** @typedef {import('../core/types.js').Warning} Warning */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURCHASED_AT = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
const TOLERANCE = 1;
const fmt = new Intl.NumberFormat('ko-KR');

/** @param {unknown} v @returns {string|null} */
function normText(v) {
  if (typeof v !== 'string') return v === undefined ? null : /** @type {any} */ (v);
  const t = v.trim();
  return t === '' ? null : t;
}

/** @param {unknown} v @returns {number|string|null} */
function normNumber(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return /** @type {any} */ (v);
  const t = v.replace(/[,\s]/g, '');
  if (t === '') return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : v;
}

/**
 * @param {Draft} d
 * @returns {Draft}
 */
export function normalizeDraft(d) {
  const currency = normText(d.currency);
  /** @type {Draft} */
  const out = {
    receiptId: d.receiptId,
    purchasedAt: normText(d.purchasedAt),
    merchantName: normText(d.merchantName),
    businessNo: normText(d.businessNo),
    supplyAmount: normNumber(d.supplyAmount),
    taxAmount: normNumber(d.taxAmount),
    totalAmount: normNumber(d.totalAmount),
    currency: typeof currency === 'string' ? currency.toUpperCase() : currency,
    paymentMethod: normText(d.paymentMethod),
    category: normText(d.category),
    memo: normText(d.memo),
    items: (d.items ?? []).map((it) => ({
      name: normText(it.name),
      quantity: normNumber(it.quantity),
      unitPrice: normNumber(it.unitPrice),
      amount: normNumber(it.amount),
      taxAmount: normNumber(it.taxAmount),
      category: normText(it.category),
    })),
  };
  if (d.createdAt !== undefined) out.createdAt = d.createdAt;
  return out;
}

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** @param {string} s */
function isValidPurchasedAt(s) {
  const m = PURCHASED_AT.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) return false;
  return true;
}

/** @param {Date} date */
function localDateString(date) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * @param {Draft} d
 * @param {{today?: Date}} [opts]
 * @returns {{errors: FieldError[], warnings: Warning[], normalized: Draft}}
 */
export function validateDraft(d, opts = {}) {
  const n = normalizeDraft(d);
  /** @type {FieldError[]} */
  const errors = [];
  /** @param {string} field @param {FieldError['code']} code */
  const err = (field, code) => errors.push({ field, code });

  if (typeof n.receiptId !== 'string' || !UUID_V4.test(n.receiptId)) err('receiptId', 'format');
  if (n.purchasedAt === null) err('purchasedAt', 'required');
  else if (typeof n.purchasedAt !== 'string' || !isValidPurchasedAt(n.purchasedAt)) err('purchasedAt', 'format');
  if (n.merchantName === null) err('merchantName', 'required');
  if (n.totalAmount === null) err('totalAmount', 'required');
  else if (!isNum(n.totalAmount)) err('totalAmount', 'number');
  if (n.currency === null) err('currency', 'required');
  else if (typeof n.currency !== 'string' || !/^[A-Z]{3}$/.test(n.currency)) err('currency', 'format');
  for (const f of /** @type {const} */ (['supplyAmount', 'taxAmount'])) {
    if (n[f] !== null && !isNum(n[f])) err(f, 'number');
  }
  n.items.forEach((it, i) => {
    if (it.name === null) err(`items[${i}].name`, 'required');
    if (it.amount === null) err(`items[${i}].amount`, 'required');
    else if (!isNum(it.amount)) err(`items[${i}].amount`, 'number');
    for (const f of /** @type {const} */ (['quantity', 'unitPrice', 'taxAmount'])) {
      if (it[f] !== null && !isNum(it[f])) err(`items[${i}].${f}`, 'number');
    }
  });

  /** @type {Warning[]} */
  const warnings = [];
  const total = n.totalAmount;
  if (n.items.length === 0) {
    warnings.push({ code: 'no_items', message: '품목이 없습니다' });
  } else if (isNum(total) && n.items.every((it) => isNum(it.amount))) {
    const sum = n.items.reduce((s, it) => s + /** @type {number} */ (it.amount), 0);
    if (Math.abs(sum - total) > TOLERANCE) {
      warnings.push({
        code: 'items_sum_mismatch',
        message: `품목 합계(${fmt.format(sum)})와 총액(${fmt.format(total)})이 ${fmt.format(Math.abs(sum - total))} 차이 납니다`,
      });
    }
  }
  if (isNum(total) && isNum(n.supplyAmount) && isNum(n.taxAmount) && Math.abs(n.supplyAmount + n.taxAmount - total) > TOLERANCE) {
    warnings.push({
      code: 'supply_tax_mismatch',
      message: `공급가액+세액(${fmt.format(n.supplyAmount + n.taxAmount)})이 총액(${fmt.format(total)})과 다릅니다`,
    });
  }
  if (typeof n.purchasedAt === 'string' && isValidPurchasedAt(n.purchasedAt)) {
    const limit = new Date(opts.today ?? new Date());
    limit.setDate(limit.getDate() + 1);
    if (n.purchasedAt.slice(0, 10) > localDateString(limit)) {
      warnings.push({ code: 'future_date', message: `구매일(${n.purchasedAt.slice(0, 10)})이 미래입니다` });
    }
  }
  return { errors, warnings, normalized: n };
}

/**
 * @param {Draft} d
 * @returns {{receipt: Receipt, items: Item[]}}
 */
export function draftToRecord(d) {
  const { errors, normalized: n } = validateDraft(d);
  if (errors.length > 0) throw new AppError('validation', '입력값을 확인하세요', { cause: errors });
  const now = nowIso();
  /** @type {Receipt} */
  const receipt = {
    receiptId: n.receiptId,
    purchasedAt: /** @type {string} */ (n.purchasedAt),
    merchantName: /** @type {string} */ (n.merchantName),
    businessNo: n.businessNo,
    supplyAmount: /** @type {number|null} */ (n.supplyAmount),
    taxAmount: /** @type {number|null} */ (n.taxAmount),
    totalAmount: /** @type {number} */ (n.totalAmount),
    currency: /** @type {string} */ (n.currency),
    paymentMethod: n.paymentMethod,
    category: n.category,
    memo: n.memo,
    createdAt: d.createdAt ?? now,
    updatedAt: now,
  };
  const items = n.items.map((it, i) => ({
    itemId: itemId(n.receiptId, i + 1),
    receiptId: n.receiptId,
    lineNo: i + 1,
    name: /** @type {string} */ (it.name),
    quantity: /** @type {number|null} */ (it.quantity),
    unitPrice: /** @type {number|null} */ (it.unitPrice),
    amount: /** @type {number} */ (it.amount),
    taxAmount: /** @type {number|null} */ (it.taxAmount),
    category: it.category,
  }));
  return { receipt, items };
}

/**
 * @param {Receipt} r
 * @param {Item[]} items
 * @returns {Draft}
 */
export function recordToDraft(r, items) {
  /** @type {Draft} */
  const d = {
    receiptId: r.receiptId,
    purchasedAt: r.purchasedAt,
    merchantName: r.merchantName,
    businessNo: r.businessNo,
    supplyAmount: r.supplyAmount,
    taxAmount: r.taxAmount,
    totalAmount: r.totalAmount,
    currency: r.currency,
    paymentMethod: r.paymentMethod,
    category: r.category,
    memo: r.memo,
    items: [...items]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((it) => ({
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        amount: it.amount,
        taxAmount: it.taxAmount,
        category: it.category,
      })),
  };
  if (r.createdAt !== null) d.createdAt = r.createdAt;
  return d;
}
