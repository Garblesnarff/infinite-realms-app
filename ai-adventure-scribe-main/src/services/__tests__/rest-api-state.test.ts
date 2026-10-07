import { describe, expect, it, vi } from 'vitest';

import {
  applyRestResultToCharacter,
  applyRestResultToCombatParticipant,
  restApi,
  type RestApiResult,
} from '../rest-api';

import type { Character } from '@/types/character';
import type { CombatParticipant } from '@/types/combat';

import { handleShortRest } from '@/contexts/combat/rest-and-stealth-handlers';

const serverShortRest: RestApiResult = {
  characterId: 'char-1',
  restType: 'short',
  hpRestored: 7,
  hitDiceSpent: 1,
  hitDiceRemaining: [
    {
      id: 'hd-1',
      characterId: 'char-1',
      className: 'Warlock',
      dieType: 'd8',
      totalDice: 5,
      usedDice: 2,
    },
  ],
  resourcesRestored: [
    {
      resourceType: 'class_feature',
      resourceName: 'Short Rest Features',
      amountRestored: 'server value',
    },
  ],
  spellSlots: {
    '1': { max: 2, current: 0 },
    '2': { max: 1, current: 1 },
  },
  pactSlots: { maximum: 2, current: 2, level: 3 },
  classFeatures: {
    action_surge: { maxUses: 1, currentUses: 1, usesPerRest: 'short' },
  },
  restEventId: 'rest-1',
};

