import { AppError } from '../core/errors.js';
import { fetchJson } from '../core/http.js';

export const SCOPES = Object.freeze(['openid', 'email', 'https://www.googleapis.com/auth/drive.file']);

const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REFRESH_MARGIN_MS = 60_000;
const GIS_POLL_MS = 50;

/** @typedef {{sub: string, email: string, accessToken: string, expiresAt: number}} Session */
/**
 * @typedef {Object} Auth
 * @property {() => Promise<Session>} signIn
 * @property {() => Promise<void>} signOut
 * @property {() => Session | null} getSession
 * @property {() => Promise<string>} getAccessToken
 * @property {(url: string, opts?: Parameters<typeof fetchJson>[1]) => Promise<any>} authorizedFetch
 * @property {(listener: (s: Session | null) => void) => () => void} onChange
 */

/**
 * @param {{clientId: string, getGis?: () => any, fetchImpl?: typeof fetch, now?: () => number, gisWaitMs?: number}} deps
 * @returns {Auth}
 */
export function createAuth(deps) {
  const getGis = deps.getGis ?? (() => /** @type {any} */ (globalThis).google);
  const now = deps.now ?? Date.now;
  const gisWaitMs = deps.gisWaitMs ?? 10_000;
  /** @type {Session | null} */
  let session = null;
  /** @type {Promise<string> | null} */
  let refreshing = null;
  /** @type {Set<(s: Session | null) => void>} */
  const listeners = new Set();

  /** @param {Session | null} s */
  const emit = (s) => listeners.forEach((fn) => fn(s));

  /** @returns {Promise<any>} google.accounts.oauth2 — the GIS script loads async */
  function waitForGis() {
    return new Promise((resolve, reject) => {
      let waited = 0;
      const poll = () => {
        const oauth2 = getGis()?.accounts?.oauth2;
        if (oauth2) return resolve(oauth2);
        if (waited >= gisWaitMs) {
          return reject(new AppError('network', 'Google 로그인 스크립트를 불러오지 못했습니다', { retryable: true }));
        }
        waited += GIS_POLL_MS;
        setTimeout(poll, GIS_POLL_MS);
      };
      poll();
    });
  }

  /**
   * @param {any} oauth2
   * @param {string} prompt
   * @returns {Promise<any>} token response
   */
  function requestToken(oauth2, prompt) {
    return new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: deps.clientId,
        scope: SCOPES.join(' '),
        callback: (/** @type {any} */ resp) => {
          if (resp?.error) reject(new AppError('permission', 'Google 로그인이 거부되었습니다', { cause: resp.error }));
          else resolve(resp);
        },
        error_callback: (/** @type {any} */ err) => {
          reject(new AppError('permission', 'Google 로그인 창이 닫혔습니다', { cause: err?.type }));
        },
      });
      client.requestAccessToken({ prompt });
    });
  }

  /** @param {string} token @returns {Promise<{sub: string, email: string}>} */
  async function userinfo(token) {
    const info = await fetchJson(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` }, fetchImpl: deps.fetchImpl });
    return { sub: String(info.sub), email: String(info.email ?? '') };
  }

  function endSession() {
    session = null;
    emit(null);
  }

  /** @returns {Promise<string>} */
  function refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        const current = session;
        if (!current) throw new AppError('auth_expired', '로그인이 필요합니다');
        const oauth2 = await waitForGis();
        const resp = await requestToken(oauth2, '');
        const info = await userinfo(resp.access_token);
        if (info.sub !== current.sub) {
          endSession();
          throw new AppError('auth_expired', '다른 계정으로 바뀌어 로그아웃되었습니다');
        }
        session = { ...current, accessToken: resp.access_token, expiresAt: now() + Number(resp.expires_in) * 1000 };
        return session.accessToken;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  /** @returns {Promise<string>} */
  async function getAccessToken() {
    if (!session) throw new AppError('auth_expired', '로그인이 필요합니다');
    if (now() < session.expiresAt - REFRESH_MARGIN_MS) return session.accessToken;
    return refresh();
  }

  return {
    async signIn() {
      const oauth2 = await waitForGis();
      const resp = await requestToken(oauth2, 'select_account');
      if (!oauth2.hasGrantedAllScopes(resp, ...SCOPES)) {
        oauth2.revoke(resp.access_token, () => {});
        throw new AppError('permission', '스프레드시트 권한이 필요합니다');
      }
      const info = await userinfo(resp.access_token);
      session = { sub: info.sub, email: info.email, accessToken: resp.access_token, expiresAt: now() + Number(resp.expires_in) * 1000 };
      emit(session);
      return session;
    },
    async signOut() {
      if (session) {
        try {
          getGis()?.accounts?.oauth2?.revoke(session.accessToken, () => {});
        } catch {
          // Revocation is best effort; the local session ends regardless.
        }
      }
      endSession();
    },
    getSession: () => session,
    getAccessToken,
    async authorizedFetch(url, opts = {}) {
      /** @param {string} token */
      const call = (token) =>
        fetchJson(url, { fetchImpl: deps.fetchImpl, ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
      try {
        return await call(await getAccessToken());
      } catch (err) {
        if (!(err instanceof AppError) || err.code !== 'auth_expired' || err.status !== 401) throw err;
        return call(await refresh());
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
