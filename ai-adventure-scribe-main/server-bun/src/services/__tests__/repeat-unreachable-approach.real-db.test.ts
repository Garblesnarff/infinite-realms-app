/**
 * Out-of-reach melee proposals repeat safely (#1802, round 1).
 *
 * A proposal that walks the actor toward a foe it cannot reach moves once and
 * records one DM fact. A retried proposal for the same actor, target and turn
 * reuses that resolution instead of moving again and appending a second fact —
 * unless the board changed under it: a manual move of either side, a forced
 * move, a removal, or a death clears the marker, and the next proposal re-plans
 * from the new board. The commit phase does not READ the marker: a commit
 * re-runs the normal approach, so it still moves with the remaining movement and
 * records a second fact. That resolution records a marker of its own, so a later
 * propose reuses the commit's resolution — the commit test pins it (a
 * movement-only commit claims no action, so the third propose is legal and
 * comes back movedFeet 0 with still two facts).
 *
 * The fixture follows the producers the route already reads: the tactical map
 * row (`tacticalMaps.state`), the equipped `inventory_items` row, and the
 * encounter version the route checks. Only authentication is mocked. Proposals
 * and commits go through `createRequestPipelineApp` and
 * `POST /v1/combat/:id/intent`; manual moves go through the same route as a
 * `move` intent.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { and, desc, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
  tacticalMaps,
} from '../../../../db/schema/index';
import { setRngSeed } from '../../lib/rng.js';

import type { TacticalMap } from '../../tactical/types.js';

const USER_PREFIX = 'repeat-approach-user-';
const userId = `${USER_PREFIX}${process.pid}`;

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/, '');
    return token && token.startsWith(USER_PREFIX)
      ? { user: { userId: token, email: 'repeat@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { intentRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/intents.js'));
const { resetTacticalMovementForTurn, grantTacticalDash } = await importWithRealDb(
  () => import('../combat/tactical-combat-lifecycle.js'),
);
const { applyTacticalMapAction, consumeTacticalMapContext } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { CombatHPService } = await importWithRealDb(() => import('../combat-hp-service.js'));

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) {
  console.warn(
    '[repeat-unreachable-approach] SKIPPED: set DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('out-of-reach melee proposals repeat safely (#1802)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let targetId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('repeat-camp') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: 'Bram',
        level: 1,
        class: 'Fighter',
        fightingStyles: ['archery'],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      dexterity: 14,
      armorClass: 16,
      maxHitPoints: 12,
      currentHitPoints: 12,
    });
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
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
          characterId,
          name: 'Bram',
          participantType: 'player',
          turnOrder: 0,
          initiative: 18,
          armorClass: 16,
          maxHp: 12,
          speed: 30,
        },
        {
          encounterId,
          name: 'Practice Dummy',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 1,
          armorClass: 10,
          maxHp: 400,
          speed: 0,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    targetId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 12, maxHp: 12, isConscious: true },
      { participantId: targetId, currentHp: 400, maxHp: 400, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb || !characterId) return;
    if (encounterId) {
      await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    }
    if (sessionId) await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    if (campaignId) await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  beforeEach(async () => {
    setRngSeed(undefined);
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false, reactionUsed: false })
      .where(eq(combatParticipants.id, heroId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 400, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, targetId));
  });

  async function equip(styles: string[], weapons: string[], extra: string[] = []): Promise<void> {
    await db
      .update(characters)
      .set({ fightingStyles: styles })
      .where(eq(characters.id, characterId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
    if (weapons.length || extra.length) {
      await db.insert(inventoryItems).values([
        ...weapons.map((name) => ({
          characterId,
          name,
          itemType: 'weapon' as const,
          isEquipped: true,
          quantity: 1,
        })),
        ...extra.map((name) => ({
          characterId,
          name,
          itemType: 'ammunition' as const,
          isEquipped: false,
          quantity: 20,
        })),
      ]);
    }
  }

  async function post(body: unknown): Promise<Record<string, any>> {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
        body: JSON.stringify(body),
      }),
    );
    const payload = (await response.json()) as Record<string, any>;
    expect(response.status, JSON.stringify(payload)).toBe(200);
    return payload;
  }

  async function version(): Promise<number> {
    const [row] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row!.version;
  }

  async function attack(d20: number, weaponName?: string): Promise<Record<string, any>> {
    const weaponId = weaponName
      ? (
          await db
            .select({ id: inventoryItems.id })
            .from(inventoryItems)
            .where(
              and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.name, weaponName)),
            )
        )[0]?.id
      : undefined;
    const expectedVersion = await version();
    const intent = {
      type: 'attack',
      actorId: heroId,
      targetId,
      expectedVersion,
      ...(weaponId ? { weaponId } : {}),
    };
    const proposed = await post({ phase: 'propose', intent, origin: 'action_bar' });
    const committed = await post({
      intent: { ...intent, d20, actionId: testId('attack') },
      origin: 'action_bar',
    });
    return { proposed, committed };
  }

  test('#1802 a second out-of-reach melee proposal does not move again and appends no second DM fact', async () => {
    await equip([], ['Longsword']);
    // A long movement-blocking obstacle (#1057's feast table): the hero closes to 15 ft on
    // the first proposal but cannot reach the foe, and the detour around the table's end
    // costs 45 ft against 30 ft of movement — so without the fix a second proposal walks
    // the detour again and appends a second fact. The fixture follows the producers the
    // route already reads: the tactical map row (`tacticalMaps.state`), the equipped
    // `inventory_items` row, and the encounter version the route checks.
    const mapId = crypto.randomUUID();
    const width = 9;
    const height = 11;
    const cells = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        if (x === 4 && y <= 8) {
          return {
            terrain: 'wall' as const,
            blocksMovement: true,
            blocksSight: true,
            cover: 3 as const,
            elevation: 0,
            decoration: 'long feast table',
          };
        }
        return {
          terrain: 'floor' as const,
          blocksMovement: false,
          blocksSight: false,
          cover: 0 as const,
          elevation: 0,
        };
      }),
    );
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width,
        height,
        cells,
        entities: [
          {
            id: heroId,
            x: 2,
            y: 4,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 6,
            y: 4,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 repeat proposal fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 5, distanceFeet: 15 },
      });
      const afterFirst = await readMap();
      const heroAfterFirst = afterFirst.entities.find((entity) => entity.id === heroId)!;
      expect(heroAfterFirst.movementRemaining).toBe(25);
      expect(afterFirst.pendingDmFacts).toHaveLength(1);
      expect(afterFirst.pendingDmFacts![0]).toContain('could not reach');
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);

      const second = await propose();
      expect(second.proposal).toMatchObject({
        movementOnly: true,
        result: {
          resolvedAs: 'movement_only',
          movedFeet: 0,
          from: { x: heroAfterFirst.x, y: heroAfterFirst.y },
          to: { x: heroAfterFirst.x, y: heroAfterFirst.y },
          distanceFeet: 15,
          startingDistanceFeet: 15,
        },
      });
      const afterSecond = await readMap();
      const heroAfterSecond = afterSecond.entities.find((entity) => entity.id === heroId)!;
      expect({ x: heroAfterSecond.x, y: heroAfterSecond.y }).toEqual({
        x: heroAfterFirst.x,
        y: heroAfterFirst.y,
      });
      expect(heroAfterSecond.movementRemaining).toBe(25);
      expect(afterSecond.pendingDmFacts).toHaveLength(1);
      expect(afterSecond.pendingDmFacts![0]).toBe(afterFirst.pendingDmFacts![0]);
      expect(afterSecond.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);

      // Next turn: the movement reset clears the marker, so the same attack is a fresh
      // resolution — it moves again (the detour remainder) and records a second fact
      // for the new attempt. If the marker had not cleared, propose 3 would come back
      // movedFeet 0 with still one fact.
      await resetTacticalMovementForTurn(sessionId, heroId);
      const third = await propose();
      expect(third.proposal).toMatchObject({
        movementOnly: true,
        result: {
          resolvedAs: 'movement_only',
          movedFeet: 30,
          from: { x: heroAfterFirst.x, y: heroAfterFirst.y },
          to: { x: 4, y: 9 },
          distanceFeet: 25,
        },
      });
      const afterThird = await readMap();
      const heroAfterThird = afterThird.entities.find((entity) => entity.id === heroId)!;
      expect(heroAfterThird.movementRemaining).toBe(0);
      expect(afterThird.pendingDmFacts).toHaveLength(2);
      expect(afterThird.pendingDmFacts![1]).toContain('could not reach');
      expect(afterThird.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 30 },
      ]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  });

  // Shared by the two #1802 cage tests below: the hero at (3,1) with all 8 neighbors
  // wall (the unit-test shape from combat-approach-service), the target at (1,1) two
  // cells away. The hero cannot move at all, so the first proposal spends nothing.
  function cagedCells(): Array<Array<Record<string, unknown>>> {
    const wall = {
      terrain: 'wall' as const,
      blocksMovement: true,
      blocksSight: true,
      cover: 3 as const,
      elevation: 0,
      decoration: 'cage wall',
    };
    const floor = {
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    };
    return Array.from({ length: 11 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) => {
        const caged = Math.abs(x - 3) <= 1 && Math.abs(y - 1) <= 1 && !(x === 3 && y === 1);
        return caged ? { ...wall } : { ...floor };
      }),
    );
  }

  test('#1802 (fall-through) a 0-spent resolution re-plans once the board changes', async () => {
    await equip([], ['Longsword']);
    // The first proposal spends nothing (caged, movedFeet 0). Clearing the cell toward
    // the target is a board change: the repeat re-plans, finds a reaching cell, and
    // moves once instead of reusing the refusal — and records no second fact.
    const mapId = crypto.randomUUID();
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width: 9,
        height: 11,
        cells: cagedCells(),
        entities: [
          {
            id: heroId,
            x: 3,
            y: 1,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 1,
            y: 1,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 0,
            movementRemaining: 0,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 fall-through fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 0, distanceFeet: 10 },
      });
      const afterFirst = await readMap();
      expect(afterFirst.entities.find((entity) => entity.id === heroId)).toMatchObject({
        x: 3,
        y: 1,
        movementRemaining: 30,
      });
      expect(afterFirst.pendingDmFacts).toHaveLength(1);
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 0 },
      ]);

      // The board changes: the wall between hero and target comes down.
      const [row] = await db
        .select({ state: tacticalMaps.state })
        .from(tacticalMaps)
        .where(eq(tacticalMaps.id, mapId));
      const state = row!.state as TacticalMap;
      state.cells[1][2] = {
        terrain: 'floor',
        blocksMovement: false,
        blocksSight: false,
        cover: 0,
        elevation: 0,
      };
      await db.update(tacticalMaps).set({ state }).where(eq(tacticalMaps.id, mapId));

      const second = await propose();
      expect(second.proposal.movementOnly).toBe(false);
      const afterSecond = await readMap();
      expect(afterSecond.entities.find((entity) => entity.id === heroId)).toMatchObject({
        x: 2,
        y: 1,
        movementRemaining: 25,
      });
      expect(afterSecond.pendingDmFacts).toHaveLength(1);
      expect(afterSecond.pendingDmFacts![0]).toBe(afterFirst.pendingDmFacts![0]);
      expect(afterSecond.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  });

  test('#1802 (Dash) a Dash after a failed approach clears the marker', async () => {
    await equip([], ['Longsword']);
    // Open board, 55 ft apart: the first proposal walks 30 ft and still cannot reach.
    // The Dash is invoked directly — grantTacticalDash is what the route's Dash intent
    // calls, and the clearing lives there (the route wiring is covered by the
    // dash-intent suite; the fixture hero is a Fighter, so Cunning Action is not
    // available to exercise the bonus-action path end to end here).
    const mapId = crypto.randomUUID();
    const floorCell = {
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    };
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width: 13,
        height: 3,
        cells: Array.from({ length: 3 }, () =>
          Array.from({ length: 13 }, () => ({ ...floorCell })),
        ),
        entities: [
          {
            id: heroId,
            x: 0,
            y: 1,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 11,
            y: 1,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 dash fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 30, distanceFeet: 25 },
      });
      const afterFirst = await readMap();
      expect(afterFirst.entities.find((entity) => entity.id === heroId)).toMatchObject({
        x: 6,
        y: 0,
        movementRemaining: 0,
      });
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 30 },
      ]);

      await grantTacticalDash(sessionId, heroId);
      const afterDash = await readMap();
      expect(afterDash.entities.find((entity) => entity.id === heroId)?.movementRemaining).toBe(30);
      expect(afterDash.resolvedUnreachableApproaches ?? []).toEqual([]);

      // Fresh movement is a fresh approach: the re-proposal closes and rolls.
      const second = await propose();
      expect(second.proposal.movementOnly).toBe(false);
      const afterSecond = await readMap();
      const heroAfterSecond = afterSecond.entities.find((entity) => entity.id === heroId)!;
      expect(Math.max(Math.abs(heroAfterSecond.x - 11), Math.abs(heroAfterSecond.y - 1))).toBe(1);
      expect(heroAfterSecond.movementRemaining).toBe(10);
      expect(afterSecond.pendingDmFacts).toHaveLength(1);
      expect(afterSecond.resolvedUnreachableApproaches ?? []).toEqual([]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  });

  test('#1802 (divergent rows) the fact lands on the latest row and the marker on the active row', async () => {
    await equip([], ['Longsword']);
    // Two rows for the session: the active board (caged hero, old updatedAt) and a newer
    // torn-down board (latest by updatedAt, inactive). The first proposal spends nothing
    // (caged, movedFeet 0), so the only writes are the fact and the marker — which is
    // what makes the updatedAt assertions deterministic: no move bumps the active row.
    const mapId = crypto.randomUUID();
    const decoyId = crypto.randomUUID();
    const oldTime = new Date(Date.now() - 3600_000);
    const floorCell = {
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    };
    await db.insert(tacticalMaps).values([
      {
        id: mapId,
        sessionId,
        state: {
          id: mapId,
          sessionId,
          width: 9,
          height: 11,
          cells: cagedCells(),
          entities: [
            {
              id: heroId,
              x: 3,
              y: 1,
              size: 'medium' as const,
              type: 'pc' as const,
              speedFeet: 30,
              movementRemaining: 30,
              name: 'Bram',
            },
            {
              id: targetId,
              x: 1,
              y: 1,
              size: 'medium' as const,
              type: 'monster' as const,
              speedFeet: 0,
              movementRemaining: 0,
              name: 'Practice Dummy',
            },
          ],
          round: 1,
          sceneDescription: '1802 divergent fixture',
        },
        active: true,
        updatedAt: oldTime,
      },
      {
        id: decoyId,
        sessionId,
        state: {
          id: decoyId,
          sessionId,
          width: 3,
          height: 3,
          cells: Array.from({ length: 3 }, () =>
            Array.from({ length: 3 }, () => ({ ...floorCell })),
          ),
          entities: [],
          round: 1,
          sceneDescription: 'torn-down board',
        },
        active: false,
        updatedAt: new Date(),
      },
    ]);
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readRows = async (): Promise<
        Array<{ id: string; state: MapState; active: boolean; updatedAt: Date }>
      > => {
        const rows = await db
          .select({
            id: tacticalMaps.id,
            state: tacticalMaps.state,
            active: tacticalMaps.active,
            updatedAt: tacticalMaps.updatedAt,
          })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt));
        return rows as Array<{ id: string; state: MapState; active: boolean; updatedAt: Date }>;
      };

      const before = await readRows();
      expect(before).toHaveLength(2);
      expect(before[0]!.id).toBe(decoyId);
      expect(before[1]!.id).toBe(mapId);

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 0, distanceFeet: 10 },
      });

      const after = await readRows();
      const activeRow = after.find((row) => row.id === mapId)!;
      const latestRow = after.find((row) => row.id === decoyId)!;
      // The marker write is state-only (no updatedAt bump): the active row is untouched
      // and the fact row stays strictly newest, so "latest" can never flip to the
      // active row and strand the fact.
      expect(activeRow.updatedAt.getTime()).toBe(before[1]!.updatedAt.getTime());
      expect(latestRow.updatedAt.getTime()).toBeGreaterThan(before[0]!.updatedAt.getTime());
      expect(latestRow.updatedAt.getTime()).toBeGreaterThan(activeRow.updatedAt.getTime());
      expect(latestRow.state.pendingDmFacts).toHaveLength(1);
      expect(latestRow.state.pendingDmFacts![0]).toContain('could not reach');
      expect(latestRow.state.resolvedUnreachableApproaches ?? []).toEqual([]);
      expect(activeRow.state.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 0 },
      ]);
      expect(activeRow.state.pendingDmFacts ?? []).toEqual([]);

      // The fact is deliverable, not stranded: consume reads the latest row.
      const delivered = await consumeTacticalMapContext(sessionId);
      expect(delivered.facts).toEqual(
        expect.arrayContaining([expect.stringContaining('could not reach')]),
      );
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  });
  // Round 1: the short-wall fixture shared by the target-move and target-remove
  // tests below. The wall (x=4, y=1..8) blocks the direct route, and the cheapest
  // detour (the north gap at y=0, to (5,3)) costs 35 ft against 30 ft of movement,
  // so the first proposal walks 5 ft toward the target and stops with 25 ft left.
  // The hero starts at (2,5): from (2,4) the greedy pick walks the full 30 ft to
  // the distance-10 cell (5,2) via the north gap, leaving nothing for propose 2.
  // (Walls to y=4/y=5/y=6 all let propose 1 reach outright, via a diagonal gap
  // shortcut to (5,5) or (5,3) at 20-25 ft — verified against the real planner.)
  function shortWallCells(): Array<Array<Record<string, unknown>>> {
    const wall = {
      terrain: 'wall' as const,
      blocksMovement: true,
      blocksSight: true,
      cover: 3 as const,
      elevation: 0,
      decoration: 'short wall',
    };
    const floor = {
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    };
    return Array.from({ length: 11 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) =>
        x === 4 && y >= 1 && y <= 8 ? { ...wall } : { ...floor },
      ),
    );
  }

  // Round 1: the table fixture (the #1802 table) for the manual-move test. The
  // verdict's sketch says "propose, manual move, propose again -> it moves and
  // reaches", but that literal sequence is geometrically impossible in one turn:
  // propose 1 fails only when the shortest path to a reaching cell costs more than
  // the turn's 30 ft, and a manual move plus a re-approach share the 25 ft left
  // after propose 1 — so any route the re-approach could take, propose 1's
  // budget-limited planner would already have taken. (Triangle inequality on the
  // same graph and budget; the planner and the manual move both use findPath.)
  // What the manual move CAN prove is the clearing itself: the marker is gone the
  // moment the hero moves by hand, and the next proposal re-plans FRESH — it moves
  // along the detour instead of answering with the stale 0-ft repeat. The
  // target-move test below is the one where the re-approach actually reaches: the
  // target's move is free for the hero's budget, so it can open a route propose 1
  // never had.
  function tableCells(): Array<Array<Record<string, unknown>>> {
    const wall = {
      terrain: 'wall' as const,
      blocksMovement: true,
      blocksSight: true,
      cover: 3 as const,
      elevation: 0,
      decoration: 'long feast table',
    };
    const floor = {
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    };
    return Array.from({ length: 11 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) => (x === 4 && y <= 8 ? { ...wall } : { ...floor })),
    );
  }

  // Round 1 tests (below) carry an explicit 30 s timeout: each makes 2-3 real-route
  // calls, and one call takes ~1.3-2.9 s on a cold scratch DB under VM load, so the
  // slowest test crossed bun's 5 s default (and a timed-out test's `finally` never
  // ran, leaking its active map into the next test's fixture insert). Precedent:
  // roll-answer-dedupe / story-damage-sheet real-DB tests use 30_000 the same way.
  test('#1802 (round 1) a manual move clears the marker, so the next proposal re-plans fresh', async () => {
    await equip([], ['Longsword']);
    const mapId = crypto.randomUUID();
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width: 9,
        height: 11,
        cells: tableCells(),
        entities: [
          {
            id: heroId,
            x: 2,
            y: 4,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 6,
            y: 4,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 0,
            movementRemaining: 0,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 round 1 manual-move fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 5, distanceFeet: 15 },
      });
      const afterFirst = await readMap();
      const heroAfterFirst = afterFirst.entities.find((entity) => entity.id === heroId)!;
      // The greedy pick among the tied 15-ft cells is (3,3): getReachableMoves inserts
      // the (x+1, y-1) diagonal first (neighbours walk dy=-1 first).
      expect({ x: heroAfterFirst.x, y: heroAfterFirst.y }).toEqual({ x: 3, y: 3 });
      expect(heroAfterFirst.movementRemaining).toBe(25);
      expect(afterFirst.pendingDmFacts).toHaveLength(1);
      expect(afterFirst.pendingDmFacts![0]).toContain('could not reach');
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);

      // The player moves by hand along the wall, through the real route: the move
      // intent is unversioned, so no expectedVersion travels with it. 10 ft, leaving
      // 15 ft — and the marker is gone the moment the first step applies.
      const moved = await post({
        intent: { type: 'move', actorId: heroId, actionId: testId('move'), x: 3, y: 5 },
        origin: 'action_bar',
      });
      expect(moved.result).toMatchObject({ applied: true });
      const afterMove = await readMap();
      const heroAfterMove = afterMove.entities.find((entity) => entity.id === heroId)!;
      expect({ x: heroAfterMove.x, y: heroAfterMove.y }).toEqual({ x: 3, y: 5 });
      expect(heroAfterMove.movementRemaining).toBe(15);
      expect(afterMove.resolvedUnreachableApproaches ?? []).toEqual([]);
      expect(afterMove.pendingDmFacts).toHaveLength(2);

      // The next proposal re-plans from the new board instead of reusing the stale
      // resolution: with no marker it takes the #1057 fallback and walks the detour
      // as far as the remaining 15 ft reaches — 15 ft, not the stale 0. A second
      // fact lands (this is a fresh resolution), and the marker is re-written with
      // the movement actually spent.
      const second = await propose();
      expect(second.proposal).toMatchObject({
        movementOnly: true,
        result: {
          resolvedAs: 'movement_only',
          movedFeet: 15,
          distanceFeet: 20,
          from: { x: 3, y: 5 },
          to: { x: 3, y: 8 },
        },
      });
      const afterSecond = await readMap();
      const heroAfterSecond = afterSecond.entities.find((entity) => entity.id === heroId)!;
      expect({ x: heroAfterSecond.x, y: heroAfterSecond.y }).toEqual({ x: 3, y: 8 });
      expect(heroAfterSecond.movementRemaining).toBe(0);
      expect(afterSecond.pendingDmFacts).toHaveLength(3);
      expect(afterSecond.pendingDmFacts![2]).toContain('could not reach');
      expect(afterSecond.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 15 },
      ]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  }, 30_000);

  test('#1802 (round 1) a target that moves clears the marker, so the next proposal re-plans', async () => {
    await equip([], ['Longsword']);
    const mapId = crypto.randomUUID();
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width: 9,
        height: 11,
        cells: shortWallCells(),
        entities: [
          {
            id: heroId,
            x: 2,
            y: 5,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 6,
            y: 4,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 round 1 target-move fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 5, distanceFeet: 15 },
      });
      const afterFirst = await readMap();
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);

      // The target walks north to (5,0) — 20 ft — by hand (a monster move goes through
      // the same mutation gateway as a player move); the marker against it is stale
      // the moment it moves. The target's move costs the hero nothing, so this is the
      // case where the re-approach genuinely moves and reaches: from (3,4) the hero
      // closes to (4,0), adjacent to the target, in 20 ft.
      const moved = await applyTacticalMapAction(sessionId, {
        action: 'move',
        entityId: targetId,
        x: 5,
        y: 0,
        changes: null,
      });
      expect(moved.applied).toBe(true);
      const afterTargetMove = await readMap();
      expect(afterTargetMove.entities.find((entity) => entity.id === targetId)).toMatchObject({
        x: 5,
        y: 0,
      });
      expect(afterTargetMove.resolvedUnreachableApproaches ?? []).toEqual([]);
      expect(afterTargetMove.pendingDmFacts).toHaveLength(1);

      // The next proposal re-plans from the new board: it closes to (4,0), adjacent
      // to the target, and rolls — 20 ft of the 25 ft left, so 5 ft remains.
      const second = await propose();
      expect(second.proposal.movementOnly).toBe(false);
      const afterSecond = await readMap();
      const heroAfterSecond = afterSecond.entities.find((entity) => entity.id === heroId)!;
      expect({ x: heroAfterSecond.x, y: heroAfterSecond.y }).toEqual({ x: 4, y: 0 });
      expect(heroAfterSecond.movementRemaining).toBe(5);
      expect(afterSecond.pendingDmFacts).toHaveLength(1);
      expect(afterSecond.resolvedUnreachableApproaches ?? []).toEqual([]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  }, 30_000);

  test('#1802 (round 1) removing the target clears its markers', async () => {
    await equip([], ['Longsword']);
    const mapId = crypto.randomUUID();
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width: 9,
        height: 11,
        cells: shortWallCells(),
        entities: [
          {
            id: heroId,
            x: 2,
            y: 5,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 6,
            y: 4,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 0,
            movementRemaining: 0,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 round 1 target-remove fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 5, distanceFeet: 15 },
      });
      const afterFirst = await readMap();
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);

      // Removal is its own branch: the entity is gone, so every marker naming it
      // is void. This does NOT prove the death event — death leaves the entity on
      // the board, and the next test covers the real death hook (the HP service
      // clears markers when a participant dies).
      const removed = await applyTacticalMapAction(sessionId, {
        action: 'remove',
        entityId: targetId,
      });
      expect(removed.applied).toBe(true);
      const afterRemove = await readMap();
      expect(afterRemove.entities.some((entity) => entity.id === targetId)).toBe(false);
      expect(afterRemove.resolvedUnreachableApproaches ?? []).toEqual([]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  }, 30_000);

  test('#1802 (round 1) a target that dies clears its markers', async () => {
    await equip([], ['Longsword']);
    const mapId = crypto.randomUUID();
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width: 9,
        height: 11,
        cells: shortWallCells(),
        entities: [
          {
            id: heroId,
            x: 2,
            y: 5,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 6,
            y: 4,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 0,
            movementRemaining: 0,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 round 1 target-death fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 5, distanceFeet: 15 },
      });
      const afterFirst = await readMap();
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);

      // The kill goes through the HP service directly — it is the production death
      // path (every damage death flows through CombatHPService.applyDamage, and the
      // route's attack resolution calls it; the Dash test calls grantTacticalDash
      // the same way). 400 slashing is the dummy's full HP; the per-hit cap only
      // protects players, so a monster takes it whole and dies outright.
      const kill = await CombatHPService.applyDamage(
        targetId,
        encounterId,
        { damageAmount: 400, damageType: 'slashing', sourceParticipantId: heroId },
        userId,
      );
      expect(kill.isDead).toBe(true);
      const afterDeath = await readMap();
      expect(afterDeath.resolvedUnreachableApproaches ?? []).toEqual([]);

      // The next proposal re-plans from the new board instead of reusing the stale
      // resolution: with no marker it walks the north-gap detour as far as the
      // remaining 25 ft reaches — to (5,1), 15 ft from the corpse — and records a
      // second fact. The stale repeat would have answered movedFeet 0 from (3,4)
      // with still one fact. (The corpse is NOT reachable in 25 ft: the cheapest
      // detour to a cell adjacent to (6,4) costs 35 ft, so this propose is
      // movement-only again — what matters is that it re-planned and spent, not
      // that it reached. Attacking a corpse is the existing propose behaviour —
      // the dead-target exclusion lives in the action listing, #314 — and is out
      // of scope here.)
      const second = await propose();
      expect(second.proposal).toMatchObject({
        movementOnly: true,
        result: {
          resolvedAs: 'movement_only',
          movedFeet: 25,
          distanceFeet: 15,
          from: { x: 3, y: 4 },
          to: { x: 5, y: 1 },
        },
      });
      const afterSecond = await readMap();
      const heroAfterSecond = afterSecond.entities.find((entity) => entity.id === heroId)!;
      expect({ x: heroAfterSecond.x, y: heroAfterSecond.y }).toEqual({ x: 5, y: 1 });
      expect(heroAfterSecond.movementRemaining).toBe(0);
      expect(afterSecond.pendingDmFacts).toHaveLength(2);
      expect(afterSecond.pendingDmFacts![1]).toContain('could not reach');
      expect(afterSecond.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 25 },
      ]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  }, 30_000);

  test('#1802 (round 1) a commit after an out-of-reach proposal re-runs the approach as on main', async () => {
    await equip([], ['Longsword']);
    // The #1802 table fixture: the hero closes to 15 ft on the first proposal but cannot
    // reach the foe, and the detour around the table's end costs 45 ft against 30 ft of
    // movement. The commit does NOT read the marker — it re-runs the normal approach,
    // so it walks the remaining 25 ft and records the second fact, as main did before
    // the marker existed. Its own resolution still records a marker ({25} below).
    const mapId = crypto.randomUUID();
    const width = 9;
    const height = 11;
    const cells = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        if (x === 4 && y <= 8) {
          return {
            terrain: 'wall' as const,
            blocksMovement: true,
            blocksSight: true,
            cover: 3 as const,
            elevation: 0,
            decoration: 'long feast table',
          };
        }
        return {
          terrain: 'floor' as const,
          blocksMovement: false,
          blocksSight: false,
          cover: 0 as const,
          elevation: 0,
        };
      }),
    );
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width,
        height,
        cells,
        entities: [
          {
            id: heroId,
            x: 2,
            y: 4,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 6,
            y: 4,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 round 1 commit fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const { proposed, committed } = await attack(15);
      expect(proposed.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 5, distanceFeet: 15 },
      });
      // The commit result spreads the movement-only result (see exposeAttackVisibility):
      // it moved again with the remaining movement instead of reusing the marker.
      // The destination varies with propose 1's greedy tie-break — (3,8) from (3,3),
      // (3,9) from (3,4) — so only the spent movement and the second fact are pinned.
      expect(committed.result).toMatchObject({
        resolvedAs: 'movement_only',
        movedFeet: 25,
        movementRemainingFeet: 0,
      });
      const afterCommit = await readMap();
      const heroAfterCommit = afterCommit.entities.find((entity) => entity.id === heroId)!;
      expect({ x: heroAfterCommit.x, y: heroAfterCommit.y }).not.toEqual({ x: 2, y: 4 });
      expect(heroAfterCommit.movementRemaining).toBe(0);
      expect(afterCommit.pendingDmFacts).toHaveLength(2);
      expect(afterCommit.pendingDmFacts![1]).toContain('could not reach');
      expect(afterCommit.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 25 },
      ]);

      // A propose after the commit DOES reach the marker — and reuses the commit's
      // resolution. The commit resolved as movement-only, so it never claimed the
      // hero's action (no attack was rolled), and the third propose is a legal
      // proposal: it comes back movedFeet 0 from the hero's cell with still two
      // facts, where main (no markers) would have re-run the approach and appended
      // a third. That is the design (the commit is a resolution for the pair), now
      // pinned rather than assumed. The destination varies with propose 1's greedy
      // tie-break, so the cell itself is not pinned — only that nothing moved.
      const third = await post({
        phase: 'propose',
        intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
        origin: 'action_bar',
      });
      expect(third.proposal).toMatchObject({
        movementOnly: true,
        result: {
          resolvedAs: 'movement_only',
          movedFeet: 0,
          from: { x: heroAfterCommit.x, y: heroAfterCommit.y },
          to: { x: heroAfterCommit.x, y: heroAfterCommit.y },
        },
      });
      const afterThird = await readMap();
      const heroAfterThird = afterThird.entities.find((entity) => entity.id === heroId)!;
      expect({ x: heroAfterThird.x, y: heroAfterThird.y }).toEqual({
        x: heroAfterCommit.x,
        y: heroAfterCommit.y,
      });
      expect(heroAfterThird.movementRemaining).toBe(0);
      expect(afterThird.pendingDmFacts).toHaveLength(2);
      expect(afterThird.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 25 },
      ]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  }, 30_000);
});
