const PROPERTY_ATTRS = new Set(['value', 'checked', 'disabled']);

/**
 * Creates an element; string children always become text nodes.
 * @param {string} tag
 * @param {Record<string, unknown>|null} [attrs]
 * @param {...(Node|string|number|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (/^on/i.test(key)) throw new TypeError(`event attribute not allowed: ${key}`);
    if (PROPERTY_ATTRS.has(key)) {
      /** @type {any} */ (el)[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else if (value !== false && value !== null && value !== undefined) {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return el;
}
