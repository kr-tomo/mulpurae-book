import { h } from './dom.js';

/** @typedef {import('../jobs/job-store.js').JobStatus} JobStatus */
/** @typedef {import('../jobs/job-queue.js').QueueSnapshot} QueueSnapshot */

/** @type {Record<JobStatus, string>} */
export const STATUS_LABELS = Object.freeze({
  queued: '대기 중',
  analyzing: '분석 중',
  review: '검토 필요 · 이 브라우저에 임시 보관됨',
  saving: '저장 중',
  analyze_failed: '분석 실패',
  save_failed: '저장 실패 · 이 브라우저에 임시 보관됨',
});

/** @type {Record<JobStatus, ('review'|'retryAnalysis'|'save'|'discard')[]>} */
const ACTIONS = {
  queued: ['discard'],
  analyzing: [],
  review: ['review', 'discard'],
  saving: [],
  analyze_failed: ['retryAnalysis', 'discard'],
  save_failed: ['review', 'save', 'discard'],
};
const ACTION_LABELS = { review: '검토', retryAnalysis: '다시 분석', save: '다시 저장', discard: '버리기' };

/**
 * @param {{snapshot: QueueSnapshot, onReview(jobId: string): void, onRetryAnalysis(jobId: string): void, onSave(jobId: string): void, onDiscard(jobId: string): void}} props
 * @returns {HTMLElement}
 */
export function renderJobList(props) {
  const handlers = { review: props.onReview, retryAnalysis: props.onRetryAnalysis, save: props.onSave, discard: props.onDiscard };
  return h(
    'ul',
    { class: 'job-list' },
    ...props.snapshot.jobs.map((job) => {
      const buttons = ACTIONS[job.status].map((action) => {
        const b = h('button', { type: 'button', class: 'small' }, ACTION_LABELS[action]);
        b.addEventListener('click', () => handlers[action](job.jobId));
        return b;
      });
      return h(
        'li',
        { class: `job job-${job.status}`, 'data-job-id': job.jobId },
        h('span', { class: 'file' }, job.fileName),
        h('span', { class: 'badge' }, STATUS_LABELS[job.status]),
        job.error ? h('span', { class: 'job-error' }, job.error.message) : null,
        h('span', { class: 'actions' }, ...buttons),
      );
    }),
  );
}
