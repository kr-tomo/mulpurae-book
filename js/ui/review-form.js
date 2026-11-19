import { h } from './dom.js';
import { validateDraft } from '../domain/receipt-validation.js';
import { CATEGORY_SUGGESTIONS } from '../gemini/receipt-extraction.js';

/** @typedef {import('../core/types.js').Draft} Draft */
/** @typedef {import('../core/types.js').DraftItem} DraftItem */
/** @typedef {import('../core/types.js').FieldError} FieldError */

const DEBOUNCE_MS = 500;
const ERROR_TEXT = { required: '필수 항목입니다', format: '형식이 올바르지 않습니다', number: '숫자를 입력하세요' };
const ITEM_FIELDS = /** @type {const} */ ([
  ['name', '품목명'],
  ['quantity', '수량'],
  ['unitPrice', '단가'],
  ['amount', '금액'],
  ['taxAmount', '세액'],
  ['category', '카테고리'],
]);
let formSeq = 0;

/** @param {unknown} v */
const str = (v) => (v === null || v === undefined ? '' : String(v));
/** @param {string} v */
const orNull = (v) => (v === '' ? null : v);

/**
 * @param {{draft: Draft, imageBlob?: Blob|null, submitLabel: string, onChange?: (d: Draft) => void, onSubmit: (d: Draft) => Promise<unknown>}} props
 * @returns {{element: HTMLElement, destroy(): void, getDraft(): Draft}}
 */
