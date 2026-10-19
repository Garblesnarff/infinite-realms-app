/**
 * #777 FIX: a damage retry after a throw applies once, and a second call
 * sees the claim before HP moves.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import { describeWithDb, hasRealDb, importWithRealDb } from './fixtures/real-db.js';
import {
  storyClaimCleanup,
  storyClaimDb,
  storyClaimHp,
  storyClaimWait,
  storyClaimWorld,
} from './story-claim-fixture.js';
import { characterStats, dialogueHistory } from '../../../../db/schema/index';

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

const { applyStoryDamage, storyDamageAfterClaimForTests } = await importWithRealDb(
  () => import('../dm/story-damage.js'),
);

describeWithDb('#777 damage claim retry', () => {
  const db = hasRealDb ? storyClaimDb() : (null as never);
  const damage = { amount: 3, source: 'rope burn' };

  it('a second call leaves HP where the first call put it', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-dmg-seq',
      12,
      12,
    );
    try {
      expect(await applyStoryDamage({ userId, sessionId, damage })).toBe('applied');
      expect(await applyStoryDamage({ userId, sessionId, damage })).toBe('already_applied');
      expect(await storyClaimHp(characterId)).toBe(9);
    } finally {
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });

  it('a thrown apply releases the claim so the retry lands once', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-dmg-throw',
      12,
      12,
    );
    storyDamageAfterClaimForTests.run = () => {
      throw new Error('apply failed');
    };
    try {
      await expect(applyStoryDamage({ userId, sessionId, damage })).rejects.toThrow('apply failed');
      expect(await storyClaimHp(characterId)).toBe(12);
      const lines = await db
        .select({ id: dialogueHistory.id })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
        );
      expect(lines).toHaveLength(0);
      storyDamageAfterClaimForTests.run = undefined;
      expect(await applyStoryDamage({ userId, sessionId, damage })).toBe('applied');
      expect(await storyClaimHp(characterId)).toBe(9);
    } finally {
      storyDamageAfterClaimForTests.run = undefined;
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });

  it('a second call sees the claim before HP is written', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-dmg-hold',
      12,
      12,
    );
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    storyDamageAfterClaimForTests.run = async () => {
      held = true;
      await hold;
    };
    try {
      const first = applyStoryDamage({ userId, sessionId, damage });
      await storyClaimWait(() => held);
      expect(held).toBe(true);
      expect(await applyStoryDamage({ userId, sessionId, damage })).toBe('already_applied');
      expect(await storyClaimHp(characterId)).toBe(12);
      release();
      expect(await first).toBe('applied');
      expect(await storyClaimHp(characterId)).toBe(9);
    } finally {
      release();
      storyDamageAfterClaimForTests.run = undefined;
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });

  it('a throw after temporary HP was spent keeps the claim', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-dmg-temp',
      12,
      12,
    );
    await db
      .update(characterStats)
      .set({ temporaryHitPoints: 5 })
      .where(eq(characterStats.characterId, characterId));
    storyDamageAfterClaimForTests.run = async () => {
      const { applyNonAttackDamage } = await import('../combat/non-attack-damage.js');
      await applyNonAttackDamage(characterId, userId, 3, 'story: rope burn');
      throw new Error('after temp');
    };
    try {
      await expect(applyStoryDamage({ userId, sessionId, damage })).rejects.toThrow('after temp');
      const [stats] = await db
        .select({
          current: characterStats.currentHitPoints,
          temp: characterStats.temporaryHitPoints,
        })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBe(12);
      expect(stats?.temp).toBe(2);
      storyDamageAfterClaimForTests.run = undefined;
      expect(await applyStoryDamage({ userId, sessionId, damage })).toBe('already_applied');
      const [again] = await db
        .select({ temp: characterStats.temporaryHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(again?.temp).toBe(2);
    } finally {
      storyDamageAfterClaimForTests.run = undefined;
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });
});
