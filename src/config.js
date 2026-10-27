'use strict';

const { z } = require('zod');

const booleanFromEnv = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4003),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.string().default('false'),

  AI_PROVIDER: z.enum(['auto', 'anthropic', 'demo']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  ANTHROPIC_FALLBACKS: z.enum(['default', 'off']).default('default'),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  ANALYZE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(10000).default(10),
  MAX_TRANSCRIPT_CHARS: z.coerce.number().int().min(1000).max(500000).default(60000),
  MAX_CONCURRENT_STREAMS: z.coerce.number().int().min(1).max(10000).default(50),
  STREAM_STEP_MS: z.coerce.number().int().min(0).max(60000).default(2500),
  STREAM_JITTER_MS: z.coerce.number().int().min(0).max(60000).default(2000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).max(120000).default(10000),
  ENABLE_API_DOCS: booleanFromEnv.default(true),
});

/**
 * Parses TRUST_PROXY into a value accepted by Express' `trust proxy` setting.
 * @param {string} raw
 * @returns {boolean | number | string}
 */
function parseTrustProxy(raw) {
  if (raw === 'true') return true;
  if (raw === 'false' || raw === '') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * @typedef {ReturnType<typeof loadConfig>} AppConfig
 */

/**
 * Loads and validates configuration from environment variables.
 * Fails fast (throws) on invalid configuration so the process never boots half-configured.
 * @param {NodeJS.ProcessEnv} [env]
 */
function loadConfig(env = process.env) {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const cfg = parsed.data;

  const hasKey = Boolean(cfg.ANTHROPIC_API_KEY);
  if (cfg.AI_PROVIDER === 'anthropic' && !hasKey) {
    throw new Error('Invalid configuration: AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  }
  const provider = cfg.AI_PROVIDER === 'auto' ? (hasKey ? 'anthropic' : 'demo') : cfg.AI_PROVIDER;

  return Object.freeze({
    env: cfg.NODE_ENV,
    port: cfg.PORT,
    host: cfg.HOST,
    logLevel: cfg.LOG_LEVEL,
    trustProxy: parseTrustProxy(cfg.TRUST_PROXY),
    ai: Object.freeze({
      provider,
      apiKey: cfg.ANTHROPIC_API_KEY,
      model: cfg.ANTHROPIC_MODEL,
      effort: cfg.ANTHROPIC_EFFORT,
      fallbacks: cfg.ANTHROPIC_FALLBACKS,
      baseURL: cfg.ANTHROPIC_BASE_URL,
      timeoutMs: cfg.AI_TIMEOUT_MS,
      maxRetries: cfg.AI_MAX_RETRIES,
    }),
    limits: Object.freeze({
      analyzePerMinute: cfg.ANALYZE_RATE_LIMIT_PER_MIN,
      maxTranscriptChars: cfg.MAX_TRANSCRIPT_CHARS,
      maxConcurrentStreams: cfg.MAX_CONCURRENT_STREAMS,
    }),
    stream: Object.freeze({
      stepMs: cfg.STREAM_STEP_MS,
      jitterMs: cfg.STREAM_JITTER_MS,
    }),
    shutdownTimeoutMs: cfg.SHUTDOWN_TIMEOUT_MS,
    enableApiDocs: cfg.ENABLE_API_DOCS,
  });
}

module.exports = { loadConfig };
