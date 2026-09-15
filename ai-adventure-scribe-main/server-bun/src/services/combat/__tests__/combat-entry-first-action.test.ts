import { describe, expect, it } from 'bun:test';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';

const { deriveCombatEntryFirstAction } = await import('../combat-entry-first-action.js');

const state = {
  encounter: { id: 'encounter-1' },
  participants: [
    {
      id: 'participant-player',
      name: 'Rook',
      characterId: 'character-1',
      participantType: 'player',
      initiative: 18,
      initiativeModifier: 2,
      armorClass: 15,
    },
    {
      id: 'participant-professor',
      name: 'Professor Emil Darkwater',
      participantType: 'monster',
      initiative: 12,
      initiativeModifier: 0,
      armorClass: 13,
    },
  ],
};

const deps = {
  getParticipantAbilityProfile: async () => ({
    level: 1,
    scores: { str: 16, dex: 14 },
    savingThrowProficiencies: [],
    saveBonuses: {},
    spellIds: ['magic-missile', 'fire-bolt'],
  }),
  listEquippedWeaponProfiles: async () => [
    {
      id: 'inventory-dagger',
      name: 'Dagger',
      damageDice: '1d4',
      damageType: 'piercing',
      normalRange: 5,
      magicBonus: 0,
      finesse: true,
      ranged: false,
      proficient: true,
    },
  ],
  getActiveConditionNames: async () => [],
  loadActiveTacticalMap: async () => null,
  logger: { warn: () => {} },
};

describe('deriveCombatEntryFirstAction', () => {
  it('derives a punch as an unarmed attack with the engine modifier', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'punch',
          actorName: 'Professor Emil Darkwater',
          attackSource: 'unarmed',
        },
      },
      deps,
    );

    expect(firstAction).toMatchObject({
      type: 'attack',
      source: 'unarmed',
      attackSource: 'unarmed',
      actor: 'participant-player',
      target: 'participant-professor',
      weaponId: 'unarmed-strike',
      weaponName: 'Unarmed Strike',
      roll_request: {
        formula: '1d20+5',
        modifier: 5,
        ac: 13,
      },
      combat_action: {
        action_type: 'attack',
        weapon_id: 'unarmed-strike',
        target_ids: ['participant-professor'],
      },
    });
  });

  it('grounds a declared stab to the equipped dagger', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'stab',
          actorName: 'Professor Emil Darkwater',
          attackSource: 'weapon',
          weaponName: 'Dagger',
        },
      },
      deps,
    );

    expect(firstAction).toMatchObject({
      source: 'weapon',
      weaponId: 'inventory-dagger',
      weaponName: 'Dagger',
      roll_request: { modifier: 5 },
    });
  });

  it('routes a damaging cantrip through the spell action path', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'cast Fire Bolt',
          actorName: 'Professor Emil Darkwater',
          attackSource: 'spell',
          spellId: 'fire-bolt',
        },
      },
      deps,
    );

    expect(firstAction).toMatchObject({
      type: 'spell',
      source: 'spell',
      spellId: 'fire-bolt',
      slotLevel: null,
      combat_action: { action_type: 'cast_spell', spell_id: 'fire-bolt' },
    });
    expect(firstAction?.roll_request).toBeUndefined();
  });

  it('falls back to the grounded weapon and logs when the declared spell is not known', async () => {
    const warnings: unknown[] = [];
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'cast Fireball',
          actorName: 'Professor Emil Darkwater',
          attackSource: 'spell',
          spellId: 'fireball',
        },
      },
      { ...deps, logger: { warn: (data: unknown) => warnings.push(data) } },
    );

    expect(firstAction).toMatchObject({
      type: 'attack',
      source: 'weapon',
      weaponId: 'inventory-dagger',
      combat_action: { action_type: 'attack', weapon_id: 'inventory-dagger' },
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'FIRST_ACTION_SPELL_NOT_KNOWN',
        spellId: 'fireball',
        participantId: 'participant-player',
      }),
    ]);
  });
});
