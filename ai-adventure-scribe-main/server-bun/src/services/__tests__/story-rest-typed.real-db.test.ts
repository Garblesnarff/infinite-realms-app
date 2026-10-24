/**
 * #751 pin: a rest the player TYPES in chat reaches the sheet through the same
 * RestService the sheet's rest buttons use, even when the DM reply carries no
 * `rest` of its own — the llm route calls applyStoryRest with the envelope's
 * rest, which is undefined on exactly those turns.
 *
 * Verify-first (2026-10-21, main bf6d87b1): the premise "a typed long rest is
 * not applied" does NOT reproduce. The typed path had no real-DB coverage
 * before this file: the unit suite pins the detection regexes
 * (dm/__tests__/story-rest-typed.test.ts) and the other real-DB rest suites
 * drive the DM-granted path (rest param set, non-rest player message). These
 * tests drive the typed path end to end: player message in dialogue_history,
 * rest param absent, state read back from the tables the sheet reads, plus the rest ledger and the chat rows.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import { describeWithDb, hasRealDb, importWithRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characterHitDice,
  characterSpellSlots,
  characterStats,
  characters,
  dialogueHistory,
  gameSessions,
  restEvents,
} from '../../../../db/schema/index';

interface LogStub {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: () => LogStub;
}

const stub = (): LogStub => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});
mock.module('../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
  default: stub(),
}));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const { applyStoryRest } = await importWithRealDb(() => import('../dm/story-rest.js'));
const { setRngSeed } = await importWithRealDb(() => import('../../lib/rng.js'));

type Db = ReturnType<typeof realDb>;

interface World {
  userId: string;
  characterId: string;
  sessionId: string;
  campaignId: string;
}

/** A level-3 Cleric at 1/20 HP with slots, dice and feature uses spent. */
async function typedRestWorld(
  label: string,
  message: string,
  hitDiceUsed: number,
): Promise<World> {
  const db: Db = realDb();
  const userId = testId(`${label}-user`);
  const [{ id: campaignId }] = await db
    .insert(campaigns)
    .values({ userId, name: testId(`${label}-camp`) })
    .returning({ id: campaigns.id });
  const [{ id: characterId }] = await db
    .insert(characters)
    .values({
      userId,
      campaignId,
      name: testId(`${label}-hero`),
      level: 3,
      class: 'Cleric',
      // Keyed-object shape the sheet producer writes (sheet-feature-rest's
      // `spent` fixture, round-tripped through PUT /v1/characters/:id):
      // snake-case key, name = key. Channel Divinity: 1 use at level 3,
      // regained on a short rest. Warding Flare: WIS-mod (3) uses, long rest.
      classFeatures: {
        channel_divinity: { name: 'channel_divinity', usesPerRest: 'short', maxUses: 1, currentUses: 0 },
        warding_flare: { name: 'warding_flare', usesPerRest: 'long', maxUses: 3, currentUses: 1 },
      },
    })
    .returning({ id: characters.id });
  await db.insert(characterStats).values({
    characterId,
    maxHitPoints: 20,
    currentHitPoints: 1,
    temporaryHitPoints: 0,
    constitution: 14,
    isConscious: true,
    vitalState: 'standing',
  });
  await db.insert(characterHitDice).values({
    characterId,
    className: 'Cleric',
    dieType: 'd8',
    totalDice: 3,
    usedDice: hitDiceUsed,
  });
  await db.insert(characterSpellSlots).values([
    { characterId, spellLevel: 1, totalSlots: 4, usedSlots: 3 },
    { characterId, spellLevel: 2, totalSlots: 2, usedSlots: 2 },
  ]);
  const [{ id: sessionId }] = await db
    .insert(gameSessions)
    .values({ campaignId, characterId })
    .returning({ id: gameSessions.id });
  await db.insert(dialogueHistory).values({ sessionId, speakerType: 'player', message });
  return { userId, characterId, sessionId, campaignId };
}

async function typedRestCleanup(world: World): Promise<void> {
  const db: Db = realDb();
  // Best-effort, FK-safe order: one failed delete must not skip the rest.
  // (The world builder is local because the shared story-claim fixture
  // hard-codes its message and cannot express these worlds.)
  const drop = async (run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch {
      // Litter is namespaced by testId; a failed delete must not mask the test.
    }
  };
  await drop(() => db.delete(restEvents).where(eq(restEvents.characterId, world.characterId)));
  await drop(() =>
    db.delete(characterHitDice).where(eq(characterHitDice.characterId, world.characterId)),
  );
  await drop(() =>
    db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, world.characterId)),
  );
  await drop(() => db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, world.sessionId)));
  await drop(() => db.delete(gameSessions).where(eq(gameSessions.id, world.sessionId)));
  await drop(() =>
    db.delete(characterStats).where(eq(characterStats.characterId, world.characterId)),
  );
  await drop(() => db.delete(characters).where(eq(characters.id, world.characterId)));
  await drop(() => db.delete(campaigns).where(eq(campaigns.id, world.campaignId)));
}

