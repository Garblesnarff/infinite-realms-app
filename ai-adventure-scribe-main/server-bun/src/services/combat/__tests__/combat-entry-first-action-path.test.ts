/**
 * #2551 — the real declared-attack → pending entry → confirmed-entry path, D3-shaped.
 *
 * Fixture provenance (production producers only):
 * - `declaredAttack` comes from the real `detectDeclaredAttack` detector, the same producer
 *   `POST /v1/combat/sessions/:id/declared-attack` runs before the DM is called.
 * - The seated `combatState` follows the `startCombat` output the gate consumes (participant
 *   id/name/initiative/initiativeModifier/characterId/participantType/armorClass/turnOrder),
 *   with D3's initiative totals (Stalker 12, Scholar 3) unless a case says otherwise.
 * - Weapon profiles follow `candidateToProfile` in data-access.ts, the producer behind
 *   `listEquippedWeaponProfiles` (id/name/damageDice/damageType/normalRange/magicBonus/
 *   finesse/ranged/proficient). An empty list is what that producer returns when the
 *   character has no equipped weapon row the loader can see.
 * - The ability profile follows `getParticipantAbilityProfile` (level/scores/spellIds).
 * Only the database seam (`deriveFirstAction`'s data deps, `startCombat`, the map) is stubbed;
 * detection, seating, and first-action derivation are the real modules.
 */
import { describe, expect, it } from 'bun:test';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';

const { detectDeclaredAttack } = await import('../combat-intent-gate.js');
const { deriveCombatEntryFirstAction } = await import('../combat-entry-first-action.js');
const { seatCombatEntry, synthesizeSceneSpec } = await import('../combat-entry-gate.js');

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'user_01KAT5E3WFD7NGE3C0TDHX2T5G';

const PLAYER = {
  characterId: 'character-1',
  name: 'The Scholar',
  initiativeModifier: 1,
  hpCurrent: 7,
  hpMax: 7,
};

const STALKER = 'The Faceless Stalker';

/** The roster producer's shape: name + slug the session has met. */
const ROSTER = [{ name: STALKER, actorSlug: 'the-faceless-stalker' }];

/** What the D3 player declared, detected by the real producer. */
const declaredAttack = detectDeclaredAttack(
  'I step into melee and attack The Faceless Stalker with my quarterstaff',
  ROSTER,
);

/** `candidateToProfile` output for a seeded Quarterstaff row (Wizard-proficient simple weapon). */
const quarterstaffProfile = {
  id: 'inventory-quarterstaff',
  name: 'Quarterstaff',
  damageDice: '1d6',
  damageType: 'bludgeoning',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
};

/** `getParticipantAbilityProfile` output for the level-1 Scholar (STR 8, DEX 12). */
const scholarProfile = {
  level: 1,
  scores: { str: 8, dex: 12 },
  savingThrowProficiencies: [],
  saveBonuses: {},
  spellIds: ['acid-splash', 'chill-touch'],
};

function seatDeps(equipped: (typeof quarterstaffProfile)[], initiatives: Record<string, number>) {
  const warnings: unknown[] = [];
  const deps = {
    getActiveEncounter: async () => undefined,
    verifySessionOwnership: async () => ({ success: true }),
    startCombat: async (_sessionId: string, participants: never[]) => {
      const seated = (participants as Array<Record<string, unknown>>)
        .map((participant, index) => ({
          id: participant.characterId ? 'participant-player' : 'participant-stalker',
          name: String(participant.name),
          initiative: initiatives[String(participant.name)] ?? 10,
          initiativeModifier: Number(participant.initiativeModifier ?? 0),
          characterId: (participant.characterId as string | null) ?? null,
          participantType: participant.characterId ? 'player' : 'monster',
          armorClass: participant.characterId ? 11 : 13,
          turnOrder: index,
        }))
        .sort((left, right) => right.initiative - left.initiative)
        .map((participant, index) => ({ ...participant, turnOrder: index }));
      return {
        encounter: { id: 'encounter-1' },
        participants: seated,
        participantSizes: {},
        turnOrder: seated.map((participant, index) => ({
          participant,
          isCurrent: index === 0,
          hasGone: false,
        })),
        currentParticipant: seated[0] ?? null,
      } as never;
    },
    createTacticalCombatMap: async () => ({}),
    sanitizeSceneSpec: (raw: unknown) => ({ ok: true as const, sceneSpec: raw as never, overrides: [] }),
    trackCombatEvent: () => undefined,
    persistSessionMessage: async () => undefined,
    publishCombatState: async () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    deriveFirstAction: (params: never) =>
      deriveCombatEntryFirstAction(params, {
        getParticipantAbilityProfile: async () => scholarProfile as never,
        listEquippedWeaponProfiles: async () => equipped as never,
        getActiveConditionNames: async () => [],
        loadActiveTacticalMap: async () => null,
        logger: { warn: (data: unknown) => warnings.push(data) },
      }),
  };
  return { deps, warnings };
}

