import { describe, expect, it } from 'vitest';

import {
  aggregateContractActions,
  buildNarrationContract,
} from '../narration-contract.js';

describe('narration-contract', () => {
  describe('aggregateContractActions', () => {
    it('groups by kind with counts and unanimous hit/miss', () => {
      const aggregated = aggregateContractActions([
        { kind: 'attack', actorSlug: 'the-veteran', actorIsPlayer: true, hit: true },
        { kind: 'attack', actorSlug: 'the-veteran', actorIsPlayer: true, hit: true },
        { kind: 'dash', actorSlug: 'the-veteran', actorIsPlayer: true },
      ]);
      expect(aggregated).toEqual([
        { kind: 'attack', count: 2, actorSlugs: ['the-veteran'], hit: true, mixed: false },
        { kind: 'dash', count: 1, actorSlugs: ['the-veteran'], hit: undefined, mixed: false },
      ]);
    });

    it('marks mixed hit/miss', () => {
      const aggregated = aggregateContractActions([
        { kind: 'attack', actorSlug: 'the-veteran', actorIsPlayer: true, hit: true },
        { kind: 'attack', actorSlug: 'the-veteran', actorIsPlayer: true, hit: false },
      ]);
      expect(aggregated[0].mixed).toBe(true);
      expect(aggregated[0].hit).toBeUndefined();
    });

    it('aggregates mixed damage scales to undefined (#2534)', () => {
      const aggregated = aggregateContractActions([
        {
          kind: 'attack',
          actorSlug: 'rook',
          actorIsPlayer: true,
          hit: true,
          damageScale: 'scratch',
        },
        {
          kind: 'attack',
          actorSlug: 'rook',
          actorIsPlayer: true,
          hit: true,
          damageScale: 'wounded',
        },
      ]);
      expect(aggregated[0].damageScale).toBeUndefined();
    });

    it('keeps a unanimous damage scale (#2534)', () => {
      const aggregated = aggregateContractActions([
        {
          kind: 'attack',
          actorSlug: 'rook',
          actorIsPlayer: true,
          hit: true,
          damageScale: 'scratch',
        },
        {
          kind: 'attack',
          actorSlug: 'rook',
          actorIsPlayer: true,
          hit: true,
          damageScale: 'scratch',
        },
      ]);
      expect(aggregated[0].damageScale).toBe('scratch');
    });
  });

  describe('buildNarrationContract', () => {
    it('names the damage scale in the contract text and JSON (#2534)', () => {
      const block = buildNarrationContract({
        currentTurn: { slug: 'rook', label: 'Rook', isPlayer: true, round: 4 },
        actions: [
          {
            kind: 'attack',
            actorSlug: 'rook',
            actorIsPlayer: true,
            hit: true,
            damageScale: 'scratch',
          },
        ],
        sceneAnchor: null,
      });
      expect(block).toContain('Damage-scale cues for landed hits:');
      expect(block).toContain('scratch damage scale (<25% of target max HP)');
      const match = /<contract_json>([\s\S]*?)<\/contract_json>/.exec(block);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1]).actions).toEqual([
        expect.objectContaining({ damageScale: 'scratch' }),
      ]);
    });

    it('omits the damage-scale line when scales are mixed (#2534)', () => {
      const block = buildNarrationContract({
        currentTurn: { slug: 'rook', label: 'Rook', isPlayer: true, round: 4 },
        actions: [
          {
            kind: 'attack',
            actorSlug: 'rook',
            actorIsPlayer: true,
            hit: true,
            damageScale: 'scratch',
          },
          {
            kind: 'attack',
            actorSlug: 'rook',
            actorIsPlayer: true,
            hit: true,
            damageScale: 'wounded',
          },
        ],
        sceneAnchor: null,
      });
      expect(block).not.toContain('Damage-scale cues for landed hits:');
    });

    it('emits turn, resolved actions, and a parseable contract_json envelope', () => {
      const block = buildNarrationContract({
        currentTurn: { slug: 'rook', label: 'Rook', isPlayer: true, round: 4 },
        actions: [{ kind: 'spell', actorSlug: 'rook', actorIsPlayer: true, hit: true }],
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
        actions: [{ kind: 'attack', actorSlug: 'spider', actorIsPlayer: false, hit: false }],
        sceneAnchor: null,
      });
      expect(block).toContain('A MISS is a miss');
    });
  });
});
