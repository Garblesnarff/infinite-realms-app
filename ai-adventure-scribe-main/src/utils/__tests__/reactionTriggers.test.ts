/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  checkOpportunityAttacks,
  checkCounterspellOpportunities,
  checkDeflectMissilesOpportunities,
  checkUncannyDodgeOpportunities,
  checkReactionTriggers,
  checkMovementOpportunityAttacks,
} from '../reactionTriggers';

import type {
  CombatEncounter,
  CombatAction,
} from '@/types/combat';

describe('reactionTriggers', () => {
  const mockEncounter: CombatEncounter = {
    id: 'e1',
    sessionId: 's1',
    phase: 'active',
    currentRound: 1,
    participants: [
      {
        id: 'p1',
        name: 'Player 1',
        participantType: 'player',
        currentHitPoints: 10,
        reactionTaken: false,
        conditions: [],
      },
      {
        id: 'm1',
        name: 'Monster 1',
        participantType: 'enemy',
        currentHitPoints: 10,
        reactionTaken: false,
        conditions: [],
      },
      {
        id: 'm2',
        name: 'Monster 2',
        participantType: 'enemy',
        currentHitPoints: 10,
        reactionTaken: false,
        conditions: [],
      },
    ],
    actions: [],
    roundsElapsed: 0,
    startTime: new Date(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkOpportunityAttacks', () => {
    it('should detect opportunity attacks when a player moves away from enemies', () => {
      const p1 = mockEncounter.participants[0];
      const opps = checkOpportunityAttacks(p1, mockEncounter, 'melee', 'far');

      // Both m1 and m2 should have opportunity attacks
      expect(opps).toHaveLength(2);
      expect(opps.map(o => o.participantId)).toContain('m1');
      expect(opps.map(o => o.participantId)).toContain('m2');
      expect(opps[0].trigger).toBe('creature_leaves_reach');
    });

    it('should not detect opportunity attacks if enemies are already far', () => {
      const p1 = mockEncounter.participants[0];
      const opps = checkOpportunityAttacks(p1, mockEncounter, 'far', 'distant');
      expect(opps).toHaveLength(0);
    });

    it('should not detect opportunity attacks if enemy reaction is taken', () => {
      const encounterWithReactionTaken = {
        ...mockEncounter,
        participants: mockEncounter.participants.map(p =>
          p.id === 'm1' ? { ...p, reactionTaken: true } : p
        )
      };
      const p1 = encounterWithReactionTaken.participants[0];
      const opps = checkOpportunityAttacks(p1, encounterWithReactionTaken as any, 'melee', 'far');

      expect(opps).toHaveLength(1);
      expect(opps[0].participantId).toBe('m2');
    });
  });

  describe('checkCounterspellOpportunities', () => {
    it('should detect counterspell opportunities if enemy has it prepared', () => {
      const encounterWithCounterspell = {
        ...mockEncounter,
        participants: mockEncounter.participants.map(p =>
          p.id === 'm1' ? {
            ...p,
            preparedSpells: ['counterspell'],
            spellSlots: { 3: { current: 1 } }
          } : p
        )
      };
      const p1 = encounterWithCounterspell.participants[0];
      const opps = checkCounterspellOpportunities(p1 as any, encounterWithCounterspell as any, 3);

      expect(opps).toHaveLength(1);
      expect(opps[0].participantId).toBe('m1');
      expect(opps[0].trigger).toBe('spell_cast_in_range');
    });
  });

  describe('checkDeflectMissilesOpportunities', () => {
    it('should detect deflect missiles if target has the feature', () => {
      const attacker = mockEncounter.participants[0];
      const target = {
        ...mockEncounter.participants[1],
        classFeatures: [{ name: 'deflect_missiles' }]
      };

      const opps = checkDeflectMissilesOpportunities(attacker as any, target as any, true);
      expect(opps).toHaveLength(1);
      expect(opps[0].participantId).toBe(target.id);
      expect(opps[0].trigger).toBe('ranged_attack_hits');
    });
  });

  describe('checkUncannyDodgeOpportunities', () => {
    it('should detect uncanny dodge if target has the feature', () => {
      const attacker = mockEncounter.participants[0];
      const target = {
        ...mockEncounter.participants[1],
        classFeatures: [{ name: 'uncanny_dodge' }]
      };

      const opps = checkUncannyDodgeOpportunities(attacker as any, target as any);
      expect(opps).toHaveLength(1);
      expect(opps[0].participantId).toBe(target.id);
      expect(opps[0].trigger).toBe('damage_taken');
    });
  });

  describe('checkReactionTriggers', () => {
    it('should handle attack action with movement', () => {
      const action: Partial<CombatAction> & { movement: any } = {
        actionType: 'attack',
        participantId: 'p1',
        movement: { fromPosition: 'melee', toPosition: 'far' }
      };

      const opps = checkReactionTriggers(action, mockEncounter);
      expect(opps.some(o => o.trigger === 'creature_leaves_reach')).toBe(true);
    });

    it('should handle ranged attack hit for deflect missiles', () => {
      const targetWithDeflect = {
        ...mockEncounter.participants[1],
        classFeatures: [{ name: 'deflect_missiles' }]
      };
      const encounter = {
        ...mockEncounter,
        participants: [mockEncounter.participants[0], targetWithDeflect, mockEncounter.participants[2]]
      };

      const action: any = {
        actionType: 'attack',
        participantId: 'p1',
        targetParticipantId: 'm1',
        hit: true,
        isRangedWeaponAttack: true
      };

      const opps = checkReactionTriggers(action, encounter as any);
      expect(opps.some(o => o.trigger === 'ranged_attack_hits')).toBe(true);
    });

    it('should handle protection fighting style', () => {
      const allyWithProtection = {
        ...mockEncounter.participants[2], // m2 is ally of m1
        fightingStyles: [{ name: 'protection' }]
      };
      const encounter = {
        ...mockEncounter,
        participants: [mockEncounter.participants[0], mockEncounter.participants[1], allyWithProtection]
      };

      const action: any = {
        actionType: 'attack',
        participantId: 'p1',
        targetParticipantId: 'm1',
        hit: true
      };

      const opps = checkReactionTriggers(action, encounter as any);
      expect(opps.some(o => o.trigger === 'ally_attacked_nearby')).toBe(true);
    });

    it('should handle cast_spell action', () => {
      const counterspeller = {
        ...mockEncounter.participants[1],
        preparedSpells: ['counterspell'],
        spellSlots: { 3: { current: 1 } }
      };
      const encounter = {
        ...mockEncounter,
        participants: [mockEncounter.participants[0], counterspeller, mockEncounter.participants[2]]
      };

      const action: any = {
        actionType: 'cast_spell',
        participantId: 'p1',
        spellLevel: 3
      };

      const opps = checkReactionTriggers(action, encounter as any);
      expect(opps.some(o => o.trigger === 'spell_cast_in_range')).toBe(true);
    });

    it('should handle damage_dealt action for uncanny dodge, shield, absorb elements, and hellish rebuke', () => {
      const defender = {
        ...mockEncounter.participants[1],
        preparedSpells: ['shield', 'absorb_elements', 'hellish_rebuke'],
        spellSlots: { 1: { current: 3 } },
        classFeatures: [{ name: 'uncanny_dodge' }]
      };
      const encounter = {
        ...mockEncounter,
        participants: [mockEncounter.participants[0], defender, mockEncounter.participants[2]]
      };

      const action: any = {
        actionType: 'damage_dealt',
        participantId: 'p1',
        targetParticipantId: 'm1',
        damageType: 'fire'
      };

      const opps = checkReactionTriggers(action, encounter as any);

      const triggers = opps.map(o => o.trigger);
      expect(triggers).toContain('damage_taken'); // Uncanny dodge, Shield, Absorb Elements, Hellish Rebuke all trigger on damage_taken
      expect(opps.filter(o => o.availableReactions.includes('uncanny_dodge'))).toHaveLength(1);
      expect(opps.filter(o => o.availableReactions.includes('shield_spell'))).toHaveLength(1);
      expect(opps.filter(o => o.availableReactions.includes('absorb_elements'))).toHaveLength(1);
      expect(opps.filter(o => o.availableReactions.includes('hellish_rebuke'))).toHaveLength(1);
    });

    it('should handle move action for polearm master', () => {
      const master = {
        ...mockEncounter.participants[1],
        classFeatures: [{ name: 'polearm_master' }]
      };
      const encounter = {
        ...mockEncounter,
        participants: [mockEncounter.participants[0], master, mockEncounter.participants[2]]
      };

      const action: any = {
        actionType: 'move',
        participantId: 'p1',
        fromPosition: 'far',
        toPosition: 'melee'
      };

      const opps = checkReactionTriggers(action, encounter as any);
      expect(opps.some(o => o.trigger === 'creature_enters_reach')).toBe(true);
    });
  });

  describe('checkMovementOpportunityAttacks', () => {
    it('should detect opportunity attacks when a participant moves', () => {
      const p1 = mockEncounter.participants[0];
      const opps = checkMovementOpportunityAttacks(p1, mockEncounter, 'melee', 'far');

      expect(opps).toHaveLength(2);
      expect(opps.map(o => o.participantId)).toContain('m1');
      expect(opps.map(o => o.participantId)).toContain('m2');
    });
  });
});
