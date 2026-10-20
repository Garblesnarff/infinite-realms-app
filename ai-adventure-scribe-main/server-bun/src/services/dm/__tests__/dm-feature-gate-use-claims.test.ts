/**
 * #712: a feature claimed after a use verb whose name contains a phrase stop
 * word ("Lay on Hands" — "on") must still be claimed whole. The gate's phrase
 * capture fragments it to "Lay", which matches no library feature, so the
 * claim used to pass silently: never refused, never spent. The gate now also
 * matches usable feature names straight against the claim texts behind a use
 * verb, mirroring the cast path (#252).
 */
import { describe, expect, it, mock } from 'bun:test';

const SESSION_ID = '0a1b2c3d-0000-4000-8000-000000000001';
const CHARACTER_ID = '2733e680-0000-4000-8000-000000000003';
const USER_ID = 'user_owner';

const noop = () => {};
const silentLogger = {
  debug: noop,
  info: noop,
  error: noop,
  warn: noop,
  child: () => silentLogger,
};

mock.module('../../../lib/logger.js', () => ({
  logger: silentLogger,
  combatLogger: silentLogger,
  errorLogSerializers: {},
  progressionLogger: silentLogger,
  spellLogger: silentLogger,
}));

const testCharacter = {
  id: CHARACTER_ID,
  name: 'Test Paladin',
  class: 'Paladin',
  level: 1,
  classLevels: null,
};

const chainable = (resolveValue: unknown) => {
  const chain: Record<string, () => unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(resolveValue);
  return chain;
};

mock.module('../../../../../db/client', () => ({
  db: { select: () => chainable([{ character: testCharacter }]) },
  pgClient: {},
  withNpcActionTransaction: async (...args: unknown[]) => {
    const fn = args[args.length - 1];
    return typeof fn === 'function' ? (fn as (tx: unknown) => unknown)({}) : undefined;
  },
}));

mock.module('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ args }),
  eq: (...args: unknown[]) => ({ args }),
  or: (...args: unknown[]) => ({ args }),
  gte: (...args: unknown[]) => ({ args }),
  desc: (...args: unknown[]) => ({ args }),
  sql: (...args: unknown[]) => ({ args }),
}));

mock.module('../../../../../db/schema/index', () => ({
  campaigns: { id: 'campaigns.id' },
  characters: { id: 'characters.id' },
  gameSessions: { id: 'gameSessions.id' },
  characterSpells: {},
  spells: {},
  classes: {},
  characterSpellSlots: {},
  spellSlotUsageLog: {},
  dialogueHistory: {},
}));

// The seeded library, SRD shape: the two pooled paladin features. (Path is
// from this test file; the gate imports the same module as
// ../class-features-service.js from services/dm/.)
mock.module('../../class-features-service.js', () => ({
  ClassFeaturesService: {
    getFeaturesLibrary: async () => [
      {
        id: 'lib-lay-on-hands',
        className: 'Paladin',
        featureName: 'Lay on Hands',
        levelAcquired: 1,
        usageType: 'action',
      },
      {
        id: 'lib-divine-sense',
        className: 'Paladin',
        featureName: 'Divine Sense',
        levelAcquired: 1,
        usageType: 'action',
      },
    ],
    getCharacterFeatures: async () => [],
  },
}));

// Real spell-name parsing; the fixture paladin casts nothing here.
const realCastable = await import('../castable-spells.js');
mock.module('../castable-spells.js', () => ({
  ...realCastable,
  castableSpells: async () => [],
  castsSpells: () => false,
}));

mock.module('../dm-response-schema.js', () => ({
  parseLlmEnvelope: (text: string) => JSON.parse(text),
}));

// story-spell-slots is imported only when an allowed cast needs a slot check;
// no cast is claimed here, but the module must link.
mock.module('../story-spell-slots.js', () => ({
  spellsWithNoSlot: async () => [],
  spendStorySpellSlots: async () => {},
  slotRefusalLine: () => '',
  playerMessage: async () => null,
}));

const { refuseFeaturesCharacterLacks } = await import('../dm-feature-gate.js');

const envelope = (text: string) =>
  JSON.stringify({
    text,
    options: [],
    narration_segments: [],
    roll_requests: [],
    combat_actions: [],
    combatants: [],
    map_actions: [],
    handout_actions: [],
    scene_spec: null,
    combat_transition: 'none',
  });

type AllowedFeatures = { character: { id: string }; features: string[] };

const runGate = async (playerInput: string) => {
  let allowed: AllowedFeatures | null = null;
  const reply = envelope('Warmth spreads through your wounds.');
  const result = await refuseFeaturesCharacterLacks({
    result: { text: reply, error: undefined },
    userId: USER_ID,
    sessionId: SESSION_ID,
    playerInput,
    inCombat: false,
    onFeaturesAllowed: (features) => {
      allowed = features as AllowedFeatures;
    },
  });
  return { allowed, result, reply };
};

describe('use-verb feature claims (#712)', () => {
  it('claims "Lay on Hands" whole in "I use Lay on Hands to heal myself for 3 hit points"', async () => {
    const { allowed, result, reply } = await runGate(
      'I use Lay on Hands to heal myself for 3 hit points',
    );
    expect(allowed).not.toBeNull();
    expect(allowed!.features).toContain('Lay on Hands');
    expect(allowed!.character.id).toBe(CHARACTER_ID);
    // Allowed, not refused: the reply passes through unchanged.
    expect(result.text).toBe(reply);
  });

  it('still claims a feature whose name has no stop word ("I use Divine Sense")', async () => {
    const { allowed } = await runGate('I use Divine Sense to scan the room.');
    expect(allowed).not.toBeNull();
    expect(allowed!.features).toContain('Divine Sense');
  });

  it('claims nothing when the feature is named without a use verb', async () => {
    const { allowed, result, reply } = await runGate('Lay on Hands is my favorite feature.');
    expect(allowed).toBeNull();
    expect(result.text).toBe(reply);
  });
});
