// Shared domain typedefs (SPEC-201 §4.1). Import with `import('../core/types.js').Receipt`.

/**
 * @typedef {{receiptId: string, purchasedAt: string, merchantName: string, businessNo: string|null,
 *   supplyAmount: number|null, taxAmount: number|null, totalAmount: number, currency: string,
 *   paymentMethod: string|null, category: string|null, memo: string|null,
 *   createdAt: string|null, updatedAt: string|null}} Receipt
 * Rows typed into the sheet by hand may lack createdAt/updatedAt.
 */

/**
 * @typedef {{itemId: string, receiptId: string, lineNo: number, name: string, quantity: number|null,
 *   unitPrice: number|null, amount: number, taxAmount: number|null, category: string|null}} Item
 */

/**
 * @typedef {{name: string|null, quantity: number|string|null, unitPrice: number|string|null,
 *   amount: number|string|null, taxAmount: number|string|null, category: string|null}} DraftItem
 */

/**
 * @typedef {{receiptId: string, purchasedAt: string|null, merchantName: string|null, businessNo: string|null,
 *   supplyAmount: number|string|null, taxAmount: number|string|null, totalAmount: number|string|null,
 *   currency: string|null, paymentMethod: string|null, category: string|null, memo: string|null,
 *   createdAt?: string, items: DraftItem[]}} Draft
 */

/** @typedef {{field: string, code: 'required'|'format'|'number'}} FieldError */

/** @typedef {{code: 'items_sum_mismatch'|'supply_tax_mismatch'|'future_date'|'no_items', message: string}} Warning */

export {};
