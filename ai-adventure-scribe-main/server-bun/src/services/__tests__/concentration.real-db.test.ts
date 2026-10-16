/* eslint-disable max-lines -- service-level and live-route suites share the concentration fixtures; splitting would rebuild them in each file. */
/**
 * Server-side concentration (2014 5e, #621 Round 4), against a real Postgres.
 *
 * When a concentrating character takes damage via POST /v1/characters/:id/damage,
 * the server must force a CON save (DC max(10, half damage)); a failed save ends
 * concentration. The service-level suites drive `applyNonAttackDamage` — the
 * route's single choke point for combat and out-of-combat damage — with a pinned
 * d20, then read `character_concentration` back directly. The live-route suite
 * posts through the real Elysia route (only auth faked) with the d20 pinned via
 * Math.random, the route path's only RNG consumer.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
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

// Live-route tests below post through the real Elysia route with a real DB.
// Only authentication is faked (a `Bearer <liveUserId>` is that user), the way
// playthrough-scope.real-db.test.ts does it; the route, applyNonAttackDamage,
// and the concentration service are all real.
const LIVE_USER_PREFIX = 'conc-live-route-user-';
const liveUserId = `${LIVE_USER_PREFIX}${process.pid}`;

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/, '');
    return token && token.startsWith(LIVE_USER_PREFIX)
      ? { user: { userId: token, email: 'player@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

import type * as ConcentrationService from '../combat/concentration-service.js';
import type * as NonAttackDamage from '../combat/non-attack-damage.js';
import type * as StorySpellSlots from '../dm/story-spell-slots.js';

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

describe('live route: POST /v1/characters/:id/damage forces the CON save (#621 Round 5)', () => {
  // The strategist's live-route requirement: the concentration save must be
  // exercised through the real HTTP route, not around it. The route handler
  // and applyNonAttackDamage are NOT mocked here (unlike
  // character-damage-http.test.ts, which mocks applyNonAttackDamage); only
  // auth is faked, per the file header. The d20 is pinned by stubbing
  // Math.random around the request. A full-path grep of server-bun/src shows
  // the damage route path's only RNG consumer is the concentration save's
  // rollD20() (Math.floor(Math.random() * 20) + 1): character-vitals-service
  // and CombatHPService.applyDamage roll nothing; the combat-hp death-save
  // roll is unreachable here (no live participant); the pipeline uses
  // crypto.randomUUID, not Math.random.
  // Fresh client per run: the fixture's shared client is closed by the
  // earlier describe's afterAll, so a describe-body capture would be dead.
  let db: ReturnType<typeof realDb>;
  const MAX_HP = 40;

  let app: { handle: (request: Request) => Response | Promise<Response> };
  let liveCharacterId: string;

  async function postDamageWithRoll(
    amount: number,
    randomValue: number,
    extraBody: Record<string, unknown> = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const realRandom = Math.random;
    Math.random = () => randomValue;
    try {
      const response = await app.handle(
        new Request(`http://localhost/v1/characters/${liveCharacterId}/damage`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${liveUserId}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ amount, ...extraBody }),
        }),
      );
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    } finally {
      Math.random = realRandom;
    }
  }

  async function resetLiveCaster(): Promise<void> {
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, liveCharacterId));
    await db
      .update(characterStats)
      .set({ currentHitPoints: MAX_HP, temporaryHitPoints: 0 })
      .where(eq(characterStats.characterId, liveCharacterId));
  }

  beforeAll(async () => {
    db = realDb();
    const { createRequestPipelineApp } = await import('../../http-pipeline.js');
    const { charactersRoutes } = await import('../../routes/v1/characters.js');
    app = createRequestPipelineApp().use(charactersRoutes);

    const [{ id }] = await db
      .insert(characters)
      .values({ userId: liveUserId, name: testId('live-caster'), level: 5 })
      .returning({ id: characters.id });
    liveCharacterId = id;
    await db.insert(characterStats).values({
      characterId: id,
      constitution: 14,
      maxHitPoints: MAX_HP,
      currentHitPoints: MAX_HP,
      temporaryHitPoints: 0,
    });
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await resetLiveCaster();
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('a failed CON save through the live route drops concentration', async () => {
    await startConcentration(liveCharacterId, { name: 'Bless' });
    expect(await getConcentration(liveCharacterId)).not.toBeNull();

    // 30 damage -> DC max(10, 15) = 15. d20 pinned to 1: 1 + 2 = 3 fails.
    const { status, json } = await postDamageWithRoll(30, 0);

    expect(status).toBe(200);
    expect(json.currentHitPoints).toBe(MAX_HP - 30);
    expect(json.engineLines).toContainEqual(
      expect.stringContaining('loses concentration on Bless'),
    );
    expect(await getConcentration(liveCharacterId)).toBeNull();
  });

  it('a successful CON save through the live route maintains concentration and reports the DC', async () => {
    await startConcentration(liveCharacterId, { name: 'Bless' });
    expect(await getConcentration(liveCharacterId)).not.toBeNull();

    // 30 damage -> DC 15. d20 pinned to 20: 20 + 2 = 22 succeeds.
    const { status, json } = await postDamageWithRoll(30, 0.99999);

    expect(status).toBe(200);
    expect(json.engineLines).toContainEqual(
      expect.stringContaining('maintains concentration on Bless (CON save 22 vs DC 15)'),
    );
    expect(await getConcentration(liveCharacterId)).not.toBeNull();
  });

  it('the forced save uses DC max(10, half damage): same die, different damage, different outcome', async () => {
    // d20 pinned to 12 -> total 12 + 2 = 14. Against 30 damage (DC 15) the
    // save fails; against 19 damage (DC 10) it succeeds. This pins the DC
    // formula through the route without reading the DC out of band.
    await startConcentration(liveCharacterId, { name: 'Bless' });
    expect(await getConcentration(liveCharacterId)).not.toBeNull();
    const failed = await postDamageWithRoll(30, 0.55);
    expect(failed.status).toBe(200);
    expect(await getConcentration(liveCharacterId)).toBeNull();

    await resetLiveCaster();
    await startConcentration(liveCharacterId, { name: 'Bless' });
    expect(await getConcentration(liveCharacterId)).not.toBeNull();
    const kept = await postDamageWithRoll(19, 0.55);
    expect(kept.status).toBe(200);
    expect(kept.json.engineLines).toContainEqual(
      expect.stringContaining('maintains concentration on Bless (CON save 14 vs DC 10)'),
    );
    expect(await getConcentration(liveCharacterId)).not.toBeNull();
  });

  it('the live-encounter branch rolls the save against damage actually taken (resisted hit)', async () => {
    // Rob's FIX: 2014 DC is based on damage TAKEN. Seat the caster in a live
    // encounter with fire resistance, then POST 30 fire damage through the
    // live route. 30 -> 15 taken -> DC max(10, 7) = 10. d20 pinned to 12
    // (total 14): fails the old raw-amount DC 15, succeeds at the correct DC 10.
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ characterId: liveCharacterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const [{ id: participantId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId: liveCharacterId,
        name: 'Live Caster',
        participantType: 'player',
        turnOrder: 0,
        initiative: 10,
        maxHp: MAX_HP,
        damageResistances: ['fire'],
      })
      .returning({ id: combatParticipants.id });
    await db.insert(combatParticipantStatus).values({
      participantId,
      currentHp: MAX_HP,
      maxHp: MAX_HP,
      isConscious: true,
    });

    try {
      await startConcentration(liveCharacterId, { name: 'Bless' });
      expect(await getConcentration(liveCharacterId)).not.toBeNull();

      const { status, json } = await postDamageWithRoll(30, 0.55, { damageType: 'fire' });

      expect(status).toBe(200);
      // 15 actually taken (30 halved by resistance), mirrored to the sheet.
      expect(json.currentHitPoints).toBe(MAX_HP - 15);
      // DC 10 from damage taken, not DC 15 from the raw 30: total 14 succeeds.
      expect(json.engineLines).toContainEqual(
        expect.stringContaining('maintains concentration on Bless (CON save 14 vs DC 10)'),
      );
      expect(await getConcentration(liveCharacterId)).not.toBeNull();
    } finally {
      // Tear down the live seat so findLiveParticipant returns null for the
      // other tests in this file.
      await db
        .delete(combatParticipantStatus)
        .where(eq(combatParticipantStatus.participantId, participantId));
      await db.delete(combatParticipants).where(eq(combatParticipants.id, participantId));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
      await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    }
  });
});
});

describeWithDb('concentration starts when a concentration spell is cast (#709)', () => {
  // The story cast path: the DM turn's gate allowed the cast and
  // `spendStorySpellSlots` spent the slot. The `casts` object below is the
  // exact shape production builds (`AllowedCasts` in dm-feature-gate.ts): a
  // real `characters` row plus the catalog-canonical spell names the gate
  // resolved, so the SRD `concentration` flag is read from the real catalog.
  // Fresh client per run: the fixture's shared client is closed by the
  // earlier describe's afterAll, so a describe-body capture would be dead.
  let db: ReturnType<typeof realDb>;
  const userId = testId('cast-user');
  const MAX_HP = 40;

  let spendStorySpellSlots: typeof StorySpellSlots.spendStorySpellSlots;
  let getConcentration: typeof ConcentrationService.getConcentration;
  let applyNonAttackDamage: typeof NonAttackDamage.applyNonAttackDamage;

  let characterId: string;
  let sessionId: string;

  beforeAll(async () => {
    db = realDb();
    ({ spendStorySpellSlots } = await import('../dm/story-spell-slots.js'));
    ({ getConcentration } = await import('../combat/concentration-service.js'));
    ({ applyNonAttackDamage } = await import('../combat/non-attack-damage.js'));

    const [{ id }] = await db
      .insert(characters)
      .values({ userId, name: testId('story-caster'), level: 5, class: 'wizard' })
      .returning({ id: characters.id });
    characterId = id;
    await db.insert(characterStats).values({
      characterId: id,
      constitution: 14,
      maxHitPoints: MAX_HP,
      currentHitPoints: MAX_HP,
      temporaryHitPoints: 0,
    });
    // spendStorySpellSlots writes usage rows keyed to the session; the schema
    // FKs those to a real game session.
    const [{ id: sid }] = await db
      .insert(gameSessions)
      .values({ characterId: id, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    sessionId = sid;
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, characterId));
    await db
      .update(characterStats)
      .set({ currentHitPoints: MAX_HP, temporaryHitPoints: 0 })
      .where(eq(characterStats.characterId, characterId));
  });

  afterAll(async () => {
    await closeRealDb();
  });

  async function castInStory(spellName: string): Promise<void> {
    const [character] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, characterId));
    await spendStorySpellSlots({
      userId,
      sessionId,
      playerInput: `I cast ${spellName}`,
      casts: { character, spells: [spellName] },
    });
  }

  it('casting a concentration spell in the story starts concentration', async () => {
    // Dancing Lights is concentration in the SRD catalog — the #709 repro spell.
    await castInStory('Dancing Lights');

    const current = await getConcentration(characterId);
    expect(current?.spellName).toBe('Dancing Lights');
    expect(current?.spellId).toBe('dancing-lights');
  });

  it('casting a non-concentration spell starts nothing', async () => {
    await castInStory('Fire Bolt');

    expect(await getConcentration(characterId)).toBeNull();
  });

  it('casting over an existing concentration replaces it, one spell at a time', async () => {
    await castInStory('Dancing Lights');
    await castInStory('Bless');

    expect((await getConcentration(characterId))?.spellName).toBe('Bless');
  });

  it('damage after the cast triggers the CON save at DC max(10, half damage)', async () => {
    await castInStory('Dancing Lights');

    // 30 damage -> DC max(10, 15) = 15. Roll 1 + 2 = 3 fails: the spell ends.
    const result = await applyNonAttackDamage(characterId, userId, 30, 'test blow', {
      concentrationRoll: () => 1,
    });

    expect(result.concentration?.hadConcentration).toBe(true);
    expect(result.concentration?.saveTriggered).toBe(true);
    expect(result.concentration?.dc).toBe(15);
    expect(result.concentration?.dropped).toBe(true);
    expect(result.concentration?.droppedSpell).toBe('Dancing Lights');
    expect(await getConcentration(characterId)).toBeNull();
  });
});
