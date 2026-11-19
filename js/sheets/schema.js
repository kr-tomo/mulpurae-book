export const SCHEMA_VERSION = 1;

const RECEIPT_HEADERS = Object.freeze([
  'receipt_id',
  'purchased_at',
  'merchant_name',
  'business_no',
  'supply_amount',
  'tax_amount',
  'total_amount',
  'currency',
  'payment_method',
  'category',
  'memo',
  'created_at',
  'updated_at',
]);

const ITEM_HEADERS = Object.freeze([
  'item_id',
  'receipt_id',
  'line_no',
  'name',
  'quantity',
  'unit_price',
  'amount',
  'tax_amount',
  'category',
]);

/** @type {Readonly<Record<'receipts'|'items'|'deleted_receipts'|'deleted_items'|'meta', readonly string[]>>} */
export const SHEETS = Object.freeze({
  receipts: RECEIPT_HEADERS,
  items: ITEM_HEADERS,
  deleted_receipts: Object.freeze([...RECEIPT_HEADERS, 'deleted_at']),
  deleted_items: Object.freeze([...ITEM_HEADERS, 'deleted_at']),
  meta: Object.freeze(['key', 'value']),
});
