import { AppError } from '../core/errors.js';
import { nowIso } from '../core/clock.js';
import { newReceiptId } from '../core/ids.js';
import { blobToBase64, checkImageFile, prepareImage } from '../gemini/image-prep.js';
import { toDraft } from '../gemini/receipt-extraction.js';
import { draftToRecord, validateDraft } from '../domain/receipt-validation.js';

/** @typedef {import('./job-store.js').Job} Job */
/** @typedef {import('./job-store.js').JobStore} JobStore */
/** @typedef {import('../core/types.js').Draft} Draft */
/** @typedef {import('../settings/settings-store.js').SettingsStore} SettingsStore */
/** @typedef {import('../sheets/receipt-repository.js').ReceiptRepository} ReceiptRepository */
/** @typedef {null|'consent'|'offline'|'rate_limited'|'invalid_key'} PauseReason */
/** @typedef {{jobs: Job[], paused: boolean, pauseReason: PauseReason, resumeAfter: number|null, saved: string[]}} QueueSnapshot */
/**
 * @typedef {Object} JobQueue
 * @property {() => Promise<void>} recover
 * @property {(files: Iterable<File>) => Promise<{added: Job[], rejected: {fileName: string, error: AppError}[]}>} addFiles
 * @property {() => void} resume
 * @property {(jobId: string) => Promise<void>} retryAnalysis
 * @property {() => Promise<void>} retryAllFailed
 * @property {(jobId: string, draft: Draft) => Promise<Job>} updateDraft
 * @property {(jobId: string) => Promise<{receiptId: string}>} save
 * @property {(jobId: string) => Promise<void>} discard
 * @property {(listener: (s: QueueSnapshot) => void) => () => void} subscribe
 * @property {() => Promise<void>} idle
 */

const INTERRUPTED_SAVE = '저장 결과를 확인하지 못했습니다. 다시 저장해도 중복되지 않습니다';

/** @param {unknown} err @returns {AppError} */
function asAppError(err) {
  return err instanceof AppError ? err : new AppError('transient', err instanceof Error ? err.message : String(err), { cause: err });
}

/**
 * @param {{store: JobStore, owner: string, settings: Pick<SettingsStore,'hasConsent'|'getSettings'>,
 *          gemini: {analyzeReceipt: (input: {imageBase64: string, mimeType: string}) => Promise<unknown>},
 *          repo: Pick<ReceiptRepository,'create'>,
 *          prepare?: typeof prepareImage, sleep?: (ms: number) => Promise<void>, now?: () => number, online?: () => boolean}} deps
 * @returns {JobQueue}
 */
