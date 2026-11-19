import { h } from './dom.js';

/**
 * In-page modal confirmation; the native blocking dialog is never used (SPEC-000 §4.2).
 * @param {HTMLElement} host
 * @param {{title: string, body: Node | string, confirmLabel: string, cancelLabel?: string}} opts
 * @returns {Promise<boolean>}
 */
export function showConfirmDialog(host, opts) {
  return new Promise((resolve) => {
    const confirm = h('button', { type: 'button', class: 'primary' }, opts.confirmLabel);
    const cancel = h('button', { type: 'button' }, opts.cancelLabel ?? '취소');
    const dialog = /** @type {HTMLDialogElement} */ (
      h('dialog', { class: 'dialog' }, h('h2', null, opts.title), typeof opts.body === 'string' ? h('p', null, opts.body) : opts.body, h('div', { class: 'actions' }, cancel, confirm))
    );
    /** @param {boolean} result */
    const finish = (result) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    confirm.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    host.append(dialog);
    dialog.showModal();
  });
}
