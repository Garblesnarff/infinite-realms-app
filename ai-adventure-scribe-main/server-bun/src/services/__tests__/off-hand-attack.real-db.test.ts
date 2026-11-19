/**
 * The off-hand attack of Two-Weapon Fighting (#1639), against a real Postgres.
 *
 * Rules under test (2014 SRD 5.1): after the Attack action with a light melee weapon, a bonus action
 * attacks with a different light melee weapon. Its damage takes no ability modifier unless that
 * modifier is negative. The engine refuses it before any roll when the Attack action came first is
 * missing, the weapon is not light, the weapon is the same one, or the bonus action is spent.
 *
 * The attack path is the production `executeCombatIntent`. The RNG is seeded. No suite here calls the
 * live DM. Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
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
} from '../../../../db/schema/index';
import { setRngSeed } from '../../lib/rng.js';

const { SessionService } = await importWithRealDb(() => import('../session-service.js'));
const { readLightAttackMark } = await importWithRealDb(
  () => import('../combat/combat-turn-flags.js'),
);
const { clearAttackBudget } = await importWithRealDb(
  () => import('../combat/attack-budget-service.js'),
);
const { combatAttackService, executeCombatIntent, getLegalCombatActions } = await importWithRealDb(
  async () => ({
    combatAttackService: (await import('../combat/combat-attack-service.js')).combatAttackService,
    executeCombatIntent: (await import('../combat/combat-intent-service.js')).executeCombatIntent,
    getLegalCombatActions: (await import('../combat/combat-intent-service.js'))
      .getLegalCombatActions,
  }),
);

if (!hasRealDb) {
  console.warn('[off-hand-attack] SKIPPED: set TEST_DATABASE_URL to run these.');
}

/** Armor Class 1, so the seeded attacks hit; only a natural 1 would miss. */
const SEED = 4242;

