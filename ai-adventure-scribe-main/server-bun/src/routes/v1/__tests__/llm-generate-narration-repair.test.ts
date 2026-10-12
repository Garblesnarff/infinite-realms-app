/**
 * #266 FIX round: the /generate reply path. When the DM's narration contradicts the engine's
 * latest roll outcome, only the contradicting sentences are replaced with the engine's truth;
 * a clean reply, a stale roll, a missing roll, or a database failure leaves the reply
 * untouched (fails open).
 *
 * The repair's database read (`latestRollOutcome` lazy-imports `db/client`, which throws
 * without DATABASE_URL) is backed by a chainable stub: each `.limit(1)` shifts the next
 * queued query result, matching the two queries the repair runs (session state, then the
 * latest DM message).
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

let combatLogForTest: unknown[] = [];
let dbShouldThrow = false;
/** A query chain that returns rows based on what is selected, not call order: the
 * game_sessions sessionState query gets the test combatLog, everything else gets []. */
const makeChainable = (selection: unknown): unknown => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'limit') {
        return async () => {
          if (dbShouldThrow) throw new Error('db unavailable');
          const isSessionState =
            !!selection && typeof selection === 'object' && 'state' in (selection as object);
          return isSessionState ? [{ state: { combatLog: combatLogForTest } }] : [];
        };
      }
      if (prop === 'then') return undefined;
      return (..._args: unknown[]): unknown => chainable;
    },
  };
  const chainable: unknown = new Proxy({}, handler);
  return chainable;
};
mock.module('../../../../../db/client', () => ({
  db: {
    select: (selection: unknown) => {
      if (dbShouldThrow) throw new Error('db unavailable');
      return makeChainable(selection);
    },
  },
}));
// #244 added deferUntilCommit (transaction-context); not under test, run immediately.
mock.module('../../../../../db/transaction-context', () => ({
  deferUntilCommit: () => false,
}));
// #244 wraps generation in SessionMessageService.withRollTurn; run the callback directly.
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    withRollTurn: async (
      _sessionId: unknown,
      _userId: unknown,
      _input: unknown,
      _rollRequestId: unknown,
      _messageId: unknown,
      fn: (replyId?: string) => Promise<unknown>,
    ) => fn(),
  },
}));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'repair-user', email: 'repair@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../lib/logger.js', () => {
  const noop = () => {};
  const testLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => testLogger };
  return {
    logger: testLogger,
    combatLogger: testLogger,
    spellLogger: testLogger,
    progressionLogger: testLogger,
    errorLogSerializers: {},
    default: testLogger,
  };
});
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));

let generatedText = '';
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => ({
      text: generatedText,
      provider: 'openrouter',
      model: 'test/model',
    }),
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

// A combatLog roll_result entry exactly as the client's SessionStateService.getLatestRollOutcome
// reads it: { timestamp, entry: { kind: 'roll_result', payload: { success, total, ... } } }.
const rollEntry = (
  timestamp: string,
  payload: Record<string, unknown>,
): { timestamp: string; entry: { kind: string; payload: Record<string, unknown> } } => ({
  timestamp,
  entry: { kind: 'roll_result', payload },
});
const FAILED_STEALTH_PAYLOAD = {
  success: false,
  total: 7,
  dc: 14,
  requestType: 'skill_check',
  description: 'Stealth check to climb the shaft unheard',
};
const nowIso = (): string => new Date().toISOString();

/** The session-state query returns the combatLog; the DM-message query returns no rows.
 * The first queued result is for the party-defeated terminal check at the top of the handler,
 * which runs one query before the repair's two. */
const queueRollOutcome = (combatLog: unknown[]): void => {
  dbShouldThrow = false;
  combatLogForTest = combatLog;
};

const dmEnvelope = (text: string): string =>
  JSON.stringify({
    text,
    options: ['Sneak past the guards', 'Climb back down'],
    narration_segments: [{ type: 'dm', text }],
    combat_transition: 'none',
    dice_rolls: [],
  });

const postGenerate = async (narration: string): Promise<Record<string, unknown>> => {
  generatedText = dmEnvelope(narration);
  const response = await app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'The party climbs the dark shaft. What happens?',
        player_input: 'I climb quietly',
        maxTokens: 8192,
        temperature: 0.9,
        provider: 'openrouter',
        requestType: 'user',
        sessionId: 'session-repair-1',
        // The client sends the player character's name here (combat-entry-gate.ts); the
        // repair anchors miss/success claims on it.
        combatEntry: {
          sessionId: 'session-repair-1',
          player: { name: 'Mira', initiativeModifier: 3 },
        },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { text: string };
  return JSON.parse(body.text) as Record<string, unknown>;
};

describe('#266 /generate narration repair', () => {
  it('replaces only the contradicting sentence with the engine truth', async () => {
    queueRollOutcome([rollEntry(nowIso(), FAILED_STEALTH_PAYLOAD)]);
    const envelope = await postGenerate(
      'You take 2 damage scraping against the rough wall. ' +
        'You succeed in climbing the shaft unheard. ' +
        'Something below stirs at the noise.',
    );
    expect(envelope.text).toBe(
      'You take 2 damage scraping against the rough wall. ' +
        'The Stealth check to climb the shaft unheard failed (7 vs DC 14). ' +
        'Something below stirs at the noise.',
    );
    expect(envelope.narration_segments).toEqual([]);
  });

  it('does not mistake the monster’s own miss for the player’s (strategist FIX)', async () => {
    queueRollOutcome([
      rollEntry(nowIso(), {
        success: true,
        total: 18,
        ac: 15,
        requestType: 'attack',
        description: 'longsword attack',
      }),
    ]);
    const narration =
      'Your blade bites deep into the goblin. The goblin’s arrow misses you, clattering off the wall.';
    const envelope = await postGenerate(narration);
    expect(envelope.text).toBe(narration);
  });

  it('leaves a clean reply untouched', async () => {
    queueRollOutcome([rollEntry(nowIso(), FAILED_STEALTH_PAYLOAD)]);
    const narration =
      'Your foot scrapes loose stone halfway up. The clatter echoes down the shaft — ' +
      'you fail to stay quiet, and something below stirs.';
    const envelope = await postGenerate(narration);
    expect(envelope.text).toBe(narration);
  });

  it('leaves the reply untouched when the roll is stale', async () => {
    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    queueRollOutcome([rollEntry(sixteenMinutesAgo, FAILED_STEALTH_PAYLOAD)]);
    const narration = 'You succeed in climbing the shaft unheard.';
    const envelope = await postGenerate(narration);
    expect(envelope.text).toBe(narration);
  });

  it('leaves the reply untouched when there is no roll', async () => {
    queueRollOutcome([]);
    const narration = 'You succeed in climbing the shaft unheard.';
    const envelope = await postGenerate(narration);
    expect(envelope.text).toBe(narration);
  });

  it('fails open when the database is unavailable', async () => {
    dbShouldThrow = true;
    combatLogForTest = [];
    const narration = 'You succeed in climbing the shaft unheard.';
    const envelope = await postGenerate(narration);
    expect(envelope.text).toBe(narration);
  });
});
