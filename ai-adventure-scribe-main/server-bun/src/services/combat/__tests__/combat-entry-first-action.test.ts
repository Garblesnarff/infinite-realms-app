import { describe, expect, it, mock } from 'bun:test';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';

mock.module('../../lib/logger.js', () => ({
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  },
  combatLogger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  },
}));

const { deriveCombatEntryFirstAction } = await import('../combat-entry-first-action.js');
const { detectDeclaredAttack } = await import('../combat-intent-gate.js');

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

const openMap = (targetX: number) => ({
  id: 'map-1',
  sessionId: 'session-1',
  width: 12,
  height: 1,
  round: 1,
  sceneDescription: 'An open room.',
  cells: Array.from({ length: 1 }, () =>
    Array.from({ length: 12 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'participant-player',
      name: 'Rook',
      x: 1,
      y: 0,
      size: 'medium' as const,
      type: 'pc' as const,
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'participant-professor',
      name: 'Professor Emil Darkwater',
      x: targetX,
      y: 0,
      size: 'medium' as const,
      type: 'monster' as const,
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
});

const declaredDaggerAttack = {
  verb: 'stab',
  actorName: 'Professor Emil Darkwater',
  attackSource: 'weapon' as const,
  weaponName: 'Dagger',
};

const quarterstaff = {
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

/** The shape listEquippedWeaponProfiles returns for a mundane equipped shortsword. */
const shortsword = {
  id: 'inventory-shortsword',
  name: 'Shortsword',
  damageDice: '1d6',
  damageType: 'piercing',
  normalRange: 5,
  magicBonus: 0,
  finesse: true,
  ranged: false,
  proficient: true,
};

describe('deriveCombatEntryFirstAction', () => {
  it('uses the declared scene name when the seated target still has a synthetic label', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: {
          ...state,
          participants: [state.participants[0], { ...state.participants[1], name: 'Player 1' }],
        },
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: { verb: 'punch', actorName: 'Chiropteran Hulk' },
      },
      deps,
    );

    expect(firstAction).toMatchObject({
      targetLabel: 'Chiropteran Hulk',
      roll_request: { purpose: 'Unarmed Strike attack against Chiropteran Hulk' },
    });
  });

  it.each(['punch'])(
    'resolves a bare %s as Unarmed Strike even when a quarterstaff is equipped (#1807)',
    async (verb) => {
      const firstAction = await deriveCombatEntryFirstAction(
        {
          sessionId: 'session-1',
          combatState: state,
          player: { characterId: 'character-1', name: 'Rook' },
          declaredAttack: { verb, actorName: 'Professor Emil Darkwater' },
        },
        { ...deps, listEquippedWeaponProfiles: async () => [quarterstaff] },
      );

      expect(firstAction).toMatchObject({
        type: 'attack',
        source: 'unarmed',
        attackSource: 'unarmed',
        weaponId: 'unarmed-strike',
        weaponName: 'Unarmed Strike',
        combat_action: { weapon_id: 'unarmed-strike' },
      });
    },
  );

  it.each(['hit', 'strike'])(
    'resolves a bare %s to the default equipped weapon, not Unarmed Strike (#569)',
    async (verb) => {
      const firstAction = await deriveCombatEntryFirstAction(
        {
          sessionId: 'session-1',
          combatState: state,
          player: { characterId: 'character-1', name: 'Rook' },
          declaredAttack: { verb, actorName: 'Professor Emil Darkwater' },
        },
        { ...deps, listEquippedWeaponProfiles: async () => [quarterstaff] },
      );

      expect(firstAction).toMatchObject({
        type: 'attack',
        source: 'weapon',
        attackSource: 'weapon',
        weaponId: 'inventory-quarterstaff',
        weaponName: 'Quarterstaff',
        combat_action: { weapon_id: 'inventory-quarterstaff' },
      });
    },
  );

  it('resolves a bare attack with no stated weapon to the default equipped weapon (#569)', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: { verb: 'attack', actorName: 'Professor Emil Darkwater' },
      },
      { ...deps, listEquippedWeaponProfiles: async () => [quarterstaff] },
    );

    expect(firstAction).toMatchObject({
      source: 'weapon',
      attackSource: 'weapon',
      weaponId: 'inventory-quarterstaff',
      weaponName: 'Quarterstaff',
      combat_action: { weapon_id: 'inventory-quarterstaff' },
    });
  });

  it('grounds a weapon word in a hit declaration to the equipped quarterstaff', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'hit',
          actorName: 'Professor Emil Darkwater',
          weaponName: 'staff',
        },
      },
      { ...deps, listEquippedWeaponProfiles: async () => [quarterstaff] },
    );

    expect(firstAction).toMatchObject({
      source: 'weapon',
      attackSource: 'weapon',
      weaponId: 'inventory-quarterstaff',
      weaponName: 'Quarterstaff',
      combat_action: { weapon_id: 'inventory-quarterstaff' },
    });
  });

  it('resolves a bare attack as unarmed when no weapon is equipped', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: { verb: 'attack', actorName: 'Professor Emil Darkwater' },
      },
      { ...deps, listEquippedWeaponProfiles: async () => [] },
    );

    expect(firstAction).toMatchObject({
      source: 'unarmed',
      attackSource: 'unarmed',
      weaponId: 'unarmed-strike',
      weaponName: 'Unarmed Strike',
      combat_action: { weapon_id: 'unarmed-strike' },
    });
  });

  it('offers the default equipped weapon for a bare attack declaration (#569)', async () => {
    // The DeclaredAttack is built by the real parser, the way /declared-attack produces it:
    // a bare "I attack X" names no weapon, so the entry must offer the default equipped
    // weapon — the same rule the in-combat proposal applies — not an Unarmed Strike.
    const declaredAttack = detectDeclaredAttack('I attack the Dragon Goldscale', [
      { name: 'Rook' },
      { name: 'Dragon Goldscale' },
    ]);
    expect(declaredAttack).toMatchObject({ verb: 'attack', attackSource: 'weapon' });
    expect(declaredAttack).not.toHaveProperty('weaponName');

    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: {
          ...state,
          participants: [
            state.participants[0],
            { ...state.participants[1], name: 'Dragon Goldscale' },
          ],
        },
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: declaredAttack!,
      },
      {
        ...deps,
        getParticipantAbilityProfile: async () => ({
          level: 1,
          scores: { str: 12, dex: 16 },
          savingThrowProficiencies: [],
          saveBonuses: {},
          spellIds: [],
        }),
        listEquippedWeaponProfiles: async () => [shortsword],
      },
    );

    expect(firstAction).toMatchObject({
      type: 'attack',
      source: 'weapon',
      attackSource: 'weapon',
      weaponId: 'inventory-shortsword',
      weaponName: 'Shortsword',
      roll_request: {
        purpose: 'Shortsword attack against Dragon Goldscale',
        formula: '1d20+5',
        modifier: 5,
      },
      combat_action: { weapon_id: 'inventory-shortsword' },
    });
  });

  it('offers the default equipped weapon for a bare strike declaration (#569)', async () => {
    // Hark N2-109 / D4-027: "I strike the Dragon Goldscale" with a shortsword equipped must
    // offer the Shortsword, not an Unarmed Strike. "strike" is a generic attack verb, not a
    // body-part attack like "punch" (#1807). Built with the real parser like /declared-attack.
    const declaredAttack = detectDeclaredAttack('I strike the Dragon Goldscale', [
      { name: 'Rook' },
      { name: 'Dragon Goldscale' },
    ]);
    expect(declaredAttack).toMatchObject({ verb: 'strike', attackSource: 'weapon' });
    expect(declaredAttack).not.toHaveProperty('weaponName');

    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: {
          ...state,
          participants: [
            state.participants[0],
            { ...state.participants[1], name: 'Dragon Goldscale' },
          ],
        },
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: declaredAttack!,
      },
      {
        ...deps,
        getParticipantAbilityProfile: async () => ({
          level: 1,
          scores: { str: 12, dex: 16 },
          savingThrowProficiencies: [],
          saveBonuses: {},
          spellIds: [],
        }),
        listEquippedWeaponProfiles: async () => [shortsword],
      },
    );

    expect(firstAction).toMatchObject({
      type: 'attack',
      source: 'weapon',
      attackSource: 'weapon',
      weaponId: 'inventory-shortsword',
      weaponName: 'Shortsword',
      roll_request: {
        purpose: 'Shortsword attack against Dragon Goldscale',
        formula: '1d20+5',
        modifier: 5,
      },
      combat_action: { weapon_id: 'inventory-shortsword' },
    });
  });

  it('resolves a romanized declaration onto an accented seat (#798)', async () => {
    // The DM's map seats the NPC romanized ("House Flambe Student" / slug
    // "house-flambe-student") while the encounter participant keeps the accent
    // ("House Flambé Student"). The declared strike must still find the seat.
    const declaredAttack = detectDeclaredAttack('I strike House Flambe Student', [
      { name: 'Rook' },
      { name: 'House Flambe Student', actorSlug: 'house-flambe-student' },
    ]);
    expect(declaredAttack).toMatchObject({ verb: 'strike', actorSlug: 'house-flambe-student' });

    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: {
          ...state,
          participants: [
            state.participants[0],
            { ...state.participants[1], name: 'House Flambé Student' },
          ],
        },
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: declaredAttack!,
      },
      {
        ...deps,
        getParticipantAbilityProfile: async () => ({
          level: 1,
          scores: { str: 12, dex: 16 },
          savingThrowProficiencies: [],
          saveBonuses: {},
          spellIds: [],
        }),
        listEquippedWeaponProfiles: async () => [shortsword],
      },
    );

    expect(firstAction).toMatchObject({
      type: 'attack',
      target: 'participant-professor',
      targetLabel: 'House Flambé Student',
      roll_request: { purpose: 'Shortsword attack against House Flambé Student' },
    });
  });

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

  it('does not auto-swap an inferred weapon to Unarmed Strike', async () => {
    const warnings: unknown[] = [];
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'attack',
          actorName: 'Professor Emil Darkwater',
          attackSource: 'weapon',
          weaponName: 'blade',
          weaponStated: false,
        },
      },
      {
        ...deps,
        listEquippedWeaponProfiles: async () => [quarterstaff],
        logger: { warn: (data: unknown) => warnings.push(data) },
      },
    );

    expect(firstAction).toBeNull();
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'INFERRED_WEAPON_DROPPED',
        requested: 'blade',
        weaponStated: false,
      }),
    ]);
  });

  it('refuses a stated weapon that is not on the sheet, with the reason in player language (#2551)', async () => {
    const warnings: unknown[] = [];
    const refusal = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'attack',
          actorName: 'Professor Emil Darkwater',
          attackSource: 'weapon',
          weaponName: 'quarterstaff',
          weaponStated: true,
        },
      },
      {
        ...deps,
        listEquippedWeaponProfiles: async () => [],
        logger: { warn: (data: unknown) => warnings.push(data) },
      },
    );

    expect(refusal).toEqual({
      reason: 'declared_weapon_not_equipped',
      notice:
        'You declared an attack with the quarterstaff, but it is not on your character sheet, so your opening attack was not queued.',
      requestedWeapon: 'quarterstaff',
      actor: 'participant-player',
      target: 'participant-professor',
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'DECLARED_WEAPON_NOT_EQUIPPED',
        requested: 'quarterstaff',
        weaponStated: true,
      }),
    ]);
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

  it('routes "I cast Hex on X" through the first-action spell path', async () => {
    const declaredAttack = detectDeclaredAttack('I cast Hex on Professor Emil Darkwater', [
      { name: 'Professor Emil Darkwater' },
    ]);
    expect(declaredAttack).toMatchObject({
      attackSource: 'spell',
      spellId: 'hex',
      actorName: 'Professor Emil Darkwater',
    });

    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: declaredAttack!,
      },
      {
        ...deps,
        getParticipantAbilityProfile: async () => ({
          level: 1,
          scores: { str: 12, dex: 14, cha: 16 },
          savingThrowProficiencies: [],
          saveBonuses: {},
          spellIds: ['hex'],
        }),
      },
    );

    expect(firstAction).toMatchObject({
      type: 'spell',
      source: 'spell',
      spellId: 'hex',
      slotLevel: 1,
      combat_action: {
        action_type: 'cast_spell',
        spell_id: 'hex',
        target_ids: ['participant-professor'],
      },
    });
    expect(firstAction?.roll_request).toBeUndefined();
  });

  it('refuses an unknown or out-of-scope declared spell without fabricating a weapon attack', async () => {
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

    // #2569: the spell refusal returns a CombatEntryFirstActionRefusal like the
    // weapon refusal, so the entry notice can name the miss.
    expect(firstAction).toEqual({
      reason: 'declared_spell_unsupported',
      notice: expect.stringContaining('Fireball'),
      requestedWeapon: null,
      requestedSpell: 'Fireball',
      actor: 'participant-player',
      target: expect.any(String),
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'FIRST_ACTION_SPELL_REFUSED',
        spellId: 'fireball',
        participantId: 'participant-player',
        reason: 'unsupported_spell',
      }),
    ]);
  });

  it('refuses an unrecognized declared spell with a specific notice (#2569)', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'cast Zorblaxian Annihilation',
          actorName: 'Professor Emil Darkwater',
          attackSource: 'spell',
          spellName: 'Zorblaxian Annihilation',
        },
      },
      { ...deps, logger: { warn: () => {} } },
    );

    expect(firstAction).toEqual({
      reason: 'declared_spell_unknown',
      notice:
        'You declared casting Zorblaxian Annihilation, but no such spell was recognized, so your opening spell was not queued.',
      requestedWeapon: null,
      requestedSpell: 'Zorblaxian Annihilation',
      actor: 'participant-player',
      target: expect.any(String),
    });
  });

  it('refuses a declared spell the character does not know with a specific notice (#2569)', async () => {
    const warnings: unknown[] = [];
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: {
          verb: 'cast Ray of Frost',
          actorName: 'Professor Emil Darkwater',
          attackSource: 'spell',
          spellId: 'ray-of-frost',
        },
      },
      { ...deps, logger: { warn: (data: unknown) => warnings.push(data) } },
    );

    // The sheet has magic-missile and fire-bolt; ray-of-frost is a real spell
    // the character does not know, so the third branch fires.
    expect(firstAction).toEqual({
      reason: 'declared_spell_not_known',
      notice:
        'You declared casting Ray of Frost, but it is not on your character sheet, so your opening spell was not queued.',
      requestedWeapon: null,
      requestedSpell: 'Ray of Frost',
      actor: 'participant-player',
      target: expect.any(String),
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'FIRST_ACTION_SPELL_REFUSED',
        reason: 'spell_not_known',
      }),
    ]);
  });

  it('previews a melee approach without mutating the map and spends the opening turn on movement', async () => {
    const map = openMap(9);
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: declaredDaggerAttack,
      },
      { ...deps, loadActiveTacticalMap: async () => map },
    );

    expect(firstAction).toMatchObject({
      type: 'move',
      reach: { inReach: false, distanceFeet: 10, movedFeetIfApproached: 30 },
      notice:
        'You close 30 ft. Professor Emil Darkwater is still 10 ft away because movement ran out before you reached the required distance. Your turn is spent.',
      combat_action: { action_type: 'move', x: 7, y: 0, movement_feet: 30 },
    });
    expect(firstAction?.roll_request).toBeUndefined();
    expect(map.entities[0]).toMatchObject({ x: 1, y: 0 });
  });

  it('turns a one-step 10ft melee approach into an attack after moving 5ft', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: declaredDaggerAttack,
      },
      { ...deps, loadActiveTacticalMap: async () => openMap(3) },
    );

    expect(firstAction).toMatchObject({
      type: 'attack',
      reach: { inReach: true, distanceFeet: 5, movedFeetIfApproached: 5 },
      combat_action: { action_type: 'attack' },
    });
    expect(firstAction?.roll_request).toBeDefined();
  });

  it('returns a reachable melee attack after previewing the full movement', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: declaredDaggerAttack,
      },
      { ...deps, loadActiveTacticalMap: async () => openMap(8) },
    );

    expect(firstAction).toMatchObject({
      type: 'attack',
      reach: { inReach: true, distanceFeet: 5, movedFeetIfApproached: 30 },
      combat_action: { action_type: 'attack' },
    });
    expect(firstAction?.roll_request).toBeDefined();
  });

  it('does not gate a ranged attack on melee reach', async () => {
    const firstAction = await deriveCombatEntryFirstAction(
      {
        sessionId: 'session-1',
        combatState: state,
        player: { characterId: 'character-1', name: 'Rook' },
        declaredAttack: { ...declaredDaggerAttack, weaponName: 'Longbow' },
      },
      {
        ...deps,
        loadActiveTacticalMap: async () => openMap(9),
        listEquippedWeaponProfiles: async () => [
          {
            id: 'inventory-bow',
            name: 'Longbow',
            damageDice: '1d8',
            damageType: 'piercing',
            normalRange: 150,
            magicBonus: 0,
            finesse: false,
            ranged: true,
            proficient: true,
          },
        ],
      },
    );

    expect(firstAction?.type).toBe('attack');
    expect(firstAction?.reach).toBeUndefined();
    expect(firstAction?.roll_request).toBeDefined();
  });
});
