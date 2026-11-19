import { AppError, errorFromStatus } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {string} url
 * @param {{method?: string, headers?: Record<string,string>, body?: BodyInit|null, timeoutMs?: number, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<any>}
 */
export async function fetchJson(url, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  /** @type {Response} */
  let res;
  let text;
  try {
    res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body ?? null,
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    if (timedOut) throw new AppError('timeout', '요청 시간이 초과되었습니다', { retryable: true, cause: err });
    throw new AppError('network', '네트워크에 연결할 수 없습니다', { retryable: true, cause: err });
  } finally {
    clearTimeout(timer);
  }

  const body = parseJson(text);
  if (res.ok) {
    if (text === '') return null;
    return body;
  }
  const message = typeof body?.error?.message === 'string' && body.error.message ? body.error.message : `HTTP ${res.status}`;
  const err = errorFromStatus(res.status, message);
  // Callers (Gemini, Sheets) inspect provider-specific details such as error reasons.
  Object.defineProperty(err, 'body', { value: body, enumerable: false });
  throw err;
}

/** @param {string} text */
function parseJson(text) {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
