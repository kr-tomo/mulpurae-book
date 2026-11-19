import { showConfirmDialog } from './confirm-dialog.js';
import { renderDataNotice } from './data-notice.js';

/**
 * @param {HTMLElement} host
 * @returns {Promise<boolean>} true = 동의
 */
export function showConsentDialog(host) {
  return showConfirmDialog(host, { title: '이미지 전송 동의', body: renderDataNotice(), confirmLabel: '동의' });
}
