import { h } from './dom.js';
import { routeHref } from '../router.js';
import { filterReceipts, validateFilter } from '../domain/receipt-filter.js';
import { formatMoney } from './format.js';

/** @typedef {import('../core/types.js').Receipt} Receipt */
/** @typedef {import('../sheets/receipt-repository.js').ReceiptRepository} ReceiptRepository */
/** @typedef {import('../domain/receipt-filter.js').Filter} Filter */

/**
 * @param {{repo: Pick<ReceiptRepository,'list'>, spreadsheetUrl: string, online?: () => boolean, flash?: string}} deps
 * @returns {{element: HTMLElement, destroy(): void}}
 */
export function renderRecordsView(deps) {
  const online = deps.online ?? (() => navigator.onLine);
  const status = h('div', { role: 'status', class: 'toast', hidden: !deps.flash }, deps.flash ?? '');
  const alert = h('div', { role: 'alert', class: 'alert', hidden: true });
  const filterAlert = h('div', { role: 'alert', class: 'alert', hidden: true });
  const info = h('p', { class: 'muted' });
  const results = h('div', { class: 'results' });

  /** @param {Record<string, unknown>} attrs */
  const input = (attrs) => /** @type {HTMLInputElement} */ (h('input', attrs));
  const fields = {
    from: input({ type: 'date' }),
    to: input({ type: 'date' }),
    merchant: input({ type: 'text' }),
    minTotal: input({ type: 'text', inputmode: 'decimal' }),
    maxTotal: input({ type: 'text', inputmode: 'decimal' }),
  };
  const search = h('button', { type: 'submit', class: 'primary' }, '검색');
  const reset = h('button', { type: 'button' }, '초기화');
  const refresh = h('button', { type: 'button' }, '새로고침');
  const form = h(
    'form',
    { class: 'filter' },
    h('label', null, '시작일', fields.from),
    h('label', null, '종료일', fields.to),
    h('label', null, '가맹점', fields.merchant),
    h('label', null, '최소 금액', fields.minTotal),
    h('label', null, '최대 금액', fields.maxTotal),
    h('div', { class: 'actions' }, search, reset, refresh),
  );

  /** @type {Receipt[] | null} */
  let all = null;
  /** @type {Filter} */
  let filter = {};

  /** @returns {Filter} */
  const readFilter = () => ({
    from: fields.from.value,
    to: fields.to.value,
    merchant: fields.merchant.value,
    minTotal: fields.minTotal.value,
    maxTotal: fields.maxTotal.value,
  });

  function renderResults() {
    if (all === null) return;
    if (all.length === 0) {
      results.replaceChildren(h('p', { class: 'empty' }, '저장된 기록이 없습니다'));
      return;
    }
    const visible = filterReceipts(all, filter);
    if (visible.length === 0) {
      results.replaceChildren(h('p', { class: 'empty' }, '조건에 맞는 기록이 없습니다'));
      return;
    }
    results.replaceChildren(
      h('p', { class: 'count' }, `${visible.length}건`),
      h(
        'ul',
        { class: 'record-list' },
        ...visible.map((r) =>
          h(
            'li',
            null,
            h(
              'a',
              { href: routeHref({ name: 'record', params: { id: r.receiptId } }), class: 'record' },
              h('span', { class: 'date' }, r.purchasedAt.replace('T', ' ')),
              h('span', { class: 'merchant' }, r.merchantName),
              h('span', { class: 'amount' }, formatMoney(r.totalAmount, r.currency)),
              h('span', { class: 'category' }, r.category ?? ''),
            ),
          ),
        ),
      ),
    );
  }

  async function load() {
    alert.hidden = true;
    if (!online()) {
      results.replaceChildren(h('p', { class: 'empty' }, '오프라인에서는 기록을 불러올 수 없습니다'));
      return;
    }
    results.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'));
    try {
      const { receipts, skipped } = await deps.repo.list();
      all = receipts;
      info.textContent = skipped > 0 ? `읽을 수 없는 행 ${skipped}개를 건너뛰었습니다` : '';
      renderResults();
    } catch (err) {
      results.replaceChildren();
      const retry = h('button', { type: 'button' }, '다시 시도');
      retry.addEventListener('click', () => void load());
      alert.replaceChildren(err instanceof Error ? err.message : String(err), ' ', retry);
      alert.hidden = false;
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const next = readFilter();
    const errors = validateFilter(next);
    filterAlert.textContent = errors.join(' · ');
    filterAlert.hidden = errors.length === 0;
    if (errors.length > 0) return;
    filter = next;
    renderResults();
  });
  search.addEventListener('click', (ev) => {
    ev.preventDefault();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  });
  reset.addEventListener('click', () => {
    Object.values(fields).forEach((f) => (f.value = ''));
    filter = {};
    filterAlert.hidden = true;
    renderResults();
  });
  refresh.addEventListener('click', () => void load());

  const view = h(
    'section',
    { class: 'records-view' },
    h('h2', null, '기록'),
    status,
    h('p', null, h('a', { href: deps.spreadsheetUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Google Sheets 에서 열기')),
    form,
    filterAlert,
    alert,
    info,
    results,
  );
  void load();
  return {
    element: view,
    destroy() {
      view.remove();
    },
  };
}
