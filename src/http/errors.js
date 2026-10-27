'use strict';

const { ProviderError } = require('../providers/errors');
const { TranscriptError } = require('../domain/transcript');

class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** @type {Record<string, { status: number, message: string }>} */
const PROVIDER_STATUS = {
  timeout: { status: 504, message: 'The analysis took too long. Try a shorter transcript or retry later.' },
  rate_limited: { status: 503, message: 'The AI provider is busy. Retry in a minute.' },
  unavailable: { status: 502, message: 'The AI provider is unavailable. Retry later.' },
  refused: { status: 422, message: 'The AI provider declined to analyze this transcript.' },
  invalid_output: { status: 502, message: 'The AI provider returned an invalid analysis. Retry later.' },
  misconfigured: { status: 502, message: 'The AI provider is misconfigured. Contact the administrator.' },
};

/**
 * @param {unknown} err
 * @returns {HttpError}
 */
function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof TranscriptError) return new HttpError(400, 'invalid_transcript', err.message);
  if (err instanceof ProviderError) {
    const mapped = PROVIDER_STATUS[err.code] ?? PROVIDER_STATUS.unavailable;
    return new HttpError(mapped.status, `ai_${err.code}`, mapped.message);
  }
  const e = /** @type {{ type?: string, status?: number, statusCode?: number }} */ (err ?? {});
  if (e.type === 'entity.too.large') return new HttpError(413, 'payload_too_large', 'Request body is too large');
  if (e.type === 'entity.parse.failed') return new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  const status = e.status ?? e.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new HttpError(status, 'bad_request', 'Bad request');
  }
  return new HttpError(500, 'internal_error', 'Internal server error');
}

/**
 * @param {import('pino').Logger} logger
 * @returns {import('express').ErrorRequestHandler}
 */
function errorHandler(logger) {
  return (err, req, res, _next) => {
    const httpError = toHttpError(err);
    const logPayload = {
      requestId: res.locals.requestId,
      status: httpError.status,
      code: httpError.code,
      err:
        err instanceof Error
          ? { name: err.name, message: err.message, code: /** @type {any} */ (err).code }
          : undefined,
    };
    if (httpError.status >= 500) logger.error(logPayload, 'request failed');
    else logger.warn(logPayload, 'request rejected');

    if (res.headersSent) {
      res.end();
      return;
    }
    if (httpError.code === 'ai_rate_limited') res.set('Retry-After', '60');
    res.status(httpError.status).json({
      error: {
        code: httpError.code,
        message: httpError.message,
        ...(httpError.details ? { details: httpError.details } : {}),
        requestId: res.locals.requestId,
      },
    });
  };
}

module.exports = { HttpError, toHttpError, errorHandler };
