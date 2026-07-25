import { Writable } from 'node:stream';

import { describe, expect, it } from 'bun:test';
import pino from 'pino';

/**
 * Regression guard for the production "logging black hole": `logger.error({ error: e })`
 * rendered `"error":{}` because Error's message/stack are non-enumerable. The real
 * exception behind 31 consecutive combat-start 500s was therefore unrecoverable.
 *
 * The logger module builds a real pino instance bound to stdout, so this test rebuilds
 * an instance with the exact same options against a capture stream. It imports the
 * production serializer options rather than re-declaring them.
 */
const captured: string[] = [];
const sink = new Writable({
  write(chunk, _encoding, callback) {
    captured.push(String(chunk));
    callback();
  },
});

const { errorLogSerializers } = await import('../logger.js');
const testLogger = pino({ level: 'debug', serializers: errorLogSerializers }, sink);

const lastLine = (): Record<string, unknown> =>
  JSON.parse(captured[captured.length - 1]) as Record<string, unknown>;

describe('logger Error serialization', () => {
  for (const key of ['err', 'error'] as const) {
    it(`serializes a thrown Error with message and stack under the "${key}" key`, () => {
      let thrown: unknown;
      try {
        throw new TypeError('participants insert exploded');
      } catch (error) {
        thrown = error;
      }

      testLogger.error({ msg: 'Start combat error', [key]: thrown });

      const line = lastLine();
      const serialized = line[key] as Record<string, unknown>;
      expect(line.msg).toBe('Start combat error');
      expect(serialized).toBeDefined();
      expect(serialized.type).toBe('TypeError');
      expect(serialized.message).toBe('participants insert exploded');
      expect(typeof serialized.stack).toBe('string');
      expect(String(serialized.stack)).toContain('logger-error-serialization.test');
      // The bug this guards against: an empty object where the exception should be.
      expect(JSON.stringify(serialized)).not.toBe('{}');
    });
  }

  it('keeps the cause chain of a wrapped Error', () => {
    const cause = new Error('drizzle: selected fields are not the same');
    testLogger.error({ msg: 'Start combat error', error: new Error('stage failed', { cause }) });

    const serialized = lastLine().error as Record<string, unknown>;
    expect(serialized.message).toBe('stage failed');
    expect(JSON.stringify(serialized.cause)).toContain('selected fields are not the same');
  });

  it('leaves non-Error values untouched so existing structured fields keep their shape', () => {
    testLogger.error({ msg: 'plain', error: 'Session not found' });
    expect(lastLine().error).toBe('Session not found');

    testLogger.error({ msg: 'structured', error: { stage: 'ownership', status: 404 } });
    expect(lastLine().error).toEqual({ stage: 'ownership', status: 404 });
  });

  it('serializes error-shaped objects that failed an instanceof check across realms', () => {
    const crossRealm = { name: 'AppError', message: 'boom', stack: 'AppError: boom\n    at x' };
    testLogger.error({ msg: 'cross realm', error: crossRealm });

    const serialized = lastLine().error as Record<string, unknown>;
    expect(serialized.message).toBe('boom');
    expect(serialized.stack).toContain('AppError: boom');
  });
});
