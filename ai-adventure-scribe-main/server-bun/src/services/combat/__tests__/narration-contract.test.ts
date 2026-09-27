import { describe, expect, it } from 'vitest';

import {
  aggregateContractActions,
  buildNarrationContract,
} from '../narration-contract.js';

describe('narration-contract', () => {
  describe('aggregateContractActions', () => {
    it('groups by kind with counts and unanimous hit/miss', () => {
      const aggregated = aggregateContractActions([
        { kind: 'attack', actorSlug: 'the-veteran', isPlayer: true, hit: true },
        { kind: 'attack', actorSlug: 'the-veteran', isPlayer: true, hit: true },
        { kind: 'dash', actorSlug: 'the-veteran', isPlayer: true },
      ]);
      expect(aggregated).toEqual([
        { kind: 'attack', count: 2, actorSlugs: ['the-veteran'], hit: true, mixed: false },
        { kind: 'dash', count: 1, actorSlugs: ['the-veteran'], hit: undefined, mixed: false },
      ]);
    });

    it('marks mixed hit/miss', () => {
      const aggregated = aggregateContractActions([
        { kind: 'attack', actorSlug: 'the-veteran', isPlayer: true, hit: true },
        { kind: 'attack', actorSlug: 'the-veteran', isPlayer: true, hit: false },
      ]);
      expect(aggregated[0].mixed).toBe(true);
      expect(aggregated[0].hit).toBeUndefined();
    });
  });

  describe('buildNarrationContract', () => {
    it('emits turn, resolved actions, and a parseable contract_json envelope', () => {
      const block = buildNarrationContract({
        currentTurn: { slug: 'rook', label: 'Rook', isPlayer: true, round: 4 },
        actions: [{ kind: 'spell', actorSlug: 'rook', isPlayer: true, hit: true }],
        sceneAnchor: 'rook@(3,2) mv30/30',
        sceneDescription: 'A ruined laboratory.',
      });
      expect(block).toContain("it IS the player's turn");
      expect(block).toContain('spell x1 (HIT)');
      const match = /<contract_json>([\s\S]*?)<\/contract_json>/.exec(block);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1])).toEqual({
        currentTurn: { slug: 'rook', label: 'Rook', isPlayer: true, round: 4 },
        actions: [{ kind: 'spell', count: 1, actors: ['rook'], hit: true, mixed: false }],
        sceneDescription: 'A ruined laboratory.',
      });
    });

    it('contracts an empty turn so false turn-denial can be caught', () => {
      const block = buildNarrationContract({
        currentTurn: { slug: 'rook', label: 'Rook', isPlayer: true, round: 4 },
        actions: [],
        sceneAnchor: null,
      });
      expect(block).toContain('Resolved actions this turn: none');
      expect(block).toContain("it IS the player's turn");
    });

    it('warns the model off success language for a miss', () => {
      const block = buildNarrationContract({
        currentTurn: { slug: 'spider', label: 'Spider', isPlayer: false, round: 4 },
        actions: [{ kind: 'attack', actorSlug: 'spider', isPlayer: false, hit: false }],
        sceneAnchor: null,
      });
      expect(block).toContain('A MISS is a miss');
    });
  });
});
