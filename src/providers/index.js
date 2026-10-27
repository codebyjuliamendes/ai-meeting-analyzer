'use strict';

const { analyzeTranscriptHeuristically } = require('../domain/demoAnalyzer');
const { createAnthropicProvider } = require('./anthropicProvider');

/**
 * @typedef {Object} AnalysisProvider
 * @property {'anthropic' | 'demo'} name
 * @property {string} model
 * @property {(utterances: import('../domain/schemas').Utterance[], options?: { title?: string, signal?: AbortSignal }) => Promise<unknown>} analyze
 */

/** @returns {AnalysisProvider} */
function createDemoProvider() {
  return {
    name: 'demo',
    model: 'keyword-heuristics',
    async analyze(utterances) {
      return analyzeTranscriptHeuristically(utterances);
    },
  };
}

/**
 * @param {import('../config').AppConfig['ai']} aiConfig
 * @returns {AnalysisProvider}
 */
function createProvider(aiConfig) {
  if (aiConfig.provider === 'anthropic') {
    return /** @type {AnalysisProvider} */ (createAnthropicProvider({ config: aiConfig }));
  }
  return createDemoProvider();
}

module.exports = { createProvider, createDemoProvider };
