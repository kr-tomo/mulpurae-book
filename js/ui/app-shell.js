import { h } from './dom.js';
import { parseRoute, routeHref } from '../router.js';
import { AppError } from '../core/errors.js';
import { createSettingsStore } from '../settings/settings-store.js';
import { createJobStore } from '../jobs/job-store.js';
import { createJobQueue } from '../jobs/job-queue.js';
import { createSheetsClient } from '../sheets/sheets-client.js';
import { createSpreadsheetBootstrap } from '../sheets/spreadsheet-bootstrap.js';
import { createReceiptRepository } from '../sheets/receipt-repository.js';
import { createGeminiClient } from '../gemini/gemini-client.js';
import { renderCaptureView } from './capture-view.js';
import { renderRecordsView } from './records-view.js';
import { renderRecordDetailView } from './record-detail-view.js';
import { renderSettingsView } from './settings-view.js';

/** @typedef {import('../auth/google-auth.js').Auth} Auth */
/** @typedef {import('../auth/google-auth.js').Session} Session */
/** @typedef {import('../router.js').Route} Route */

/**
 * @typedef {Object} ShellFactories
 * @property {typeof createSettingsStore} createSettingsStore
 * @property {typeof createJobStore} createJobStore
 * @property {typeof createSheetsClient} createSheetsClient
 * @property {typeof createSpreadsheetBootstrap} createSpreadsheetBootstrap
 * @property {typeof createReceiptRepository} createReceiptRepository
 * @property {typeof createGeminiClient} createGeminiClient
 * @property {typeof createJobQueue} createJobQueue
 * @property {{capture: typeof renderCaptureView, records: typeof renderRecordsView, record: typeof renderRecordDetailView, settings: typeof renderSettingsView}} views
 */

/** @type {ShellFactories} */
export const defaultFactories = {
  createSettingsStore,
  createJobStore,
  createSheetsClient,
  createSpreadsheetBootstrap,
  createReceiptRepository,
  createGeminiClient,
  createJobQueue,
  views: { capture: renderCaptureView, records: renderRecordsView, record: renderRecordDetailView, settings: renderSettingsView },
};

const NAV = /** @type {const} */ ([
  ['영수증 추가', 'capture'],
  ['기록', 'records'],
  ['설정', 'settings'],
]);

/** @typedef {{element: HTMLElement, destroy(): void}} MountedView */

/**
 * @param {{root: HTMLElement, auth: Auth, factories: ShellFactories, win?: Window}} deps
 * @returns {{start(): void, stop(): void}}
 */
