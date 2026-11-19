import { h } from './ui/dom.js';

/**
 * @param {{onUpdateReady: (apply: () => void) => void, nav?: Navigator, loc?: Location}} opts
 * @returns {Promise<ServiceWorkerRegistration | null>}
 */
export async function registerServiceWorker(opts) {
  const nav = opts.nav ?? navigator;
  const loc = opts.loc ?? location;
  if (!('serviceWorker' in nav) || !nav.serviceWorker) return null;
  const sw = nav.serviceWorker;
  const reg = await sw.register('./sw.js', { scope: './' });
  // Reload only after the user asked for the update; the first install's clients.claim() also fires controllerchange.
  let applied = false;
  let reloaded = false;
  const apply = () => {
    applied = true;
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  };
  sw.addEventListener('controllerchange', () => {
    if (!applied || reloaded) return;
    reloaded = true;
    loc.reload();
  });
  const notify = () => {
    if (reg.waiting && sw.controller) opts.onUpdateReady(apply);
  };
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') notify();
    });
  });
  notify();
  return reg;
}

/**
 * @param {HTMLElement} host
 * @param {() => void} apply
 * @returns {HTMLElement}
 */
export function showUpdateBanner(host, apply) {
  const button = h('button', { type: 'button' }, '새로고침');
  button.addEventListener('click', apply);
  const banner = h('div', { role: 'status', class: 'banner update-banner' }, '새 버전이 있습니다 ', button);
  host.prepend(banner);
  return banner;
}
