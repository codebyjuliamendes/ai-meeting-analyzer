'use strict';

const { validateAnalysis } = require('../domain/schemas');
const { ProviderError } = require('../providers/errors');

/**
 * Orchestrates a provider call: overall deadline, cancellation, one extra attempt when the
 * model returns output that fails validation, and validation against the transcript.
 *
 * @param {{
 *   provider: import('../providers').AnalysisProvider,
 *   deadlineMs: number,
 *   invalidOutputRetries?: number,
 *   logger: import('pino').Logger,
 * }} deps
 */
function createAnalysisService({ provider, deadlineMs, invalidOutputRetries = 1, logger }) {
  return {
    provider: { name: provider.name, model: provider.model },
    /**
     * @param {import('../domain/schemas').Utterance[]} utterances
     * @param {{ title?: string, signal?: AbortSignal }} [options]
     */
    async analyze(utterances, options = {}) {
      const signals = [AbortSignal.timeout(deadlineMs)];
      if (options.signal) signals.push(options.signal);
      const signal = AbortSignal.any(signals);
      const started = Date.now();

      let lastError;
      for (let attempt = 0; attempt <= invalidOutputRetries; attempt += 1) {
        if (signal.aborted) break;
        try {
          const raw = await provider.analyze(utterances, { title: options.title, signal });
          const result = validateAnalysis(raw, utterances.length);
          if (result.success) {
            logger.info(
              { provider: provider.name, utterances: utterances.length, attempt, durationMs: Date.now() - started },
              'analysis completed',
            );
            return { provider: provider.name, model: provider.model, analysis: result.data };
          }
          // Log only the validation issue paths, never the content.
          logger.warn({ provider: provider.name, attempt, issue: result.error.slice(0, 300) }, 'invalid AI output');
          lastError = new ProviderError('invalid_output', 'AI output failed validation');
        } catch (err) {
          if (err instanceof ProviderError && err.code === 'invalid_output') {
            lastError = err;
            continue;
          }
          if (signal.aborted && !(err instanceof ProviderError && err.code !== 'timeout')) {
            throw new ProviderError('timeout', 'Analysis exceeded the time limit', { cause: err });
          }
          throw err;
        }
      }
      if (signal.aborted && !lastError) {
        throw new ProviderError('timeout', 'Analysis exceeded the time limit');
      }
      throw lastError ?? new ProviderError('invalid_output', 'AI output failed validation');
    },
  };
}

module.exports = { createAnalysisService };
