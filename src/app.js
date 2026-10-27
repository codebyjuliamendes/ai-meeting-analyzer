'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet').default;
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const swaggerUiDist = require('swagger-ui-dist');

const { analyzeRequestSchema } = require('./domain/schemas');
const { normaliseTranscript } = require('./domain/transcript');
const { HttpError, errorHandler } = require('./http/errors');
const { createMeetingStreamHandler } = require('./http/meetingStream');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CHART_JS = path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js');

/**
 * Builds the Express application. Has no side effects (no listen), so tests can drive it.
 *
 * @param {{
 *   config: import('./config').AppConfig,
 *   logger: import('pino').Logger,
 *   analysisService: ReturnType<typeof import('./services/analysisService').createAnalysisService>,
 *   streamOptions?: { random?: () => number, now?: () => number },
 * }} deps
 */
function createApp({ config, logger, analysisService, streamOptions = {} }) {
  const app = express();
  let draining = false;

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // Request id + access log (method, path, status, duration; never bodies or query strings).
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.locals.requestId = requestId;
    res.set('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/healthz' || req.path === '/readyz') return;
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Number((process.hrtime.bigint() - started) / 1000000n),
        },
        'request',
      );
    });
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'font-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          // Deployments may be served over plain HTTP behind an internal proxy.
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );

  // SSE responses must not be buffered by compression.
  app.use(
    compression({
      /** @type {(req: import('express').Request, res: import('express').Response) => boolean} */
      filter: (req, res) => {
        const type = String(res.getHeader('Content-Type') ?? '');
        if (type.startsWith('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // ---- Health ----
  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/readyz', (req, res) => {
    if (draining) {
      res.status(503).json({ status: 'draining' });
      return;
    }
    res.json({ status: 'ready' });
  });

  // ---- Static assets ----
  app.get('/vendor/chart.umd.min.js', (req, res, next) => {
    res.sendFile(CHART_JS, { maxAge: '7d' }, (err) => err && next(err));
  });
  if (config.enableApiDocs) {
    app.use('/vendor/swagger-ui', express.static(swaggerUiDist.getAbsoluteFSPath(), { index: false, maxAge: '7d' }));
    app.get('/api-docs', (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, 'api-docs.html'));
    });
  }
  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // ---- API ----
  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.get('/config', (req, res) => {
    res.json({
      provider: analysisService.provider.name,
      model: analysisService.provider.model,
      demo: analysisService.provider.name === 'demo',
      limits: { maxTranscriptChars: config.limits.maxTranscriptChars },
    });
  });

  /** @type {import('express').RequestHandler} */
  const rateLimitHandler = (req, res) => {
    res.status(429).json({
      error: {
        code: 'rate_limited',
        message: 'Too many requests. Retry in a minute.',
        requestId: res.locals.requestId,
      },
    });
  };

  const analyzeLimiter = rateLimit({
    windowMs: 60000,
    limit: config.limits.analyzePerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler,
  });

  const jsonLimitBytes = Math.max(100 * 1024, config.limits.maxTranscriptChars * 4 + 16 * 1024);

  api.post(
    '/analyze',
    analyzeLimiter,
    (req, res, next) => {
      if (!req.is('application/json')) {
        next(new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json'));
        return;
      }
      next();
    },
    express.json({ limit: jsonLimitBytes }),
    async (req, res) => {
      const parsed = analyzeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          'validation_error',
          'Invalid request body',
          parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const utterances = normaliseTranscript(parsed.data, { maxChars: config.limits.maxTranscriptChars });

      // Abort the upstream call if the client goes away.
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', onClose);
      try {
        const result = await analysisService.analyze(utterances, {
          title: parsed.data.title,
          signal: controller.signal,
        });
        res.json({ ...result, utterances });
      } finally {
        res.off('close', onClose);
      }
    },
  );

  const stream = createMeetingStreamHandler({
    stepMs: config.stream.stepMs,
    jitterMs: config.stream.jitterMs,
    maxConcurrent: config.limits.maxConcurrentStreams,
    logger,
    ...streamOptions,
  });
  const streamLimiter = rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler,
  });
  api.get('/stream-meeting', streamLimiter, (req, res, next) => {
    if (draining) {
      next(new HttpError(503, 'draining', 'Server is shutting down'));
      return;
    }
    stream.handler(req, res, next);
  });

  api.use((req, res, next) => {
    next(new HttpError(404, 'not_found', 'Route not found'));
  });

  app.use('/api', api);

  app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  app.use(errorHandler(logger));

  return {
    app,
    /** Marks the app as draining (readiness fails) and ends open SSE streams. */
    drain() {
      draining = true;
      stream.closeAll();
    },
    activeStreams: stream.activeCount,
  };
}

module.exports = { createApp };
