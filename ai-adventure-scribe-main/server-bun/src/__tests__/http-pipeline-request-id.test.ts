import { describe, expect, it, mock } from 'bun:test';

// #2050 D follow-up. The previous implementation passed a presence check --
// the header was there -- while every request in the process shared ONE id,
// because the id lived on Elysia's application-wide `store`. These tests
// verify the PROPERTY, not the presence: ids differ across concurrent
// requests, each request's start/end/header agree, and durations are measured
// from that request's own start.

type Line = Record<string, unknown>;
let lines: Line[] = [];
const testLogger = {
  debug: () => {},
  info: (m: unknown) => {
    if (m && typeof m === 'object') lines.push(m as Line);
  },
  warn: () => {},
  error: (m: unknown) => {
    if (m && typeof m === 'object') lines.push(m as Line);
  },
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const app = createRequestPipelineApp()
  .get('/slow', async () => {
    await sleep(150);
    return { ok: 'slow' };
  })
  .get('/fast', async () => {
    await sleep(5);
    return { ok: 'fast' };
  });

const req = (path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

const linesFor = (path: string, msg: string) =>
  lines.filter((l) => l.url === path && l.msg === msg);

describe('request id is per-request, not per-process', () => {
  it('gives two CONCURRENT requests different ids, each consistent start/end/header', async () => {
    lines = [];
    const slowP = req('/slow');
    await sleep(100);
    const fastP = req('/fast');
    const [slow, fast] = await Promise.all([slowP, fastP]);

    const slowHeader = slow.headers.get('x-request-id');
    const fastHeader = fast.headers.get('x-request-id');
    expect(slowHeader).toBeTruthy();
    expect(fastHeader).toBeTruthy();

    // THE property the old code violated.
    expect(slowHeader).not.toBe(fastHeader);

    // Fails if Elysia hands different Request instances to different hooks:
    // the WeakMap would miss and mint a second id for the same request.
    const [slowStart] = linesFor('/slow', 'request.start');
    const [slowEnd] = linesFor('/slow', 'request.end');
    const [fastStart] = linesFor('/fast', 'request.start');
    const [fastEnd] = linesFor('/fast', 'request.end');
    expect(slowStart.requestId).toBe(slowHeader);
    expect(slowEnd.requestId).toBe(slowHeader);
    expect(fastStart.requestId).toBe(fastHeader);
    expect(fastEnd.requestId).toBe(fastHeader);
  });

  it('measures each concurrent request from its OWN start', async () => {
    lines = [];
    // With a shared start time, /fast's onRequest at ~t=100 overwrites /slow's
    // start, and /slow (ending ~t=150) would report ~50ms instead of ~150ms.
    const slowP = req('/slow');
    await sleep(100);
    const fastP = req('/fast');
    await Promise.all([slowP, fastP]);

    const slowMs = Number(linesFor('/slow', 'request.end')[0].durationMs);
    const fastMs = Number(linesFor('/fast', 'request.end')[0].durationMs);

    expect(slowMs).toBeGreaterThanOrEqual(130);
    expect(fastMs).toBeLessThan(80);
    expect(slowMs).toBeGreaterThan(fastMs);
  });

  it('never repeats an id across many sequential requests', async () => {
    lines = [];
    const ids = new Set<string | null>();
    for (let i = 0; i < 20; i += 1) {
      const res = await req('/fast');
      ids.add(res.headers.get('x-request-id'));
    }
    expect(ids.has(null)).toBe(false);
    expect(ids.size).toBe(20);
  });

  it('honours an inbound x-request-id so a caller can propagate its own', async () => {
    lines = [];
    const res = await req('/fast', { 'x-request-id': 'caller-supplied-id' });
    expect(res.headers.get('x-request-id')).toBe('caller-supplied-id');
    expect(linesFor('/fast', 'request.end')[0].requestId).toBe('caller-supplied-id');
  });
});