interface SheetState {
  hp: number | undefined;
  hitDiceUsed: number | undefined;
  slotsUsed: Record<number, number>;
  featureUses: Record<string, number>;
  events: string[];
  engineLines: string[];
}

async function sheetState(world: World): Promise<SheetState> {
  const db: Db = realDb();
  const [stats] = await db
    .select({ current: characterStats.currentHitPoints })
    .from(characterStats)
    .where(eq(characterStats.characterId, world.characterId));
  const [dice] = await db
    .select({ used: characterHitDice.usedDice })
    .from(characterHitDice)
    .where(eq(characterHitDice.characterId, world.characterId));
  const slots = await db
    .select({ level: characterSpellSlots.spellLevel, used: characterSpellSlots.usedSlots })
    .from(characterSpellSlots)
    .where(eq(characterSpellSlots.characterId, world.characterId));
  const [character] = await db
    .select({ classFeatures: characters.classFeatures })
    .from(characters)
    .where(eq(characters.id, world.characterId));
  const events = await db
    .select({ restType: restEvents.restType })
    .from(restEvents)
    .where(eq(restEvents.characterId, world.characterId));
  const lines = await db
    .select({ speakerType: dialogueHistory.speakerType, message: dialogueHistory.message })
    .from(dialogueHistory)
    .where(eq(dialogueHistory.sessionId, world.sessionId));
  const features = Object.values(
    (character?.classFeatures ?? {}) as Record<string, { name: string; currentUses: number }>,
  );
  return {
    hp: stats?.current,
    hitDiceUsed: dice?.used,
    slotsUsed: Object.fromEntries(slots.map((slot) => [slot.level, slot.used])),
    featureUses: Object.fromEntries(features.map((feature) => [feature.name, feature.currentUses])),
    events: events.map((event) => event.restType),
    engineLines: lines
      .filter((line) => line.speakerType !== 'player')
      .map((line) => line.message),
  };
}

