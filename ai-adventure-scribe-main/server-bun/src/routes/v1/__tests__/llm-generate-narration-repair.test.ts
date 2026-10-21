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

import { describeAttackRoll } from '../../../../../shared/describe-attack-roll.js';

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

const dmEnvelope = (text: string, rollRequests?: unknown[]): string =>
  JSON.stringify({
    text,
    options: ['Sneak past the guards', 'Climb back down'],
    narration_segments: [{ type: 'dm', text }],
    combat_transition: 'none',
    dice_rolls: [],
    ...(rollRequests ? { roll_requests: rollRequests } : {}),
  });

const postGenerate = async (
  narration: string,
  rollRequests?: unknown[],
): Promise<Record<string, unknown>> => {
  generatedText = dmEnvelope(narration, rollRequests);
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

describe('#467 NT-013 /generate narration repair (strategist FIX)', () => {
  // The roll_result the client logs for an engine-resolved action-card attack
  // (combat-resolution-step.ts): the engine's authoritative verdict. The description is
  // derived from the real producer — describeAttackRoll for the NT-013 popup spec —
  // not handwritten, so the test proves the repair against the words production sends.
  const NT013_DESCRIPTION = describeAttackRoll({
    kind: 'spell-attack',
    weaponName: 'Chill Touch',
    targetLabel: 'Mechanical Server',
    actorLabel: 'The Apprentice',
    attackBonus: 5,
    targetAc: 15,
    advantage: false,
    disadvantage: false,
  });
  const NT013_PAYLOAD = {
    success: true,
    total: 22,
    ac: 15,
    requestType: 'attack',
    description: NT013_DESCRIPTION,
    timestamp: nowIso(),
  };

  it('repairs the DM dismissing the engine hit as "ignores your magical assault"', async () => {
    queueRollOutcome([rollEntry(nowIso(), NT013_PAYLOAD)]);
    const envelope = await postGenerate(
      'The mechanical server ignores your magical assault, its gears grinding on. ' +
        'You step back, wary of its reach.',
    );
    // The contradicting sentence is replaced by the engine truth; the rest stays.
    expect(envelope.text).toBe(
      `The ${NT013_DESCRIPTION} succeeded (22 vs AC 15). ` +
        'You step back, wary of its reach.',
    );
    expect(envelope.text).not.toContain('ignores your magical assault');
    expect(envelope.narration_segments).toEqual([]);
  });

  it('leaves a passed check narrated as a success untouched (control)', async () => {
    queueRollOutcome([
      rollEntry(nowIso(), { ...FAILED_STEALTH_PAYLOAD, success: true, total: 19 }),
    ]);
    const narration =
      'You succeed in climbing the shaft unheard, and the guards below never stir.';
    const envelope = await postGenerate(narration);
    expect(envelope.text).toBe(narration);
  });
});

describe('#266 NT-011/NT-020 /generate premature roll claims', () => {
  // The requesting turn: no roll outcome is persisted yet (the combatLog is empty), so
  // the outcome repair above has nothing to key on — this is the ordering Hark's retest
  // documented ("The DM narration posted first... The engine fail line came after").
  // The request uses the real envelope shape (dm-response-schema.ts roll_requests).
  const INVESTIGATION_REQUEST = {
    type: 'check',
    formula: '1d20+5',
    purpose: 'Investigation check to examine the crystal',
    dc: 14,
    ac: null,
    advantage: false,
    disadvantage: false,
  };

  it('repairs a success narrated in the reply that requests the roll', async () => {
    queueRollOutcome([]);
    const envelope = await postGenerate(
      "You succeed in reading the crystal's fractures like a diagnosis. " +
        'Roll an Investigation check to learn more.',
      [INVESTIGATION_REQUEST],
    );
    expect(envelope.text).toBe(
      'That outcome is not decided yet — the roll still has to be made. ' +
        'Roll an Investigation check to learn more.',
    );
    expect(envelope.text).not.toContain('You succeed');
    // The roll request itself is untouched: the tray still gets its roll.
    expect(envelope.roll_requests).toEqual([INVESTIGATION_REQUEST]);
    expect(envelope.narration_segments).toEqual([]);
  });

  // #959 forward-fix: this expectation FLIPS, as a stated CONCESSION (self-review
  // HIGH 2): semantically this failure narration IS the pending shaft climb, phrased
  // in synonyms the request never uses ("purchase", "slick stone" vs climb/shaft).
  // Lexically it cannot be told apart from a decided roll's recap, which the
  // unscoped #959 pass corrupted — so the scoped pass leaves it alone, and the
  // strategist's anchoring directive accepts that trade explicitly.
  it('leaves a failure verdict that does not name the pending action untouched', async () => {
    queueRollOutcome([]);
    const narration =
      'You fail to find any purchase on the slick stone, sliding back down. ' +
      'Roll a Stealth check to climb the shaft.';
    const envelope = await postGenerate(narration, [
      {
        type: 'check',
        formula: '1d20+5',
        purpose: 'Stealth check to climb the shaft',
        dc: 14,
        ac: null,
        advantage: false,
        disadvantage: false,
      },
    ]);
    expect(envelope.text).toBe(narration);
  });

  // #959 forward-fix: when the turn HAS a fresh roll outcome, the premature pass does
  // not run at all — the outcome repair owns the turn's verdicts. This reply recaps
  // the decided (successful) Stealth roll correctly AND prematurely claims the newly
  // requested Investigation check's outcome; the combined shape is deliberately
  // conceded rather than risking the recap.
  it('leaves a combined recap + premature claim untouched when a fresh outcome exists', async () => {
    queueRollOutcome([
      rollEntry(nowIso(), { ...FAILED_STEALTH_PAYLOAD, success: true, total: 19 }),
    ]);
    const narration =
      'You succeed in climbing the shaft unheard. ' +
      "You succeed in reading the crystal's fractures like a diagnosis. " +
      'Roll an Investigation check to learn more.';
    const envelope = await postGenerate(narration, [INVESTIGATION_REQUEST]);
    expect(envelope.text).toBe(narration);
    expect(envelope.roll_requests).toEqual([INVESTIGATION_REQUEST]);
  });

  it('leaves a neutral requesting reply untouched', async () => {
    queueRollOutcome([]);
    const narration =
      'The shaft rises into darkness above you, slick with condensation. ' +
      'Roll a Stealth check to climb it unheard.';
    const envelope = await postGenerate(narration, [
      {
        type: 'check',
        formula: '1d20+5',
        purpose: 'Stealth check to climb the shaft',
        dc: 14,
        ac: null,
        advantage: false,
        disadvantage: false,
      },
    ]);
    expect(envelope.text).toBe(narration);
  });
});
