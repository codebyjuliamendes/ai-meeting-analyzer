'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const request = require('supertest');

const { buildApp, validAnalysis } = require('./helpers');
const { ProviderError } = require('../src/providers/errors');
const { loadConfig } = require('../src/config');

/** Reads an SSE response to completion and returns the parsed `data:` payloads. */
function readStream(app, path = '/api/stream-meeting') {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      http
        .get({ port, path }, (res) => {
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (buffer += chunk));
          res.on('end', () => {
            server.close();
            const events = buffer
              .split('\n\n')
              .filter((block) => block.startsWith('data: '))
              .map((block) => JSON.parse(block.slice(6)));
            resolve({ res, events });
          });
        })
        .on('error', reject);
    });
  });
}

describe('health and config', () => {
  test('liveness, readiness and draining', async () => {
    const { app, drain } = buildApp();
    await request(app).get('/healthz').expect(200, { status: 'ok' });
    await request(app).get('/readyz').expect(200, { status: 'ready' });
    drain();
    await request(app).get('/readyz').expect(503);
  });

  test('reports demo mode when no API key is configured', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/config').expect(200);
    assert.equal(res.body.provider, 'demo');
    assert.equal(res.body.demo, true);
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('config validation fails fast on bad values', () => {
    assert.throws(() => loadConfig({ PORT: 'abc' }), /Invalid configuration/);
    assert.throws(() => loadConfig({ AI_PROVIDER: 'anthropic' }), /requires ANTHROPIC_API_KEY/);
    assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'k' }).ai.provider, 'anthropic');
    assert.equal(loadConfig({}).ai.provider, 'demo');
    assert.equal(loadConfig({ AI_PROVIDER: 'demo', ANTHROPIC_API_KEY: 'k' }).ai.provider, 'demo');
  });
});

describe('static UI and security headers', () => {
  test('serves the UI with a strict CSP and no x-powered-by', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/').expect(200);
    assert.match(res.text, /NexusMeet/);
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
    assert.doesNotMatch(res.headers['content-security-policy'], /unsafe-eval/);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-request-id']);
  });

  test('serves vendored assets locally (no CDN)', async () => {
    const { app } = buildApp();
    await request(app)
      .get('/vendor/chart.umd.min.js')
      .expect(200)
      .expect('Content-Type', /javascript/);
    await request(app).get('/vendor/swagger-ui/swagger-ui-bundle.js').expect(200);
    await request(app).get('/api-docs').expect(200).expect('Content-Type', /html/);
    const html = (await request(app).get('/').expect(200)).text;
    assert.doesNotMatch(html, /https?:\/\/(cdn|unpkg)/);
  });

  test('api docs can be disabled', async () => {
    const { app } = buildApp({ ENABLE_API_DOCS: 'false' });
    await request(app).get('/api-docs').expect(404);
  });

  test('unknown API routes return JSON 404', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/nope').expect(404);
    assert.equal(res.body.error.code, 'not_found');
  });
});

