/**
 * #777 item 3: two overlapping applies for one player message land once.
 *
 * /generate calls applyStoryDamage and applyStoryRest after the model returns.
 * A non-roll turn does not hold the session lock across that work, so two
 * generates can enter the appliers together. This drives those appliers in
 * parallel. It does not call a provider.
 *
 * #130: story damage, items and XP are applied server-side during the DM turn
 * with no client notification, so the live sheet showed the stale value until
 * a hard reload. The appliers now publish `character_state_updated` to the
 * session room; these tests drive the real applier entry points and assert the
 * invalidation is broadcast alongside the write. #751 adds the same pair for
 * rests: a story rest publishes too, and a story short rest spends hit dice.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import { describeWithDb, hasRealDb, importWithRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characterEquipment,
  characterHitDice,
  characterStats,
  characters,
  dialogueHistory,
  experienceEvents,
  gameSessions,
  inventoryItems,
  restEvents,
  storyItemEvents,
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

const { applyStoryDamage } = await importWithRealDb(() => import('../dm/story-damage.js'));
const { applyStoryRest } = await importWithRealDb(() => import('../dm/story-rest.js'));
const { applyStoryItems } = await importWithRealDb(() => import('../dm/story-items.js'));
const { awardStoryXp } = await importWithRealDb(() => import('../dm/story-xp.js'));

if (!hasRealDb) {
  console.warn(
    '[story-once-message] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('#777 two parallel story applies for one message', () => {
  const db = hasRealDb ? realDb() : (null as never);

  async function world(
    label: string,
    currentHitPoints: number,
    maxHitPoints: number,
  ): Promise<{ userId: string; characterId: string; sessionId: string; campaignId: string }> {
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
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      maxHitPoints,
      currentHitPoints,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId })
      .returning({ id: gameSessions.id });
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: 'I stay where I am.',
    });
    return { userId, characterId, sessionId, campaignId };
  }

  async function cleanup(
    characterId: string,
    sessionId: string,
    campaignId: string,
  ): Promise<void> {
    await db.delete(restEvents).where(eq(restEvents.characterId, characterId));
    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, characterId));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  }

  /**
   * #130: joins the session room with a capturing socket (standing in for the
   * live client's session socket) and returns the parsed
   * `character_state_updated` payloads it received.
   */
  async function characterUpdatesInSessionRoom(
    sessionId: string,
    run: () => Promise<unknown>,
  ): Promise<Array<{ type?: string; reason?: string }>> {
    const { joinRoom, leaveRoom } = await importWithRealDb(
      () => import('../collaboration/room-manager.js'),
    );
    const sent: string[] = [];
    const fakeWs = {
      readyState: 1,
      send: (payload: string) => {
        sent.push(payload);
      },
      close: () => {},
      data: {},
    };
    joinRoom(sessionId, fakeWs as never);
    try {
      await run();
    } finally {
      leaveRoom(sessionId, fakeWs as never);
    }
    return sent
      .map((payload) => JSON.parse(payload) as { type?: string; reason?: string })
      .filter((message) => message.type === 'character_state_updated');
  }

  it('applies story damage once when two calls overlap', async () => {
    const { userId, characterId, sessionId, campaignId } = await world('777-dmg', 12, 12);
    try {
      const outcomes = await Promise.all([
        applyStoryDamage({
          userId,
          sessionId,
          damage: { amount: 3, source: 'rope burn' },
        }),
        applyStoryDamage({
          userId,
          sessionId,
          damage: { amount: 3, source: 'rope burn' },
        }),
      ]);
      expect(outcomes.slice().sort()).toEqual(['already_applied', 'applied']);
      const [stats] = await db
        .select({ current: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBe(9);
      const lines = await db
        .select({ message: dialogueHistory.message })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
        );
      expect(lines).toHaveLength(1);
      expect(lines[0]?.message).toContain('story damage — rope burn deals 3 damage');
      expect(lines[0]?.message).toContain('HP 9/12');
    } finally {
      await cleanup(characterId, sessionId, campaignId);
    }
  });

  it('applies a story long rest once when two calls overlap', async () => {
    const { userId, characterId, sessionId, campaignId } = await world('777-rest', 6, 20);
    try {
      const outcomes = await Promise.all([
        applyStoryRest({ userId, sessionId, rest: { type: 'long' } }),
        applyStoryRest({ userId, sessionId, rest: { type: 'long' } }),
      ]);
      expect(outcomes.slice().sort()).toEqual(['already_applied', 'applied']);
      const [stats] = await db
        .select({ current: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBe(20);
      const events = await db
        .select({ id: restEvents.id, restType: restEvents.restType })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      expect(events).toHaveLength(1);
      expect(events[0]?.restType).toBe('long');
    } finally {
      await cleanup(characterId, sessionId, campaignId);
    }
  });

  it('#751: a story short rest spends hit dice and restores HP', async () => {
    // 6/20 with CON +2: one d10 die restores at most 12, so at least two dice
    // are always spent — the spend is proven deterministically, not by odds.
    const { userId, characterId, sessionId, campaignId } = await world('751-short', 6, 20);
    try {
      expect(await applyStoryRest({ userId, sessionId, rest: { type: 'short' } })).toBe('applied');
      const [stats] = await db
        .select({ current: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBeGreaterThan(6);
      expect(stats?.current).toBeLessThanOrEqual(20);
      const dice = await db
        .select({ used: characterHitDice.usedDice, total: characterHitDice.totalDice })
        .from(characterHitDice)
        .where(eq(characterHitDice.characterId, characterId));
      expect(dice).toHaveLength(1);
      expect(dice[0]?.used).toBeGreaterThanOrEqual(2);
      // The spend only stops early at full HP: short of full means every die went.
      if ((stats?.current ?? 0) < 20) expect(dice[0]?.used).toBe(dice[0]?.total);
      const events = await db
        .select({ hitDiceSpent: restEvents.hitDiceSpent, hpRestored: restEvents.hpRestored })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      expect(events).toHaveLength(1);
      expect(events[0]?.hitDiceSpent).toBe(dice[0]?.used);
      expect(events[0]?.hpRestored).toBeGreaterThan(0);
    } finally {
      await cleanup(characterId, sessionId, campaignId);
    }
  });

  it('#751 follow-up: a story short rest posts the engine line showing the Hit Die rolls', async () => {
    // Same deterministic-spend fixture as the #751 case above: 6/20 with
    // CON +2, so at least two d10 dice are always spent.
    const { userId, characterId, sessionId, campaignId } = await world('751-line', 6, 20);
    try {
      expect(await applyStoryRest({ userId, sessionId, rest: { type: 'short' } })).toBe('applied');
      const [event] = await db
        .select({ hitDiceSpent: restEvents.hitDiceSpent, hpRestored: restEvents.hpRestored })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      const spent = event?.hitDiceSpent ?? 0;
      const restored = event?.hpRestored ?? 0;
      expect(spent).toBeGreaterThanOrEqual(2);
      expect(restored).toBeGreaterThan(0);
      // The reported restore is the sheet's real gain (the last die can
      // overshoot max HP; the write caps there).
      const [stats] = await db
        .select({ current: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBe(6 + restored);

      const systemRows = (): Promise<Array<typeof dialogueHistory.$inferSelect>> =>
        db
          .select()
          .from(dialogueHistory)
          .where(
            and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
          );
      const lines = await systemRows();
      expect(lines).toHaveLength(1);
      const line = lines[0]?.message ?? '';
      expect(line.startsWith('⚙️ Engine: Short rest — Hit Dice:')).toBe(true);
      const rollParts = [...line.matchAll(/d10 rolled (\d+) \(\+(\d+) HP\)/g)];
      expect(rollParts).toHaveLength(spent);
      expect(rollParts.reduce((sum, part) => sum + Number(part[2]), 0)).toBe(restored);
      expect(line).toContain(`${restored} HP restored.`);
      expect(line).toContain(`Hit dice: ${3 - spent} of 3 remaining.`);

      // A retry sees the existing line and does not duplicate it.
      expect(await applyStoryRest({ userId, sessionId, rest: { type: 'short' } })).toBe(
        'already_applied',
      );
      expect(await systemRows()).toHaveLength(1);

      // With the line lost (the first attempt threw after the write), a retry
      // re-posts the summary from the stored event — counts and HP, no rolls.
      await db
        .delete(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
        );
      expect(await applyStoryRest({ userId, sessionId, rest: { type: 'short' } })).toBe(
        'already_applied',
      );
      const recovered = await systemRows();
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.message).toContain(`${spent} hit dice spent, ${restored} HP restored.`);
      expect(recovered[0]?.message).not.toContain('rolled');
    } finally {
      await cleanup(characterId, sessionId, campaignId);
    }
  });

  it('#751: a story rest publishes a character_state_updated invalidation', async () => {
    const { userId, characterId, sessionId, campaignId } = await world('751-rest', 6, 20);
    try {
      // The real production entry llm.ts calls for the reply's `rest`.
      const updates = await characterUpdatesInSessionRoom(sessionId, () =>
        applyStoryRest({ userId, sessionId, rest: { type: 'long' } }).then((outcome) => {
          expect(outcome).toBe('applied');
        }),
      );
      // The sheet's data source moved 6 -> 20 ...
      const [stats] = await db
        .select({ current: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBe(20);
      // ... and the live client was told to refetch it, as for damage/items/XP.
      expect(updates).toHaveLength(1);
      expect(updates[0]?.reason).toBe('story_rest');
    } finally {
      await cleanup(characterId, sessionId, campaignId);
    }

    // Same publish for a short rest — the #751 headline case.
    const shortWorld = await world('751-rest-short', 6, 20);
    try {
      const updates = await characterUpdatesInSessionRoom(shortWorld.sessionId, () =>
        applyStoryRest({
          userId: shortWorld.userId,
          sessionId: shortWorld.sessionId,
          rest: { type: 'short' },
        }).then((outcome) => {
          expect(outcome).toBe('applied');
        }),
      );
      expect(updates).toHaveLength(1);
      expect(updates[0]?.reason).toBe('story_rest');
    } finally {
      await cleanup(shortWorld.characterId, shortWorld.sessionId, shortWorld.campaignId);
    }
  });

  it('#130: story damage publishes a character_state_updated invalidation', async () => {
    const { userId, characterId, sessionId, campaignId } = await world('130-dmg', 12, 12);
    try {
      // The real production entry llm.ts calls for the reply's `damage`.
      const updates = await characterUpdatesInSessionRoom(sessionId, () =>
        applyStoryDamage({
          userId,
          sessionId,
          damage: { amount: 3, source: 'falling branch' },
        }).then((outcome) => {
          expect(outcome).toBe('applied');
        }),
      );
      // The sheet's data source moved 12 -> 9 ...
      const [stats] = await db
        .select({ current: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBe(9);
      // ... and the live client was told to refetch it.
      expect(updates).toHaveLength(1);
      expect(updates[0]?.reason).toBe('story_damage');
    } finally {
      await cleanup(characterId, sessionId, campaignId);
    }
  });

  it('#130: story items publish a character_state_updated invalidation', async () => {
    const { userId, characterId, sessionId, campaignId } = await world('130-itm', 12, 12);
    try {
      // The real production entry llm.ts calls for the reply's `items`.
      const updates = await characterUpdatesInSessionRoom(sessionId, () =>
        applyStoryItems({
          userId,
          sessionId,
          items: [{ name: 'Healing Potion', quantity: 1, change: 'gain' }],
        }).then((outcome) => {
          expect(outcome).toBe('applied');
        }),
      );
      const [row] = await db
        .select({ quantity: inventoryItems.quantity })
        .from(inventoryItems)
        .where(eq(inventoryItems.characterId, characterId));
      expect(row?.quantity).toBe(1);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.reason).toBe('story_items');
    } finally {
      await db.delete(storyItemEvents).where(eq(storyItemEvents.characterId, characterId));
      await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
      await db.delete(characterEquipment).where(eq(characterEquipment.characterId, characterId));
      await cleanup(characterId, sessionId, campaignId);
    }
  });

  it('#130: story XP publishes a character_state_updated invalidation', async () => {
    const { userId, characterId, sessionId, campaignId } = await world('130-xp', 12, 12);
    try {
      const [before] = await db
        .select({ xp: characters.experiencePoints })
        .from(characters)
        .where(eq(characters.id, characterId));
      // The real production entry llm.ts calls for the reply's `xp_award`.
      const updates = await characterUpdatesInSessionRoom(sessionId, () =>
        awardStoryXp({
          userId,
          sessionId,
          xpAward: { amount: 50, reason: 'survived the ambush' },
        }).then((outcome) => {
          expect(outcome).toBe('awarded');
        }),
      );
      const [after] = await db
        .select({ xp: characters.experiencePoints })
        .from(characters)
        .where(eq(characters.id, characterId));
      expect((after?.xp ?? 0) - (before?.xp ?? 0)).toBe(50);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.reason).toBe('story_xp');
    } finally {
      await db.delete(experienceEvents).where(eq(experienceEvents.characterId, characterId));
      await cleanup(characterId, sessionId, campaignId);
    }
  });
});
