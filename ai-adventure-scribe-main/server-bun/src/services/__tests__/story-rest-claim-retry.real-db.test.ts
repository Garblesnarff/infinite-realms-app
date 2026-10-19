/**
 * #777 FIX: a rest retry after a throw applies once. A spell-slot update
 * from another connection waits on the character row the claim locks, which
 * is why the restore does not run inside that transaction.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';

import { describeWithDb, hasRealDb, importWithRealDb } from './fixtures/real-db.js';
import {
  storyClaimCleanup,
  storyClaimDb,
  storyClaimHp,
  storyClaimWait,
  storyClaimWorld,
} from './story-claim-fixture.js';
import {
  characterHitDice,
  characterSpellSlots,
  characters,
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
const { RestService } = await importWithRealDb(() => import('../rest-service.js'));

describeWithDb('#777 rest claim retry', () => {
  const db = hasRealDb ? storyClaimDb() : (null as never);
  const rest = { type: 'long' as const };

  it('a second call leaves HP where the first rest put it', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-rest-seq',
      6,
      20,
    );
    try {
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('applied');
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('already_applied');
      expect(await storyClaimHp(characterId)).toBe(20);
      const events = await db
        .select({ id: restEvents.id })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      expect(events).toHaveLength(1);
    } finally {
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });

  it('a thrown restore releases the claim so the retry lands once', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-rest-throw',
      6,
      20,
    );
    RestService.afterStoryClaimForTests = () => {
      throw new Error('restore failed');
    };
    try {
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('rest_failed');
      expect(await storyClaimHp(characterId)).toBe(6);
      const blocked = await db
        .select({ id: restEvents.id })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      expect(blocked).toHaveLength(0);
      RestService.afterStoryClaimForTests = undefined;
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('applied');
      expect(await storyClaimHp(characterId)).toBe(20);
    } finally {
      RestService.afterStoryClaimForTests = undefined;
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });

  it('a throw after hit dice changed keeps the claim', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-rest-dice',
      6,
      20,
    );
    await db.insert(characterHitDice).values({
      characterId,
      className: 'Fighter',
      dieType: 'd10',
      totalDice: 3,
      usedDice: 2,
    });
    RestService.afterStoryClaimForTests = async () => {
      await db
        .update(characterHitDice)
        .set({ usedDice: 1 })
        .where(eq(characterHitDice.characterId, characterId));
      throw new Error('after dice');
    };
    try {
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('rest_failed');
      expect(await storyClaimHp(characterId)).toBe(6);
      const [dice] = await db
        .select({ used: characterHitDice.usedDice })
        .from(characterHitDice)
        .where(eq(characterHitDice.characterId, characterId));
      expect(dice?.used).toBe(1);
      const events = await db
        .select({ id: restEvents.id })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      expect(events).toHaveLength(1);
      RestService.afterStoryClaimForTests = undefined;
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('already_applied');
      expect(await storyClaimHp(characterId)).toBe(6);
    } finally {
      RestService.afterStoryClaimForTests = undefined;
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });

  it('a second call sees the claim before HP is restored', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-rest-hold',
      6,
      20,
    );
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    RestService.afterStoryClaimForTests = async () => {
      held = true;
      await hold;
    };
    try {
      const first = applyStoryRest({ userId, sessionId, rest });
      await storyClaimWait(() => held);
      expect(held).toBe(true);
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('already_applied');
      expect(await storyClaimHp(characterId)).toBe(6);
      release();
      expect(await first).toBe('applied');
      expect(await storyClaimHp(characterId)).toBe(20);
    } finally {
      release();
      RestService.afterStoryClaimForTests = undefined;
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });

  it('a spell-slot insert on another connection waits on the character lock', async () => {
    const { characterId, sessionId, campaignId } = await storyClaimWorld('777-lock', 12, 12);
    const url = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '';
    const other = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await db.insert(characterSpellSlots).values({
        characterId,
        spellLevel: 1,
        totalSlots: 2,
        usedSlots: 1,
      });
      await other`set lock_timeout = '500ms'`;
      await expect(
        db.transaction(async (tx) => {
          await tx
            .select({ id: characters.id })
            .from(characters)
            .where(eq(characters.id, characterId))
            .for('update');
          // A spell-slot insert checks the character foreign key and takes
          // FOR KEY SHARE on that row. The claim already holds FOR UPDATE,
          // so the insert waits. An update of used_slots does not.
          await other`
            insert into character_spell_slots
              (character_id, spell_level, total_slots, used_slots)
            values (${characterId}, 2, 2, 0)
          `;
        }),
      ).rejects.toThrow(/lock timeout/i);
    } finally {
      await other.end({ timeout: 5 });
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });
});