export function renderReviewForm(props) {
  const uid = `rf${++formSeq}`;
  const base = props.draft;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pending = null;
  let busy = false;

  /** @param {string} label @param {HTMLElement} control @param {string} field */
  function field(label, control, field) {
    const err = h('span', { class: 'field-error', id: `${uid}-${field}-err` });
    control.setAttribute('data-field', field);
    return h('label', null, label, control, err);
  }
  /** @param {Record<string, unknown>} attrs */
  const input = (attrs) => /** @type {HTMLInputElement} */ (h('input', attrs));

  const [date, time] = (() => {
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(str(base.purchasedAt));
    return m ? [m[1], m[2] ?? ''] : ['', ''];
  })();
  const listId = `${uid}-categories`;
  const f = {
    date: input({ type: 'date', value: date }),
    time: input({ type: 'time', value: time }),
    merchantName: input({ type: 'text', value: str(base.merchantName) }),
    businessNo: input({ type: 'text', value: str(base.businessNo) }),
    supplyAmount: input({ type: 'text', inputmode: 'decimal', value: str(base.supplyAmount) }),
    taxAmount: input({ type: 'text', inputmode: 'decimal', value: str(base.taxAmount) }),
    totalAmount: input({ type: 'text', inputmode: 'decimal', value: str(base.totalAmount) }),
    currency: input({ type: 'text', value: str(base.currency), maxlength: '3' }),
    paymentMethod: input({ type: 'text', value: str(base.paymentMethod) }),
    category: input({ type: 'text', value: str(base.category), list: listId }),
    memo: /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '2' })),
  };
  f.memo.value = str(base.memo);

  const itemsBody = h('tbody');
  /** @param {DraftItem} item */
  function addItemRow(item) {
    const row = h('tr', { class: 'item-row' });
    for (const [key, label] of ITEM_FIELDS) {
      const numeric = key !== 'name' && key !== 'category';
      const el = input({ type: 'text', value: str(item[key]), 'aria-label': label, 'data-item-field': key, ...(numeric ? { inputmode: 'decimal' } : {}), ...(key === 'category' ? { list: listId } : {}) });
      row.append(h('td', null, el));
    }
    const remove = h('button', { type: 'button', class: 'small' }, '행 삭제');
    remove.addEventListener('click', () => {
      row.remove();
      changed();
    });
    row.append(h('td', null, remove));
    itemsBody.append(row);
  }
  base.items.forEach(addItemRow);
  const addItem = h('button', { type: 'button' }, '품목 추가');
  addItem.addEventListener('click', () => {
    addItemRow({ name: null, quantity: null, unitPrice: null, amount: null, taxAmount: null, category: null });
    changed();
  });

  const warnings = h('ul', { class: 'warnings' });
  const submit = /** @type {HTMLButtonElement} */ (h('button', { type: 'submit', class: 'primary' }, props.submitLabel));
  const preview = props.imageBlob ? /** @type {HTMLImageElement} */ (h('img', { class: 'receipt-preview', alt: '영수증 이미지' })) : null;
  /** @type {string | null} */
  let previewUrl = null;
  if (preview && props.imageBlob) {
    previewUrl = URL.createObjectURL(props.imageBlob);
    preview.src = previewUrl;
  }

  const form = /** @type {HTMLFormElement} */ (
    h(
      'form',
      { class: 'review-form', novalidate: true },
      preview,
      warnings,
      h(
        'div',
        { class: 'grid' },
        field('구매일', f.date, 'purchasedAt'),
        field('시각', f.time, 'purchasedAtTime'),
        field('가맹점명', f.merchantName, 'merchantName'),
        field('사업자번호', f.businessNo, 'businessNo'),
        field('공급가액', f.supplyAmount, 'supplyAmount'),
        field('세액', f.taxAmount, 'taxAmount'),
        field('총액', f.totalAmount, 'totalAmount'),
        field('통화', f.currency, 'currency'),
        field('결제수단', f.paymentMethod, 'paymentMethod'),
        field('카테고리', f.category, 'category'),
        field('메모', f.memo, 'memo'),
      ),
      h('datalist', { id: listId }, ...CATEGORY_SUGGESTIONS.map((c) => h('option', { value: c }))),
      h('h3', null, '품목'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'items' }, h('thead', null, h('tr', null, ...ITEM_FIELDS.map(([, l]) => h('th', null, l)), h('th'))), itemsBody)),
      h('div', { class: 'actions' }, addItem),
      h('div', { class: 'actions' }, submit),
    )
  );

  /** @returns {Draft} */
  function getDraft() {
    const d = f.date.value;
    const t = f.time.value;
    /** @type {Draft} */
    const draft = {
      receiptId: base.receiptId,
      purchasedAt: d ? (t ? `${d}T${t}` : d) : null,
      merchantName: orNull(f.merchantName.value),
      businessNo: orNull(f.businessNo.value),
      supplyAmount: orNull(f.supplyAmount.value),
      taxAmount: orNull(f.taxAmount.value),
      totalAmount: orNull(f.totalAmount.value),
      currency: orNull(f.currency.value),
      paymentMethod: orNull(f.paymentMethod.value),
      category: orNull(f.category.value),
      memo: orNull(f.memo.value),
      items: [...itemsBody.querySelectorAll('tr.item-row')].map((row) => {
        /** @param {string} key */
        const v = (key) => orNull(/** @type {HTMLInputElement} */ (row.querySelector(`[data-item-field="${key}"]`)).value);
        return { name: v('name'), quantity: v('quantity'), unitPrice: v('unitPrice'), amount: v('amount'), taxAmount: v('taxAmount'), category: v('category') };
      }),
    };
    if (base.createdAt !== undefined) draft.createdAt = base.createdAt;
    return draft;
  }

  /** @param {FieldError[]} errors */
  function showErrors(errors) {
    form.querySelectorAll('[aria-invalid]').forEach((el) => {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });
    form.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
    for (const e of errors) {
      const m = /^items\[(\d+)\]\.(\w+)$/.exec(e.field);
      /** @type {HTMLElement | null} */
      let control;
      /** @type {HTMLElement | null} */
      let msg;
      if (m) {
        const row = itemsBody.querySelectorAll('tr.item-row')[Number(m[1])];
        control = row?.querySelector(`[data-item-field="${m[2]}"]`) ?? null;
        msg = null;
        if (control) {
          const id = `${uid}-${e.field.replace(/\W/g, '_')}-err`;
          msg = control.parentElement?.querySelector('.field-error') ?? h('span', { class: 'field-error', id });
          if (!msg.isConnected) control.after(msg);
        }
      } else {
        control = form.querySelector(`[data-field="${e.field}"]`);
        msg = control?.parentElement?.querySelector('.field-error') ?? null;
      }
      if (control && msg) {
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', msg.id);
        msg.textContent = ERROR_TEXT[e.code];
      }
    }
  }

  function revalidate() {
    const { errors, warnings: ws } = validateDraft(getDraft());
    showErrors(errors);
    warnings.replaceChildren(...ws.map((w) => h('li', null, w.message)));
    submit.disabled = busy || errors.length > 0;
  }

  function flush() {
    if (pending === null) return;
    clearTimeout(pending);
    pending = null;
    props.onChange?.(getDraft());
  }

  function changed() {
    revalidate();
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      props.onChange?.(getDraft());
    }, DEBOUNCE_MS);
  }

  form.addEventListener('input', changed);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    flush();
    busy = true;
    submit.disabled = true;
    submit.textContent = '저장 중…';
    try {
      await props.onSubmit(getDraft());
      submit.textContent = props.submitLabel;
    } catch {
      submit.textContent = '다시 저장';
    } finally {
      busy = false;
      if (form.isConnected) revalidate();
    }
  });
  submit.addEventListener('click', (ev) => {
    // happy-dom and some engines do not dispatch submit for detached forms; keep one path.
    ev.preventDefault();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  });

  revalidate();
  return {
    element: form,
    destroy() {
      if (pending !== null) clearTimeout(pending);
      pending = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      form.remove();
    },
    getDraft,
  };
}
