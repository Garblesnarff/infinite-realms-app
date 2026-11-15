import { describe, expect, it } from 'vitest';

import { summarizeCombatDamageEvents } from '../../../../shared/combat-summary-events';

import type { CombatEncounter } from '@/types/combat-encounter';

import { buildCombatSummaryMessage } from '@/features/game-session/hooks/use-deferred-combat-summary';

describe('combat summary events (#974)', () => {
  const events = [
    { round: 1, side: 'player' as const, damage: 8 },
    { round: 2, side: 'player' as const, damage: 10 },
    { round: 2, side: 'npc' as const, damage: 6 },
    { round: 3, side: 'player' as const, damage: 11 },
  ];

  it('labels a round-2 hit R2 and leaves the foe out of the total', () => {
    const summary = summarizeCombatDamageEvents(events, 1);
    expect(summary.hits.map((hit) => hit.label)).toEqual(['R1', 'R2', 'R2', 'R3']);
    expect(summary.hits[1]).toMatchObject({ round: 2, side: 'player', damage: 10, label: 'R2' });
    expect(summary.totalDamage).toBe(29);
    expect(summary.totalDamage).not.toBe(35);
    expect(summary.rounds).toBe(3);
  });

  it('keeps a later encounter round when the last hit was earlier, and skips zero damage', () => {
    const summary = summarizeCombatDamageEvents(
      [
        { round: 1, side: 'player', damage: 4 },
        { round: 2, side: 'npc', damage: 0 },
      ],
      2,
    );
    expect(summary.rounds).toBe(2);
    expect(summary.hits).toEqual([{ round: 1, side: 'player', damage: 4, label: 'R1' }]);
    expect(summary.totalDamage).toBe(4);
  });

  it('buildCombatSummaryMessage reads round and side from the actions', () => {
    const message = buildCombatSummaryMessage({
      currentRound: 1,
      participants: [
        { id: 'hero', name: 'Hero', participantType: 'player' },
        { id: 'goblin', name: 'Goblin', participantType: 'monster' },
      ],
      actions: [
        { participantId: 'hero', round: 1, damageDealt: 8 },
        { participantId: 'hero', round: 2, damageDealt: 10 },
        { participantId: 'goblin', round: 2, damageDealt: 6 },
        { participantId: 'hero', round: 3, damageDealt: 11 },
      ],
    } as unknown as CombatEncounter);
    const summary = message.context?.combatData?.summary;
    expect(summary?.rounds).toBe(3);
    expect(summary?.totalDamage).toBe(29);
    expect(summary?.hits?.map((hit) => hit.label)).toEqual(['R1', 'R2', 'R2', 'R3']);
    expect(summary?.hits?.[2]).toMatchObject({ side: 'npc', damage: 6, label: 'R2' });
    expect(summary?.participants.find((row) => row.name === 'Goblin')?.damageDealt).toBe(6);
  });
});
