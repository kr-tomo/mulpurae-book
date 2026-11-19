import { AppError } from '../core/errors.js';
import { fetchJson } from '../core/http.js';
import { EXTRACTION_PROMPT, RECEIPT_RESPONSE_SCHEMA } from './receipt-extraction.js';

const MODELS_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TIMEOUT_MS = 60_000;
const BLOCKED_FINISH = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT']);

/** @typedef {Record<string, unknown>} Extraction */

/** @param {any} body */
function details(body) {
  return Array.isArray(body?.error?.details) ? body.error.details : [];
}

/** @param {any} body @returns {number|undefined} */
function retryAfterMs(body) {
  const info = details(body).find((/** @type {any} */ d) => typeof d?.retryDelay === 'string');
  const m = info ? /^(\d+(?:\.\d+)?)s$/.exec(info.retryDelay) : null;
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

/** @param {unknown} err @returns {never} */
function classify(err) {
  if (!(err instanceof AppError) || err.status === undefined) throw err;
  const body = /** @type {any} */ (err).body;
  const keyInvalid = details(body).some((/** @type {any} */ d) => d?.reason === 'API_KEY_INVALID');
  if (err.status === 401 || err.status === 403 || (err.status === 400 && keyInvalid)) {
    throw new AppError('invalid_key', 'API 키가 유효하지 않거나 Gemini API 가 활성화되지 않았습니다', { status: err.status });
  }
  if (err.status === 429) {
    throw new AppError('rate_limited', 'Gemini 사용 한도에 도달했습니다', { retryable: true, status: 429, retryAfterMs: retryAfterMs(body) });
  }
  throw err;
}

/** @param {any} res @returns {Extraction} */
function extract(res) {
  const candidate = res?.candidates?.[0];
  if (res?.promptFeedback?.blockReason || !candidate || BLOCKED_FINISH.has(candidate.finishReason)) {
    throw new AppError('no_result', '분석 결과를 받지 못했습니다');
  }
  if (candidate.finishReason === 'MAX_TOKENS') throw new AppError('invalid_output', '분석 결과가 너무 길어 잘렸습니다');
  const text = (candidate.content?.parts ?? []).map((/** @type {any} */ p) => (typeof p?.text === 'string' ? p.text : '')).join('');
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('invalid_output', '분석 결과를 해석할 수 없습니다');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError('invalid_output', '분석 결과를 해석할 수 없습니다');
  if (/** @type {any} */ (parsed).isReceipt === false) throw new AppError('no_result', '영수증을 찾지 못했습니다');
  return /** @type {Extraction} */ (parsed);
}

/**
 * @param {{getKey: () => string | null, getModel: () => string, fetchImpl?: typeof fetch}} deps
 * @returns {{analyzeReceipt(input: {imageBase64: string, mimeType: string}): Promise<Extraction>}}
 */
export function createGeminiClient(deps) {
  return {
    async analyzeReceipt({ imageBase64, mimeType }) {
      const key = deps.getKey();
      if (!key) throw new AppError('invalid_key', '설정에서 Gemini API 키를 입력하세요');
      const body = {
        contents: [{ role: 'user', parts: [{ text: EXTRACTION_PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RECEIPT_RESPONSE_SCHEMA, temperature: 0 },
      };
      /** @type {any} */
      let res;
      try {
        res = await fetchJson(`${MODELS_BASE}${encodeURIComponent(deps.getModel())}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs: TIMEOUT_MS,
          fetchImpl: deps.fetchImpl,
        });
      } catch (err) {
        classify(err);
      }
      return extract(res);
    },
  };
}
