import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characters,
  characterStats,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
  inventoryItems,
} from '../../../../../../db/schema/index';
import { HELP_REFUSAL, READY_REFUSAL } from '../../../../../../shared/combat-object-action';
import { combatObjectIntentBody } from '../../../../../../shared/test-fixtures/combat-object-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

if (hasRealDb) process.env.DATABASE_URL = realDbUrl;

const userId = testId('combat-utility-user');
mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'utility@example.test', plan: 'free' },
    error: null,
  }),
}));

mock.module('../../../../lib/user-plan.js', () => ({ resolveUserPlanStrict: async () => 'free' }));
mock.module('../../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date().toISOString(),
    }),
  },
}));
const generate = mock(() => {
  throw new Error('Utility action reached the DM');
});
mock.module('../../../../services/llm-provider-service.js', () => ({
  LLMProviderService: { generate },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));
const { llmRoutes } = await importWithRealDb(() => import('../../llm.js'));

describeWithDb('combat utility actions (#1635)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const app = hasRealDb
    ? createRequestPipelineApp()
        .use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
        .use(llmRoutes)
    : null;
  const fixtures: Array<{ campaignId: string; characterId: string; sessionId: string }> = [];
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let actorId: string;

  beforeEach(async () => {
    const campaignId = crypto.randomUUID();
    characterId = crypto.randomUUID();
    sessionId = crypto.randomUUID();
    encounterId = crypto.randomUUID();
    actorId = crypto.randomUUID();
    const foeId = crypto.randomUUID();
    fixtures.push({ campaignId, characterId, sessionId });
    await db.insert(campaigns).values({ id: campaignId, userId, name: 'Combat utility' });
    await db.insert(characters).values({
      id: characterId,
      userId,
      ownerId: userId,
      campaignId,
      name: 'Hero',
      level: 1,
      skillProficiencies: 'Perception',
    });
    await db.insert(characterStats).values({
      characterId,
      wisdom: 16,
      maxHitPoints: 20,
      currentHitPoints: 8,
    });
    await db
      .insert(gameSessions)
      .values({ id: sessionId, campaignId, characterId, status: 'active' });
    await db.insert(combatEncounters).values({
      id: encounterId,
      sessionId,
      status: 'active',
      currentTurnOrder: 0,
    });
    await db.insert(combatParticipants).values([
      {
        id: actorId,
        encounterId,
        characterId,
        name: 'Hero',
        participantType: 'player',
        turnOrder: 0,
        maxHp: 20,
      },
      {
        id: foeId,
        encounterId,
        name: 'Goblin',
        participantType: 'monster',
        turnOrder: 1,
        maxHp: 10,
      },
    ]);
    await db.insert(combatParticipantStatus).values([
      { participantId: actorId, currentHp: 8, maxHp: 20, isConscious: true },
      { participantId: foeId, currentHp: 10, maxHp: 10, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      for (const fixture of fixtures) {
        await db.delete(gameSessions).where(eq(gameSessions.id, fixture.sessionId));
        await db.delete(characters).where(eq(characters.id, fixture.characterId));
        await db.delete(campaigns).where(eq(campaigns.id, fixture.campaignId));
      }
    } finally {
      await closeRealDb();
    }
  });

  const postObject = (name?: string) =>
    app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
        body: JSON.stringify(combatObjectIntentBody(actorId, name)),
      }),
    );

  const typedLine = async (text: string): Promise<string> => {
    const response = await app!.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          player_input: text,
          sessionId,
          dmReply: { messageId: crypto.randomUUID(), inCombat: true, holdProse: true },
        }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.provider).toBe('engine');
    expect(generate).not.toHaveBeenCalled();
    return body.combatUtilityLine;
  };

  const actionUsed = async () => {
    const [actor] = await db
      .select()
      .from(combatParticipants)
      .where(eq(combatParticipants.id, actorId));
    return actor.actionUsed;
  };
  const hp = async () => {
    const [status] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, actorId));
    return status.currentHp;
  };

  test('typed Search spends the Action and returns a proficient Wisdom (Perception) result', async () => {
    const line = await typedLine('I search the room.');
    expect(line).toMatch(/^Search \(Wisdom \/ Perception\): \d+ \(nat \d+\+5\)$/);
    expect(await actionUsed()).toBe(true);
    expect(await hp()).toBe(8);
    expect(await typedLine('Search')).not.toMatch(/^Search/);
  });

  test('generic Use an Object spends the Action and leaves HP unchanged', async () => {
    const response = await postObject();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.result.engineLine).toBe('Hero used an object. No mechanical effect.');
    expect(await actionUsed()).toBe(true);
    expect(await hp()).toBe(8);
  });

  test('Use an Object heals the hero and spends the carried Potion of Healing', async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({
        characterId,
        name: 'Potion of Healing',
        itemType: 'consumable',
        quantity: 1,
        properties: JSON.stringify({ healingDice: '2d4+2' }),
      })
      .returning();
    const line = await typedLine('I drink my Potion of Healing.');
    expect(line).toMatch(/^Hero used Potion of Healing and regained (?:[4-9]|10) HP/);
    expect(await hp()).toBe(8 + Number(/regained (\d+) HP/.exec(line)?.[1]));
    expect(await actionUsed()).toBe(true);
    expect(await db.select().from(inventoryItems).where(eq(inventoryItems.id, item.id))).toEqual(
      [],
    );
  });

  test('a missing potion is refused without spending the Action', async () => {
    const response = await postObject('Potion of Healing');
    expect(response.status).toBe(422);
    expect(await response.text()).toContain('You are not carrying a Potion of Healing.');
    expect(await actionUsed()).toBe(false);
    expect(await hp()).toBe(8);
  });

  test.each([
    ['I help.', HELP_REFUSAL],
    ['I ready an attack.', READY_REFUSAL],
  ])('%s is refused in words and leaves the Action unspent', async (text, refusal) => {
    expect(await typedLine(text)).toBe(refusal);
    expect(await actionUsed()).toBe(false);
    expect(await hp()).toBe(8);
  });
});
