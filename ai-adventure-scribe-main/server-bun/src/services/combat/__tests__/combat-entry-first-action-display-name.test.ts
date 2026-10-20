/**
 * The opening attack of a fight must land on the creature the player named (#876).
 *
 * `deriveCombatEntryFirstAction` matches the declared target against the seated rows.
 * A creature seated under a label ("The Pale Shape 1") whose cards call it by its
 * bestiary heading ("The Thing Below (Avatar) 1") answered to the label only, so an
 * opening declaration naming the creature as the player read it derived no action and
 * the attack silently dropped. The state rows are shaped like the entry gate's
 * combat state (startCombat output): the heading rides on `monsterAttack.displayName`.
 */
import { describe, expect, it } from 'bun:test';

// The module chain builds the DB client at import; nothing here connects (all data
// deps are stubbed below), but the client requires the variable to exist.
process.env.DATABASE_URL ??= 'postgres://placeholder:placeholder@localhost:5432/placeholder';

const { deriveCombatEntryFirstAction } = await import('../combat-entry-first-action.js');

/** `getParticipantAbilityProfile` output for the level-1 Scholar (STR 8, DEX 12). */
const scholarProfile = {
  level: 1,
  scores: { str: 8, dex: 12 },
  savingThrowProficiencies: [],
  saveBonuses: {},
  spellIds: [],
};

/** `candidateToProfile` output for a seeded Quarterstaff row. */
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

const avatar = (seat: number): Record<string, unknown> => ({
  id: `avatar-${seat}`,
  name: `The Pale Shape ${seat}`,
  initiative: 12,
  initiativeModifier: 2,
  participantType: 'monster',
  armorClass: 13,
  monsterAttack: { displayName: `The Thing Below (Avatar) ${seat}`, attacks: [] },
});

const combatState = {
  encounter: { id: 'encounter-1' },
  participants: [
    {
      id: 'participant-player',
      name: 'The Scholar',
      initiative: 10,
      initiativeModifier: 1,
      characterId: 'character-1',
      participantType: 'player',
      armorClass: 11,
    },
    avatar(1),
    avatar(2),
  ],
};

const deps = {
  getParticipantAbilityProfile: async () => scholarProfile as never,
  listEquippedWeaponProfiles: async () => [quarterstaffProfile] as never,
  getActiveConditionNames: async () => [] as string[],
  loadActiveTacticalMap: async () => null,
  logger: { warn: () => {} },
};

const attackOn = (actorName: string, actorSlug: string): Promise<unknown> =>
  deriveCombatEntryFirstAction(
    {
      sessionId: 'session-876',
      combatState: combatState as never,
      player: { characterId: 'character-1', name: 'The Scholar' },
      declaredAttack: {
        verb: 'attack',
        actorName,
        actorSlug,
        attackSource: 'weapon',
        weaponName: 'Quarterstaff',
        weaponStated: true,
      },
    },
    deps,
  );

describe('an opening attack on a renamed creature (#876)', () => {
  it('derives the action against the seat the card name picks out', async () => {
    const action = (await attackOn(
      'The Thing Below (Avatar) 2',
      'the-thing-below-avatar-2',
    )) as { target?: string } | null;
    expect(action?.target).toBe('avatar-2');
  });

  it('still derives it against the seating label', async () => {
    const action = (await attackOn('The Pale Shape 1', 'the-pale-shape-1')) as {
      target?: string;
    } | null;
    expect(action?.target).toBe('avatar-1');
  });

  it('derives no action for the unnumbered heading, which names both seats', async () => {
    const action = await attackOn('The Thing Below (Avatar)', 'the-thing-below-avatar');
    expect(action).toBeNull();
  });
});