async function seat(equipped: (typeof quarterstaffProfile)[], initiatives: Record<string, number>) {
  const { deps, warnings } = seatDeps(equipped, initiatives);
  const outcome = await seatCombatEntry(
    {
      sessionId: SESSION_ID,
      userId: USER_ID,
      player: PLAYER,
      combatants: [{ name: STALKER, count: 1 }],
      sceneSpec: synthesizeSceneSpec(SESSION_ID),
      trigger: 'player_intent',
      detail: 'player declared an attack on The Faceless Stalker',
      declaredAttack: declaredAttack ?? undefined,
    },
    deps as never,
  );
  return { outcome, warnings };
}

describe('declared-attack → confirmed entry → first_action (#2551, D3 shape)', () => {
  it('the real detector names the weapon the player stated', () => {
    expect(declaredAttack).toEqual({
      verb: 'attack',
      actorName: STALKER,
      actorSlug: 'the-faceless-stalker',
      attackSource: 'weapon',
      weaponStated: true,
      weaponName: 'quarterstaff',
    });
  });

  it('produces a usable first_action when the declared weapon is on the sheet (player wins initiative)', async () => {
    const { outcome } = await seat([quarterstaffProfile], { 'The Scholar': 18, [STALKER]: 12 });

    expect(outcome?.firstAction).toMatchObject({
      type: 'attack',
      weaponName: 'Quarterstaff',
      combat_action: {
        action_type: 'attack',
        target_ids: ['participant-stalker'],
        weapon_id: 'inventory-quarterstaff',
      },
      roll_request: { modifier: 1, ac: 13, formula: '1d20+1' },
    });
  });

  it('produces a usable first_action when the monster acts first (D3 initiative order)', async () => {
    const { outcome } = await seat([quarterstaffProfile], { [STALKER]: 12, 'The Scholar': 3 });

    expect(outcome?.combatState.participants[0]?.name).toBe(STALKER);
    expect(outcome?.firstAction).toMatchObject({
      type: 'attack',
      weaponName: 'Quarterstaff',
      combat_action: {
        action_type: 'attack',
        target_ids: ['participant-stalker'],
        weapon_id: 'inventory-quarterstaff',
      },
      roll_request: { modifier: 1, ac: 13, formula: '1d20+1' },
    });
  });

  it('surfaces why no first_action was queued when the declared weapon is not on the sheet', async () => {
    const { outcome, warnings } = await seat([], { [STALKER]: 12, 'The Scholar': 3 });

    expect(warnings).toEqual([
      expect.objectContaining({ msg: 'DECLARED_WEAPON_NOT_EQUIPPED', requested: 'quarterstaff' }),
    ]);
    expect(outcome?.firstAction).toBeUndefined();
    expect(outcome?.firstActionRefusal).toMatchObject({
      reason: 'declared_weapon_not_equipped',
    });
    expect(outcome?.notice).toMatch(/quarterstaff/i);
    expect(outcome?.notice).toMatch(/not on your character sheet/i);
  });
});
