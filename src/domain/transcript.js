'use strict';

const { utteranceSchema, MAX_UTTERANCES } = require('./schemas');

class TranscriptError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'TranscriptError';
  }
}

const SPEAKER_LINE = /^\s*(?:\[[^\]]{1,20}\]\s*)?([^:\n]{1,80}?)\s*:\s*(.+)$/;

/**
 * Parses a plain-text transcript in the common "Speaker: text" format.
 * Lines without a speaker prefix are appended to the previous utterance
 * (or attributed to "Unknown" when they come first). Blank lines are ignored.
 * An optional leading timestamp like "[00:01:02]" is dropped.
 * @param {string} text
 * @returns {import('./schemas').Utterance[]}
 */
function parseTranscriptText(text) {
  /** @type {{ speaker: string, text: string }[]} */
  const utterances = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = SPEAKER_LINE.exec(line);
    if (match && !/^https?$/i.test(match[1].trim())) {
      utterances.push({ speaker: match[1].trim(), text: match[2].trim() });
    } else if (utterances.length > 0) {
      utterances[utterances.length - 1].text += ` ${line}`;
    } else {
      utterances.push({ speaker: 'Unknown', text: line });
    }
  }
  return utterances;
}

/**
 * Normalises an analyze request into a bounded list of validated utterances.
 * @param {{ utterances?: import('./schemas').Utterance[], text?: string }} body
 * @param {{ maxChars: number }} limits
 * @returns {import('./schemas').Utterance[]}
 */
function normaliseTranscript(body, { maxChars }) {
  const candidates = body.utterances ?? parseTranscriptText(body.text ?? '');
  if (candidates.length === 0) throw new TranscriptError('Transcript is empty');
  if (candidates.length > MAX_UTTERANCES) {
    throw new TranscriptError(`Transcript has more than ${MAX_UTTERANCES} utterances`);
  }
  const utterances = candidates.map((candidate, index) => {
    const parsed = utteranceSchema.safeParse(candidate);
    if (!parsed.success) throw new TranscriptError(`Utterance ${index} is invalid`);
    return parsed.data;
  });
  const totalChars = utterances.reduce((sum, u) => sum + u.speaker.length + u.text.length, 0);
  if (totalChars > maxChars) {
    throw new TranscriptError(`Transcript exceeds ${maxChars} characters`);
  }
  return utterances;
}

module.exports = { TranscriptError, parseTranscriptText, normaliseTranscript };
