import { AppError } from '../core/errors.js';
import { fetchJson } from '../core/http.js';
import { nowIso } from '../core/clock.js';
import { DEFAULT_ANALYSIS_INTERVAL_MS, DEFAULT_GEMINI_MODEL } from '../config.js';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
const MODEL_RE = /^[a-z0-9][a-z0-9.\-]*$/;
const MAX_INTERVAL_MS = 60_000;

/** @typedef {{model: string, analysisIntervalMs: number, consentAcceptedAt: string | null}} AppSettings */
/**
 * @typedef {Object} SettingsStore
 * @property {() => string | null} getGeminiKey
 * @property {(key: string) => void} setGeminiKey
 * @property {() => void} clearGeminiKey
 * @property {(key: string) => Promise<true>} verifyGeminiKey
 * @property {() => AppSettings} getSettings
 * @property {(partial: Partial<Pick<AppSettings, 'model'|'analysisIntervalMs'>>) => AppSettings} updateSettings
 * @property {() => void} acceptConsent
 * @property {() => boolean} hasConsent
 * @property {() => void} clearAllLocalData
 */

/** @returns {AppSettings} */
const defaults = () => ({ model: DEFAULT_GEMINI_MODEL, analysisIntervalMs: DEFAULT_ANALYSIS_INTERVAL_MS, consentAcceptedAt: null });

/**
 * @param {string} key
 * @returns {string}
 */
export function maskKey(key) {
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

/** @param {any} body */
function isInvalidKeyBody(body) {
  const err = body?.error;
  return err?.status === 'INVALID_ARGUMENT' || (Array.isArray(err?.details) && err.details.some((/** @type {any} */ d) => d?.reason === 'API_KEY_INVALID'));
}

/**
 * @param {{sub: string, storage?: Storage, fetchImpl?: typeof fetch}} deps
 * @returns {SettingsStore}
 */
export function createSettingsStore(deps) {
  const storage = deps.storage ?? localStorage;
  const prefix = `receipt:${deps.sub}:`;
  const KEY = `${prefix}geminiKey`;
  const SETTINGS = `${prefix}settings`;

  /** @returns {AppSettings} */
  function readSettings() {
    const raw = storage.getItem(SETTINGS);
    if (raw === null) return defaults();
    try {
      const parsed = JSON.parse(raw);
      return { ...defaults(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch {
      return defaults();
    }
  }

  /** @param {AppSettings} s */
  const writeSettings = (s) => storage.setItem(SETTINGS, JSON.stringify(s));

  return {
    getGeminiKey: () => storage.getItem(KEY),
    setGeminiKey(key) {
      const trimmed = key.trim();
      if (trimmed === '') throw new AppError('validation', 'API 키를 입력하세요');
      storage.setItem(KEY, trimmed);
    },
    clearGeminiKey: () => storage.removeItem(KEY),
    async verifyGeminiKey(key) {
      try {
        await fetchJson(MODELS_URL, { headers: { 'x-goog-api-key': key }, fetchImpl: deps.fetchImpl });
        return true;
      } catch (err) {
        if (err instanceof AppError && ((err.status === 400 && isInvalidKeyBody(/** @type {any} */ (err).body)) || err.status === 403)) {
          throw new AppError('invalid_key', 'API 키가 유효하지 않거나 Gemini API 가 활성화되지 않았습니다', { status: err.status });
        }
        throw err;
      }
    },
    getSettings: readSettings,
    updateSettings(partial) {
      const next = { ...readSettings() };
      if (partial.model !== undefined) {
        if (typeof partial.model !== 'string' || !MODEL_RE.test(partial.model)) {
          throw new AppError('validation', '모델 이름은 소문자·숫자·점·하이픈만 쓸 수 있습니다');
        }
        next.model = partial.model;
      }
      if (partial.analysisIntervalMs !== undefined) {
        const v = partial.analysisIntervalMs;
        if (!Number.isInteger(v) || v < 0 || v > MAX_INTERVAL_MS) {
          throw new AppError('validation', '분석 간격은 0~60000 사이의 정수(ms)여야 합니다');
        }
        next.analysisIntervalMs = v;
      }
      writeSettings(next);
      return next;
    },
    acceptConsent() {
      writeSettings({ ...readSettings(), consentAcceptedAt: nowIso() });
    },
    hasConsent: () => readSettings().consentAcceptedAt !== null,
    clearAllLocalData() {
      const doomed = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k !== null && k.startsWith(prefix)) doomed.push(k);
      }
      doomed.forEach((k) => storage.removeItem(k));
    },
  };
}
