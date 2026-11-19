import { AppError } from '../core/errors.js';
import { nowIso } from '../core/clock.js';
import { SHEETS } from './schema.js';
import { itemToCells, receiptToCells, rowToItem, rowToReceipt, toCell } from './row-mapper.js';

/** @typedef {import('../core/types.js').Receipt} Receipt */
/** @typedef {import('../core/types.js').Item} Item */
/** @typedef {import('./sheets-client.js').SheetsClient} SheetsClient */
/** @typedef {import('./spreadsheet-bootstrap.js').SpreadsheetHandle} SpreadsheetHandle */

/**
 * @typedef {Object} ReceiptRepository
 * @property {(receipt: Receipt, items: Item[]) => Promise<{status: 'created'|'already_exists'}>} create
 * @property {() => Promise<{receipts: Receipt[], skipped: number}>} list
 * @property {(receiptId: string) => Promise<{receipt: Receipt, items: Item[]} | null>} get
 * @property {(receipt: Receipt, items: Item[]) => Promise<void>} update
 * @property {(receiptId: string) => Promise<{status: 'deleted'|'not_found'}>} remove
 */

const FIELDS = 'userEnteredValue';

/** @param {Receipt} receipt @param {Item[]} items */
function assertSameReceipt(receipt, items) {
  if (items.some((i) => i.receiptId !== receipt.receiptId)) {
    throw new AppError('validation', '품목의 영수증 ID 가 영수증과 다릅니다');
  }
}

/** @param {number} sheetId @param {object[][]} rows */
const append = (sheetId, rows) => ({ appendCells: { sheetId, rows: rows.map((values) => ({ values })), fields: FIELDS } });

/** @param {number} sheetId @param {number} rowIndex */
const deleteRow = (sheetId, rowIndex) => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } });

/**
 * 0-based sheet row indexes (data starts at row 2) whose first value equals `id`.
 * @param {unknown[][] | undefined} values
 * @param {string} id
 * @param {number} [col]
 */
function rowIndexesOf(values, id, col = 0) {
  /** @type {number[]} */
  const out = [];
  (values ?? []).forEach((row, i) => {
    if (row?.[col] === id) out.push(i + 1);
  });
  return out;
}

/** @param {number[]} indexes */
const descending = (indexes) => [...indexes].sort((a, b) => b - a);

/**
 * Copies a raw row exactly (no domain parsing) so hand-entered values survive archiving.
 * @param {unknown[]} row
 * @param {number} width
 * @param {string} deletedAt
 */
function archiveCells(row, width, deletedAt) {
  const cells = [];
  for (let c = 0; c < width; c++) {
    const v = row[c];
    if (v === undefined || v === null || v === '') cells.push(toCell(null));
    else if (typeof v === 'number') cells.push(toCell(v));
    else cells.push(toCell(String(v)));
  }
  cells.push(toCell(deletedAt));
  return cells;
}

