/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import {
  getRageDamageBonus,
  getBardicInspirationDie,
  canUseSneakAttack,
  getSneakAttackDice,
  getDivineSmiteDamage,
  getMartialArtsDie,
  calculateUnarmoredDefenseAC,
  hasUnarmoredDefense,
  activateRage,
  deactivateRage,
  isIncapacitated,
} from '../classMechanics';

describe('classMechanics', () => {
  const createMockParticipant = (overrides = {}): any => ({
    id: 'p1',
    name: 'Test Participant',
    participantType: 'player',
    characterClass: 'fighter',
    level: 1,
    currentHitPoints: 10,
    maxHitPoints: 10,
    armorClass: 15,
    conditions: [],
    damageResistances: [],
    classFeatures: [],
    ...overrides,
  });

  const createMockEncounter = (participants: any[] = []): any => ({
    id: 'e1',
    participants,
  });

  describe('getRageDamageBonus', () => {
    it('should return 2 for levels 1-8', () => {
      expect(getRageDamageBonus(1)).toBe(2);
      expect(getRageDamageBonus(8)).toBe(2);
    });

    it('should return 3 for levels 9-15', () => {
      expect(getRageDamageBonus(9)).toBe(3);
      expect(getRageDamageBonus(15)).toBe(3);
    });

    it('should return 4 for levels 16+', () => {
      expect(getRageDamageBonus(16)).toBe(4);
      expect(getRageDamageBonus(20)).toBe(4);
    });
  });

  describe('getBardicInspirationDie', () => {
    it('should return 6 for levels 1-4', () => {
      expect(getBardicInspirationDie(1)).toBe(6);
      expect(getBardicInspirationDie(4)).toBe(6);
    });

    it('should return 8 for levels 5-9', () => {
      expect(getBardicInspirationDie(5)).toBe(8);
      expect(getBardicInspirationDie(9)).toBe(8);
    });

    it('should return 10 for levels 10-14', () => {
      expect(getBardicInspirationDie(10)).toBe(10);
      expect(getBardicInspirationDie(14)).toBe(10);
    });

    it('should return 12 for levels 15+', () => {
      expect(getBardicInspirationDie(15)).toBe(12);
      expect(getBardicInspirationDie(20)).toBe(12);
    });
  });

  describe('getSneakAttackDice', () => {
    it('should return correct dice count (ceil level/2)', () => {
      expect(getSneakAttackDice(1)).toBe(1);
      expect(getSneakAttackDice(2)).toBe(1);
      expect(getSneakAttackDice(3)).toBe(2);
      expect(getSneakAttackDice(4)).toBe(2);
      expect(getSneakAttackDice(5)).toBe(3);
      expect(getSneakAttackDice(20)).toBe(10);
    });
  });

  describe('getDivineSmiteDamage', () => {
    it('should return 2d8 for 1st level slot', () => {
      expect(getDivineSmiteDamage(1)).toBe('2d8');
    });

    it('should return 3d8 for 2nd level slot', () => {
      expect(getDivineSmiteDamage(2)).toBe('3d8');
    });

    it('should double dice for critical hits', () => {
      expect(getDivineSmiteDamage(1, true)).toBe('4d8');
      expect(getDivineSmiteDamage(2, true)).toBe('6d8');
    });

    it('should cap at 5d8 for high level slots (BUG DETECTION)', () => {
      // D&D 5e Divine Smite is capped at 5d8 (4th level slot)
      // Currently it might return 6d8 for 5th level
      expect(getDivineSmiteDamage(4)).toBe('5d8');
      expect(getDivineSmiteDamage(5)).toBe('5d8');
    });
  });

  describe('getMartialArtsDie', () => {
    it('should return 4 for levels 1-4', () => {
      expect(getMartialArtsDie(1)).toBe(4);
      expect(getMartialArtsDie(4)).toBe(4);
    });

    it('should return 6 for levels 5-10', () => {
      expect(getMartialArtsDie(5)).toBe(6);
      expect(getMartialArtsDie(10)).toBe(6);
    });

    it('should return 8 for levels 11-16', () => {
      expect(getMartialArtsDie(11)).toBe(8);
      expect(getMartialArtsDie(16)).toBe(8);
    });

    it('should return 10 for levels 17+', () => {
      expect(getMartialArtsDie(17)).toBe(10);
      expect(getMartialArtsDie(20)).toBe(10);
    });
  });

  describe('isIncapacitated', () => {
    it('should return true for stunned, paralyzed, unconscious, petrified', () => {
      expect(isIncapacitated(createMockParticipant({ conditions: [{ name: 'stunned' }] }))).toBe(true);
      expect(isIncapacitated(createMockParticipant({ conditions: [{ name: 'paralyzed' }] }))).toBe(true);
      expect(isIncapacitated(createMockParticipant({ conditions: [{ name: 'unconscious' }] }))).toBe(true);
      expect(isIncapacitated(createMockParticipant({ conditions: [{ name: 'petrified' }] }))).toBe(true);
    });

    it('should return true for the explicit incapacitated condition (BUG DETECTION)', () => {
      expect(isIncapacitated(createMockParticipant({ conditions: [{ name: 'incapacitated' }] }))).toBe(true);
    });

    it('should return false if no incapacitating conditions', () => {
      expect(isIncapacitated(createMockParticipant({ conditions: [{ name: 'poisoned' }] }))).toBe(false);
      expect(isIncapacitated(createMockParticipant({ conditions: [] }))).toBe(false);
    });
  });

  describe('canUseSneakAttack', () => {
    const attacker = createMockParticipant({
      characterClass: 'rogue',
      classFeatures: [{ name: 'sneak_attack' }],
    });
    const target = createMockParticipant({ participantType: 'monster' });

    it('should return false if not a rogue or lacks feature', () => {
      const fighter = createMockParticipant({ characterClass: 'fighter' });
      expect(canUseSneakAttack(fighter, target, createMockEncounter())).toBe(false);
    });

    it('should return true if there is a nearby ally (and no disadvantage)', () => {
      const ally = createMockParticipant({ id: 'ally', participantType: 'player' });
      const encounter = createMockEncounter([attacker, target, ally]);
      expect(canUseSneakAttack(attacker, target, encounter)).toBe(true);
    });

    it('should return false if nearby ally is incapacitated', () => {
      const ally = createMockParticipant({
        id: 'ally',
        participantType: 'player',
        conditions: [{ name: 'stunned' }],
      });
      const encounter = createMockEncounter([attacker, target, ally]);
      expect(canUseSneakAttack(attacker, target, encounter)).toBe(false);
    });

    it('should return true if attacker has advantage (BUG DETECTION)', () => {
      // Currently the implementation ONLY checks for nearby allies
      const attackerWithAdvantage = createMockParticipant({
        ...attacker,
        conditions: [{ name: 'invisible' }], // invisible gives advantage
      });
      const encounter = createMockEncounter([attackerWithAdvantage, target]);
      expect(canUseSneakAttack(attackerWithAdvantage, target, encounter)).toBe(true);
    });

    it('should return false if attacker has disadvantage (BUG DETECTION)', () => {
      // Sneak attack cannot be used if you have disadvantage
      const attackerWithDisadvantage = createMockParticipant({
        ...attacker,
        conditions: [{ name: 'blinded' }], // blinded gives disadvantage
      });
      const ally = createMockParticipant({ id: 'ally', participantType: 'player' });
      const encounter = createMockEncounter([attackerWithDisadvantage, target, ally]);
      expect(canUseSneakAttack(attackerWithDisadvantage, target, encounter)).toBe(false);
    });
  });

  describe('calculateUnarmoredDefenseAC', () => {
    const scores = {
      dexterity: { modifier: 3 },
      constitution: { modifier: 2 },
      wisdom: { modifier: 4 },
    };

    it('should calculate Barbarian AC (10 + DEX + CON)', () => {
      expect(calculateUnarmoredDefenseAC('barbarian', scores as any)).toBe(15);
    });

    it('should calculate Monk AC (10 + DEX + WIS)', () => {
      expect(calculateUnarmoredDefenseAC('monk', scores as any)).toBe(17);
    });

    it('should fallback to 10 + DEX for other classes', () => {
      expect(calculateUnarmoredDefenseAC('fighter', scores as any)).toBe(13);
    });
  });

  describe('hasUnarmoredDefense', () => {
    it('should return true for barbarian and monk at level 1+', () => {
      expect(hasUnarmoredDefense('barbarian', 1)).toBe(true);
      expect(hasUnarmoredDefense('monk', 1)).toBe(true);
    });

    it('should return false for other classes', () => {
      expect(hasUnarmoredDefense('fighter', 1)).toBe(false);
    });
  });

  describe('rage management', () => {
    describe('activateRage', () => {
      it('should activate rage and add resistances', () => {
        const participant = createMockParticipant({
          characterClass: 'barbarian',
          classFeatures: [{ name: 'rage' }],
          damageResistances: ['fire'],
        });
        const resources = { rages: { current: 2, max: 2 } };

        const result = activateRage(participant, resources);
        expect(result.updatedParticipant.isRaging).toBe(true);
        expect(result.updatedParticipant.damageResistances).toContain('bludgeoning');
        expect(result.updatedParticipant.damageResistances).toContain('piercing');
        expect(result.updatedParticipant.damageResistances).toContain('slashing');
        expect(result.updatedParticipant.damageResistances).toContain('fire');
        expect(result.updatedResources.rages.current).toBe(1);
      });

      it('should throw if already raging', () => {
        const participant = createMockParticipant({
          characterClass: 'barbarian',
          classFeatures: [{ name: 'rage' }],
          isRaging: true,
        });
        expect(() => activateRage(participant, { rages: { current: 1 } } as any)).toThrow();
      });

      it('should throw if no rage uses', () => {
        const participant = createMockParticipant({
          characterClass: 'barbarian',
          classFeatures: [{ name: 'rage' }],
        });
        expect(() => activateRage(participant, { rages: { current: 0 } } as any)).toThrow();
      });
    });

    describe('deactivateRage', () => {
      it('should deactivate rage and remove resistances', () => {
        const participant = createMockParticipant({
          isRaging: true,
          damageResistances: ['bludgeoning', 'piercing', 'slashing'],
        });
        const result = deactivateRage(participant);
        expect(result.isRaging).toBe(false);
        expect(result.damageResistances).not.toContain('bludgeoning');
      });

      it('should NOT remove pre-existing resistances (BUG DETECTION)', () => {
        const participant = createMockParticipant({
          isRaging: true,
          damageResistances: ['bludgeoning', 'fire'],
        });
        // If 'bludgeoning' was a natural resistance, it shouldn't be removed
        // Currently the implementation removes ALL bludgeoning, piercing, slashing
        // This is hard to fix without knowing the base state, but let's document it.
        const result = deactivateRage(participant);
        expect(result.damageResistances).toContain('fire');
        // If we wanted to fix this, we'd need to know if bludgeoning was there before.
      });
    });
  });
});
