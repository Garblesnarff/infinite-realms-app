/**
 * GP-061 (#313) retest: "I cast Fireball at them." (not on the sheet) must be refused
 * at once by the DM feature gate, even when inCombat=true.
 *
 * The gate used to skip the entire spell sheet check in combat, trusting the engine
 * to refuse. The engine's typed-action path never did — Hark D4-012 got a Quarterstaff
 * roll request and no refusal. The player's own typed casts are now sheet-checked in
 * combat; only the DM's narration (NPC spells) is still skipped.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

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

// The Apprentice's sheet: Burning Hands known, Fireball not.
const testCharacter = {
  id: CHARACTER_ID,
  name: 'The Apprentice',
  class: 'Wizard',
  level: 1,
  classLevels: null,
  cantrips: 'Fire Bolt',
  preparedSpells: 'Burning Hands',
  knownSpells: 'Burning Hands,Acid Splash',
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

// Real spell-name parsing; only the sheet contents are stubbed.
const realCastable = await import('../castable-spells.js');
mock.module('../castable-spells.js', () => ({
  ...realCastable,
  castableSpells: async () => ['Fire Bolt', 'Burning Hands', 'Acid Splash'],
  castsSpells: () => true,
}));

mock.module('../dm-response-schema.js', () => ({
  parseLlmEnvelope: (text: string) => JSON.parse(text),
}));

// story-spell-slots is only imported when there is something to spend; the refusal
// path never reaches it, but the module must link.
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

describe('GP-061 (#313): in-combat typed spell the sheet does not list is refused', () => {
  it('refuses "I cast Fireball at them." when inCombat=true and Fireball is not on the sheet', async () => {
    const result = await refuseFeaturesCharacterLacks({
      result: { text: envelope('The Apprentice hurls fire.'), error: undefined },
      userId: USER_ID,
      sessionId: SESSION_ID,
      playerInput: 'I cast Fireball at them.',
      inCombat: true,
    });
    const parsed = JSON.parse(result.text);
    expect(parsed.text).toContain('Fireball');
    expect(parsed.text.toLowerCase()).toContain("isn't on their character sheet");
  });

  it('allows "I cast Burning Hands at them." when inCombat=true and it is on the sheet', async () => {
    const inputText = 'The Apprentice sweeps burning hands across the cultists.';
    const result = await refuseFeaturesCharacterLacks({
      result: { text: envelope(inputText), error: undefined },
      userId: USER_ID,
      sessionId: SESSION_ID,
      playerInput: 'I cast Burning Hands at them.',
      inCombat: true,
    });
    // No refusal: the reply passes through unchanged.
    expect(result.text).toBe(envelope(inputText));
  });

  it('still refuses an unknown spell out of combat (existing behavior)', async () => {
    const result = await refuseFeaturesCharacterLacks({
      result: { text: envelope('The Apprentice hurls fire.'), error: undefined },
      userId: USER_ID,
      sessionId: SESSION_ID,
      playerInput: 'I cast Fireball at them.',
      inCombat: false,
    });
    const parsed = JSON.parse(result.text);
    expect(parsed.text).toContain('Fireball');
  });
});
