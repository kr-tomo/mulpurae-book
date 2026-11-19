import { GOOGLE_CLIENT_ID } from './config.js';
import { createAuth } from './auth/google-auth.js';
import { createAppShell, defaultFactories } from './ui/app-shell.js';
import { registerServiceWorker, showUpdateBanner } from './pwa.js';
import { mountOfflineBanner } from './ui/offline-banner.js';

const root = document.getElementById('app');
if (root) {
  createAppShell({ root, auth: createAuth({ clientId: GOOGLE_CLIENT_ID }), factories: defaultFactories }).start();
  mountOfflineBanner(document.body);
  // Installability is optional; a blocked or failed registration must not break the app.
  registerServiceWorker({ onUpdateReady: (apply) => showUpdateBanner(document.body, apply) }).catch(() => {});
}
