/** Reckless Attack lifecycle and refusals against real PostgreSQL; no live DM. */
import { afterAll, afterEach, beforeAll, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

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

const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { isReckless } = await importWithRealDb(() => import('../combat/combat-turn-flags.js'));
const { CombatInitiativeService } = await importWithRealDb(
  () => import('../combat-initiative-service.js'),
);
const { getLegalCombatActions, proposeCombatAttack, executeCombatIntent } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);
const { saveTacticalMap, loadActiveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);

if (!hasRealDb) {
  console.warn('[reckless-attack] SKIPPED: set TEST_DATABASE_URL to run these.');
}

describeWithDb('Reckless Attack on real combat state (#1635)', () => {
  afterEach(() => setRngSeed(undefined));
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('rage-attack-user');

  let campaignId: string;
  let barbarianCharacterId: string;
  let allyCharacterId: string;
  let sessionId: string;
  let encounterId: string;
  let barbarianId: string;
  let allyId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('rage-attack-camp') })
      .returning({ id: campaigns.id });

    [{ id: barbarianCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('barbarian'),
        level: 5,
        class: 'Barbarian',
        classLevels: [{ className: 'Barbarian', level: 5 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: barbarianCharacterId,
      strength: 16,
      dexterity: 12,
      charisma: 10,
      armorClass: 14,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });
    await db.insert(inventoryItems).values([
      {
        characterId: barbarianCharacterId,
        name: 'Longsword',
        itemType: 'weapon',
        isEquipped: true,
      },
      { characterId: barbarianCharacterId, name: 'Dagger', itemType: 'weapon', isEquipped: true },
      { characterId: barbarianCharacterId, name: 'Shortbow', itemType: 'weapon', isEquipped: true },
    ]);

    [{ id: allyCharacterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('ally'), level: 1, class: 'Fighter' })
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
      .values({ campaignId, characterId: barbarianCharacterId, sessionNumber: 1, status: 'active' })
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
          characterId: barbarianCharacterId,
          name: 'The Barbarian',
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
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 500,
          speed: 30,
          // A racial resistance the Rage merge must keep.
          damageResistances: ['fire'],
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    barbarianId = inserted.find((row) => row.turnOrder === 0)!.id;
    allyId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: barbarianId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: allyId, currentHp: 500, maxHp: 500, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, barbarianCharacterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, barbarianCharacterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, allyCharacterId));
    await db.delete(characters).where(eq(characters.id, barbarianCharacterId));
    await db.delete(characters).where(eq(characters.id, allyCharacterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  /** Clears the fight back to round 1, the Barbarian's turn, no marks, and full hit points. */
  const resetFight = async (): Promise<void> => {
    await db
      .update(combatEncounters)
      .set({ currentRound: 1, currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, encounterId));
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 500, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, allyId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 30, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, barbarianId));
  };

  const version = async (): Promise<number> =>
    (
      await db
        .select({ version: combatEncounters.version })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, encounterId))
    )[0].version;
  const input = async (changes: Record<string, unknown> = {}) => ({
    attackerId: barbarianId,
    targetId: allyId,
    attackType: 'melee' as const,
    weaponId: 'Longsword',
    expectedVersion: await version(),
    ...changes,
  });

  it('grants advantage on the reckless attack and the next Strength melee attack', async () => {
    await resetFight();
    setRngSeed(4242);
    const first = await combatAttackService!.resolveAttack(
      encounterId,
      await input({ reckless: true }),
      userId,
    );
    expect(first.advantage).toBe(true);
    expect(first.d20Rolls).toHaveLength(2);
    const second = await combatAttackService!.resolveAttack(encounterId, await input(), userId);
    expect(second.advantage).toBe(true);
    expect(second.d20Rolls).toHaveLength(2);
    expect(await isReckless(encounterId, barbarianId)).toBe(true);
    setRngSeed(undefined);
  });

  it('grants attacks against the Barbarian advantage until their next turn', async () => {
    await resetFight();
    await combatAttackService!.resolveAttack(
      encounterId,
      await input({ reckless: true, providedD20: 10 }),
      userId,
    );
    await CombatInitiativeService!.advanceTurn(encounterId, userId);
    const foeAttack = {
      attackerId: allyId,
      targetId: barbarianId,
      attackType: 'melee' as const,
      expectedVersion: await version(),
    };
    const before = await combatAttackService!.proposeAttack(encounterId, foeAttack, userId);
    expect(before.advantage).toBe(true);
    expect(before.advantageSources).toContain('target used Reckless Attack');
    const beforeHit = await combatAttackService!.resolveAttack(encounterId, foeAttack, userId);
    expect(beforeHit.advantage).toBe(true);
    await CombatInitiativeService!.advanceTurn(encounterId, userId);
    expect(await isReckless(encounterId, barbarianId)).toBe(false);
    const after = await combatAttackService!.proposeAttack(
      encounterId,
      { ...foeAttack, isReaction: true },
      userId,
    );
    expect(after.advantageSources).not.toContain('target used Reckless Attack');
    expect(after.advantage).toBe(false);
    const afterHit = await combatAttackService!.resolveAttack(
      encounterId,
      { ...foeAttack, expectedVersion: await version(), isReaction: true },
      userId,
    );
    expect(afterHit.advantage).toBe(false);
  });

  it('grants advantage to a spell attack against a reckless Barbarian', async () => {
    await resetFight();
    await db
      .update(characters)
      .set({ knownSpells: 'Eldritch Blast' })
      .where(eq(characters.id, allyCharacterId));
    try {
      await combatAttackService!.resolveAttack(
        encounterId,
        await input({ reckless: true, providedD20: 10 }),
        userId,
      );
      await CombatInitiativeService!.advanceTurn(encounterId, userId);
      const spell = {
        casterId: allyId,
        targetIds: [barbarianId],
        spellId: 'eldritch-blast',
        spellName: 'Eldritch Blast',
        expectedVersion: await version(),
      };
      const proposal = await combatAttackService!.proposeSpellAttack(encounterId, spell, userId);
      expect(proposal.advantage).toBe(true);
      expect(proposal.advantageSources).toContain('target used Reckless Attack');
      const result = await combatAttackService!.resolveSpellAttack(encounterId, spell, userId);
      expect(result.results[0].advantage).toBe(true);
    } finally {
      await db
        .update(characters)
        .set({ knownSpells: null })
        .where(eq(characters.id, allyCharacterId));
    }
  });

  it('counts a spell attack as the first attack of the turn', async () => {
    await resetFight();
    await db
      .update(characters)
      .set({ knownSpells: 'Eldritch Blast' })
      .where(eq(characters.id, barbarianCharacterId));
    try {
      await combatAttackService!.resolveSpellAttack(
        encounterId,
        {
          casterId: barbarianId,
          targetIds: [allyId],
          spellId: 'eldritch-blast',
          spellName: 'Eldritch Blast',
          expectedVersion: await version(),
          d20: 10,
        },
        userId,
      );
      await expect(
        combatAttackService!.proposeAttack(encounterId, await input({ reckless: true }), userId),
      ).rejects.toThrow('first attack of the turn');
    } finally {
      await db
        .update(characters)
        .set({ knownSpells: null })
        .where(eq(characters.id, barbarianCharacterId));
    }
  });

  it('offers the reckless attack option only before the first attack', async () => {
    await resetFight();
    const before = await getLegalCombatActions(encounterId, userId);
    expect(before.actions.some((action) => action.type === 'reckless_attack')).toBe(true);
    await combatAttackService!.resolveAttack(encounterId, await input({ providedD20: 10 }), userId);
    const after = await getLegalCombatActions(encounterId, userId);
    expect(after.actions.some((action) => action.type === 'reckless_attack')).toBe(false);
  });

  it('refuses a non-Barbarian', async () => {
    await resetFight();
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 1 })
      .where(eq(combatEncounters.id, encounterId));
    await expect(
      combatAttackService!.proposeAttack(
        encounterId,
        {
          attackerId: allyId,
          targetId: barbarianId,
          attackType: 'melee',
          expectedVersion: await version(),
          reckless: true,
        },
        userId,
      ),
    ).rejects.toThrow('requires the Barbarian class');
  });

  it('refuses an ineligible out-of-reach declaration before proposal or commit moves', async () => {
    await resetFight();
    await db
      .update(characters)
      .set({ level: 1, classLevels: [{ className: 'Barbarian', level: 1 }] })
      .where(eq(characters.id, barbarianCharacterId));
    await saveTacticalMap({
      id: crypto.randomUUID(),
      sessionId,
      width: 7,
      height: 3,
      cells: Array.from({ length: 3 }, () =>
        Array.from({ length: 7 }, () => ({
          terrain: 'floor' as const,
          blocksMovement: false,
          blocksSight: false,
          cover: 0 as const,
          elevation: 0,
        })),
      ),
      entities: [
        {
          id: barbarianId,
          x: 0,
          y: 1,
          size: 'medium' as const,
          type: 'pc' as const,
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: allyId,
          x: 5,
          y: 1,
          size: 'medium' as const,
          type: 'monster' as const,
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 1,
      sceneDescription: 'reckless approach fixture',
    });
    const intent = {
      type: 'attack' as const,
      actorId: barbarianId,
      targetId: allyId,
      weaponId: 'Longsword',
      reckless: true,
      expectedVersion: await version(),
    };
    try {
      await expect(proposeCombatAttack(encounterId, intent, userId, 'player')).rejects.toThrow(
        'requires Barbarian level 2',
      );
      await expect(
        executeCombatIntent(encounterId, intent, userId, 'player', undefined, 'action_bar'),
      ).rejects.toThrow('requires Barbarian level 2');
      const map = await loadActiveTacticalMap(sessionId);
      expect(map?.entities.find((entity) => entity.id === barbarianId)).toMatchObject({
        x: 0,
        y: 1,
        movementRemaining: 30,
      });
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
      await db
        .update(characters)
        .set({ level: 5, classLevels: [{ className: 'Barbarian', level: 5 }] })
        .where(eq(characters.id, barbarianCharacterId));
    }
  });

  it('refuses a Barbarian below level 2', async () => {
    await resetFight();
    await db
      .update(characters)
      .set({ level: 1, classLevels: [{ className: 'Barbarian', level: 1 }] })
      .where(eq(characters.id, barbarianCharacterId));
    try {
      await expect(
        combatAttackService!.proposeAttack(encounterId, await input({ reckless: true }), userId),
      ).rejects.toThrow('requires Barbarian level 2');
    } finally {
      await db
        .update(characters)
        .set({ level: 5, classLevels: [{ className: 'Barbarian', level: 5 }] })
        .where(eq(characters.id, barbarianCharacterId));
    }
  });

  it('refuses a ranged weapon attack', async () => {
    await resetFight();
    await expect(
      combatAttackService!.proposeAttack(
        encounterId,
        await input({ reckless: true, weaponId: 'Shortbow', attackType: 'ranged' }),
        userId,
      ),
    ).rejects.toThrow('requires a melee weapon attack');
  });

  it('refuses a finesse attack using Dexterity', async () => {
    await resetFight();
    await db
      .update(characterStats)
      .set({ dexterity: 18 })
      .where(eq(characterStats.characterId, barbarianCharacterId));
    try {
      await expect(
        combatAttackService!.proposeAttack(
          encounterId,
          await input({ reckless: true, weaponId: 'Dagger' }),
          userId,
        ),
      ).rejects.toThrow('requires an attack using Strength');
    } finally {
      await db
        .update(characterStats)
        .set({ dexterity: 12 })
        .where(eq(characterStats.characterId, barbarianCharacterId));
    }
  });

  it('refuses a declaration after the first attack', async () => {
    await resetFight();
    await combatAttackService!.resolveAttack(encounterId, await input({ providedD20: 10 }), userId);
    await expect(
      combatAttackService!.proposeAttack(encounterId, await input({ reckless: true }), userId),
    ).rejects.toThrow('first attack of the turn');
  });
});
