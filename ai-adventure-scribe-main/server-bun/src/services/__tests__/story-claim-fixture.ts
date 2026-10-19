/**
 * Shared rows for the #777 claim tests. Not a suite: the *.real-db.test.ts
 * files import it.
 */
import { eq } from 'drizzle-orm';

import { realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characterHitDice,
  characterStats,
  characters,
  dialogueHistory,
  gameSessions,
  restEvents,
} from '../../../../db/schema/index';

type Db = ReturnType<typeof realDb>;

export function storyClaimDb(): Db {
  return realDb();
}

export async function storyClaimWorld(
  label: string,
  currentHitPoints: number,
  maxHitPoints: number,
): Promise<{ userId: string; characterId: string; sessionId: string; campaignId: string }> {
  const db = storyClaimDb();
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

export async function storyClaimCleanup(
  characterId: string,
  sessionId: string,
  campaignId: string,
): Promise<void> {
  const db = storyClaimDb();
  await db.delete(restEvents).where(eq(restEvents.characterId, characterId));
  await db.delete(characterHitDice).where(eq(characterHitDice.characterId, characterId));
  await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
  await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
  await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
  await db.delete(characters).where(eq(characters.id, characterId));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
}

export async function storyClaimHp(characterId: string): Promise<number | undefined> {
  const db = storyClaimDb();
  const [stats] = await db
    .select({ current: characterStats.currentHitPoints })
    .from(characterStats)
    .where(eq(characterStats.characterId, characterId));
  return stats?.current;
}

export async function storyClaimWait(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !ready(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