export function createAppShell(deps) {
  const { root, auth, factories: f } = deps;
  const win = deps.win ?? window;
  /** @type {(() => void)[]} */
  const cleanups = [];

  const header = h('header', { class: 'app-header' });
  const nav = h('nav', { class: 'app-nav', 'aria-label': '주요 메뉴' });
  const alertBox = h('div', { role: 'alert', class: 'alert', hidden: true });
  const content = h('div', { class: 'app-content' });

  /**
   * Everything built for one signed-in user; dropped wholesale when the session ends or changes.
   * @typedef {{sub: string, settings: ReturnType<typeof createSettingsStore>, jobStore: ReturnType<typeof createJobStore>,
   *   boot: ReturnType<typeof createSpreadsheetBootstrap>, repo: ReturnType<typeof createReceiptRepository>,
   *   queue: ReturnType<typeof createJobQueue>, unsubscribe: () => void, ready: boolean, spreadsheetUrl: string}} UserContext
   */
  /** @type {UserContext | null} */
  let ctx = null;
  /** @type {MountedView | null} */
  let view = null;
  /** @type {string | undefined} */
  let pendingFlash;
  /** @type {string | null} hash of the view on screen; duplicate hashchange events are ignored */
  let renderedHash = null;
  const pendingCount = h('span', { class: 'muted pending' });

  /** @param {string | null} message */
  function showAlert(message) {
    alertBox.textContent = message ?? '';
    alertBox.hidden = !message;
  }

  function destroyView() {
    view?.destroy();
    view = null;
  }

  function teardown() {
    destroyView();
    if (ctx) {
      ctx.unsubscribe();
      ctx.boot.reset();
    }
    ctx = null;
    renderedHash = null;
    nav.replaceChildren();
    pendingCount.textContent = '';
  }

  function renderLogin() {
    header.replaceChildren(h('h1', null, '영수증 기록'));
    const button = h('button', { type: 'button', class: 'primary' }, 'Google 계정으로 로그인');
    button.addEventListener('click', async () => {
      showAlert(null);
      try {
        await auth.signIn();
      } catch (err) {
        showAlert(err instanceof Error ? err.message : String(err));
      }
    });
    content.replaceChildren(
      h(
        'section',
        { class: 'login' },
        button,
        h('p', { class: 'muted' }, '로그인하면 이 앱이 만든 Google 스프레드시트에만 접근합니다. 영수증 이미지는 분석을 위해 Google Gemini API 로 전송됩니다.'),
      ),
    );
  }

  /** @param {Session} session */
  function renderHeader(session) {
    const logout = h('button', { type: 'button' }, '로그아웃');
    logout.addEventListener('click', () => void auth.signOut());
    header.replaceChildren(h('h1', null, '영수증 기록'), h('div', { class: 'user' }, pendingCount, h('span', null, session.email), logout));
  }

  /** @param {Route} route */
  function renderNav(route) {
    const active = route.name === 'record' ? 'records' : route.name;
    nav.replaceChildren(
      ...NAV.map(([label, name]) => h('a', { href: routeHref({ name }), 'aria-current': name === active ? 'page' : null }, label)),
    );
  }

  function renderRoute() {
    if (!ctx?.ready) return;
    const c = ctx;
    const route = parseRoute(win.location.hash);
    const canonical = routeHref(route);
    if (win.location.hash !== canonical) win.history.replaceState(null, '', canonical);
    renderedHash = canonical;
    renderNav(route);
    destroyView();
    const flash = pendingFlash;
    pendingFlash = undefined;
    /** @param {string} hash @param {string} [message] */
    const navigate = (hash, message) => {
      pendingFlash = message;
      if (win.location.hash === hash) renderRoute();
      else win.location.hash = hash;
    };
    if (route.name === 'capture') view = f.views.capture({ queue: c.queue, settings: c.settings, sub: c.sub });
    else if (route.name === 'records') view = f.views.records({ repo: c.repo, spreadsheetUrl: c.spreadsheetUrl, flash });
    else if (route.name === 'record') view = f.views.record({ repo: c.repo, receiptId: route.params.id, navigate });
    else view = f.views.settings({ settings: c.settings, jobStore: c.jobStore, sub: c.sub });
    content.replaceChildren(view.element);
  }

  /** @param {UserContext} c */
  async function prepare(c) {
    showAlert(null);
    content.replaceChildren(h('p', { class: 'muted' }, '스프레드시트 준비 중…'));
    try {
      const handle = await c.boot.ensureSpreadsheet();
      if (ctx !== c) return;
      c.spreadsheetUrl = handle.spreadsheetUrl;
      await c.queue.recover();
      if (ctx !== c) return;
      c.ready = true;
      renderRoute();
    } catch (err) {
      if (ctx !== c) return;
      const e = err instanceof AppError ? err : new AppError('transient', String(err));
      const relogin = e.code === 'permission' || e.code === 'auth_expired';
      const action = h('button', { type: 'button', class: 'primary' }, relogin ? '다시 로그인' : '다시 시도');
      action.addEventListener('click', () => {
        if (relogin) void auth.signIn().catch((x) => showAlert(x instanceof Error ? x.message : String(x)));
        else void prepare(c);
      });
      content.replaceChildren(h('section', { class: 'prepare-error' }, h('p', null, e.message), action));
    }
  }

  /** @param {Session} session @returns {UserContext} */
  function build(session) {
    const sub = session.sub;
    const settings = f.createSettingsStore({ sub });
    const jobStore = f.createJobStore({ owner: sub });
    const client = f.createSheetsClient(auth);
    const boot = f.createSpreadsheetBootstrap({ client, sub });
    const repo = f.createReceiptRepository({ client, getHandle: () => boot.ensureSpreadsheet() });
    const gemini = f.createGeminiClient({ getKey: () => settings.getGeminiKey(), getModel: () => settings.getSettings().model });
    const queue = f.createJobQueue({ store: jobStore, owner: sub, settings, gemini, repo });
    const unsubscribe = queue.subscribe((s) => {
      const n = s.jobs.length;
      pendingCount.textContent = n > 0 ? `임시 보관 ${n}건` : '';
    });
    return { sub, settings, jobStore, boot, repo, queue, unsubscribe, ready: false, spreadsheetUrl: '' };
  }

  /** @param {Session | null} session */
  function onSession(session) {
    showAlert(null);
    if (!session) {
      teardown();
      renderLogin();
      return;
    }
    if (ctx && ctx.sub === session.sub) {
      renderHeader(session);
      return;
    }
    teardown();
    renderHeader(session);
    ctx = build(session);
    void prepare(ctx);
  }

  return {
    start() {
      root.replaceChildren(header, nav, alertBox, content);
      cleanups.push(auth.onChange(onSession));
      const onHash = () => {
        if (win.location.hash !== renderedHash) renderRoute();
      };
      win.addEventListener('hashchange', onHash);
      cleanups.push(() => win.removeEventListener('hashchange', onHash));
      onSession(auth.getSession());
    },
    stop() {
      cleanups.splice(0).forEach((fn) => fn());
      teardown();
      root.replaceChildren();
    },
  };
}
