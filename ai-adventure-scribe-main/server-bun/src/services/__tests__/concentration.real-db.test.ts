/**
 * Server-side concentration (2014 5e, #621 Round 4), against a real Postgres.
 *
 * When a concentrating character takes damage via POST /v1/characters/:id/damage,
 * the server must force a CON save (DC max(10, half damage)); a failed save ends
 * concentration. These suites drive `applyNonAttackDamage` — the route's single
 * choke point for combat and out-of-combat damage — with a pinned d20, then read
 * `character_concentration` back directly.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  characterConcentration,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';

if (!hasRealDb) {
  console.warn('[concentration] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.');
}

import type * as ConcentrationService from '../combat/concentration-service.js';
import type * as NonAttackDamage from '../combat/non-attack-damage.js';

describeWithDb('concentration', () => {
  let applyNonAttackDamage: typeof NonAttackDamage.applyNonAttackDamage;
  let checkConcentrationOnDamage: typeof ConcentrationService.checkConcentrationOnDamage;
  let concentrationSaveDc: typeof ConcentrationService.concentrationSaveDc;
  let dropConcentration: typeof ConcentrationService.dropConcentration;
  let getConcentration: typeof ConcentrationService.getConcentration;
  let startConcentration: typeof ConcentrationService.startConcentration;

  beforeAll(async () => {
    ({ applyNonAttackDamage } = await import('../combat/non-attack-damage.js'));
    ({
      checkConcentrationOnDamage,
      concentrationSaveDc,
      dropConcentration,
      getConcentration,
      startConcentration,
    } = await import('../combat/concentration-service.js'));
  });

  describe('concentrationSaveDc', () => {
    it('is 10 when half damage is below 10', () => {
      expect(concentrationSaveDc(6)).toBe(10);
      expect(concentrationSaveDc(19)).toBe(10);
      expect(concentrationSaveDc(20)).toBe(10);
    });

    it('is half damage (rounded down) once that exceeds 10', () => {
      expect(concentrationSaveDc(21)).toBe(10);
      expect(concentrationSaveDc(22)).toBe(11);
      expect(concentrationSaveDc(30)).toBe(15);
      expect(concentrationSaveDc(45)).toBe(22);
    });
  });

  describe('concentration breaks on damage', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('user');

  let characterId: string;
  let combatCharacterId: string;
  // CON 14 -> +2 modifier.
  const CON_MOD = 2;
  const MAX_HP = 40;

  async function makeCaster(name: string): Promise<string> {
    const [{ id }] = await db
      .insert(characters)
      .values({ userId, name: testId(name), level: 5 })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: id,
      constitution: 14,
      maxHitPoints: MAX_HP,
      currentHitPoints: MAX_HP,
      temporaryHitPoints: 0,
    });
    return id;
  }

  beforeAll(async () => {
    characterId = await makeCaster('caster');
    combatCharacterId = await makeCaster('caster-combat');

    const [session] = await db
      .insert(gameSessions)
      .values({ characterId: combatCharacterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    const [encounter] = await db
      .insert(combatEncounters)
      .values({
        sessionId: session.id,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning({ id: combatEncounters.id });

    const [participant] = await db
      .insert(combatParticipants)
      .values({
        encounterId: encounter.id,
        characterId: combatCharacterId,
        name: 'Caster',
        participantType: 'player',
        turnOrder: 0,
        initiative: 15,
        maxHp: MAX_HP,
      })
      .returning({ id: combatParticipants.id });

    await db.insert(combatParticipantStatus).values({
      participantId: participant.id,
      currentHp: MAX_HP,
      maxHp: MAX_HP,
      isConscious: true,
    });
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, characterId));
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, combatCharacterId));
    for (const id of [characterId, combatCharacterId]) {
      await db
        .update(characterStats)
        .set({ currentHitPoints: MAX_HP, temporaryHitPoints: 0 })
        .where(eq(characterStats.characterId, id));
    }
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('(a) a successful CON save keeps concentration', async () => {
    await startConcentration(characterId, { name: 'Bless' });

    // 8 damage -> DC max(10, 4) = 10. Roll 20 + 2 = 22 beats it.
    const result = await applyNonAttackDamage(characterId, userId, 8, 'test blow', {
      concentrationRoll: () => 20,
    });

    expect(result.concentration?.hadConcentration).toBe(true);
    expect(result.concentration?.saveTriggered).toBe(true);
    expect(result.concentration?.dc).toBe(10);
    expect(result.concentration?.total).toBe(20 + CON_MOD);
    expect(result.concentration?.success).toBe(true);
    expect(result.concentration?.dropped).toBe(false);
    expect(await getConcentration(characterId)).not.toBeNull();
  });

  it('a successful save writes a maintained-concentration engine line', async () => {
    await startConcentration(characterId, { name: 'Bless' });

    const result = await applyNonAttackDamage(characterId, userId, 8, 'test blow', {
      concentrationRoll: () => 20,
    });

    expect(result.engineLines).toContainEqual(
      expect.stringContaining('maintains concentration on Bless'),
    );
  });

  it('(b) a failed CON save drops concentration and writes the engine line', async () => {
    await startConcentration(characterId, { name: 'Bless' });

    // 30 damage -> DC max(10, 15) = 15. Roll 1 + 2 = 3 fails.
    const result = await applyNonAttackDamage(characterId, userId, 30, 'test blow', {
      concentrationRoll: () => 1,
    });

    expect(result.concentration?.saveTriggered).toBe(true);
    expect(result.concentration?.dc).toBe(15);
    expect(result.concentration?.success).toBe(false);
    expect(result.concentration?.dropped).toBe(true);
    expect(result.concentration?.droppedSpell).toBe('Bless');
    expect(await getConcentration(characterId)).toBeNull();
    expect(result.engineLines).toContainEqual(expect.stringContaining('concentration'));
  });

  it('no damage taken means no save and concentration is kept', async () => {
    await startConcentration(characterId, { name: 'Bless' });

    const result = await applyNonAttackDamage(characterId, userId, 0, 'test blow', {
      concentrationRoll: () => 1,
    });

    expect(result.concentration?.hadConcentration).toBe(true);
    expect(result.concentration?.saveTriggered).toBe(false);
    expect(await getConcentration(characterId)).not.toBeNull();
  });

  it('starting a new concentration replaces the old one (one spell at a time)', async () => {
    await startConcentration(characterId, { name: 'Bless' });
    await startConcentration(characterId, { name: 'Hold Person' });

    const current = await getConcentration(characterId);
    expect(current?.spellName).toBe('Hold Person');
  });

  it('checkConcentrationOnDamage reports cleanly when nobody is concentrating', async () => {
    const result = await checkConcentrationOnDamage(characterId, 30, {
      rollD20Fn: () => 1,
    });
    expect(result.hadConcentration).toBe(false);
    expect(result.saveTriggered).toBe(false);
  });

  it('dropConcentration returns null when there is nothing to drop', async () => {
    expect(await dropConcentration(characterId)).toBeNull();
  });

  it('dropping to 0 HP ends concentration without a save', async () => {
    await startConcentration(characterId, { name: 'Bless' });

    // 100 damage drops the 40-HP caster to 0. Even a natural 20 cannot keep
    // concentration while unconscious — 2014 PHB.
    const result = await applyNonAttackDamage(characterId, userId, 100, 'test blow', {
      concentrationRoll: () => 20,
    });

    expect(result.concentration?.hadConcentration).toBe(true);
    expect(result.concentration?.saveTriggered).toBe(false);
    expect(result.concentration?.dropped).toBe(true);
    expect(result.concentration?.incapacitated).toBe(true);
    expect(await getConcentration(characterId)).toBeNull();
    expect(result.engineLines).toContainEqual(expect.stringContaining('concentration'));
  });

  it('a failed save on the combat branch drops concentration', async () => {
    await startConcentration(combatCharacterId, { name: 'Bless' });

    // Live encounter -> CombatHPService path. 30 damage -> DC 15, roll 1 + 2 fails.
    const result = await applyNonAttackDamage(combatCharacterId, userId, 30, 'test blow', {
      concentrationRoll: () => 1,
    });

    expect(result.concentration?.saveTriggered).toBe(true);
    expect(result.concentration?.dropped).toBe(true);
    expect(await getConcentration(combatCharacterId)).toBeNull();
    expect(result.engineLines).toContainEqual(expect.stringContaining('concentration'));
  });
});
});
