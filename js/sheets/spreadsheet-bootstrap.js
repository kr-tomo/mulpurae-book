import { AppError } from '../core/errors.js';
import { SCHEMA_VERSION, SHEETS } from './schema.js';
import { toCell } from './row-mapper.js';

/** @typedef {import('./sheets-client.js').SheetsClient} SheetsClient */
/** @typedef {keyof typeof SHEETS} SheetName */
/** @typedef {{spreadsheetId: string, spreadsheetUrl: string, sheetIds: Record<SheetName, number>}} SpreadsheetHandle */

const SHEET_NAMES = /** @type {SheetName[]} */ (Object.keys(SHEETS));

/** @param {unknown[] | undefined} row */
function trimRow(row) {
  const r = [...(row ?? [])];
  while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === null || r[r.length - 1] === undefined)) r.pop();
  return r;
}

/** @param {readonly string[]} values */
const headerRow = (values) => ({ values: values.map((v) => toCell(v)) });

/**
 * @param {{client: SheetsClient, sub: string, storage?: Storage}} deps
 */
export function createSpreadsheetBootstrap(deps) {
  const { client } = deps;
  const storage = deps.storage ?? localStorage;
  const cacheKey = `receipt:${deps.sub}:spreadsheetId`;
  /** @type {SpreadsheetHandle | null} */
  let handle = null;
  /** @type {Promise<SpreadsheetHandle> | null} */
  let inflight = null;

  /** @returns {Promise<SpreadsheetHandle>} */
  async function run() {
    let id = storage.getItem(cacheKey);
    let justCreated = false;
    /** @type {Awaited<ReturnType<SheetsClient['getSpreadsheet']>> | null} */
    let meta = null;
    if (id) {
      try {
        meta = await client.getSpreadsheet(id);
      } catch (err) {
        if (!(err instanceof AppError) || (err.code !== 'not_found' && err.code !== 'permission')) throw err;
        storage.removeItem(cacheKey);
        id = null;
      }
    }
    if (!id) {
      const files = await client.findAppFiles();
      if (files.length > 0) {
        id = files[0].id;
      } else {
        id = (await client.createAppFile()).id;
        justCreated = true;
      }
    }
    if (!meta) meta = await client.getSpreadsheet(id);

    /** @type {Map<string, number>} */
    const existing = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
    const present = SHEET_NAMES.filter((n) => existing.has(n));
    /** @type {Map<string, unknown[][]>} */
    const read = new Map();
    if (present.length > 0) {
      const ranges = present.map((n) => (n === 'meta' ? 'meta!A1:B' : `${n}!1:1`));
      const res = await client.batchGetValues(id, ranges);
      present.forEach((n, i) => read.set(n, res.valueRanges?.[i]?.values ?? []));
    }

    // Validate everything before writing anything.
    /** @type {SheetName[]} */
    const needHeader = [];
    for (const name of present) {
      const header = trimRow(read.get(name)?.[0]);
      if (header.length === 0) needHeader.push(name);
      else if (header.length !== SHEETS[name].length || header.some((v, i) => v !== SHEETS[name][i])) {
        throw new AppError('schema_mismatch', `${name} 시트의 첫 행이 예상과 다릅니다`);
      }
    }
    let needVersion = true;
    if (existing.has('meta')) {
      const versionRow = (read.get('meta') ?? []).slice(1).find((r) => r?.[0] === 'schema_version');
      if (versionRow) {
        needVersion = false;
        if (Number(versionRow[1]) > SCHEMA_VERSION) throw new AppError('schema_mismatch', '앱보다 새로운 형식의 시트입니다');
      }
    }

    /** @type {object[]} */
    const requests = [];
    /** @type {Record<string, number>} */
    const sheetIds = Object.fromEntries(present.map((n) => [n, /** @type {number} */ (existing.get(n))]));
    const usedIds = new Set(existing.values());
    let nextId = 1000;
    for (const name of SHEET_NAMES.filter((n) => !existing.has(n))) {
      while (usedIds.has(nextId)) nextId++;
      const sheetId = nextId++;
      usedIds.add(sheetId);
      sheetIds[name] = sheetId;
      requests.push({ addSheet: { properties: { sheetId, title: name, gridProperties: { frozenRowCount: 1 } } } });
      requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [headerRow(SHEETS[name])], fields: 'userEnteredValue' } });
    }
    for (const name of needHeader) {
      const sheetId = sheetIds[name];
      requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [headerRow(SHEETS[name])], fields: 'userEnteredValue' } });
      requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
    }
    if (needVersion) {
      requests.push({ appendCells: { sheetId: sheetIds.meta, rows: [{ values: [toCell('schema_version'), toCell(SCHEMA_VERSION)] }], fields: 'userEnteredValue' } });
    }
    if (justCreated) {
      for (const [title, sheetId] of existing) {
        if (!SHEET_NAMES.includes(/** @type {SheetName} */ (title))) requests.push({ deleteSheet: { sheetId } });
      }
    }
    if (requests.length > 0) {
      const res = await client.batchUpdate(id, requests);
      for (const reply of res?.replies ?? []) {
        const props = /** @type {any} */ (reply)?.addSheet?.properties;
        if (props && props.title in sheetIds) sheetIds[props.title] = props.sheetId;
      }
    }
    storage.setItem(cacheKey, id);
    return { spreadsheetId: id, spreadsheetUrl: meta.spreadsheetUrl, sheetIds: /** @type {Record<SheetName, number>} */ (sheetIds) };
  }

  return {
    /** @returns {Promise<SpreadsheetHandle>} */
    ensureSpreadsheet() {
      if (handle) return Promise.resolve(handle);
      if (!inflight) {
        inflight = run()
          .then((h) => (handle = h))
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    /** @returns {void} */
    reset() {
      handle = null;
    },
  };
}
