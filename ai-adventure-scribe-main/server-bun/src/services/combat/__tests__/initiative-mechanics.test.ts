import { describe, it, expect, vi } from 'vitest';
import { InitiativeMechanics, rollD20 } from '../initiative-mechanics';

describe('InitiativeMechanics', () => {
  describe('rollD20', () => {
    it('should return a number between 1 and 20', () => {
      for (let i = 0; i < 100; i++) {
        const roll = rollD20();
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(20);
        expect(Math.floor(roll)).toBe(roll);
      }
    });
  });

  describe('calculateInitiative', () => {
    it('should add roll and modifier', () => {
      expect(InitiativeMechanics.calculateInitiative(10, 5)).toBe(15);
      expect(InitiativeMechanics.calculateInitiative(1, -2)).toBe(-1);
      expect(InitiativeMechanics.calculateInitiative(20, 0)).toBe(20);
    });
  });

  describe('sortParticipants', () => {
    it('should sort by initiative descending', () => {
      const participants = [
        { initiative: 10, initiativeModifier: 2, id: '1' },
        { initiative: 20, initiativeModifier: 0, id: '2' },
        { initiative: 15, initiativeModifier: 5, id: '3' },
      ];
      const sorted = InitiativeMechanics.sortParticipants(participants);
      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });

    it('should break ties using initiativeModifier descending', () => {
      const participants = [
        { initiative: 15, initiativeModifier: 2, id: '1' },
        { initiative: 15, initiativeModifier: 5, id: '2' },
        { initiative: 15, initiativeModifier: 0, id: '3' },
      ];
      const sorted = InitiativeMechanics.sortParticipants(participants);
      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('1');
      expect(sorted[2].id).toBe('3');
    });
  });

  describe('calculateNextTurn', () => {
    it('should advance to the next turn order', () => {
      const result = InitiativeMechanics.calculateNextTurn(0, 3, 1);
      expect(result.nextTurnOrder).toBe(1);
      expect(result.newRound).toBe(false);
      expect(result.newRoundNumber).toBe(1);
    });

    it('should wrap around and increment round number', () => {
      const result = InitiativeMechanics.calculateNextTurn(2, 3, 1);
      expect(result.nextTurnOrder).toBe(0);
      expect(result.newRound).toBe(true);
      expect(result.newRoundNumber).toBe(2);
    });

    it('should handle empty participants', () => {
      const result = InitiativeMechanics.calculateNextTurn(0, 0, 1);
      expect(result.nextTurnOrder).toBe(0);
      expect(result.newRound).toBe(false);
      expect(result.newRoundNumber).toBe(1);
    });

    it('should match original behavior for single participant', () => {
        // In original code:
        // const nextTurnOrder = (0 + 1) % 1; // 0
        // const newRound = 0 === 0 && 0 !== 0; // false
        const result = InitiativeMechanics.calculateNextTurn(0, 1, 1);
        expect(result.nextTurnOrder).toBe(0);
        expect(result.newRound).toBe(false);
        expect(result.newRoundNumber).toBe(1);
    });
  });

  describe('getTurnOrderEntries', () => {
    it('should map participants to turn order entries correctly', () => {
      const participants = [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ] as any;

      const entries = InitiativeMechanics.getTurnOrderEntries(participants, 1, '2');

      expect(entries).toHaveLength(3);

      expect(entries[0].participant.id).toBe('1');
      expect(entries[0].isCurrent).toBe(false);
      expect(entries[0].hasGone).toBe(true);

      expect(entries[1].participant.id).toBe('2');
      expect(entries[1].isCurrent).toBe(true);
      expect(entries[1].hasGone).toBe(false);

      expect(entries[2].participant.id).toBe('3');
      expect(entries[2].isCurrent).toBe(false);
      expect(entries[2].hasGone).toBe(false);
    });
  });
});
