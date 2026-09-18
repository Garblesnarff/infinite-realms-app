import { afterEach, describe, expect, it, mock } from 'bun:test';

type LogEntry = Record<string, unknown>;

const warningLogs: LogEntry[] = [];
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (entry: unknown) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      warningLogs.push(entry as LogEntry);
    }
  },
  error: () => {},
  child: () => testLogger,
};

mock.module('../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../lib/alerting.js', () => ({ alert: () => {} }));

const { LLMProviderService } = await import('../llm-provider-service.js');
const { resetCircuitBreakersForTests } = await import('../../utils/circuit-breaker.js');

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  warningLogs.length = 0;
  resetCircuitBreakersForTests();
});

describe('LLM failover logging', () => {
  it('logs the model transition after a timed-out generation attempt', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'primary/model';
    process.env.OPENROUTER_FALLBACK_MODELS = 'secondary/model';

    const requestedModels: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);
      if (body.model === 'primary/model') {
        throw new DOMException('timed out', 'TimeoutError');
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'secondary response' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({ prompt: 'hello' });

    expect(requestedModels).toEqual(['primary/model', 'secondary/model']);
    expect(result).toMatchObject({ model: 'secondary/model', text: 'secondary response' });
    expect(warningLogs).toContainEqual({
      msg: 'LLM_FAILOVER',
      from: 'primary/model',
      to: 'secondary/model',
      reason: 'upstream_status_503',
    });
  });

  it('logs the model transition when extraction advances to its fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_EXTRACTION_MODEL = 'primary/extraction';
    process.env.OPENROUTER_EXTRACTION_FALLBACK_MODEL = 'secondary/extraction';

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      if (body.model === 'primary/extraction') return new Response('not found', { status: 404 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"memories":[]}' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await LLMProviderService.extract({ prompt: 'extract memories' });

    expect(warningLogs).toContainEqual({
      msg: 'LLM_FAILOVER',
      from: 'primary/extraction',
      to: 'secondary/extraction',
      reason: 'upstream_status_404',
    });
  });
});
