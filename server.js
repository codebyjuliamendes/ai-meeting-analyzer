'use strict';

/**
 * Process entry point: validates configuration, wires dependencies, starts the HTTP server
 * and handles graceful shutdown.
 */

const { loadConfig } = require('./src/config');
const { createLogger } = require('./src/logger');
const { createProvider } = require('./src/providers');
const { createAnalysisService } = require('./src/services/analysisService');
const { createApp } = require('./src/app');

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Logger depends on config; fall back to a plain structured line.
    process.stderr.write(`${JSON.stringify({ level: 'fatal', msg: /** @type {Error} */ (err).message })}\n`);
    process.exit(1);
  }

  const logger = createLogger({ level: config.logLevel });
  const provider = createProvider(config.ai);
  const analysisService = createAnalysisService({
    provider,
    deadlineMs: config.ai.timeoutMs * 2 + 5000,
    logger,
  });
  const { app, drain } = createApp({ config, logger, analysisService });

  const server = app.listen(config.port, config.host, () => {
    logger.info(
      { port: config.port, host: config.host, provider: provider.name, model: provider.model },
      provider.name === 'demo'
        ? 'server started in DEMO mode (no AI provider configured; set ANTHROPIC_API_KEY for real analysis)'
        : 'server started',
    );
  });
  // Long AI calls: keep sockets open long enough for the analysis deadline.
  server.requestTimeout = config.ai.timeoutMs * 2 + 15000;
  server.headersTimeout = 30000;
  server.keepAliveTimeout = 65000;

  let shuttingDown = false;
  /** @param {string} signal */
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    drain();
    const force = setTimeout(() => {
      logger.warn('forcing shutdown after timeout');
      server.closeAllConnections();
      process.exit(1);
    }, config.shutdownTimeoutMs);
    force.unref();
    server.close((err) => {
      if (err) logger.error({ err: { message: err.message } }, 'error while closing server');
      logger.info('shutdown complete');
      process.exit(err ? 1 : 0);
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: { message: String(reason) } }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: { message: err.message, stack: err.stack } }, 'uncaught exception');
    process.exit(1);
  });
}

main();