describe('rest API state application', () => {
  it('applies the server rest response to character state without local slot recomputation', () => {
    const character: Character = {
      id: 'char-1',
      name: 'Mira',
      spellSlots: {
        1: { max: 2, current: 2 },
        2: { max: 1, current: 0 },
      },
      pactSlots: { maximum: 2, current: 0, level: 3 },
      classFeatures: {
        action_surge: { maxUses: 1, currentUses: 0, usesPerRest: 'short' },
      },
      hitPoints: { maximum: 30, current: 10, temporary: 0 },
      hitDice: { total: 5, remaining: 4, type: 'd8' },
    };

    const updated = applyRestResultToCharacter(character, serverShortRest);

    expect(updated.spellSlots).toEqual({
      1: { max: 2, current: 0 },
      2: { max: 1, current: 1 },
    });
    expect(updated.pactSlots).toEqual(serverShortRest.pactSlots);
    expect(updated.classFeatures).toEqual(serverShortRest.classFeatures);
    expect(updated.hitDice).toEqual({ total: 5, remaining: 3, type: 'd8' });
    expect(updated.hitPoints?.current).toBe(17);
  });

  it('routes combat short rests through the server API and applies returned state', async () => {
    const shortRest = vi.spyOn(restApi, 'shortRest').mockResolvedValue(serverShortRest);
    const participant: CombatParticipant = {
      id: 'participant-1',
      characterId: 'char-1',
      name: 'Mira',
      participantType: 'player',
      maxHitPoints: 30,
      currentHitPoints: 10,
      temporaryHitPoints: 0,
      armorClass: 15,
      initiative: 12,
      speed: 30,
      actionTaken: false,
      bonusActionTaken: false,
      reactionTaken: false,
      movementUsed: 0,
      movementRemaining: 30,
      reactionOpportunities: [],
      conditions: [],
      deathSaves: { successes: 0, failures: 0 },
      damageResistances: [],
      damageImmunities: [],
      damageVulnerabilities: [],
      hitDice: { max: 5, current: 5 },
      spellSlots: {
        1: { max: 2, current: 2 },
        2: { max: 1, current: 0 },
      },
    };

    const result = await handleShortRest(participant, 1);

    expect(shortRest).toHaveBeenCalledWith('char-1', 1);
    expect(result.success).toBe(true);
    expect(result.participantUpdates.currentHitPoints).toBe(17);
    expect(result.participantUpdates.hitDice).toEqual({ max: 5, current: 3 });
    expect(result.participantUpdates.spellSlots).toEqual({
      1: { max: 2, current: 0 },
      2: { max: 1, current: 1 },
    });
  });

  it('maps long-rest server state onto combat participants', () => {
    const updated = applyRestResultToCombatParticipant(
      {
        id: 'participant-1',
        characterId: 'char-1',
        name: 'Mira',
        participantType: 'player',
        maxHitPoints: 30,
        currentHitPoints: 1,
        temporaryHitPoints: 0,
        armorClass: 15,
        initiative: 12,
        speed: 30,
        actionTaken: true,
        bonusActionTaken: true,
        reactionTaken: true,
        movementUsed: 15,
        movementRemaining: 15,
        reactionOpportunities: [],
        conditions: [{ name: 'poisoned', description: 'Poisoned', duration: 1 }],
        deathSaves: { successes: 0, failures: 0 },
        damageResistances: [],
        damageImmunities: [],
        damageVulnerabilities: [],
      },
      {
        ...serverShortRest,
        restType: 'long',
        hpRestored: 29,
        hitDiceRestored: 1,
        restEventId: 'rest-2',
      },
    );

    expect(updated.currentHitPoints).toBe(30);
    expect(updated.actionTaken).toBe(false);
    // #2600: the allow-list ends only rest-resolved conditions — a timed
    // poisoned survives the rest.
    expect(updated.conditions).toEqual([{ name: 'poisoned', description: 'Poisoned', duration: 1 }]);
    expect(updated.spellSlots?.[2]).toEqual({ max: 1, current: 1 });
  });

  it('sheet long rest ends only rest-resolved conditions and ends concentration (#2600)', () => {
    const character: Character = {
      id: 'char-1',
      name: 'Mira',
      hitPoints: { maximum: 30, current: 10, temporary: 0 },
      conditions: [
        { name: 'Poisoned', duration: 10 } as any,
        { name: 'Unconscious', duration: 10 } as any,
        { name: 'Blessed', duration: -1 } as any,
      ],
      activeConcentration: 'bless',
    };

    const updated = applyRestResultToCharacter(character, {
      ...serverShortRest,
      restType: 'long',
      hpRestored: 20,
      restEventId: 'rest-3',
    });

    // Unconscious ends (HP restored); lasting conditions survive regardless of
    // duration; concentration ends.
    expect(updated.conditions).toEqual([
      { name: 'Poisoned', duration: 10 },
      { name: 'Blessed', duration: -1 },
    ]);
    expect(updated.activeConcentration).toBeNull();
    expect(updated.hitPoints?.current).toBe(30);
  });

  it('sheet short rest keeps conditions and concentration (#2600)', () => {
    const character: Character = {
      id: 'char-1',
      name: 'Mira',
      hitPoints: { maximum: 30, current: 10, temporary: 0 },
      conditions: [{ name: 'Poisoned', duration: 10 } as any],
      activeConcentration: 'bless',
    };

    const updated = applyRestResultToCharacter(character, serverShortRest);

    expect(updated.conditions).toEqual([{ name: 'Poisoned', duration: 10 }]);
    expect(updated.activeConcentration).toBe('bless');
  });

  it('parity: sheet and combat appliers apply the same long-rest semantics (#2600)', () => {
    const conditions = [
      { name: 'Unconscious', duration: 5 } as any,
      { name: 'Prone', duration: 5 } as any,
      { name: 'Poisoned', duration: 10 } as any,
      { name: 'Cursed', duration: 10 } as any,
    ];
    const longRest: RestApiResult = {
      ...serverShortRest,
      restType: 'long',
      hpRestored: 20,
      restEventId: 'rest-parity',
    };

    const character: Character = {
      id: 'char-1',
      name: 'Mira',
      hitPoints: { maximum: 30, current: 10, temporary: 0 },
      conditions: [...conditions],
      activeConcentration: 'bless',
    };
    const participant: CombatParticipant = {
      id: 'participant-1',
      characterId: 'char-1',
      name: 'Mira',
      participantType: 'player',
      maxHitPoints: 30,
      currentHitPoints: 10,
      temporaryHitPoints: 0,
      armorClass: 15,
      initiative: 12,
      speed: 30,
      actionTaken: true,
      bonusActionTaken: true,
      reactionTaken: true,
      movementUsed: 15,
      movementRemaining: 15,
      reactionOpportunities: [],
      conditions: [...conditions],
      deathSaves: { successes: 2, failures: 1 },
      damageResistances: [],
      damageImmunities: [],
      damageVulnerabilities: [],
      activeConcentration: 'bless',
    };

    const updatedCharacter = applyRestResultToCharacter(character, longRest);
    const updatedParticipant = applyRestResultToCombatParticipant(participant, longRest);

    // Same input through both appliers gives the same rest semantics — this
    // catches drift between the two paths.
    expect(updatedCharacter.conditions).toEqual(updatedParticipant.conditions);
    // The allow-list ends unconscious and prone; timed poisoned and cursed stay.
    expect(updatedCharacter.conditions).toEqual([
      { name: 'Poisoned', duration: 10 },
      { name: 'Cursed', duration: 10 },
    ]);
    expect(updatedCharacter.activeConcentration).toBeNull();
    expect(updatedParticipant.activeConcentration).toBeNull();
    // Death-save tallies are server-owned (#2618): the applier passes the
    // local value through untouched; the reset happens in
    // RestService.takeLongRest and arrives on the participant wire.
    expect(updatedParticipant.deathSaves).toEqual({ successes: 2, failures: 1 });
  });

  it('long rest leaves death-save counters to the server (#2600)', () => {
    const updated = applyRestResultToCombatParticipant(
      {
        id: 'participant-1',
        characterId: 'char-1',
        name: 'Mira',
        participantType: 'player',
        maxHitPoints: 30,
        currentHitPoints: 10,
        temporaryHitPoints: 0,
        armorClass: 15,
        initiative: 12,
        speed: 30,
        actionTaken: false,
        bonusActionTaken: false,
        reactionTaken: false,
        movementUsed: 0,
        movementRemaining: 30,
        reactionOpportunities: [],
        conditions: [],
        deathSaves: { successes: 2, failures: 1 },
        damageResistances: [],
        damageImmunities: [],
        damageVulnerabilities: [],
      },
      {
        ...serverShortRest,
        restType: 'long',
        hpRestored: 20,
        restEventId: 'rest-deathsaves',
      },
    );

    // The applier does not reset death saves: tallies are server-owned
    // (#2618), reset in RestService.takeLongRest. The local value passes
    // through until the participant wire refresh brings the server's 0/0.
    expect(updated.deathSaves).toEqual({ successes: 2, failures: 1 });
  });
});
