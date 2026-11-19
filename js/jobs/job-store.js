import { AppError } from '../core/errors.js';
import { nowIso } from '../core/clock.js';

/** @typedef {import('../core/types.js').Draft} Draft */
/** @typedef {import('../core/types.js').Warning} Warning */
/** @typedef {'queued'|'analyzing'|'review'|'saving'|'analyze_failed'|'save_failed'} JobStatus */
/**
 * @typedef {{jobId: string, owner: string, status: JobStatus, fileName: string, image: Blob|null, draft: Draft|null,
 *   warnings: Warning[], error: {code: string, message: string}|null, attempts: number, createdAt: string, updatedAt: string}} Job
 */
/**
 * @typedef {Object} JobStore
 * @property {(job: Job) => Promise<void>} create
 * @property {(jobId: string) => Promise<Job|null>} get
 * @property {(job: Job) => Promise<Job>} put
 * @property {(jobId: string) => Promise<void>} delete
 * @property {() => Promise<Job[]>} listByOwner
 * @property {(maxAgeMs?: number) => Promise<number>} purgeExpired
 * @property {(owner: string) => Promise<void>} clearOwner
 */

const DB_NAME = 'receipt-app';
const DB_VERSION = 1;
const STORE = 'jobs';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/**
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @param {IDBFactory} idb @returns {Promise<IDBDatabase>} */
function openDb(idb) {
  const req = idb.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const store = req.result.createObjectStore(STORE, { keyPath: 'jobId' });
    store.createIndex('owner', 'owner');
  };
  return done(req);
}

const denied = () => new AppError('permission', '다른 사용자의 작업에는 접근할 수 없습니다');

/**
 * @param {{owner: string, indexedDB?: IDBFactory}} deps
 * @returns {JobStore}
 */
export function createJobStore(deps) {
  const { owner } = deps;
  /** @type {Promise<IDBDatabase> | null} */
  let dbp = null;
  const db = () => (dbp ??= openDb(deps.indexedDB ?? globalThis.indexedDB));

  /**
   * @template T
   * @param {IDBTransactionMode} mode
   * @param {(store: IDBObjectStore) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function withStore(mode, fn) {
    const tx = (await db()).transaction(STORE, mode);
    const finished = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const result = await fn(tx.objectStore(STORE));
    await finished;
    return result;
  }

  /** @param {string} jobId @returns {Promise<Job | undefined>} */
  const raw = (jobId) => withStore('readonly', (s) => done(/** @type {IDBRequest<Job | undefined>} */ (s.get(jobId))));

  /** @returns {Promise<Job[]>} */
  async function listByOwner() {
    const all = await withStore('readonly', (s) => done(/** @type {IDBRequest<Job[]>} */ (s.index('owner').getAll(owner))));
    return all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  /** @param {string[]} ids */
  const deleteMany = (ids) =>
    withStore('readwrite', async (s) => {
      await Promise.all(ids.map((id) => done(s.delete(id))));
    });

  return {
    async create(job) {
      if (job.owner !== owner) throw denied();
      await withStore('readwrite', (s) => done(s.add(job)));
    },
    async get(jobId) {
      const rec = await raw(jobId);
      return rec && rec.owner === owner ? rec : null;
    },
    async put(job) {
      const existing = await raw(job.jobId);
      if (job.owner !== owner || (existing && existing.owner !== owner)) throw denied();
      const updated = { ...job, updatedAt: nowIso() };
      await withStore('readwrite', (s) => done(s.put(updated)));
      return updated;
    },
    async delete(jobId) {
      const existing = await raw(jobId);
      if (existing && existing.owner !== owner) throw denied();
      await withStore('readwrite', (s) => done(s.delete(jobId)));
    },
    listByOwner,
    async purgeExpired(maxAgeMs = DEFAULT_MAX_AGE_MS) {
      const cutoff = Date.parse(nowIso()) - maxAgeMs;
      const expired = (await listByOwner()).filter((j) => Date.parse(j.updatedAt) < cutoff).map((j) => j.jobId);
      await deleteMany(expired);
      return expired.length;
    },
    async clearOwner(target) {
      if (target !== owner) throw denied();
      await deleteMany((await listByOwner()).map((j) => j.jobId));
    },
  };
}
