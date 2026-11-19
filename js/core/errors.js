/**
 * @typedef {'network'|'timeout'|'auth_expired'|'permission'|'not_found'|'rate_limited'|'transient'|'bad_request'|'invalid_key'|'invalid_output'|'no_result'|'schema_mismatch'|'validation'|'offline'} ErrorCode
 */

/** Normalized failure of an external call or a domain rule. */
export class AppError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} message
   * @param {{retryable?: boolean, status?: number, cause?: unknown, retryAfterMs?: number}} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'AppError';
    /** @type {ErrorCode} */
    this.code = code;
    /** @type {boolean} */
    this.retryable = opts.retryable ?? false;
    /** @type {number|undefined} */
    this.status = opts.status;
    /** @type {number|undefined} Server-suggested wait before retrying (SPEC-302 §4.2). */
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/**
 * @param {number} status
 * @param {string} message
 * @returns {AppError}
 */
export function errorFromStatus(status, message) {
  /** @type {[ErrorCode, boolean]} */
  let kind;
  if (status === 401) kind = ['auth_expired', false];
  else if (status === 403) kind = ['permission', false];
  else if (status === 404) kind = ['not_found', false];
  else if (status === 429) kind = ['rate_limited', true];
  else if (status >= 500 && status <= 599) kind = ['transient', true];
  else kind = ['bad_request', false];
  return new AppError(kind[0], message, { retryable: kind[1], status });
}
