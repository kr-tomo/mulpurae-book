// App-shell service worker (SPEC-501). Only same-origin shell files are ever cached;
// Google / Gemini requests are never intercepted.
const CACHE_PREFIX = 'receipt-shell-';
const CACHE_VERSION = 'receipt-shell-v1';
// Keep in sync with src/ — TC-U-501-002 compares this list with the files on disk.
const APP_SHELL = [
  './',
  './css/app.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './index.html',
  './js/auth/google-auth.js',
  './js/config.js',
  './js/core/clock.js',
  './js/core/errors.js',
  './js/core/http.js',
  './js/core/ids.js',
  './js/core/types.js',
  './js/domain/receipt-filter.js',
  './js/domain/receipt-validation.js',
  './js/gemini/gemini-client.js',
  './js/gemini/image-prep.js',
  './js/gemini/receipt-extraction.js',
  './js/jobs/job-queue.js',
  './js/jobs/job-store.js',
  './js/main.js',
  './js/pwa.js',
  './js/router.js',
  './js/settings/settings-store.js',
  './js/sheets/receipt-repository.js',
  './js/sheets/row-mapper.js',
  './js/sheets/schema.js',
  './js/sheets/sheets-client.js',
  './js/sheets/spreadsheet-bootstrap.js',
  './js/ui/app-shell.js',
  './js/ui/capture-view.js',
  './js/ui/confirm-dialog.js',
  './js/ui/consent-dialog.js',
  './js/ui/data-notice.js',
  './js/ui/dom.js',
  './js/ui/format.js',
  './js/ui/job-list.js',
  './js/ui/offline-banner.js',
  './js/ui/record-detail-view.js',
  './js/ui/records-view.js',
  './js/ui/review-form.js',
  './js/ui/settings-view.js',
  './manifest.webmanifest',
];

const SCOPE = new URL('./', self.location.href);
const INDEX_URL = new URL('./index.html', SCOPE).href;

/** @param {URL} url */
function shellPath(url) {
  if (!url.pathname.startsWith(SCOPE.pathname)) return null;
  const rel = './' + url.pathname.slice(SCOPE.pathname.length);
  return APP_SHELL.includes(rel) ? rel : null;
}

/** @param {FetchEvent} event */
function handleFetch(event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(INDEX_URL)));
    return;
  }
  const rel = shellPath(url);
  if (rel === null) {
    event.respondWith(fetch(req));
    return;
  }
  event.respondWith(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.match(new URL(rel, SCOPE).href))
      .then((hit) => hit || fetch(req)),
  );
}

/** @param {ExtendableEvent} event */
function handleInstall(event) {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
}

/** @param {ExtendableEvent} event */
function handleActivate(event) {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
}

/** @param {ExtendableMessageEvent} event */
function handleMessage(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
}

self.addEventListener('install', handleInstall);
self.addEventListener('activate', handleActivate);
self.addEventListener('fetch', handleFetch);
self.addEventListener('message', handleMessage);
Object.assign(self, { CACHE_PREFIX, CACHE_VERSION, APP_SHELL, handleFetch, handleActivate });
