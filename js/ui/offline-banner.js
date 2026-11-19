import { h } from './dom.js';

/**
 * @param {HTMLElement} host
 * @param {{win?: Window}} [opts]
 * @returns {() => void} 해제 함수
 */
export function mountOfflineBanner(host, opts = {}) {
  const win = opts.win ?? window;
  const banner = h('div', { role: 'status', class: 'banner offline-banner' }, '오프라인 — 분석·저장·조회를 할 수 없습니다');
  const update = () => {
    banner.hidden = win.navigator.onLine;
  };
  update();
  host.prepend(banner);
  win.addEventListener('online', update);
  win.addEventListener('offline', update);
  return () => {
    win.removeEventListener('online', update);
    win.removeEventListener('offline', update);
  };
}
