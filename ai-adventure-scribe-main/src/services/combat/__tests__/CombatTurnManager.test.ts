import { describe, it, expect, vi, beforeEach } from 'vitest';

import { combatAuditSystem } from '../../combat-audit';
import { CombatTurnManager } from '../CombatTurnManager';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../combat-audit', () => ({
  combatAuditSystem: {
    startCombatAudit: vi.fn(),
    recordAction: vi.fn(),
  },
}));

describe('CombatTurnManager', () => {
  let manager: CombatTurnManager;
  const combatId = 'test-combat-id';

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new CombatTurnManager();
  });

  describe('addInitiativeEntry', () => {
    it('should add a new initiative entry and start audit if it is the first entry', () => {
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 15, 2, true);

      expect(combatAuditSystem.startCombatAudit).toHaveBeenCalledWith(combatId);
      expect(combatAuditSystem.recordAction).toHaveBeenCalledWith(
        expect.objectContaining({
          combatId,
          actorId: 'actor-1',
          actionType: 'initiative',
        }),
      );
    });

    it('should replace an existing entry for the same actor (re-roll)', () => {
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 10, 2, true);
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 20, 2, true);

      const turnOrder = manager.completeInitiativePhase(combatId);
      expect(turnOrder?.entries).toHaveLength(1);
      expect(turnOrder?.entries[0].initiative).toBe(20);
    });
  });

  describe('completeInitiativePhase', () => {
    it('should return null if no entries exist for the combat', () => {
      const result = manager.completeInitiativePhase('non-existent');
      expect(result).toBeNull();
    });

    it('should sort entries by initiative descending', () => {
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 10, 2);
      manager.addInitiativeEntry(combatId, 'actor-2', 'Monster', 20, 0);
      manager.addInitiativeEntry(combatId, 'actor-3', 'Sidekick', 15, 1);

      const turnOrder = manager.completeInitiativePhase(combatId);

      expect(turnOrder?.entries[0].actorId).toBe('actor-2'); // 20
      expect(turnOrder?.entries[1].actorId).toBe('actor-3'); // 15
      expect(turnOrder?.entries[2].actorId).toBe('actor-1'); // 10
    });

    it('should use dexModifier as a tiebreaker for equal initiative', () => {
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 15, 2);
      manager.addInitiativeEntry(combatId, 'actor-2', 'Monster', 15, 5);
      manager.addInitiativeEntry(combatId, 'actor-3', 'Sidekick', 15, 0);

      const turnOrder = manager.completeInitiativePhase(combatId);

      expect(turnOrder?.entries[0].actorId).toBe('actor-2'); // dex 5
      expect(turnOrder?.entries[1].actorId).toBe('actor-1'); // dex 2
      expect(turnOrder?.entries[2].actorId).toBe('actor-3'); // dex 0
    });
  });

  describe('turn management', () => {
    beforeEach(() => {
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 20, 5);
      manager.addInitiativeEntry(combatId, 'actor-2', 'Monster', 10, 0);
      manager.completeInitiativePhase(combatId);
    });

    it('should get current actor', () => {
      const current = manager.getCurrentActor(combatId);
      expect(current?.actorId).toBe('actor-1');
    });

    it('should return null for current actor if initiative is not complete', () => {
      const result = manager.getCurrentActor('other-combat');
      expect(result).toBeNull();
    });

    it('should return null for current actor if turn index is out of bounds', () => {
      // Manually manipulate state for testing
      const turnOrder = manager.getTurnOrder(combatId);
      if (turnOrder) {
        turnOrder.currentTurnIndex = 999;
      }
      expect(manager.getCurrentActor(combatId)).toBeNull();
    });

    it('should return null for next turn if turn order is missing', () => {
      expect(manager.nextTurn('missing-combat')).toBeNull();
    });

    it('should advance to next turn', () => {
      const next = manager.nextTurn(combatId);
      expect(next?.actorId).toBe('actor-2');

      const turnOrder = manager.getTurnOrder(combatId);
      expect(turnOrder?.currentTurnIndex).toBe(1);
      expect(turnOrder?.entries[0].hasActed).toBe(true);
    });

    it('should start a new round after all actors have gone', () => {
      manager.nextTurn(combatId); // actor 1 finishes, moves to actor 2
      const nextRoundStart = manager.nextTurn(combatId); // actor 2 finishes, moves back to actor 1, round 2

      expect(nextRoundStart?.actorId).toBe('actor-1');
      const turnOrder = manager.getTurnOrder(combatId);
      expect(turnOrder?.round).toBe(2);
      expect(turnOrder?.currentTurnIndex).toBe(0);
      expect(turnOrder?.entries.every((e) => e.hasActed === false)).toBe(true);
    });
  });

  describe('isInitiativeComplete', () => {
    it('should return true when all expected actors have rolled', () => {
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 10, 2);
      manager.addInitiativeEntry(combatId, 'actor-2', 'Monster', 15, 0);

      expect(manager.isInitiativeComplete(combatId, ['actor-1', 'actor-2'])).toBe(true);
    });

    it('should return false when some expected actors are missing', () => {
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 10, 2);

      expect(manager.isInitiativeComplete(combatId, ['actor-1', 'actor-2'])).toBe(false);
    });

    it('should return false when no initiative entries exist for the combat', () => {
      expect(manager.isInitiativeComplete('missing-combat', ['actor-1'])).toBe(false);
    });
  });

  describe('state clearing', () => {
    it('should clear state for a specific encounter', () => {
      manager.addInitiativeEntry(combatId, 'actor-1', 'Hero', 10, 2);
      manager.completeInitiativePhase(combatId);

      manager.clearEncounterState(combatId);

      expect(manager.getTurnOrder(combatId)).toBeNull();
      expect(manager.hasInitiativeBeenRolled(combatId)).toBe(false);
    });

    it('should clear all state', () => {
      manager.addInitiativeEntry('combat-1', 'actor-1', 'Hero', 10, 2);
      manager.addInitiativeEntry('combat-2', 'actor-2', 'Monster', 15, 0);

      manager.clearAllState();

      expect(manager.getTurnOrder('combat-1')).toBeNull();
      expect(manager.getTurnOrder('combat-2')).toBeNull();
    });
  });
});
