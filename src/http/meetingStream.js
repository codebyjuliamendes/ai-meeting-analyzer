'use strict';

const { DEMO_MEETING } = require('../domain/demoMeeting');
const { analyzeUtterance } = require('../domain/demoAnalyzer');

const HEARTBEAT_MS = 15000;

/**
 * Server-Sent Events replay of a scripted demo meeting. Each utterance is analyzed with the
 * deterministic demo analyzer. A random "processing" delay simulates out-of-order delivery
 * from a transcription service; the client re-orders by `timestamp`.
 *
 * @param {{
 *   stepMs: number,
 *   jitterMs: number,
 *   maxConcurrent: number,
 *   random?: () => number,
 *   now?: () => number,
 *   logger: import('pino').Logger,
 * }} options
 */
function createMeetingStreamHandler({ stepMs, jitterMs, maxConcurrent, random = Math.random, now = Date.now, logger }) {
  /** @type {Set<() => void>} */
  const active = new Set();

  /** @type {import('express').RequestHandler} */
  const handler = (req, res) => {
    if (active.size >= maxConcurrent) {
      res
        .status(503)
        .set('Retry-After', '10')
        .json({
          error: {
            code: 'too_many_streams',
            message: 'Too many live streams. Retry shortly.',
            requestId: res.locals.requestId,
          },
        });
      return;
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    /** @type {NodeJS.Timeout[]} */
    const timers = [];
    let finished = false;
    let delivered = 0;
    const heartbeat = setInterval(() => {
      if (!finished) res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    /** @param {unknown} payload */
    const send = (payload) => {
      if (!finished) res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const cleanup = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      clearInterval(heartbeat);
      active.delete(stop);
    };
    const stop = () => {
      if (finished) return;
      send({ event: 'SERVER_SHUTDOWN' });
      cleanup();
      res.end();
    };
    active.add(stop);

    // `close` on the response fires when the client disconnects or the response ends.
    res.on('close', cleanup);

    send({ event: 'MEETING_START', mode: 'demo', total: DEMO_MEETING.length });

    const baseTime = now();
    DEMO_MEETING.forEach((utterance, index) => {
      const delay = index * stepMs + Math.floor(random() * jitterMs);
      timers.push(
        setTimeout(() => {
          try {
            const { sentiment, actionItem } = analyzeUtterance(utterance, index);
            send({
              event: 'UTTERANCE',
              index,
              transcript: { speaker: utterance.speaker, text: utterance.text },
              actionItem,
              sentiment,
              timestamp: baseTime + index * stepMs,
            });
          } catch (err) {
            logger.error({ err: { message: /** @type {Error} */ (err).message }, index }, 'demo analysis failed');
            send({ event: 'ERROR', index, error: 'Failed to analyze chunk' });
          }
          delivered += 1;
          if (delivered === DEMO_MEETING.length) {
            send({ event: 'END_OF_MEETING' });
            cleanup();
            res.end();
          }
        }, delay),
      );
    });
  };

  return {
    handler,
    activeCount: () => active.size,
    /** Ends every open stream (used on graceful shutdown). */
    closeAll: () => [...active].forEach((stop) => stop()),
  };
}

module.exports = { createMeetingStreamHandler };
