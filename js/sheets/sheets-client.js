const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const APP_QUERY = `appProperties has { key='receiptApp' and value='v1' } and mimeType='${SPREADSHEET_MIME}' and trashed=false`;
const VALUE_PARAMS = 'valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS';

/**
 * @typedef {Object} SheetsClient
 * @property {(id: string) => Promise<{spreadsheetId: string, spreadsheetUrl: string, sheets: {properties: {sheetId: number, title: string}}[]}>} getSpreadsheet
 * @property {(id: string, ranges: string[]) => Promise<{valueRanges: {range: string, values?: unknown[][]}[]}>} batchGetValues
 * @property {(id: string, range: string) => Promise<{values?: unknown[][]}>} getValues
 * @property {(id: string, requests: object[]) => Promise<{replies: object[]}>} batchUpdate
 * @property {() => Promise<{id: string, createdTime: string}[]>} findAppFiles
 * @property {() => Promise<{id: string}>} createAppFile
 */

const enc = encodeURIComponent;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * @param {{authorizedFetch: import('../auth/google-auth.js').Auth['authorizedFetch']}} auth
 * @returns {SheetsClient}
 */
export function createSheetsClient(auth) {
  return {
    getSpreadsheet: (id) =>
      auth.authorizedFetch(`${SHEETS_API}/${enc(id)}?fields=${enc('spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title)')}`),
    batchGetValues: (id, ranges) =>
      auth.authorizedFetch(`${SHEETS_API}/${enc(id)}/values:batchGet?${ranges.map((r) => `ranges=${enc(r)}`).join('&')}&${VALUE_PARAMS}`),
    getValues: (id, range) => auth.authorizedFetch(`${SHEETS_API}/${enc(id)}/values/${enc(range)}?${VALUE_PARAMS}`),
    batchUpdate: (id, requests) =>
      auth.authorizedFetch(`${SHEETS_API}/${enc(id)}:batchUpdate`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ requests }) }),
    async findAppFiles() {
      const res = await auth.authorizedFetch(
        `${DRIVE_FILES}?q=${enc(APP_QUERY)}&orderBy=createdTime&fields=${enc('files(id,createdTime)')}&spaces=drive`,
      );
      return res?.files ?? [];
    },
    createAppFile: () =>
      auth.authorizedFetch(`${DRIVE_FILES}?fields=id`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: '영수증 기록', mimeType: SPREADSHEET_MIME, appProperties: { receiptApp: 'v1' } }),
      }),
  };
}
