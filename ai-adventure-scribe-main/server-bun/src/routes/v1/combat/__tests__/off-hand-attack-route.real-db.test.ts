/**
 * The off-hand chip through the real intent route (#1639): the proposal the action bar posts before the
 * roll, then the commit. The bodies are the shared wire fixture with this test's real ids. The proposal
 * is refused before the Attack action, and after it the proposal is legal and the commit spends the
 * bonus action. The rolls and the engine run for real against a real Postgres. No suite here calls the
 * live DM.
 */
import { beforeAll, afterAll, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
} from '../../../../../../db/schema/index';
import {
  offHandAttackBody,
  offHandProposeBody,
} from '../../../../../../shared/test-fixtures/off-hand-attack-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

const userId = `off-hand-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'off-hand-route@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));
const { combatAttackService } = await importWithRealDb(
  () => import('../../../../services/combat/combat-attack-service.js'),
);
const { clearAttackBudget } = await importWithRealDb(
  () => import('../../../../services/combat/attack-budget-service.js'),
);

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) {
  console.warn('[off-hand-attack-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');
}

describeWithDb('The off-hand chip through the real intent route (#1639)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let fighterCharacterId: string;
  let allyCharacterId: string;
  let sessionId: string;
  let encounterId: string;
  let fighterId: string;
  let allyId: string;
  let shortswordId: string;
  let daggerId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('off-hand-route-camp') })
      .returning({ id: campaigns.id });
    [{ id: fighterCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('off-hand-route-fighter'),
        level: 3,
        class: 'Fighter',
        classLevels: [{ className: 'Fighter', level: 3 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: fighterCharacterId,
      strength: 16,
      dexterity: 14,
      charisma: 10,
      armorClass: 14,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });
    const weapons = await db
      .insert(inventoryItems)
      .values([
        {
          characterId: fighterCharacterId,
          name: 'Shortsword',
          itemType: 'weapon',
          isEquipped: true,
        },
        { characterId: fighterCharacterId, name: 'Dagger', itemType: 'weapon', isEquipped: true },
      ])
      .returning({ id: inventoryItems.id, name: inventoryItems.name });
    shortswordId = weapons.find((row) => row.name === 'Shortsword')!.id;
    daggerId = weapons.find((row) => row.name === 'Dagger')!.id;

    [{ id: allyCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('off-hand-route-ally'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: allyCharacterId,
      strength: 10,
      dexterity: 10,
      charisma: 10,
      armorClass: 1,
      maxHitPoints: 500,
      currentHitPoints: 500,
      speed: 30,
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: fighterCharacterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId: fighterCharacterId,
          name: 'The Fighter',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 14,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          characterId: allyCharacterId,
          name: 'The Ally',
          // An opposing side, so the fight stays open after the first swing.
          participantType: 'enemy',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 500,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    fighterId = inserted.find((row) => row.turnOrder === 0)!.id;
    allyId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: fighterId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: allyId, currentHp: 500, maxHp: 500, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, fighterCharacterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, fighterCharacterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, allyCharacterId));
    await db.delete(characters).where(eq(characters.id, fighterCharacterId));
    await db.delete(characters).where(eq(characters.id, allyCharacterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  /** A fresh turn for the Fighter: no spent Action, no spent bonus action, no marks, no attack budget. */
  const freshTurn = async (): Promise<void> => {
    await db
      .update(combatEncounters)
      .set({ currentRound: 1, currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, encounterId));
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
    await clearAttackBudget(sessionId, fighterId);
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
  };

  /** The chip's body with this test's real ids; `propose` selects the proposal the popup posts first. */
  const chipBody = (propose: boolean) => {
    const base = propose ? offHandProposeBody() : offHandAttackBody();
    return {
      ...base,
      intent: { ...base.intent, actorId: fighterId, targetId: allyId, weaponId: daggerId },
    };
  };

  const post = (body: unknown) =>
    app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
        body: JSON.stringify(body),
      }),
    );

  const bonusActionUsed = async (): Promise<boolean> => {
    const [row] = await db
      .select({ used: combatParticipants.bonusActionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, fighterId));
    return row!.used;
  };

  test('the proposal before the Action is refused by the route, and nothing is spent', async () => {
    await freshTurn();
    const response = await post(chipBody(true));
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      'Take the Attack action with a light melee weapon first',
    );
    expect(await bonusActionUsed()).toBe(false);
  });

  test('after the Action is spent, the proposal is legal and the commit spends the bonus action', async () => {
    await freshTurn();
    // The Action, with the shortsword, through the production attack resolver.
    await combatAttackService!.resolveAttack(
      encounterId,
      {
        attackerId: fighterId,
        targetId: allyId,
        weaponId: shortswordId,
        attackType: 'melee',
        expectedVersion: 1,
      } as never,
      userId,
    );

    const proposed = await post(chipBody(true));
    expect(proposed.status).toBe(200);
    const proposal = (await proposed.json()) as {
      proposal: { legal: boolean; weaponName: string };
    };
    expect(proposal.proposal.legal).toBe(true);
    expect(proposal.proposal.weaponName).toBe('Dagger');
    expect(await bonusActionUsed()).toBe(false);

    const committed = await post(chipBody(false));
    expect(committed.status).toBe(200);
    expect(await bonusActionUsed()).toBe(true);
  });
});
