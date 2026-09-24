import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// #2148: the server must say when a client leaves mid-request. #2144 could not tell a client
// abort from a slow success because nothing on the server logged the former. This runs a real
// Bun server so the test exercises Bun's own request.signal behaviour, not a mock of it.

type Line = Record<string, unknown>;
let warnings: Line[] = [];
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (m: unknown) => {
    if (m && typeof m === 'object') warnings.push(m as Line);
  },
  error: () => {},
  child: () => testLogger,
};
mock.module('../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));

const { createRequestPipelineApp } = await import('../http-pipeline.js');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const app = createRequestPipelineApp()
  .get('/slow', async () => {
    await sleep(400);
    return { ok: true };
  })
  .get('/fast', () => ({ ok: true }))
  .listen(0);

const base = `http://localhost:${app.server!.port}`;
const disconnects = () => warnings.filter((line) => line.msg === 'request.client_disconnected');

describe('client disconnect logging (#2148)', () => {
  beforeEach(() => {
    warnings = [];
  });

  afterAll(async () => {
    await app.stop(true);
  });

  it('logs when the client aborts before the response is sent', async () => {
    const controller = new AbortController();
    const pending = fetch(`${base}/slow`, {
      signal: controller.signal,
      headers: { 'x-request-id': 'abort-me' },
    }).catch(() => null);
    await sleep(100);
    controller.abort();
    await pending;
    await sleep(100);

    expect(disconnects()).toEqual([
      expect.objectContaining({
        requestId: 'abort-me',
        method: 'GET',
        url: '/slow',
        elapsedMs: expect.any(Number),
      }),
    ]);
  });

  it('does not log a request that completed normally', async () => {
    const fast = await fetch(`${base}/fast`);
    await fast.json();
    const slow = await fetch(`${base}/slow`);
    await slow.json();
    await sleep(100);

    expect(disconnects()).toEqual([]);
  });
});