describeWithDb('Off-hand attack, Two-Weapon Fighting (#1639)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('off-hand-user');

  let campaignId: string;
  let fighterCharacterId: string;
  let allyCharacterId: string;
  let sessionId: string;
  let encounterId: string;
  let fighterId: string;
  let allyId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('off-hand-camp') })
      .returning({ id: campaigns.id });

    [{ id: fighterCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('two-weapon-fighter'),
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
    // Two light melee weapons, one in each hand, and a heavy one for the "not light" refusal.
    await db.insert(inventoryItems).values([
      { characterId: fighterCharacterId, name: 'Shortsword', itemType: 'weapon', isEquipped: true },
      { characterId: fighterCharacterId, name: 'Dagger', itemType: 'weapon', isEquipped: true },
      { characterId: fighterCharacterId, name: 'Longsword', itemType: 'weapon', isEquipped: true },
    ]);

    [{ id: allyCharacterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('off-hand-ally'), level: 1, class: 'Fighter' })
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

  /** A fresh turn for the Fighter: round 1, no marks, no spent action or bonus action, full HP. */
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
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 500, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, allyId));
  };

  const versionNow = async (): Promise<number> => {
    const [row] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row!.version;
  };

  const bonusActionUsed = async (): Promise<boolean> => {
    const [row] = await db
      .select({ used: combatParticipants.bonusActionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, fighterId));
    return row!.used;
  };

  /** The Attack action with one weapon, through the production attack resolver. */
  const attackAction = async (weaponId: string, seed = SEED) => {
    setRngSeed(seed);
    return combatAttackService!.resolveAttack(
      encounterId,
      {
        attackerId: fighterId,
        targetId: allyId,
        weaponId,
        attackType: 'melee',
        expectedVersion: await versionNow(),
      },
      userId,
    );
  };

  /** The off-hand swing, through the production intent executor, as the action bar sends it. */
  const offHandIntent = async (weaponId: string, seed = SEED) => {
    setRngSeed(seed);
    return executeCombatIntent(
      encounterId,
      {
        type: 'attack',
        actorId: fighterId,
        targetId: allyId,
        weaponId,
        offHand: true,
        expectedVersion: await versionNow(),
      },
      userId,
      'player',
    );
  };

  const weaponIdOf = async (name: string): Promise<string> => {
    const { listEquippedWeaponProfiles } = await importWithRealDb(
      () => import('../combat/data-access.js'),
    );
    const profiles = await listEquippedWeaponProfiles({ characterId: fighterCharacterId });
    return profiles.find((profile) => profile.name === name)!.id;
  };

  it('spends the bonus action and takes no positive ability modifier on the off-hand damage', async () => {
    await freshTurn();
    const shortsword = await weaponIdOf('Shortsword');
    const dagger = await weaponIdOf('Dagger');
    await attackAction(shortsword);
    const off = await offHandIntent(dagger);
    expect(await bonusActionUsed()).toBe(true);

    // Strength 16 is +3. The same seed on the same dagger as a plain Attack action carries the +3;
    // the off-hand swing must not, so its damage is three less before resistances.
    await freshTurn();
    const plain = await attackAction(dagger);
    const offDamage = Number(
      (off as { damageBeforeResistances?: number }).damageBeforeResistances ??
        (off as { result?: { damageBeforeResistances?: number } }).result?.damageBeforeResistances,
    );
    expect(offDamage).toBe(Number(plain.damageBeforeResistances) - 3);
  });

  it('names the off-hand weapon in the engine record of the swing', async () => {
    await freshTurn();
    const shortsword = await weaponIdOf('Shortsword');
    const dagger = await weaponIdOf('Dagger');
    await attackAction(shortsword);
    const off = await offHandIntent(dagger);
    expect(JSON.stringify(off)).toContain('Dagger');
    expect(JSON.stringify(off)).not.toContain('Shortsword');
  });

  it('refuses the off-hand swing before the Attack action, and spends nothing', async () => {
    await freshTurn();
    const dagger = await weaponIdOf('Dagger');
    await expect(offHandIntent(dagger)).rejects.toMatchObject({
      details: { reason: 'no_attack_action' },
    });
    expect(await bonusActionUsed()).toBe(false);
  });

  it('refuses an off-hand weapon that is not light', async () => {
    await freshTurn();
    const shortsword = await weaponIdOf('Shortsword');
    const longsword = await weaponIdOf('Longsword');
    await attackAction(shortsword);
    await expect(offHandIntent(longsword)).rejects.toMatchObject({
      details: { reason: 'not_light' },
    });
    expect(await bonusActionUsed()).toBe(false);
  });

  it('refuses the same weapon that took the Attack action', async () => {
    await freshTurn();
    const shortsword = await weaponIdOf('Shortsword');
    await attackAction(shortsword);
    await expect(offHandIntent(shortsword)).rejects.toMatchObject({
      details: { reason: 'same_weapon' },
    });
    expect(await bonusActionUsed()).toBe(false);
  });

  it('refuses a second off-hand swing once the bonus action is spent', async () => {
    await freshTurn();
    const shortsword = await weaponIdOf('Shortsword');
    const dagger = await weaponIdOf('Dagger');
    await attackAction(shortsword);
    await offHandIntent(dagger);
    await expect(offHandIntent(dagger)).rejects.toThrow('Bonus action already used this turn');
  });

  it('takes the body the action bar sends: a DM-sourced swing with no version', async () => {
    await freshTurn();
    const shortsword = await weaponIdOf('Shortsword');
    const dagger = await weaponIdOf('Dagger');
    await attackAction(shortsword);
    setRngSeed(SEED);
    const off = await executeCombatIntent(
      encounterId,
      {
        type: 'attack',
        actorId: fighterId,
        targetId: allyId,
        weaponId: dagger,
        offHand: true,
      } as never,
      userId,
      'dm',
    );
    expect(await bonusActionUsed()).toBe(true);
    expect(JSON.stringify(off)).toContain('Dagger');
  });

  it('offers the off-hand chip only after the Attack action, and not once the bonus action is spent', async () => {
    await freshTurn();
    const shortsword = await weaponIdOf('Shortsword');
    const dagger = await weaponIdOf('Dagger');
    const offered = async () =>
      (
        (await getLegalCombatActions(encounterId, userId)) as {
          actions: Array<{ type: string; weaponId?: string; targetIds?: string[] }>;
        }
      ).actions.filter((action) => action.type === 'off_hand_attack');
    expect(await offered()).toEqual([]);
    await attackAction(shortsword);
    const chips = await offered();
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ weaponId: dagger, targetIds: [allyId] });
    await offHandIntent(dagger);
    expect(await offered()).toEqual([]);
  });

  describe('a row of two copies is two weapons (#1639)', () => {
    /** Replaces the fighter's equipped weapon rows and returns the new row ids, in order. */
    const setInventory = async (rows: Array<{ name: string; quantity: number }>) => {
      await db.delete(inventoryItems).where(eq(inventoryItems.characterId, fighterCharacterId));
      return db
        .insert(inventoryItems)
        .values(
          rows.map((row) => ({
            characterId: fighterCharacterId,
            name: row.name,
            itemType: 'weapon',
            isEquipped: true,
            quantity: row.quantity,
          })),
        )
        .returning({ id: inventoryItems.id });
    };

    afterEach(async () => {
      // Put back the fixture the other tests in this file read by name.
      await setInventory([
        { name: 'Shortsword', quantity: 1 },
        { name: 'Dagger', quantity: 1 },
        { name: 'Longsword', quantity: 1 },
      ]);
    });

    it('two rows of one shortsword: the second row is the off-hand weapon', async () => {
      const [first, second] = await setInventory([
        { name: 'Shortsword', quantity: 1 },
        { name: 'Shortsword', quantity: 1 },
      ]);
      await freshTurn();
      await attackAction(first.id);
      await offHandIntent(second.id);
      expect(await bonusActionUsed()).toBe(true);
    });

    it('one row of two shortswords: the second copy is the off-hand weapon', async () => {
      const [row] = await setInventory([{ name: 'Shortsword', quantity: 2 }]);
      await freshTurn();
      await attackAction(row.id);
      await offHandIntent(row.id);
      expect(await bonusActionUsed()).toBe(true);
    });

    it('a single shortsword cannot be both weapons', async () => {
      const [row] = await setInventory([{ name: 'Shortsword', quantity: 1 }]);
      await freshTurn();
      await attackAction(row.id);
      await expect(offHandIntent(row.id)).rejects.toMatchObject({
        details: { reason: 'same_weapon' },
      });
      expect(await bonusActionUsed()).toBe(false);
    });
  });

  describe('client writes cannot touch the light-attack mark (#1639)', () => {
    const update = (sessionState: Record<string, unknown>) =>
      SessionService!.updateSession(sessionId, userId, { sessionState } as never);

    it('a client whole-blob write that omits the mark keeps it', async () => {
      await freshTurn();
      const shortsword = await weaponIdOf('Shortsword');
      await attackAction(shortsword);
      await update({ notes: 'client snapshot' });
      expect(await readLightAttackMark(encounterId, fighterId)).toBe(shortsword);
    });

    it('a client write that empties the bucket cannot clear the mark', async () => {
      await freshTurn();
      const shortsword = await weaponIdOf('Shortsword');
      await attackAction(shortsword);
      await update({ lightAttack: {} });
      expect(await readLightAttackMark(encounterId, fighterId)).toBe(shortsword);
    });

    it('a client write cannot set a mark the engine did not write', async () => {
      await freshTurn();
      const dagger = await weaponIdOf('Dagger');
      await update({
        lightAttack: { [fighterId]: { encounterId, turn: '1:0', weaponId: dagger } },
      });
      expect(await readLightAttackMark(encounterId, fighterId)).toBeNull();
    });
  });
});
