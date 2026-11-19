/** @typedef {{name: 'capture'|'records'|'settings'} | {name: 'record', params: {id: string}}} Route */

/**
 * @param {string} hash
 * @returns {Route}
 */
export function parseRoute(hash) {
  const path = hash.replace(/^#/, '');
  if (path === '/records') return { name: 'records' };
  if (path === '/settings') return { name: 'settings' };
  const m = /^\/records\/([^/]+)$/.exec(path);
  if (m) {
    try {
      return { name: 'record', params: { id: decodeURIComponent(m[1]) } };
    } catch {
      return { name: 'capture' };
    }
  }
  return { name: 'capture' };
}

/**
 * @param {Route} route
 * @returns {string}
 */
export function routeHref(route) {
  if (route.name === 'record') return `#/records/${encodeURIComponent(route.params.id)}`;
  return `#/${route.name}`;
}
