'use strict';

const pino = require('pino');

/**
 * Structured JSON logger. Transcripts are sensitive: request bodies are never logged,
 * and any field that could carry transcript content or credentials is redacted.
 * @param {{ level: string }} options
 */
function createLogger({ level }) {
  return pino({
    level,
    base: { service: 'ai-meeting-analyzer' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'body',
        'transcript',
        'utterances',
        'text',
        'apiKey',
      ],
      censor: '[REDACTED]',
    },
  });
}

module.exports = { createLogger };
