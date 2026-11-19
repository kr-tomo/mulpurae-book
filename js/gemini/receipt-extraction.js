import { normalizeDraft } from '../domain/receipt-validation.js';

/** @typedef {import('../core/types.js').Draft} Draft */
/** @typedef {import('../core/types.js').DraftItem} DraftItem */

export const CATEGORY_SUGGESTIONS = Object.freeze(['식비', '카페', '장보기', '교통', '주유', '생활', '의료', '쇼핑', '문화', '교육', '기타']);

const S = { type: 'STRING', nullable: true };
const N = { type: 'NUMBER', nullable: true };

export const RECEIPT_RESPONSE_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    isReceipt: { type: 'BOOLEAN' },
    purchasedAt: S,
    merchantName: S,
    businessNo: S,
    supplyAmount: N,
    taxAmount: N,
    totalAmount: N,
    currency: S,
    paymentMethod: S,
    category: S,
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, quantity: N, unitPrice: N, amount: N, taxAmount: N, category: S },
        required: ['name', 'amount'],
      },
    },
  },
  required: ['isReceipt', 'items'],
});

export const EXTRACTION_PROMPT = [
  '이 이미지는 영수증 사진입니다. 영수증의 정보를 JSON 으로 추출하세요.',
  '- 영수증이 아니면 isReceipt 를 false 로, items 는 빈 배열로 두세요.',
  '- purchasedAt: 구매 일시. 형식 YYYY-MM-DD 또는 시각이 보이면 YYYY-MM-DDTHH:mm (24 시간제).',
  '- 금액(supplyAmount, taxAmount, totalAmount, quantity, unitPrice, amount)은 쉼표·통화 기호 없는 숫자로.',
  '- 영수증에서 보이지 않는 값은 추측하지 말고 null 로 두세요.',
  '- currency: ISO 4217 코드. 원화(₩, 원) 표기이거나 한국 영수증이면 KRW.',
  `- category: 다음 중 가장 알맞은 하나 또는 null — ${CATEGORY_SUGGESTIONS.join(', ')}.`,
  '- items: 영수증에 적힌 품목 순서대로. 할인 행은 amount 를 음수로.',
  '- businessNo: 사업자등록번호가 보이면 적힌 그대로.',
].join('\n');

const MAX_TEXT = 500;
const MAX_ITEMS = 200;

/** @param {unknown} v @returns {string|null} */
function text(v) {
  return typeof v === 'string' ? v.slice(0, MAX_TEXT) : null;
}

/** @param {unknown} v @returns {number|string|null} numeric strings are left for normalizeDraft */
function number(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?[\d,\s]+(\.\d+)?$/.test(v.trim())) return v;
  return null;
}

/**
 * LLM output is untrusted: only known keys of the expected type survive.
 * @param {unknown} extraction
 * @param {string} receiptId
 * @returns {Draft}
 */
export function toDraft(extraction, receiptId) {
  const e = /** @type {Record<string, unknown>} */ (extraction && typeof extraction === 'object' ? extraction : {});
  const rawItems = Array.isArray(e.items) ? e.items.slice(0, MAX_ITEMS) : [];
  /** @type {DraftItem[]} */
  const items = rawItems.map((it) => {
    const i = /** @type {Record<string, unknown>} */ (it && typeof it === 'object' ? it : {});
    return {
      name: text(i.name),
      quantity: number(i.quantity),
      unitPrice: number(i.unitPrice),
      amount: number(i.amount),
      taxAmount: number(i.taxAmount),
      category: text(i.category),
    };
  });
  return normalizeDraft({
    receiptId,
    purchasedAt: text(e.purchasedAt),
    merchantName: text(e.merchantName),
    businessNo: text(e.businessNo),
    supplyAmount: number(e.supplyAmount),
    taxAmount: number(e.taxAmount),
    totalAmount: number(e.totalAmount),
    currency: text(e.currency),
    paymentMethod: text(e.paymentMethod),
    category: text(e.category),
    memo: null,
    items,
  });
}
