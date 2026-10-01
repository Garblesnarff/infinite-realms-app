import { describe, expect, it, mock } from 'bun:test';

// #2382. Elysia's ValidationError.message is a JSON document that includes `found`, the whole
// submitted body, and `stack` starts with that message. A validation failure must log the error
// kind and the failing field paths, and never a value the player sent.

type Line = Record<string, unknown>;
let lines: Line[] = [];
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (m: unknown, text?: unknown) => {
    if (m && typeof m === 'object') lines.push({ ...(m as Line), ...(text ? { text } : {}) });
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

const { t } = await import('elysia');
const { createRequestPipelineApp } = await import('../http-pipeline.js');
const { loggingPlugin } = await import('../middleware/logging.js');

const MARKER = 'PLAYER-TEXT-MARKER-7f3a9c';

const body = { slotLevel: 0, secret: MARKER };
const schema = {
  body: t.Object({ slotLevel: t.Number({ minimum: 1 }), secret: t.String() }),
};

const post = (app: { handle: (request: Request) => Promise<Response> }) =>
  app.handle(
    new Request('http://localhost/cast', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-2382' },
      body: JSON.stringify(body),
    }),
  );

describe('a validation failure never logs the submitted body (#2382)', () => {
  it('request.error carries the path and rule, and no value the player sent', async () => {
    lines = [];
    const app = createRequestPipelineApp().post('/cast', () => ({ ok: true }), schema);

    const response = await post(app);
    expect(response.status).toBe(422);

    const line = lines.find((entry) => entry.msg === 'request.error');
    expect(line).toMatchObject({
      requestId: 'req-2382',
      error: 'Validation failed',
      errorName: 'ValidationError',
      issues: [expect.objectContaining({ path: '/slotLevel' })],
    });
    expect(line?.stack).toBeUndefined();
    expect(JSON.stringify(lines)).not.toContain(MARKER);
  });

  it('a record key the client chose becomes * in the log, and the client answer is unchanged', async () => {
    lines = [];
    const SECRET_KEY = 'CLIENT-KEY-MARKER-9d41e2';
    // The shape of /v1/llm/generate's `metrics`, plus an array and a nested object.
    const app = createRequestPipelineApp().post('/m', () => ({ ok: true }), {
      body: t.Object({
        metrics: t.Record(t.String(), t.Number()),
        items: t.Array(t.Object({ name: t.String() })),
      }),
    });
    const response = await app.handle(
      new Request('http://localhost/m', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-record' },
        body: JSON.stringify({ metrics: { [SECRET_KEY]: 'not a number' }, items: [{ name: 1 }] }),
      }),
    );
    expect(response.status).toBe(422);

    const line = lines.find((entry) => entry.msg === 'request.error');
    const paths = (line?.issues as Array<{ path: string }>).map((issue) => issue.path);
    expect(paths).toContain('/metrics/*');
    expect(paths).toContain('/items/0/name');
    expect(JSON.stringify(lines)).not.toContain(SECRET_KEY);
    // The 422 body is for the caller's own debugging and keeps the real path.
    const payload = (await response.json()) as { issues: Array<{ path: string }> };
    expect(payload.issues.map((issue) => issue.path)).toContain(`/metrics/${SECRET_KEY}`);
  });

  it('the answer to the client still names the field and leaves the value out', async () => {
    lines = [];
    const app = createRequestPipelineApp().post('/cast', () => ({ ok: true }), schema);

    const payload = (await (await post(app)).json()) as {
      error: string;
      issues: Array<{ path: string }>;
    };
    expect(payload.error).toBe('Validation failed');
    expect(payload.issues.map((issue) => issue.path)).toContain('/slotLevel');
    expect(JSON.stringify(payload)).not.toContain(MARKER);
  });

  it('keeps the message and stack for an error that is not a validation failure', async () => {
    lines = [];
    const app = createRequestPipelineApp().post('/boom', () => {
      throw new Error('database unreachable');
    });

    await app.handle(new Request('http://localhost/boom', { method: 'POST' }));

    const line = lines.find((entry) => entry.msg === 'request.error');
    expect(line).toMatchObject({ error: 'database unreachable', errorName: 'Error' });
    expect(typeof line?.stack).toBe('string');
  });

  it('the loggingPlugin error line leaves the body out too', async () => {
    lines = [];
    // The plugin's hooks are local to its own instance, so the route goes on the plugin itself.
    // Nothing mounts `loggingPlugin` today; this keeps its line from leaking if something does.
    const app = loggingPlugin.post('/cast', () => ({ ok: true }), schema);

    await post(app);

    const line = lines.find((entry) => entry.type === 'error');
    expect(line).toMatchObject({
      errorMessage: 'Validation failed',
      issues: [expect.objectContaining({ path: '/slotLevel' })],
    });
    expect(line?.errorStack).toBeUndefined();
    expect(JSON.stringify(lines)).not.toContain(MARKER);
  });
});
