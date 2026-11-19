import { h } from './dom.js';
import { maskKey } from '../settings/settings-store.js';
import { renderDataNotice } from './data-notice.js';
import { showConfirmDialog } from './confirm-dialog.js';

/** @typedef {import('../settings/settings-store.js').SettingsStore} SettingsStore */

/**
 * @param {{settings: SettingsStore, jobStore: {clearOwner(sub: string): Promise<void>}, sub: string}} deps
 * @returns {{element: HTMLElement, destroy(): void}}
 */
export function renderSettingsView(deps) {
  const { settings, jobStore, sub } = deps;
  const alert = h('div', { role: 'alert', class: 'alert', hidden: true });
  const status = h('div', { role: 'status', class: 'status' });
  /** @param {unknown} err */
  const fail = (err) => {
    alert.textContent = err instanceof Error ? err.message : String(err);
    alert.hidden = false;
  };
  /** @param {string} msg */
  const ok = (msg) => {
    alert.hidden = true;
    status.textContent = msg;
  };

  const keyState = h('p', { class: 'key-state' });
  const refreshKey = () => {
    const key = settings.getGeminiKey();
    keyState.textContent = key ? `저장된 키: ${maskKey(key)}` : '저장된 키 없음';
  };
  const keyInput = /** @type {HTMLInputElement} */ (h('input', { type: 'password', autocomplete: 'off', name: 'gemini-key' }));
  const saveKey = h('button', { type: 'button', class: 'primary' }, '저장');
  const verifyKey = h('button', { type: 'button' }, '키 확인');
  const deleteKey = h('button', { type: 'button' }, '키 삭제');
  saveKey.addEventListener('click', () => {
    try {
      settings.setGeminiKey(keyInput.value);
      keyInput.value = '';
      refreshKey();
      ok('API 키를 저장했습니다');
    } catch (err) {
      fail(err);
    }
  });
  verifyKey.addEventListener('click', async () => {
    const key = settings.getGeminiKey();
    if (!key) return fail('저장된 API 키가 없습니다');
    try {
      await settings.verifyGeminiKey(key);
      ok('API 키가 확인되었습니다');
    } catch (err) {
      fail(err);
    }
  });
  deleteKey.addEventListener('click', () => {
    settings.clearGeminiKey();
    refreshKey();
    ok('API 키를 삭제했습니다');
  });

  const current = settings.getSettings();
  const modelInput = /** @type {HTMLInputElement} */ (h('input', { type: 'text', name: 'model', value: current.model }));
  const intervalInput = /** @type {HTMLInputElement} */ (
    h('input', { type: 'number', name: 'interval', min: '0', max: '60000', step: '500', value: String(current.analysisIntervalMs) })
  );
  const saveSettings = h('button', { type: 'button' }, '분석 설정 저장');
  saveSettings.addEventListener('click', () => {
    try {
      settings.updateSettings({ model: modelInput.value.trim(), analysisIntervalMs: Number(intervalInput.value) });
      ok('분석 설정을 저장했습니다');
    } catch (err) {
      fail(err);
    }
  });

  const clearData = h('button', { type: 'button', class: 'danger' }, '이 브라우저의 내 데이터 삭제');
  const view = h(
    'section',
    { class: 'settings-view' },
    h('h2', null, '설정'),
    alert,
    status,
    h('h3', null, 'Gemini API 키'),
    keyState,
    h('label', null, 'API 키 ', keyInput),
    h('div', { class: 'actions' }, saveKey, verifyKey, deleteKey),
    h('p', { class: 'muted' }, '키는 이 브라우저에만 저장됩니다. 공용 기기에서는 사용 후 삭제하세요.'),
    h('h3', null, '분석 설정'),
    h('label', null, '모델 ', modelInput),
    h('label', null, '분석 간격(ms) ', intervalInput),
    h('div', { class: 'actions' }, saveSettings),
    h('h3', null, '데이터 전송 안내'),
    renderDataNotice(),
    h('h3', null, '내 데이터'),
    h('div', { class: 'actions' }, clearData),
  );
  clearData.addEventListener('click', async () => {
    const yes = await showConfirmDialog(view, {
      title: '내 데이터 삭제',
      body: '이 브라우저에 저장된 API 키·설정·임시 작업을 모두 삭제합니다. Google Sheets 의 기록은 지워지지 않습니다.',
      confirmLabel: '삭제',
    });
    if (!yes) return;
    try {
      settings.clearAllLocalData();
      await jobStore.clearOwner(sub);
      refreshKey();
      ok('이 브라우저의 내 데이터를 삭제했습니다');
    } catch (err) {
      fail(err);
    }
  });
  refreshKey();
  return {
    element: view,
    destroy() {
      view.remove();
    },
  };
}
