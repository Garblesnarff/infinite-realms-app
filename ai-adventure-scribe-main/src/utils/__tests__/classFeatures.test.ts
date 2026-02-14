/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import {
  getClassFeatures,
  getCharacterResources,
  getRageDamageBonus,
  getBardicInspirationDie,
  canUseSneakAttack,
  getSneakAttackDice,
  getDivineSmiteDamage,
  getMartialArtsDie,
  calculateUnarmoredDefenseAC,
  hasUnarmoredDefense,
  canUseClassFeature,
  useClassFeature,
  restoreClassFeatures,
  activateRage,
  deactivateRage,
} from '../classFeatures';

describe('classFeatures utilities', () => {
  // Mock data helpers
  const createMockParticipant = (overrides = {}): any => ({
    id: 'p1',
    name: 'Test Participant',
    participantType: 'player',
    characterClass: 'fighter',
    level: 1,
    maxHitPoints: 10,
    currentHitPoints: 10,
    temporaryHitPoints: 0,
    armorClass: 15,
    initiative: 10,
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
    classFeatures: [],
    ...overrides,
  });

  const createMockEncounter = (participants: any[] = []): any => ({
    id: 'e1',
    sessionId: 's1',
    phase: 'active',
    currentRound: 1,
    participants,
    actions: [],
    roundsElapsed: 0,
    startTime: new Date(),
  });

  describe('scaling utilities', () => {
    it('getRageDamageBonus should scale with level', () => {
      expect(getRageDamageBonus(1)).toBe(2);
      expect(getRageDamageBonus(9)).toBe(3);
      expect(getRageDamageBonus(16)).toBe(4);
    });

    it('getBardicInspirationDie should scale with level', () => {
      expect(getBardicInspirationDie(1)).toBe(6);
      expect(getBardicInspirationDie(5)).toBe(8);
      expect(getBardicInspirationDie(10)).toBe(10);
      expect(getBardicInspirationDie(15)).toBe(12);
    });

    it('getSneakAttackDice should scale with level', () => {
      expect(getSneakAttackDice(1)).toBe(1);
      expect(getSneakAttackDice(3)).toBe(2);
      expect(getSneakAttackDice(5)).toBe(3);
    });

    it('getMartialArtsDie should scale with level', () => {
      expect(getMartialArtsDie(1)).toBe(4);
      expect(getMartialArtsDie(5)).toBe(6);
      expect(getMartialArtsDie(11)).toBe(8);
      expect(getMartialArtsDie(17)).toBe(10);
    });

    it('getDivineSmiteDamage should return correct dice string', () => {
      expect(getDivineSmiteDamage(1)).toBe('2d8');
      expect(getDivineSmiteDamage(2)).toBe('3d8');
      expect(getDivineSmiteDamage(1, true)).toBe('4d8');
      expect(getDivineSmiteDamage(3, true)).toBe('8d8');
    });
  });

  describe('getCharacterResources', () => {
    it('should initialize hit dice for any class', () => {
      expect(getCharacterResources('barbarian', 1).hitDice.d12).toBeDefined();
      expect(getCharacterResources('fighter', 1).hitDice.d10).toBeDefined();
      expect(getCharacterResources('paladin', 1).hitDice.d10).toBeDefined();
      expect(getCharacterResources('ranger', 1).hitDice.d10).toBeDefined();
      expect(getCharacterResources('bard', 1).hitDice.d8).toBeDefined();
      expect(getCharacterResources('cleric', 1).hitDice.d8).toBeDefined();
      expect(getCharacterResources('monk', 1).hitDice.d8).toBeDefined();
      expect(getCharacterResources('rogue', 1).hitDice.d8).toBeDefined();
      expect(getCharacterResources('sorcerer', 1).hitDice.d6).toBeDefined();
      expect(getCharacterResources('wizard', 1).hitDice.d6).toBeDefined();
      expect(getCharacterResources('unknown', 1).hitDice.d8).toBeDefined();
    });

    it('should initialize barbarian rages with correct scaling', () => {
      expect(getCharacterResources('barbarian', 1).rages.max).toBe(2);
      expect(getCharacterResources('barbarian', 3).rages.max).toBe(3);
      expect(getCharacterResources('barbarian', 6).rages.max).toBe(4);
      expect(getCharacterResources('barbarian', 12).rages.max).toBe(5);
      expect(getCharacterResources('barbarian', 17).rages.max).toBe(6);
    });

    it('should initialize fighter action surge', () => {
      expect(getCharacterResources('fighter', 2).actionSurge.max).toBe(1);
      expect(getCharacterResources('fighter', 17).actionSurge.max).toBe(2);
    });

    it('should initialize monk ki points', () => {
      expect(getCharacterResources('monk', 1).kiPoints).toBeUndefined();
      expect(getCharacterResources('monk', 2).kiPoints.max).toBe(2);
      expect(getCharacterResources('monk', 10).kiPoints.max).toBe(10);
    });

    it('should initialize sorcerer sorcery points', () => {
      expect(getCharacterResources('sorcerer', 1).sorceryPoints).toBeUndefined();
      expect(getCharacterResources('sorcerer', 2).sorceryPoints.max).toBe(2);
    });

    it('should initialize bardic inspiration with correct scaling', () => {
      expect(getCharacterResources('bard', 1).bardic_inspiration.max).toBe(2);
      expect(getCharacterResources('bard', 5).bardic_inspiration.max).toBe(3);
      expect(getCharacterResources('bard', 15).bardic_inspiration.max).toBe(4);
    });

    it('should initialize cleric channel divinity with correct scaling', () => {
      expect(getCharacterResources('cleric', 1).channelDivinity).toBeUndefined();
      expect(getCharacterResources('cleric', 2).channelDivinity.max).toBe(1);
      expect(getCharacterResources('cleric', 6).channelDivinity.max).toBe(2);
      expect(getCharacterResources('cleric', 18).channelDivinity.max).toBe(3);
    });

    it('should initialize paladin resources including channel divinity scaling', () => {
      const p1 = getCharacterResources('paladin', 1);
      expect(p1.layOnHands.max).toBe(5);
      expect(p1.channelDivinity).toBeUndefined();

      const p2 = getCharacterResources('paladin', 2);
      expect(p2.layOnHands.max).toBe(10);
      expect(p2.channelDivinity.max).toBe(1);

      const p6 = getCharacterResources('paladin', 6);
      expect(p6.channelDivinity.max).toBe(2);

      const p18 = getCharacterResources('paladin', 18);
      expect(p18.channelDivinity.max).toBe(3);
    });
  });

  describe('getClassFeatures', () => {
    it('should return barbarian features with rage scaling', () => {
      expect(getClassFeatures('barbarian', 1).find((f) => f.name === 'rage').maxUses).toBe(2);
      expect(getClassFeatures('barbarian', 3).find((f) => f.name === 'rage').maxUses).toBe(3);
      expect(getClassFeatures('barbarian', 6).find((f) => f.name === 'rage').maxUses).toBe(4);
      expect(getClassFeatures('barbarian', 12).find((f) => f.name === 'rage').maxUses).toBe(5);
      expect(getClassFeatures('barbarian', 17).find((f) => f.name === 'rage').maxUses).toBe(6);
    });

    it('should return rogue features', () => {
      expect(getClassFeatures('rogue', 1).some((f) => f.name === 'sneak_attack')).toBe(true);
      expect(getClassFeatures('rogue', 5).some((f) => f.name === 'uncanny_dodge')).toBe(true);
    });

    it('should return fighter features', () => {
      expect(getClassFeatures('fighter', 1).some((f) => f.name === 'second_wind')).toBe(true);
      expect(getClassFeatures('fighter', 2).some((f) => f.name === 'action_surge')).toBe(true);
    });

    it('should return paladin features', () => {
      expect(getClassFeatures('paladin', 1).some((f) => f.name === 'lay_on_hands')).toBe(true);
      expect(getClassFeatures('paladin', 2).some((f) => f.name === 'divine_smite')).toBe(true);
    });

    it('should return monk features', () => {
      expect(getClassFeatures('monk', 2).some((f) => f.name === 'ki')).toBe(true);
      expect(getClassFeatures('monk', 3).some((f) => f.name === 'deflect_missiles')).toBe(true);
      expect(getClassFeatures('monk', 1).some((f) => f.name === 'unarmored_defense')).toBe(true);
    });

    it('should return bard features', () => {
      expect(getClassFeatures('bard', 1).find((f) => f.name === 'bardic_inspiration').maxUses).toBe(
        2,
      );
      expect(getClassFeatures('bard', 5).find((f) => f.name === 'bardic_inspiration').maxUses).toBe(
        3,
      );
      expect(getClassFeatures('bard', 15).find((f) => f.name === 'bardic_inspiration').maxUses).toBe(
        4,
      );
    });

    it('should return cleric features', () => {
      expect(getClassFeatures('cleric', 2).find((f) => f.name === 'channel_divinity').maxUses).toBe(
        1,
      );
      expect(getClassFeatures('cleric', 6).find((f) => f.name === 'channel_divinity').maxUses).toBe(
        2,
      );
      expect(getClassFeatures('cleric', 18).find((f) => f.name === 'channel_divinity').maxUses).toBe(
        3,
      );
    });

    it('should return empty array for unknown class', () => {
      expect(getClassFeatures('unknown', 1)).toEqual([]);
    });
  });

  describe('canUseSneakAttack', () => {
    it('should return true if nearby ally exists', () => {
      const attacker = createMockParticipant({
        id: 'a1',
        characterClass: 'rogue',
        classFeatures: [{ name: 'sneak_attack' }],
      });
      const ally = createMockParticipant({ id: 'a2', participantType: 'player' });
      const target = createMockParticipant({ id: 't1', participantType: 'monster' });
      const encounter = createMockEncounter([attacker, ally, target]);
      expect(canUseSneakAttack(attacker, target, encounter)).toBe(true);
    });

    it('should return false if nearby ally is incapacitated', () => {
      const attacker = createMockParticipant({
        id: 'a1',
        characterClass: 'rogue',
        classFeatures: [{ name: 'sneak_attack' }],
      });
      const ally = createMockParticipant({
        id: 'a2',
        participantType: 'player',
        conditions: [{ name: 'stunned' }],
      });
      const target = createMockParticipant({ id: 't1', participantType: 'monster' });
      const encounter = createMockEncounter([attacker, ally, target]);
      expect(canUseSneakAttack(attacker, target, encounter)).toBe(false);
    });
  });

  describe('unarmored defense', () => {
    const abilityScores = {
      dexterity: { modifier: 3 },
      constitution: { modifier: 2 },
      wisdom: { modifier: 4 },
    };

    it('calculateUnarmoredDefenseAC should return correct AC', () => {
      expect(calculateUnarmoredDefenseAC('barbarian', abilityScores as any)).toBe(15);
      expect(calculateUnarmoredDefenseAC('monk', abilityScores as any)).toBe(17);
      expect(calculateUnarmoredDefenseAC('fighter', abilityScores as any)).toBe(13);
    });

    it('hasUnarmoredDefense should return true for barbarian and monk', () => {
      expect(hasUnarmoredDefense('barbarian', 1)).toBe(true);
      expect(hasUnarmoredDefense('monk', 1)).toBe(true);
      expect(hasUnarmoredDefense('fighter', 1)).toBe(false);
    });
  });

  describe('feature usage and state transitions', () => {
    const mockResources: any = {
      kiPoints: { max: 10, current: 5 },
      rages: { max: 3, current: 2 },
    };

    it('canUseClassFeature should check resources correctly', () => {
      expect(canUseClassFeature({ type: 'passive' } as any, mockResources)).toBe(true);
      expect(
        canUseClassFeature(
          { name: 'ki', type: 'active', maxUses: 10, resourceCost: 2 } as any,
          mockResources,
        ),
      ).toBe(true);
      expect(
        canUseClassFeature(
          { name: 'ki', type: 'active', maxUses: 10, resourceCost: 10 } as any,
          mockResources,
        ),
      ).toBe(false);
      expect(
        canUseClassFeature({ name: 'rage', maxUses: 3, currentUses: 2 } as any, mockResources),
      ).toBe(true);
      expect(
        canUseClassFeature({ name: 'rage', maxUses: 3, currentUses: 0 } as any, mockResources),
      ).toBe(false);
    });

    it('useClassFeature should decrement resources', () => {
      const kiResult = useClassFeature({ name: 'ki', resourceCost: 2 } as any, mockResources);
      expect(kiResult.resources.kiPoints.current).toBe(3);

      const rageResult = useClassFeature({ currentUses: 2 } as any, mockResources);
      expect(rageResult.feature.currentUses).toBe(1);
    });

    it('restoreClassFeatures should reset uses on rest', () => {
      const features: any[] = [
        { name: 'rage', usesPerRest: 'long', maxUses: 3, currentUses: 0 },
        { name: 'second_wind', usesPerRest: 'short', maxUses: 1, currentUses: 0 },
      ];
      const resources: any = { kiPoints: { max: 10, current: 0 } };

      const shortRest = restoreClassFeatures(features, resources, 'short');
      expect(shortRest.features.find((f) => f.name === 'second_wind').currentUses).toBe(1);
      expect(shortRest.features.find((f) => f.name === 'rage').currentUses).toBe(0);
      expect(shortRest.resources.kiPoints.current).toBe(10);

      const longRest = restoreClassFeatures(features, resources, 'long');
      expect(longRest.features.every((f) => f.currentUses === f.maxUses)).toBe(true);
    });

    describe('activateRage / deactivateRage', () => {
      it('activateRage should update participant and resources', () => {
        const participant = createMockParticipant({
          characterClass: 'barbarian',
          classFeatures: [{ name: 'rage' }],
          damageResistances: ['fire'],
        });
        const resources: any = { rages: { max: 2, current: 2 } };

        const result = activateRage(participant, resources);
        expect(result.updatedParticipant.isRaging).toBe(true);
        expect(result.updatedParticipant.damageResistances).toContain('bludgeoning');
        expect(result.updatedParticipant.damageResistances).toContain('fire');
        expect(result.updatedResources.rages.current).toBe(1);
      });

      it('activateRage should throw if already raging', () => {
        const participant = createMockParticipant({
          isRaging: true,
          classFeatures: [{ name: 'rage' }],
        });
        expect(() => activateRage(participant, { rages: { current: 1 } } as any)).toThrow(
          'Participant is already raging',
        );
      });

      it('activateRage should throw if no uses left', () => {
        const participant = createMockParticipant({
          classFeatures: [{ name: 'rage' }],
        });
        expect(() => activateRage(participant, { rages: { current: 0 } } as any)).toThrow(
          'No rage uses remaining',
        );
      });

      it('activateRage should throw if no rage feature', () => {
        const participant = createMockParticipant({ classFeatures: [] });
        expect(() => activateRage(participant, {} as any)).toThrow(
          'Participant does not have the rage feature',
        );
      });

      it('deactivateRage should remove state and resistances', () => {
        const participant = createMockParticipant({
          isRaging: true,
          damageResistances: ['bludgeoning', 'piercing', 'slashing', 'fire'],
        });
        const updated = deactivateRage(participant);
        expect(updated.isRaging).toBe(false);
        expect(updated.damageResistances).not.toContain('bludgeoning');
        expect(updated.damageResistances).toContain('fire');
      });
    });
  });
});