/** @param {string|null} a @param {string|null} b */
function descNullsLast(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

/**
 * @param {{client: SheetsClient, getHandle: () => Promise<SpreadsheetHandle>}} deps
 * @returns {ReceiptRepository}
 */
export function createReceiptRepository(deps) {
  const { client, getHandle } = deps;

  /** @param {string} id @param {number} count */
  function assertSingle(id, count) {
    if (count > 1) throw new AppError('schema_mismatch', `같은 영수증 ID 의 행이 여러 개입니다: ${id}`);
  }

  return {
    async create(receipt, items) {
      assertSameReceipt(receipt, items);
      const h = await getHandle();
      const res = await client.getValues(h.spreadsheetId, 'receipts!A2:A');
      if (rowIndexesOf(res.values, receipt.receiptId).length > 0) return { status: 'already_exists' };
      const requests = [append(h.sheetIds.receipts, [receiptToCells(receipt)])];
      if (items.length > 0) requests.push(append(h.sheetIds.items, items.map((i) => itemToCells(i))));
      await client.batchUpdate(h.spreadsheetId, requests);
      return { status: 'created' };
    },

    async list() {
      const h = await getHandle();
      const res = await client.getValues(h.spreadsheetId, 'receipts!A2:M');
      /** @type {Receipt[]} */
      const receipts = [];
      let skipped = 0;
      for (const row of res.values ?? []) {
        if (!row || row.length === 0) continue;
        const r = rowToReceipt(row);
        if (r) receipts.push(r);
        else skipped++;
      }
      receipts.sort((a, b) => descNullsLast(a.purchasedAt, b.purchasedAt) || descNullsLast(a.createdAt, b.createdAt));
      return { receipts, skipped };
    },

    async get(receiptId) {
      const h = await getHandle();
      const res = await client.batchGetValues(h.spreadsheetId, ['receipts!A2:M', 'items!A2:I']);
      const [receiptRows, itemRows] = [res.valueRanges[0]?.values ?? [], res.valueRanges[1]?.values ?? []];
      const row = receiptRows.find((r) => r?.[0] === receiptId);
      const receipt = row ? rowToReceipt(row) : null;
      if (!receipt) return null;
      const items = itemRows
        .filter((r) => r?.[1] === receiptId)
        .map(rowToItem)
        .filter((i) => i !== null)
        .sort((a, b) => a.lineNo - b.lineNo);
      return { receipt, items };
    },

    async update(receipt, items) {
      assertSameReceipt(receipt, items);
      const h = await getHandle();
      const res = await client.batchGetValues(h.spreadsheetId, ['receipts!A2:A', 'items!B2:B']);
      const receiptRows = rowIndexesOf(res.valueRanges[0]?.values, receipt.receiptId);
      if (receiptRows.length === 0) throw new AppError('not_found', '영수증을 찾을 수 없습니다');
      assertSingle(receipt.receiptId, receiptRows.length);
      const itemRows = rowIndexesOf(res.valueRanges[1]?.values, receipt.receiptId);
      /** @type {object[]} */
      const requests = [
        { updateCells: { start: { sheetId: h.sheetIds.receipts, rowIndex: receiptRows[0], columnIndex: 0 }, rows: [{ values: receiptToCells(receipt) }], fields: FIELDS } },
        ...descending(itemRows).map((i) => deleteRow(h.sheetIds.items, i)),
      ];
      if (items.length > 0) requests.push(append(h.sheetIds.items, items.map((i) => itemToCells(i))));
      await client.batchUpdate(h.spreadsheetId, requests);
    },

    async remove(receiptId) {
      const h = await getHandle();
      const res = await client.batchGetValues(h.spreadsheetId, ['receipts!A2:M', 'items!A2:I']);
      const receiptValues = res.valueRanges[0]?.values ?? [];
      const itemValues = res.valueRanges[1]?.values ?? [];
      const receiptRows = rowIndexesOf(receiptValues, receiptId);
      if (receiptRows.length === 0) return { status: 'not_found' };
      assertSingle(receiptId, receiptRows.length);
      const itemRows = rowIndexesOf(itemValues, receiptId, 1);
      const deletedAt = nowIso();
      /** @type {object[]} */
      const requests = [append(h.sheetIds.deleted_receipts, [archiveCells(receiptValues[receiptRows[0] - 1], SHEETS.receipts.length, deletedAt)])];
      if (itemRows.length > 0) {
        requests.push(append(h.sheetIds.deleted_items, itemRows.map((i) => archiveCells(itemValues[i - 1], SHEETS.items.length, deletedAt))));
      }
      requests.push(...descending(itemRows).map((i) => deleteRow(h.sheetIds.items, i)));
      requests.push(deleteRow(h.sheetIds.receipts, receiptRows[0]));
      await client.batchUpdate(h.spreadsheetId, requests);
      return { status: 'deleted' };
    },
  };
}