describeWithDb('#751 typed chat rests', () => {
  it('applies a typed long rest in full when the DM reply carries no rest', async () => {
    // The exact sentence from the original Hark report (P1016-029).
    const world = await typedRestWorld(
      '751-typed-long',
      'I take a full long rest - eight hours sleeping and tending my wounds...',
      3,
    );
    try {
      expect(
        await applyStoryRest({ userId: world.userId, sessionId: world.sessionId, rest: undefined }),
      ).toBe('applied');
      const after = await sheetState(world);
      expect(after.hp).toBe(20);
      // Half of 3 total hit dice regained (minimum 1): 3 used -> 2 used.
      expect(after.hitDiceUsed).toBe(2);
      expect(after.slotsUsed).toEqual({ 1: 0, 2: 0 });
      // A long rest resets short-rest and long-rest feature uses alike.
      expect(after.featureUses).toEqual({ channel_divinity: 1, warding_flare: 3 });
      expect(after.events).toEqual(['long']);
      // #751 fix: a long rest posts its engine line too (this assertion
      // pinned the old asymmetry — no line for a long rest — until the
      // DM-route fix; the line's parts are the rest's actuals: 19 HP
      // (1 -> 20), slots were spent and restored, 1 hit die regained).
      const freshLine =
        '⚙️ Engine: Long rest — 19 HP restored, spell slots restored, 1 hit dice regained.';
      expect(after.engineLines).toEqual([freshLine]);

      // Once per player message: a retry of the same turn applies nothing twice.
      expect(
        await applyStoryRest({ userId: world.userId, sessionId: world.sessionId, rest: undefined }),
      ).toBe('already_applied');
      const retried = await sheetState(world);
      expect(retried.hp).toBe(20);
      expect(retried.hitDiceUsed).toBe(2);
      expect(retried.slotsUsed).toEqual({ 1: 0, 2: 0 });
      expect(retried.featureUses).toEqual({ channel_divinity: 1, warding_flare: 3 });
      expect(retried.events).toEqual(['long']);
      expect(retried.engineLines).toEqual([freshLine]);

      // Recovery: the rest landed but the line itself was lost (a transient
      // write failure the notice swallows). A retry re-posts it from the
      // finished rest_events row — the stored HP actual and the completed
      // rest's canonical effect, never a "(nothing to restore)" claim the
      // stored row cannot support (slots and dice deltas are not stored).
      const db = realDb();
      await db
        .delete(dialogueHistory)
        .where(
          and(
            eq(dialogueHistory.sessionId, world.sessionId),
            eq(dialogueHistory.speakerType, 'system'),
          ),
        );
      expect(
        await applyStoryRest({ userId: world.userId, sessionId: world.sessionId, rest: undefined }),
      ).toBe('already_applied');
      const recovered = await sheetState(world);
      expect(recovered.engineLines).toEqual([
        '⚙️ Engine: Long rest — 19 HP restored, spell slots restored.',
      ]);
    } finally {
      await typedRestCleanup(world);
    }
  });

  it('applies a typed short rest: hit dice spent until healed, engine line posted', async () => {
    const world = await typedRestWorld('751-typed-short', 'I take a short rest.', 0);
    // Seeded dice (full-session / hex real-DB precedent): the rolls, the HP
    // total and the engine line are exact strings this test can pin.
    setRngSeed(42);
    try {
      expect(
        await applyStoryRest({ userId: world.userId, sessionId: world.sessionId, rest: undefined }),
      ).toBe('applied');
      const after = await sheetState(world);
      // Seeded rolls 5 / 4 / 7 (+2 CON each; the third gain is capped by the
      // 6 HP still missing): dice are spent until the character is healed.
      expect(after.hp).toBe(20);
      expect(after.hitDiceUsed).toBe(3);
      // A short rest resets short-rest features only; slots stay spent.
      expect(after.featureUses).toEqual({ channel_divinity: 1, warding_flare: 1 });
      expect(after.slotsUsed).toEqual({ 1: 3, 2: 2 });
      expect(after.events).toEqual(['short']);
      // The player sees the rolls, not just a silent HP move (Hark D2-002/003).
      expect(after.engineLines).toEqual([
        '⚙️ Engine: Short rest — Hit Dice: d8 rolled 5 (+7 HP), d8 rolled 4 (+6 HP), d8 rolled 7 (+6 HP). 19 HP restored. Hit dice: 0 of 3 remaining.',
      ]);
    } finally {
      setRngSeed(undefined);
      await typedRestCleanup(world);
    }
  });

  it('a typed long rest wins over a DM reply that declares a short rest (D23-002)', async () => {
    // Live failure, Hark D23-002 (build 85d20316): after a won fight, the typed
    // 'we take a long rest' produced 'Short rest — no hit dice spent' and the
    // spent slot stayed spent. The DM reply had declared a short rest (a
    // post-combat breather narration), and the old precedence let the DM's
    // field silently override the player's explicit words. The slot-restore
    // assert is the discriminating one: a short rest never restores slots.
    const world = await typedRestWorld('751-typed-long-vs-dm-short', 'we take a long rest', 3);
    try {
      expect(
        await applyStoryRest({
          userId: world.userId,
          sessionId: world.sessionId,
          rest: { type: 'short' },
        }),
      ).toBe('applied');
      const after = await sheetState(world);
      expect(after.hp).toBe(20);
      expect(after.hitDiceUsed).toBe(2);
      expect(after.slotsUsed).toEqual({ 1: 0, 2: 0 });
      expect(after.featureUses).toEqual({ channel_divinity: 1, warding_flare: 3 });
      expect(after.events).toEqual(['long']);
      expect(after.engineLines).toEqual([
        '⚙️ Engine: Long rest — 19 HP restored, spell slots restored, 1 hit dice regained.',
      ]);
    } finally {
      await typedRestCleanup(world);
    }
  });

  it('a typed short rest wins over a DM reply that declares a long rest', async () => {
    // The symmetric half of the precedence rule: the player's explicit words
    // decide, in both directions. A DM reply that upgrades the player's
    // short rest to a long one must not restore slots the player did not
    // ask to restore.
    const world = await typedRestWorld('751-typed-short-vs-dm-long', 'I take a short rest.', 0);
    setRngSeed(42);
    try {
      expect(
        await applyStoryRest({
          userId: world.userId,
          sessionId: world.sessionId,
          rest: { type: 'long' },
        }),
      ).toBe('applied');
      const after = await sheetState(world);
      expect(after.hp).toBe(20);
      expect(after.hitDiceUsed).toBe(3);
      expect(after.featureUses).toEqual({ channel_divinity: 1, warding_flare: 1 });
      expect(after.slotsUsed).toEqual({ 1: 3, 2: 2 });
      expect(after.events).toEqual(['short']);
      expect(after.engineLines).toEqual([
        '⚙️ Engine: Short rest — Hit Dice: d8 rolled 5 (+7 HP), d8 rolled 4 (+6 HP), d8 rolled 7 (+6 HP). 19 HP restored. Hit dice: 0 of 3 remaining.',
      ]);
    } finally {
      setRngSeed(undefined);
      await typedRestCleanup(world);
    }
  });

  it('leaves state untouched when the player message declares no rest', async () => {
    const world = await typedRestWorld('751-typed-none', 'I stay where I am.', 3);
    try {
      expect(
        await applyStoryRest({ userId: world.userId, sessionId: world.sessionId, rest: undefined }),
      ).toBe('invalid_rest');
      const after = await sheetState(world);
      expect(after.hp).toBe(1);
      expect(after.hitDiceUsed).toBe(3);
      expect(after.slotsUsed).toEqual({ 1: 3, 2: 2 });
      expect(after.featureUses).toEqual({ channel_divinity: 0, warding_flare: 1 });
      expect(after.events).toEqual([]);
      expect(after.engineLines).toEqual([]);
    } finally {
      await typedRestCleanup(world);
    }
  });
});
