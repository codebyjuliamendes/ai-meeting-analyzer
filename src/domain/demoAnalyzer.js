'use strict';

/**
 * Deterministic keyword-based analyzer used in demonstration mode (no LLM configured)
 * and for the scripted live-meeting replay. It is intentionally simple and is always
 * labelled as "demo" in API responses and in the UI; it is not an AI model.
 */

const POSITIVE = [
  'agreed',
  'great',
  'good',
  'thanks',
  'thank you',
  'no problem',
  'perfect',
  'excellent',
  'on track',
  'sounds good',
  'happy',
  'love',
  'nice',
  'awesome',
  'done',
];
const NEGATIVE = [
  'problem',
  'ridiculous',
  'stressed',
  'blocked',
  'blocker',
  'late',
  'delay',
  'issue',
  "can't",
  'cannot',
  'angry',
  'bad',
  'worried',
  'risk',
  'fail',
  'broken',
  'sorry',
];
const RISK_HINTS = ['problem', "can't", 'cannot', 'blocked', 'blocker', 'risk', "don't have", 'missing', 'delay'];
const DECISION_HINTS = ["let's", 'we will', "we'll", 'decided', 'agreed', 'reconvene'];

const COMMITMENT = /\b(?:I(?:'ll| will| can| am going to|'m going to))\s+(.+?)(?:[.!?]|$)/i;
const DEADLINE =
  /\b(?:by|before|on|until)\s+((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|today|end of (?:day|week|month)|eod|eow|\d{1,2}(?:\/\d{1,2})?))\b|\b(tonight|tomorrow|today|right after this call)\b/i;

/**
 * @param {string} text
 * @param {string[]} words
 */
function countHits(text, words) {
  return words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);
}

/**
 * Scores one utterance from 0 (negative) to 100 (positive).
 * @param {string} text
 */
function scoreSentiment(text) {
  const lower = text.toLowerCase();
  // "no problem" is positive; avoid double counting it as "problem".
  const normalised = lower.replace(/no problem/g, 'thanks');
  const pos = countHits(normalised, POSITIVE);
  const neg = countHits(normalised, NEGATIVE);
  const raw = 50 + pos * 15 - neg * 20 + (/!/.test(text) && neg > 0 ? -10 : 0);
  return Math.max(0, Math.min(100, raw));
}

/**
 * Extracts a commitment ("I'll do X by Y") from one utterance.
 * @param {import('./schemas').Utterance} utterance
 * @param {number} index
 */
function extractActionItem(utterance, index) {
  const match = COMMITMENT.exec(utterance.text);
  if (!match) return null;
  let task = match[1].trim();
  const deadlineMatch = DEADLINE.exec(task) || DEADLINE.exec(utterance.text);
  const deadline = deadlineMatch ? (deadlineMatch[1] || deadlineMatch[2]).trim() : null;
  if (deadlineMatch) task = task.replace(deadlineMatch[0], '').trim();
  task = task
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+(and|then)$/i, '')
    .replace(/[,;]+$/, '')
    .trim();
  if (task.length < 3) return null;
  return {
    assignee: utterance.speaker,
    task: task.charAt(0).toUpperCase() + task.slice(1),
    deadline: deadline ? deadline.charAt(0).toUpperCase() + deadline.slice(1) : null,
    sourceIndex: index,
  };
}

/**
 * Per-utterance analysis used by the live replay stream.
 * @param {import('./schemas').Utterance} utterance
 * @param {number} index
 */
function analyzeUtterance(utterance, index) {
  return { sentiment: scoreSentiment(utterance.text), actionItem: extractActionItem(utterance, index) };
}

/**
 * @param {number} value
 * @returns {'negative' | 'neutral' | 'positive'}
 */
function labelFor(value) {
  if (value < 40) return 'negative';
  if (value > 60) return 'positive';
  return 'neutral';
}

/**
 * Full-transcript heuristic analysis with the same shape as the LLM output.
 * @param {import('./schemas').Utterance[]} utterances
 * @returns {import('./schemas').Analysis}
 */
function analyzeTranscriptHeuristically(utterances) {
  const utteranceSentiment = utterances.map((u, index) => ({ index, score: scoreSentiment(u.text) }));
  const actionItems = utterances.map((u, index) => extractActionItem(u, index)).filter((item) => item !== null);
  const avg = Math.round(
    utteranceSentiment.reduce((sum, e) => sum + e.score, 0) / Math.max(1, utteranceSentiment.length),
  );
  /** @param {string[]} hints */
  const pick = (hints) =>
    utterances
      .filter((u) => hints.some((h) => u.text.toLowerCase().includes(h)))
      .slice(0, 10)
      .map((u) => `${u.speaker}: ${u.text}`.slice(0, 500));
  const speakers = [...new Set(utterances.map((u) => u.speaker))];
  const summary =
    `Demo summary (keyword heuristics, not an AI model): ${utterances.length} utterances from ` +
    `${speakers.length} participant(s) (${speakers.slice(0, 8).join(', ')}${speakers.length > 8 ? ', …' : ''}). ` +
    `${actionItems.length} commitment(s) detected.`;
  return {
    summary: summary.slice(0, 4000),
    overallSentiment: { score: avg, label: labelFor(avg) },
    actionItems: actionItems.slice(0, 100),
    decisions: pick(DECISION_HINTS),
    risks: pick(RISK_HINTS),
    utteranceSentiment,
  };
}

module.exports = { scoreSentiment, extractActionItem, analyzeUtterance, analyzeTranscriptHeuristically };
