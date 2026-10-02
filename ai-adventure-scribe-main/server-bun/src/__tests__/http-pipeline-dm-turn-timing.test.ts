import { describe, expect, it, mock } from 'bun:test';

type LogLine = Record<string, unknown>;
const lines: LogLine[] = [];
const testLogger = {
  debug: () => {},
  info: (line: unknown) => {
    if (line && typeof line === 'object') lines.push(line as LogLine);
  },
  warn: () => {},
  error: () => {},
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

describe('DM turn timing request logging (#2480)', () => {
  it('logs one timing line for a game DM request with the actual response model', async () => {
    lines.length = 0;
    const app = createRequestPipelineApp().post('/v1/llm/generate', () => ({
      text: 'The torch gutters.',
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
    }));

    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'session-2480',
          provider: 'openrouter',
          model: 'requested-model',
          dmReply: { messageId: '0b7e4f5a-2c9d-4e1b-8a3f-6d5c4b3a2e1f' },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const timingLines = lines.filter((line) => line.msg === 'DM_TURN_TIMING');
    expect(timingLines).toHaveLength(1);
    expect(timingLines[0]).toMatchObject({
      sessionId: 'session-2480',
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      outcome: 'success',
    });
    expect(timingLines[0].durationMs).toEqual(expect.any(Number));
  });

  it('does not classify a non-game LLM request as a DM turn', async () => {
    lines.length = 0;
    const app = createRequestPipelineApp().post('/v1/llm/generate', () => ({
      text: 'not a game turn',
      provider: 'openrouter',
      model: 'model',
    }));

    await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-not-a-game' }),
      }),
    );

    expect(lines.filter((line) => line.msg === 'DM_TURN_TIMING')).toHaveLength(0);
  });

  it.each([
    {
      label: 'quota exceeded',
      status: 402,
      response: { error: 'quota' },
      outcome: 'quota_exceeded',
    },
    { label: 'degraded', status: 200, response: { degraded: true }, outcome: 'degraded' },
  ])('logs one timing line for a $label response', async ({ status, response, outcome }) => {
    lines.length = 0;
    const app = createRequestPipelineApp().post('/v1/llm/generate', ({ set }) => {
      set.status = status;
      return response;
    });

    const result = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'session-outcome',
          dmReply: { messageId: 'message-outcome' },
        }),
      }),
    );

    expect(result.status).toBe(status);
    const timingLines = lines.filter((line) => line.msg === 'DM_TURN_TIMING');
    expect(timingLines).toHaveLength(1);
    expect(timingLines[0]).toMatchObject({
      sessionId: 'session-outcome',
      outcome,
    });
  });

  it('logs one error timing line when the game route throws', async () => {
    lines.length = 0;
    const app = createRequestPipelineApp().post('/v1/llm/generate', () => {
      throw new Error('provider failed');
    });

    const result = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'session-error',
          dmReply: { messageId: 'message-error' },
        }),
      }),
    );

    expect(result.status).toBe(500);
    const timingLines = lines.filter((line) => line.msg === 'DM_TURN_TIMING');
    expect(timingLines).toHaveLength(1);
    expect(timingLines[0]).toMatchObject({
      sessionId: 'session-error',
      outcome: 'error',
    });
  });
});
