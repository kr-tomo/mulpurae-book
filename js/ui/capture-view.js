import { h } from './dom.js';
import { renderJobList } from './job-list.js';
import { renderReviewForm } from './review-form.js';
import { showConsentDialog } from './consent-dialog.js';
import { showConfirmDialog } from './confirm-dialog.js';
import { routeHref } from '../router.js';

/** @typedef {import('../jobs/job-queue.js').JobQueue} JobQueue */
/** @typedef {import('../jobs/job-queue.js').QueueSnapshot} QueueSnapshot */
/** @typedef {import('../settings/settings-store.js').SettingsStore} SettingsStore */

const TOAST_MS = 5000;
const SAVED_TEXT = '저장 완료 — Google Sheets 에 기록되었습니다';

/** @param {number} ms */
function hhmmss(ms) {
  const d = new Date(ms);
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * @param {{queue: JobQueue, settings: SettingsStore, sub: string}} deps
 * @returns {{element: HTMLElement, destroy(): void}}
 */
export function renderCaptureView(deps) {
  const { queue, settings } = deps;
  const settingsLink = () => h('a', { href: routeHref({ name: 'settings' }) }, '설정');

  const alert = h('div', { role: 'alert', class: 'alert', hidden: true });
  const toast = h('div', { role: 'status', class: 'toast', hidden: true });
  const banner = h('div', { role: 'status', class: 'banner', hidden: true });
  const rejectedList = h('ul', { class: 'rejected' });
  const listHost = h('div', { class: 'jobs' });
  const retryAllHost = h('div', { class: 'actions' });
  const reviewHost = h('div', { class: 'review' });
  const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp' }));

  /** @type {QueueSnapshot | null} */
  let snapshot = null;
  /** @type {{jobId: string, form: ReturnType<typeof renderReviewForm>} | null} */
  let open = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let toastTimer = null;

  /** @param {...(Node|string)} parts */
  function showAlert(...parts) {
    alert.replaceChildren(...parts);
    alert.hidden = parts.length === 0;
  }
  /** @param {unknown} err */
  const errText = (err) => (err instanceof Error ? err.message : String(err));

  /** @param {string} text */
  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
  }

  function closeForm() {
    open?.form.destroy();
    open = null;
    reviewHost.replaceChildren();
  }

  /** @param {string} jobId */
  async function save(jobId) {
    showAlert();
    try {
      await queue.save(jobId);
    } catch (err) {
      showAlert(`저장 실패: ${errText(err)}`, h('br'), '이 브라우저에 임시 보관되어 있습니다. 다시 저장할 수 있습니다.');
      throw err;
    }
  }

  /** @param {string} jobId */
  function openReview(jobId) {
    const job = snapshot?.jobs.find((j) => j.jobId === jobId);
    if (!job?.draft) return;
    closeForm();
    const form = renderReviewForm({
      draft: job.draft,
      imageBlob: job.image,
      submitLabel: 'Google Sheets 에 저장',
      onChange: (d) => void queue.updateDraft(jobId, d).catch((err) => showAlert(errText(err))),
      // Persist the submitted draft first: the debounced onChange write may still be in flight.
      onSubmit: async (d) => {
        await queue.updateDraft(jobId, d);
        await save(jobId);
      },
    });
    open = { jobId, form };
    reviewHost.replaceChildren(h('h3', null, `검토: ${job.fileName}`), form.element);
  }

  /** @param {string} jobId */
  async function discard(jobId) {
    const yes = await showConfirmDialog(view, { title: '작업 버리기', body: '이 영수증 작업과 임시 보관된 이미지를 삭제합니다.', confirmLabel: '버리기' });
    if (!yes) return;
    if (open?.jobId === jobId) closeForm();
    await queue.discard(jobId).catch((err) => showAlert(errText(err)));
  }

  function renderBanner() {
    const s = snapshot;
    if (!s?.paused) {
      banner.hidden = true;
      banner.replaceChildren();
      return;
    }
    const resume = h('button', { type: 'button' }, s.pauseReason === 'consent' ? '동의하고 재개' : '재개');
    resume.addEventListener('click', async () => {
      if (s.pauseReason === 'consent') {
        if (!(await showConsentDialog(view))) return;
        settings.acceptConsent();
      }
      queue.resume();
    });
    /** @type {(Node|string)[]} */
    let message;
    if (s.pauseReason === 'rate_limited') {
      message = ['Gemini 사용 한도에 도달했습니다.', s.resumeAfter !== null ? ` ${hhmmss(s.resumeAfter)} 이후 재개하세요.` : ''];
    } else if (s.pauseReason === 'invalid_key') {
      message = ['API 키가 유효하지 않습니다. ', settingsLink(), '에서 확인하세요.'];
    } else if (s.pauseReason === 'consent') {
      message = ['이미지 전송 동의가 필요합니다.'];
    } else {
      message = ['오프라인입니다. 연결되면 재개하세요.'];
    }
    banner.replaceChildren(h('span', null, ...message), ' ', resume);
    banner.hidden = false;
  }

  /** @param {QueueSnapshot} s */
  function onSnapshot(s) {
    snapshot = s;
    if (s.saved.length > 0) {
      if (open && s.saved.includes(open.jobId)) closeForm();
      showAlert();
      showToast(SAVED_TEXT);
    }
    if (open && !s.jobs.some((j) => j.jobId === open?.jobId)) closeForm();
    renderBanner();
    const failed = s.jobs.filter((j) => j.status === 'analyze_failed').length;
    if (failed > 0) {
      const b = h('button', { type: 'button' }, '실패한 분석 모두 다시 시도');
      b.addEventListener('click', () => void queue.retryAllFailed());
      retryAllHost.replaceChildren(b);
    } else {
      retryAllHost.replaceChildren();
    }
    listHost.replaceChildren(
      renderJobList({
        snapshot: s,
        onReview: openReview,
        onRetryAnalysis: (id) => void queue.retryAnalysis(id).catch((err) => showAlert(errText(err))),
        onSave: (id) => void save(id).catch(() => {}),
        onDiscard: (id) => void discard(id),
      }),
    );
  }

  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    if (files.length === 0) return;
    showAlert();
    rejectedList.replaceChildren();
    try {
      if (!settings.getGeminiKey()) {
        showAlert('설정에서 Gemini API 키를 먼저 입력하세요. ', settingsLink());
        return;
      }
      if (!settings.hasConsent()) {
        if (!(await showConsentDialog(view))) return;
        settings.acceptConsent();
      }
      const { rejected } = await queue.addFiles(files);
      rejectedList.replaceChildren(...rejected.map((r) => h('li', null, `${r.fileName}: ${r.error.message}`)));
    } finally {
      fileInput.value = '';
    }
  });

  const view = h(
    'section',
    { class: 'capture-view' },
    h('h2', null, '영수증 추가'),
    h('label', { class: 'file-pick' }, '영수증 이미지 선택', fileInput),
    alert,
    toast,
    banner,
    rejectedList,
    retryAllHost,
    listHost,
    reviewHost,
  );
  const unsubscribe = queue.subscribe(onSnapshot);

  return {
    element: view,
    destroy() {
      unsubscribe();
      closeForm();
      if (toastTimer) clearTimeout(toastTimer);
      view.remove();
    },
  };
}
