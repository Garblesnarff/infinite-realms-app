/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  processReactionResponse,
  clearExpiredReactions,
  hasAvailableReactions,
} from '../reactionSystem';
import {
  createReactionOpportunity,
  checkOpportunityAttacks,
  checkCounterspellOpportunities,
  checkDeflectMissilesOpportunities,
  checkUncannyDodgeOpportunities,
  checkShieldSpellOpportunities,
  checkAbsorbElementsOpportunities,
  checkHellishRebukeOpportunities,
  checkReactionTriggers,
} from '../reactionTriggers';

// Mock diceUtils
vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
}));

describe('reactionSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createReactionOpportunity', () => {
    it('should create a reaction opportunity with correct structure', () => {
      const opportunity = createReactionOpportunity(
        'p1',
        'creature_leaves_reach',
        'Leaving reach',
        ['opportunity_attack'],
        'p2',
      );

      expect(opportunity.participantId).toBe('p1');
      expect(opportunity.trigger).toBe('creature_leaves_reach');
      expect(opportunity.triggerDescription).toBe('Leaving reach');
      expect(opportunity.availableReactions).toEqual(['opportunity_attack']);
      expect(opportunity.triggeredBy).toBe('p2');
      expect(opportunity.id).toMatch(/^reaction_/);
      expect(opportunity.expiresAtEndOfTurn).toBe(true);
    });
  });

  describe('checkOpportunityAttacks', () => {
    it('should trigger opportunity attack when enemy leaves reach', () => {
      const movingParticipant: any = { id: 'p1', participantType: 'player' };
      const encounter: any = {
        participants: [
          {
            id: 'e1',
            name: 'Enemy 1',
            participantType: 'enemy',
            currentHitPoints: 10,
            reactionTaken: false,
            conditions: [],
          },
        ],
      };

      const opportunities = checkOpportunityAttacks(movingParticipant, encounter, 'melee', 'far');

      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].participantId).toBe('e1');
      expect(opportunities[0].trigger).toBe('creature_leaves_reach');
    });

    it('should not trigger if enemy is incapacitated', () => {
      const movingParticipant: any = { id: 'p1', participantType: 'player' };
      const encounter: any = {
        participants: [
          {
            id: 'e1',
            name: 'Enemy 1',
            participantType: 'enemy',
            currentHitPoints: 10,
            reactionTaken: false,
            conditions: [{ name: 'paralyzed' }],
          },
        ],
      };

      const opportunities = checkOpportunityAttacks(movingParticipant, encounter, 'melee', 'far');
      expect(opportunities).toHaveLength(0);
    });

    it('should not trigger if enemy already took reaction', () => {
      const movingParticipant: any = { id: 'p1', participantType: 'player' };
      const encounter: any = {
        participants: [
          {
            id: 'e1',
            name: 'Enemy 1',
            participantType: 'enemy',
            currentHitPoints: 10,
            reactionTaken: true,
            conditions: [],
          },
        ],
      };

      const opportunities = checkOpportunityAttacks(movingParticipant, encounter, 'melee', 'far');
      expect(opportunities).toHaveLength(0);
    });
  });

  describe('checkCounterspellOpportunities', () => {
    it('should trigger counterspell for participants with 3rd level slots and counterspell prepared', () => {
      const caster: any = { id: 'p1' };
      const encounter: any = {
        participants: [
          {
            id: 'p2',
            currentHitPoints: 10,
            reactionTaken: false,
            preparedSpells: ['counterspell'],
            spellSlots: { 3: { current: 1 } },
          },
        ],
      };

      const opportunities = checkCounterspellOpportunities(caster, encounter, 3);
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].availableReactions).toContain('counterspell');
    });

    it('should not trigger if no 3rd level or higher slots', () => {
      const caster: any = { id: 'p1' };
      const encounter: any = {
        participants: [
          {
            id: 'p2',
            currentHitPoints: 10,
            reactionTaken: false,
            spellSlots: { 1: { current: 4 }, 2: { current: 2 } },
          },
        ],
      };

      const opportunities = checkCounterspellOpportunities(caster, encounter, 3);
      expect(opportunities).toHaveLength(0);
    });
  });

  describe('checkDeflectMissilesOpportunities', () => {
    it('should trigger for monks on ranged hits', () => {
      const attacker: any = { id: 'p1' };
      const target: any = {
        id: 'p2',
        reactionTaken: false,
        classFeatures: [{ name: 'deflect_missiles' }],
      };

      const opportunities = checkDeflectMissilesOpportunities(attacker, target, true);
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].availableReactions).toContain('deflect_missiles');
    });

    it('should not trigger for non-monks', () => {
      const attacker: any = { id: 'p1' };
      const target: any = {
        id: 'p2',
        reactionTaken: false,
        classFeatures: [],
      };

      const opportunities = checkDeflectMissilesOpportunities(attacker, target, true);
      expect(opportunities).toHaveLength(0);
    });
  });

  describe('checkUncannyDodgeOpportunities', () => {
    it('should trigger for rogues when damaged', () => {
      const attacker: any = { id: 'p1' };
      const target: any = {
        id: 'p2',
        reactionTaken: false,
        classFeatures: [{ name: 'uncanny_dodge' }],
      };

      const opportunities = checkUncannyDodgeOpportunities(attacker, target, true);
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].availableReactions).toContain('uncanny_dodge');
    });
  });

  describe('checkShieldSpellOpportunities', () => {
    it('should trigger if shield spell is prepared and has slots', () => {
      const target: any = {
        id: 'p2',
        currentHitPoints: 10,
        reactionTaken: false,
        preparedSpells: ['shield'],
        spellSlots: { 1: { current: 1 } },
      };
      const encounter: any = { participants: [target] };

      const opportunities = checkShieldSpellOpportunities(target, encounter);
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].availableReactions).toContain('shield_spell');
    });
  });

  describe('checkAbsorbElementsOpportunities', () => {
    it('should trigger if absorb elements is prepared and has slots', () => {
      const target: any = {
        id: 'p2',
        currentHitPoints: 10,
        reactionTaken: false,
        preparedSpells: ['absorb_elements'],
        spellSlots: { 1: { current: 1 } },
      };
      const opportunities = checkAbsorbElementsOpportunities(target, {} as any, 'fire');
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].availableReactions).toContain('absorb_elements');
    });
  });

  describe('checkHellishRebukeOpportunities', () => {
    it('should trigger for warlocks on damage from enemy', () => {
      const target: any = {
        id: 'p2',
        currentHitPoints: 10,
        reactionTaken: false,
        preparedSpells: ['hellish_rebuke'],
        spellSlots: { 1: { current: 1 } },
      };
      const attacker: any = { id: 'p1' };
      const opportunities = checkHellishRebukeOpportunities(target, attacker, {} as any);
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].availableReactions).toContain('hellish_rebuke');
    });
  });

  describe('processReactionResponse', () => {
    const encounter: any = {
      currentRound: 1,
      participants: [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ],
    };

    it('should process opportunity attack correctly', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p2' } as any;
      const action = processReactionResponse(opportunity, 'opportunity_attack', encounter);

      expect(action.actionType).toBe('opportunity_attack');
      expect(action.participantId).toBe('p1');
      expect(action.targetParticipantId).toBe('p2');
    });

    it('should process shield spell correctly', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p1' } as any;
      const action = processReactionResponse(opportunity, 'shield_spell', encounter);

      expect(action.actionType).toBe('shield_spell');
      expect(action.description).toContain('casts shield');
    });

    it('should process counterspell correctly', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p2' } as any;
      const action = processReactionResponse(opportunity, 'counterspell', encounter);
      expect(action.actionType).toBe('counterspell');
    });

    it('should process deflect_missiles correctly', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p2' } as any;
      const action = processReactionResponse(opportunity, 'deflect_missiles', encounter);
      expect(action.actionType).toBe('deflect_missiles');
    });

    it('should process uncanny_dodge correctly', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p2' } as any;
      const action = processReactionResponse(opportunity, 'uncanny_dodge', encounter);
      expect(action.actionType).toBe('uncanny_dodge');
    });

    it('should process absorb_elements correctly', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p1' } as any;
      const action = processReactionResponse(opportunity, 'absorb_elements', encounter);
      expect(action.actionType).toBe('absorb_elements');
    });

    it('should process hellish_rebuke correctly', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p2' } as any;
      const action = processReactionResponse(opportunity, 'hellish_rebuke', encounter);
      expect(action.actionType).toBe('hellish_rebuke');
    });

    it('should process protection reaction (use_object) correctly', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p2' } as any;
      const action = processReactionResponse(opportunity, 'use_object', encounter);
      expect(action.actionType).toBe('use_object');
      expect(action.description).toContain('protection fighting style');
    });

    it('should throw error for unsupported reaction', () => {
      const opportunity = { participantId: 'p1', triggeredBy: 'p2' } as any;
      expect(() => processReactionResponse(opportunity, 'dash' as any, encounter)).toThrow(
        'Unsupported reaction type',
      );
    });
  });

  describe('clearExpiredReactions', () => {
    it('should clear opportunities that expire at end of turn', () => {
      const opportunities: any[] = [
        { id: 'o1', participantId: 'p1', expiresAtEndOfTurn: true },
        { id: 'o2', participantId: 'p2', expiresAtEndOfTurn: true },
      ];

      const cleared = clearExpiredReactions(opportunities, 'p1');
      expect(cleared).toHaveLength(1);
      expect(cleared[0].participantId).toBe('p1');
    });
  });

  describe('checkReactionTriggers', () => {
    it('should check for opportunity attacks on movement during attack', () => {
      const encounter: any = {
        participants: [
          { id: 'p1', participantType: 'player' },
          {
            id: 'e1',
            participantType: 'enemy',
            currentHitPoints: 10,
            reactionTaken: false,
            conditions: [],
          },
        ],
      };
      const action: any = {
        actionType: 'attack',
        participantId: 'p1',
        movement: { fromPosition: 'melee', toPosition: 'far' },
      };

      const opportunities = checkReactionTriggers(action, encounter);
      expect(opportunities.some((o) => o.trigger === 'creature_leaves_reach')).toBe(true);
    });

    it('should check for counterspell on cast_spell', () => {
      const encounter: any = {
        participants: [
          { id: 'p1', participantType: 'player' },
          {
            id: 'p2',
            currentHitPoints: 10,
            reactionTaken: false,
            preparedSpells: ['counterspell'],
            spellSlots: { 3: { current: 1 } },
          },
        ],
      };
      const action: any = {
        actionType: 'cast_spell',
        participantId: 'p1',
        spellLevel: 1,
      };

      const opportunities = checkReactionTriggers(action, encounter);
      expect(opportunities.some((o) => o.availableReactions.includes('counterspell'))).toBe(true);
    });

    it('should check for defensive reactions on damage_dealt', () => {
      const attacker: any = { id: 'p1', participantType: 'player' };
      const target: any = {
        id: 'p2',
        participantType: 'enemy',
        currentHitPoints: 10,
        reactionTaken: false,
        classFeatures: [{ name: 'uncanny_dodge' }],
      };
      const encounter: any = {
        participants: [attacker, target],
      };
      const action: any = {
        actionType: 'damage_dealt',
        participantId: 'p1',
        targetParticipantId: 'p2',
      };

      const opportunities = checkReactionTriggers(action, encounter);
      expect(opportunities.some((o) => o.availableReactions.includes('uncanny_dodge'))).toBe(true);
    });

    it('should check for polearm master on move', () => {
      const master: any = {
        id: 'p2',
        currentHitPoints: 10,
        reactionTaken: false,
        classFeatures: [{ name: 'polearm_master' }],
      };
      const encounter: any = {
        participants: [{ id: 'p1', participantType: 'player' }, master],
      };
      const action: any = {
        actionType: 'move',
        participantId: 'p1',
        fromPosition: 'far',
        toPosition: 'melee',
      };

      const opportunities = checkReactionTriggers(action, encounter);
      expect(opportunities.some((o) => o.trigger === 'creature_enters_reach')).toBe(true);
    });
  });

  describe('hasAvailableReactions', () => {
    it('should return true if participant has not taken reaction and is conscious', () => {
      const participant: any = { currentHitPoints: 10, reactionTaken: false };
      expect(hasAvailableReactions(participant)).toBe(true);
    });

    it('should return false if reaction taken', () => {
      const participant: any = { currentHitPoints: 10, reactionTaken: true };
      expect(hasAvailableReactions(participant)).toBe(false);
    });

    it('should return false if unconscious', () => {
      const participant: any = { currentHitPoints: 0, reactionTaken: false };
      expect(hasAvailableReactions(participant)).toBe(false);
    });
  });
});
