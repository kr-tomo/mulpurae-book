import { h } from './dom.js';
import { routeHref } from '../router.js';
import { draftToRecord, recordToDraft } from '../domain/receipt-validation.js';
import { renderReviewForm } from './review-form.js';
import { showConfirmDialog } from './confirm-dialog.js';
import { formatMoney } from './format.js';

/** @typedef {import('../core/types.js').Receipt} Receipt */
/** @typedef {import('../core/types.js').Item} Item */
/** @typedef {import('../sheets/receipt-repository.js').ReceiptRepository} ReceiptRepository */

const DASH = '—';
/** @param {unknown} v */
const show = (v) => (v === null || v === undefined || v === '' ? DASH : String(v));

/**
 * @param {{repo: Pick<ReceiptRepository,'get'|'update'|'remove'>, receiptId: string, navigate: (hash: string, flash?: string) => void}} deps
 * @returns {{element: HTMLElement, destroy(): void}}
 */
export function renderRecordDetailView(deps) {
  const { repo, receiptId, navigate } = deps;
  const status = h('div', { role: 'status', class: 'toast', hidden: true });
  const alert = h('div', { role: 'alert', class: 'alert', hidden: true });
  const body = h('div', { class: 'detail-body' }, h('p', { class: 'muted' }, '불러오는 중…'));
  const back = h('a', { href: routeHref({ name: 'records' }) }, '← 기록 목록');
  /** @type {ReturnType<typeof renderReviewForm> | null} */
  let form = null;

  /** @param {unknown} err */
  const errText = (err) => (err instanceof Error ? err.message : String(err));
  /** @param {string} text */
  function fail(text) {
    alert.textContent = text;
    alert.hidden = false;
  }

  /** @param {Receipt} r @param {Item[]} items */
  function renderDetail(r, items) {
    /** @type {[string, string][]} */
    const rows = [
      ['구매일', show(r.purchasedAt?.replace('T', ' '))],
      ['가맹점', show(r.merchantName)],
      ['사업자번호', show(r.businessNo)],
      ['공급가액', r.supplyAmount === null ? DASH : formatMoney(r.supplyAmount, r.currency)],
      ['세액', r.taxAmount === null ? DASH : formatMoney(r.taxAmount, r.currency)],
      ['총액', formatMoney(r.totalAmount, r.currency)],
      ['통화', show(r.currency)],
      ['결제수단', show(r.paymentMethod)],
      ['카테고리', show(r.category)],
      ['메모', show(r.memo)],
    ];
    const edit = h('button', { type: 'button' }, '수정');
    const remove = h('button', { type: 'button', class: 'danger' }, '삭제');
    edit.addEventListener('click', () => openEdit(r, items));
    remove.addEventListener('click', () => void confirmRemove());
    body.replaceChildren(
      h('dl', { class: 'fields' }, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', { 'data-field': k }, v)])),
      h('h3', null, '품목'),
      items.length === 0
        ? h('p', { class: 'muted' }, '품목 없음')
        : h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 'items' },
              h('thead', null, h('tr', null, ...['#', '품목명', '수량', '단가', '금액', '세액', '카테고리'].map((t) => h('th', null, t)))),
              h(
                'tbody',
                null,
                ...[...items].sort((a, b) => a.lineNo - b.lineNo).map((i) =>
                  h(
                    'tr',
                    { class: 'item-row' },
                    ...[i.lineNo, i.name, show(i.quantity), show(i.unitPrice), formatMoney(i.amount, r.currency), show(i.taxAmount), show(i.category)].map((v) => h('td', null, String(v))),
                  ),
                ),
              ),
            ),
          ),
      h('div', { class: 'actions' }, edit, remove),
    );
  }

  async function load() {
    const found = await repo.get(receiptId).catch((err) => {
      fail(errText(err));
      return undefined;
    });
    if (found === undefined) return;
    if (found === null) {
      body.replaceChildren(h('p', null, '기록을 찾을 수 없습니다'), h('a', { href: routeHref({ name: 'records' }) }, '기록 목록으로'));
      return;
    }
    renderDetail(found.receipt, found.items);
  }

  /** @param {Receipt} r @param {Item[]} items */
  function openEdit(r, items) {
    alert.hidden = true;
    status.hidden = true;
    const cancel = h('button', { type: 'button' }, '취소');
    form = renderReviewForm({
      draft: recordToDraft(r, items),
      submitLabel: '수정 저장',
      onSubmit: async (draft) => {
        alert.hidden = true;
        try {
          const record = draftToRecord(draft);
          await repo.update(record.receipt, record.items);
        } catch (err) {
          fail(`수정 실패: ${errText(err)}`);
          throw err;
        }
        form?.destroy();
        form = null;
        await load();
        status.textContent = '수정 완료';
        status.hidden = false;
      },
    });
    cancel.addEventListener('click', () => {
      form?.destroy();
      form = null;
      void load();
    });
    body.replaceChildren(form.element, h('div', { class: 'actions' }, cancel));
  }

  async function confirmRemove() {
    const yes = await showConfirmDialog(view, {
      title: '영수증 삭제',
      body: '이 영수증과 품목을 삭제합니다. 데이터는 시트의 deleted_receipts·deleted_items 탭으로 옮겨집니다.',
      confirmLabel: '삭제',
    });
    if (!yes) return;
    alert.hidden = true;
    try {
      const { status: result } = await repo.remove(receiptId);
      navigate(routeHref({ name: 'records' }), result === 'deleted' ? '삭제 완료' : '이미 삭제된 기록입니다');
    } catch (err) {
      fail(`삭제 실패: ${errText(err)}`);
    }
  }

  const view = h('section', { class: 'record-detail' }, back, h('h2', null, '영수증 상세'), status, alert, body);
  void load();
  return {
    element: view,
    destroy() {
      form?.destroy();
      view.remove();
    },
  };
}