describe('POST /api/analyze', () => {
  test('analyzes a text transcript in demo mode', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/analyze')
      .send({ title: 'Sync', text: 'Ana: I will send the report by Friday.\nBruno: Great, thanks!' })
      .expect(200);
    assert.equal(res.body.provider, 'demo');
    assert.equal(res.body.utterances.length, 2);
    assert.deepEqual(res.body.analysis.actionItems[0], {
      assignee: 'Ana',
      task: 'Send the report',
      deadline: 'Friday',
      sourceIndex: 0,
    });
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('uses the injected provider and returns validated output', async () => {
    const provider = { name: 'anthropic', model: 'claude-opus-5-5', analyze: async () => validAnalysis() };
    const { app } = buildApp({}, { provider });
    const res = await request(app)
      .post('/api/analyze')
      .send({
        utterances: [
          { speaker: 'Ana', text: 'I will send it' },
          { speaker: 'Bruno', text: 'Thanks' },
        ],
      })
      .expect(200);
    assert.equal(res.body.provider, 'anthropic');
    assert.equal(res.body.analysis.summary, 'Ana will send the report.');
  });

  test('rejects invalid bodies with 400 and details', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/analyze').send({ foo: 'bar' }).expect(400);
    assert.equal(res.body.error.code, 'validation_error');
    assert.ok(Array.isArray(res.body.error.details));
    await request(app).post('/api/analyze').send({ text: '   ' }).expect(400);
    const bad = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    assert.equal(bad.body.error.code, 'invalid_json');
  });

  test('requires JSON content type', async () => {
    const { app } = buildApp();
    await request(app).post('/api/analyze').set('Content-Type', 'text/plain').send('Ana: hi').expect(415);
  });

  test('enforces transcript and body size limits', async () => {
    const { app } = buildApp({ MAX_TRANSCRIPT_CHARS: '1000' });
    const res = await request(app)
      .post('/api/analyze')
      .send({ text: `Ana: ${'x'.repeat(1200)}` })
      .expect(400);
    assert.equal(res.body.error.code, 'invalid_transcript');
    const big = await request(app)
      .post('/api/analyze')
      .send({ text: 'x'.repeat(200 * 1024) })
      .expect(413);
    assert.equal(big.body.error.code, 'payload_too_large');
  });

  test('maps provider failures to stable error codes without leaking internals', async () => {
    const cases = [
      ['timeout', 504],
      ['rate_limited', 503],
      ['refused', 422],
      ['unavailable', 502],
      ['misconfigured', 502],
    ];
    for (const [code, status] of cases) {
      const provider = {
        name: 'anthropic',
        model: 'm',
        analyze: async () => {
          throw new ProviderError(/** @type {any} */ (code), 'secret internal detail sk-ant-xyz');
        },
      };
      const { app } = buildApp({}, { provider });
      const res = await request(app).post('/api/analyze').send({ text: 'Ana: hi' }).expect(status);
      assert.equal(res.body.error.code, `ai_${code}`);
      assert.doesNotMatch(JSON.stringify(res.body), /secret|sk-ant/);
    }
  });

  test('unexpected errors return a generic 500', async () => {
    const provider = {
      name: 'anthropic',
      model: 'm',
      analyze: async () => {
        throw new Error('database password is hunter2');
      },
    };
    const { app } = buildApp({}, { provider });
    const res = await request(app).post('/api/analyze').send({ text: 'Ana: hi' }).expect(500);
    assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message', 'requestId']);
    assert.doesNotMatch(res.text, /hunter2/);
  });

  test('rate limits analysis requests per client', async () => {
    const { app } = buildApp({ ANALYZE_RATE_LIMIT_PER_MIN: '2' });
    await request(app).post('/api/analyze').send({ text: 'Ana: hi' }).expect(200);
    await request(app).post('/api/analyze').send({ text: 'Ana: hi' }).expect(200);
    const res = await request(app).post('/api/analyze').send({ text: 'Ana: hi' }).expect(429);
    assert.equal(res.body.error.code, 'rate_limited');
  });
});

describe('GET /api/stream-meeting', () => {
  test('streams the whole demo meeting as SSE and ends the response', async () => {
    const { app } = buildApp();
    const { res, events } = await readStream(app);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(events[0].event, 'MEETING_START');
    assert.equal(events[0].mode, 'demo');
    const utterances = events.filter((e) => e.event === 'UTTERANCE');
    assert.equal(utterances.length, events[0].total);
    assert.equal(events.at(-1).event, 'END_OF_MEETING');
    assert.ok(utterances.some((e) => e.actionItem && e.actionItem.assignee === 'Bob'));
    for (const u of utterances) assert.ok(u.sentiment >= 0 && u.sentiment <= 100);
    // No fabricated random "radar" values.
    assert.equal(events.filter((e) => e.event === 'SENTIMENT_RADAR').length, 0);
  });

  test('rejects streams beyond the concurrency limit and while draining', async () => {
    const { app, drain } = buildApp({ MAX_CONCURRENT_STREAMS: '1', STREAM_STEP_MS: '1000' });
    const server = app.listen(0);
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    const first = await new Promise((resolve) => http.get({ port, path: '/api/stream-meeting' }, resolve));
    const second = await request(server).get('/api/stream-meeting').expect(503);
    assert.equal(second.body.error.code, 'too_many_streams');

    // Draining ends open streams with a shutdown event.
    let body = '';
    first.setEncoding('utf8');
    first.on('data', (c) => (body += c));
    const ended = new Promise((resolve) => first.on('end', resolve));
    drain();
    await ended;
    assert.match(body, /SERVER_SHUTDOWN/);
    await request(server).get('/api/stream-meeting').expect(503);
    server.close();
  });
});
