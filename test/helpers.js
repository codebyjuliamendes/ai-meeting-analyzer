'use strict';

const pino = require('pino');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { createAnalysisService } = require('../src/services/analysisService');
const { createDemoProvider } = require('../src/providers');

const silentLogger = pino({ level: 'silent' });

/**
 * @param {Record<string, string>} [env]
 * @param {{ provider?: any, deadlineMs?: number }} [opts]
 */
function buildApp(env = {}, opts = {}) {
  const config = loadConfig({ NODE_ENV: 'test', STREAM_STEP_MS: '0', STREAM_JITTER_MS: '0', ...env });
  const provider = opts.provider ?? createDemoProvider();
  const analysisService = createAnalysisService({
    provider,
    deadlineMs: opts.deadlineMs ?? 2000,
    logger: silentLogger,
  });
  return { config, ...createApp({ config, logger: silentLogger, analysisService }) };
}

/** A valid analysis for a 2-utterance transcript. */
function validAnalysis() {
  return {
    summary: 'Ana will send the report.',
    overallSentiment: { score: 70, label: 'positive' },
    actionItems: [{ assignee: 'Ana', task: 'Send the report', deadline: 'Friday', sourceIndex: 0 }],
    decisions: [],
    risks: [],
    utteranceSentiment: [
      { index: 0, score: 60 },
      { index: 1, score: 80 },
    ],
  };
}

module.exports = { silentLogger, buildApp, validAnalysis };