export function createJobQueue(deps) {
  const { store, owner, settings, gemini, repo } = deps;
  const prepare = deps.prepare ?? prepareImage;
  const sleep = deps.sleep ?? ((/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const online = deps.online ?? (() => navigator.onLine);

  /** @type {Map<string, Job>} */
  const jobs = new Map();
  /** @type {Set<(s: QueueSnapshot) => void>} */
  const listeners = new Set();
  let paused = false;
  /** @type {PauseReason} */
  let pauseReason = null;
  /** @type {number|null} */
  let resumeAfter = null;
  let lastStart = -Infinity;
  let lastCreatedMs = 0;
  /** @type {Promise<void> | null} */
  let running = null;
  /** @type {Promise<void> | null} */
  let loaded = null;

  /** @returns {Job[]} */
  const ordered = () => [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  /** @param {string[]} [saved] */
  function emit(saved = []) {
    /** @type {QueueSnapshot} */
    const snap = { jobs: ordered(), paused, pauseReason, resumeAfter, saved };
    listeners.forEach((fn) => fn(snap));
  }

  function load() {
    return (loaded ??= store.listByOwner().then((list) => {
      for (const j of list) jobs.set(j.jobId, j);
    }));
  }

  /** @param {Job} job */
  async function write(job) {
    const saved = await store.put(job);
    jobs.set(saved.jobId, saved);
    emit();
    return saved;
  }

  /** @param {string} jobId */
  function current(jobId) {
    const job = jobs.get(jobId);
    if (!job) throw new AppError('not_found', '작업을 찾을 수 없습니다');
    return job;
  }

  /** @param {Exclude<PauseReason, null>} reason @param {number|null} [until] */
  function pause(reason, until = null) {
    paused = true;
    pauseReason = reason;
    resumeAfter = until;
    emit();
  }

  /** @param {Job} job */
  async function analyze(job) {
    lastStart = now();
    const working = await write({ ...job, status: 'analyzing' });
    try {
      if (!working.image) throw new AppError('validation', '이미지가 없습니다');
      const imageBase64 = await blobToBase64(working.image);
      const extraction = await gemini.analyzeReceipt({ imageBase64, mimeType: working.image.type || 'image/jpeg' });
      const { warnings, normalized } = validateDraft(toDraft(extraction, working.jobId));
      await write({ ...current(working.jobId), status: 'review', draft: normalized, warnings, error: null });
    } catch (e) {
      const err = asAppError(e);
      const latest = current(working.jobId);
      await write({ ...latest, status: 'analyze_failed', attempts: latest.attempts + 1, error: { code: err.code, message: err.message } });
      if (err.code === 'rate_limited') pause('rate_limited', err.retryAfterMs !== undefined ? now() + err.retryAfterMs : null);
      else if (err.code === 'invalid_key') pause('invalid_key');
    }
  }

  async function loop() {
    await load();
    for (;;) {
      if (paused) return;
      const next = ordered().find((j) => j.status === 'queued');
      if (!next) return;
      if (!settings.hasConsent()) return pause('consent');
      if (!online()) return pause('offline');
      const wait = lastStart + settings.getSettings().analysisIntervalMs - now();
      if (wait > 0) await sleep(wait);
      const job = jobs.get(next.jobId);
      if (paused || !job || job.status !== 'queued') continue;
      await analyze(job);
    }
  }

  function wake() {
    if (!running) {
      running = loop().finally(() => {
        running = null;
      });
    }
  }

  /** @param {string} jobId @param {Job['status'][]} allowed @param {string} message */
  function requireStatus(jobId, allowed, message) {
    const job = current(jobId);
    if (!allowed.includes(job.status)) throw new AppError('validation', message);
    return job;
  }

  function resume() {
    paused = false;
    pauseReason = null;
    resumeAfter = null;
    emit();
    wake();
  }

  function nextCreatedAt() {
    const ms = Math.max(Date.parse(nowIso()), lastCreatedMs + 1);
    lastCreatedMs = ms;
    return new Date(ms).toISOString();
  }

  return {
    async recover() {
      await load();
      await store.purgeExpired();
      jobs.clear();
      for (const j of await store.listByOwner()) jobs.set(j.jobId, j);
      for (const job of ordered()) {
        if (job.status === 'analyzing') await write({ ...job, status: 'queued' });
        else if (job.status === 'saving') await write({ ...job, status: 'save_failed', error: { code: 'transient', message: INTERRUPTED_SAVE } });
      }
      emit();
      wake();
    },

    async addFiles(files) {
      await load();
      /** @type {Job[]} */
      const added = [];
      /** @type {{fileName: string, error: AppError}[]} */
      const rejected = [];
      for (const file of files) {
        try {
          checkImageFile(file);
          const { blob } = await prepare(file);
          const createdAt = nextCreatedAt();
          /** @type {Job} */
          const job = {
            jobId: newReceiptId(),
            owner,
            status: 'queued',
            fileName: file.name,
            image: blob,
            draft: null,
            warnings: [],
            error: null,
            attempts: 0,
            createdAt,
            updatedAt: createdAt,
          };
          await store.create(job);
          jobs.set(job.jobId, job);
          added.push(job);
        } catch (e) {
          rejected.push({ fileName: file.name, error: asAppError(e) });
        }
      }
      emit();
      wake();
      return { added, rejected };
    },

    resume,

    async retryAnalysis(jobId) {
      const job = requireStatus(jobId, ['analyze_failed'], '다시 분석할 수 없는 상태입니다');
      await write({ ...job, status: 'queued', error: null });
      wake();
    },

    async retryAllFailed() {
      for (const job of ordered().filter((j) => j.status === 'analyze_failed')) {
        await write({ ...job, status: 'queued', error: null });
      }
      resume();
    },

    async updateDraft(jobId, draft) {
      const job = requireStatus(jobId, ['review', 'save_failed'], '지금은 수정할 수 없습니다');
      const { warnings } = validateDraft(draft);
      return write({ ...job, draft, warnings });
    },

    async save(jobId) {
      const job = requireStatus(jobId, ['review', 'save_failed'], '지금은 저장할 수 없습니다');
      const draft = /** @type {Draft} */ (job.draft);
      const { errors } = validateDraft(draft);
      if (errors.length > 0) throw new AppError('validation', '입력값을 확인하세요', { cause: errors });
      if (!online()) throw new AppError('offline', '오프라인에서는 저장할 수 없습니다');
      await write({ ...job, status: 'saving' });
      try {
        const { receipt, items } = draftToRecord(draft);
        await repo.create(receipt, items);
      } catch (e) {
        const err = asAppError(e);
        await write({ ...current(jobId), status: 'save_failed', error: { code: err.code, message: err.message } });
        throw err;
      }
      await store.delete(jobId);
      jobs.delete(jobId);
      emit([jobId]);
      return { receiptId: jobId };
    },

    async discard(jobId) {
      requireStatus(jobId, ['queued', 'review', 'analyze_failed', 'save_failed'], '진행 중인 작업은 버릴 수 없습니다');
      await store.delete(jobId);
      jobs.delete(jobId);
      emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener({ jobs: ordered(), paused, pauseReason, resumeAfter, saved: [] });
      return () => listeners.delete(listener);
    },

    async idle() {
      while (running) await running;
    },
  };
}
