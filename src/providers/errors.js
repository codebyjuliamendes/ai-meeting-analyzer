'use strict';

/**
 * Error raised by an analysis provider. `code` is stable and safe to return to clients;
 * `message` must never contain transcript content or credentials.
 */
class ProviderError extends Error {
  /**
   * @param {'timeout' | 'rate_limited' | 'unavailable' | 'refused' | 'invalid_output' | 'misconfigured'} code
   * @param {string} message
   * @param {{ retryable?: boolean, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

module.exports = { ProviderError };
