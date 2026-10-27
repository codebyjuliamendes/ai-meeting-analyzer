'use strict';

const { z } = require('zod');

const MAX_UTTERANCES = 1000;
const MAX_SPEAKER_CHARS = 80;
const MAX_UTTERANCE_CHARS = 4000;

/** Control characters except tab/newline/carriage return. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** @param {number} max */
const cleanString = (max) =>
  z
    .string()
    .transform((value) => value.replace(CONTROL_CHARS, '').trim())
    .pipe(z.string().min(1).max(max));

const utteranceSchema = z.object({
  speaker: cleanString(MAX_SPEAKER_CHARS),
  text: cleanString(MAX_UTTERANCE_CHARS),
});

const analyzeRequestSchema = z
  .object({
    title: cleanString(200).optional(),
    utterances: z.array(utteranceSchema).min(1).max(MAX_UTTERANCES).optional(),
    text: z.string().max(500000).optional(),
  })
  .strict()
  .refine((body) => (body.utterances ? 1 : 0) + (body.text !== undefined ? 1 : 0) === 1, {
    message: 'Provide exactly one of "utterances" or "text"',
  });

const SENTIMENT_LABELS = /** @type {const} */ (['negative', 'neutral', 'positive']);

const score = z.number().int().min(0).max(100);

const analysisSchema = z
  .object({
    summary: z.string().min(1).max(4000),
    overallSentiment: z.object({ score, label: z.enum(SENTIMENT_LABELS) }).strict(),
    actionItems: z
      .array(
        z
          .object({
            assignee: z.string().min(1).max(MAX_SPEAKER_CHARS),
            task: z.string().min(1).max(500),
            deadline: z.string().max(100).nullable(),
            sourceIndex: z.number().int().min(0),
          })
          .strict(),
      )
      .max(100),
    decisions: z.array(z.string().min(1).max(500)).max(50),
    risks: z.array(z.string().min(1).max(500)).max(50),
    utteranceSentiment: z.array(z.object({ index: z.number().int().min(0), score }).strict()).max(MAX_UTTERANCES),
  })
  .strict();

/**
 * JSON Schema sent to the model as the structured-output contract. Kept to the keyword
 * subset structured outputs supports (types, enums, required, additionalProperties);
 * numeric ranges and lengths are enforced afterwards by `analysisSchema`.
 */
const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'overallSentiment', 'actionItems', 'decisions', 'risks', 'utteranceSentiment'],
  properties: {
    summary: { type: 'string', description: 'Neutral 2-5 sentence summary of the meeting.' },
    overallSentiment: {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'label'],
      properties: {
        score: { type: 'integer', description: '0 = very negative, 50 = neutral, 100 = very positive' },
        label: { type: 'string', enum: [...SENTIMENT_LABELS] },
      },
    },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assignee', 'task', 'deadline', 'sourceIndex'],
        properties: {
          assignee: { type: 'string', description: 'Speaker name exactly as in the transcript, or "Unassigned".' },
          task: { type: 'string' },
          deadline: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Deadline as stated in the meeting, or null.',
          },
          sourceIndex: { type: 'integer', description: 'Index of the utterance where the commitment was made.' },
        },
      },
    },
    decisions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    utteranceSentiment: {
      type: 'array',
      description: 'One entry per utterance, in order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'score'],
        properties: {
          index: { type: 'integer' },
          score: { type: 'integer', description: '0-100' },
        },
      },
    },
  },
};

/**
 * Validates a provider result against the transcript it was produced from.
 * Rejects references to utterances that do not exist.
 * @param {unknown} raw
 * @param {number} utteranceCount
 * @returns {{ success: true, data: z.infer<typeof analysisSchema> } | { success: false, error: string }}
 */
function validateAnalysis(raw, utteranceCount) {
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const data = parsed.data;
  /** @param {number} i */
  const outOfRange = (i) => i >= utteranceCount;
  if (data.actionItems.some((item) => outOfRange(item.sourceIndex))) {
    return { success: false, error: 'actionItems.sourceIndex out of range' };
  }
  if (data.utteranceSentiment.some((entry) => outOfRange(entry.index))) {
    return { success: false, error: 'utteranceSentiment.index out of range' };
  }
  // Normalise: one entry per utterance, ordered and de-duplicated.
  const seen = new Map();
  for (const entry of data.utteranceSentiment) seen.set(entry.index, entry.score);
  data.utteranceSentiment = [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, value]) => ({ index, score: value }));
  return { success: true, data };
}

/** @typedef {z.infer<typeof utteranceSchema>} Utterance */
/** @typedef {z.infer<typeof analysisSchema>} Analysis */

module.exports = {
  MAX_UTTERANCES,
  MAX_SPEAKER_CHARS,
  MAX_UTTERANCE_CHARS,
  utteranceSchema,
  analyzeRequestSchema,
  analysisSchema,
  analysisJsonSchema,
  validateAnalysis,
};
