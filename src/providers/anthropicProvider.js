'use strict';

const { Anthropic } = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT, buildUserMessage } = require('../domain/prompt');
const { analysisJsonSchema } = require('../domain/schemas');
const { ProviderError } = require('./errors');

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Maps SDK errors to provider errors without leaking request content.
 * @param {unknown} err
 */
function mapSdkError(err) {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('timeout', 'AI provider timed out', { cause: err });
  }
  if (err instanceof Anthropic.APIUserAbortError) {
    return new ProviderError('timeout', 'AI request aborted', { cause: err });
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('misconfigured', 'AI provider rejected the credentials', { cause: err });
  }
  if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.BadRequestError) {
    return new ProviderError('misconfigured', `AI provider rejected the request (${err.status})`, { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError('rate_limited', 'AI provider rate limit reached', { cause: err, retryable: true });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('unavailable', 'Could not reach AI provider', { cause: err, retryable: true });
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError('unavailable', `AI provider error (${err.status ?? 'unknown'})`, {
      cause: err,
      retryable: true,
    });
  }
  return new ProviderError('unavailable', 'Unexpected AI provider failure', { cause: err });
}

/**
 * Real meeting analysis backed by the Anthropic Messages API with structured outputs.
 * The SDK handles per-attempt timeouts and retries (429, 5xx, connection errors).
 *
 * @param {{
 *   config: import('../config').AppConfig['ai'],
 *   client?: Pick<InstanceType<typeof Anthropic>, 'beta'>,
 * }} options
 */
function createAnthropicProvider({ config, client }) {
  const anthropic =
    client ??
    new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });

  // Server-side refusal fallback is not available for Haiku-class models.
  const useFallbacks = config.fallbacks === 'default' && !config.model.startsWith('claude-haiku');

  return {
    name: 'anthropic',
    model: config.model,
    /**
     * @param {import('../domain/schemas').Utterance[]} utterances
     * @param {{ title?: string, signal?: AbortSignal }} [options]
     * @returns {Promise<unknown>} raw (unvalidated) structured output
     */
    async analyze(utterances, options = {}) {
      /** @type {Record<string, unknown>} */
      const params = {
        model: config.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(utterances, { title: options.title }) }],
        output_config: {
          effort: config.effort,
          format: { type: 'json_schema', schema: analysisJsonSchema },
        },
      };
      if (useFallbacks) {
        params.betas = [FALLBACK_BETA];
        params.fallbacks = 'default';
      }

      let response;
      try {
        response = await anthropic.beta.messages.create(/** @type {any} */ (params), { signal: options.signal });
      } catch (err) {
        throw mapSdkError(err);
      }

      if (response.stop_reason === 'refusal') {
        throw new ProviderError('refused', 'AI provider declined to analyze this transcript');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new ProviderError('invalid_output', 'AI output was truncated', { retryable: true });
      }
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => /** @type {{ text: string }} */ (block).text)
        .join('');
      try {
        return JSON.parse(text);
      } catch {
        throw new ProviderError('invalid_output', 'AI output was not valid JSON', { retryable: true });
      }
    },
  };
}

module.exports = { createAnthropicProvider, mapSdkError, FALLBACK_BETA };
