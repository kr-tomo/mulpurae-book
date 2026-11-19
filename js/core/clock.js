/** @type {(() => Date) | null} */
let clock = null;

/** @returns {string} */
export function nowIso() {
  return (clock ? clock() : new Date()).toISOString();
}

/** @param {(() => Date) | null} fn */
export function setClock(fn) {
  clock = fn;
}
