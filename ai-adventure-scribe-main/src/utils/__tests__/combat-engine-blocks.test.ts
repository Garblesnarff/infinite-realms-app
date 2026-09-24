import { describe, expect, it } from 'vitest';

import { orderCombatEngineBlocks, type CombatEngineBlock } from '../combat-engine-blocks';

/** Round-shifted transcript fixture from issue #2127 (reference: acc877b6). */
const ACC877B6_ROUND_SHIFTED_SEQUENCE: CombatEngineBlock[] = [
  {
    sequence: 0,
    serverSequence: 30,
    round: 3,
    source: 'npc',
    lines: ['⚙️ Engine: Hulk misses.'],
  },
  {
    sequence: 1,
    serverSequence: 20,
    round: 3,
    source: 'player',
    lines: ['⚙️ Engine: Veteran HIT 5.'],
  },
  {
    sequence: 2,
    serverSequence: 40,
    round: 3,
    source: 'npc',
    lines: ['⚙️ Engine: Combat has ended.'],
  },
];

describe('combat engine block ordering', () => {
  it('renders the round-shifted fixture in server sequence order, keeping the killing HIT first', () => {
    const ordered = orderCombatEngineBlocks(ACC877B6_ROUND_SHIFTED_SEQUENCE);

    expect(ordered.map((block) => block.serverSequence)).toEqual([20, 30, 40]);
    expect(ordered.map((block) => block.lines[0])).toEqual([
      '⚙️ Engine: Veteran HIT 5.',
      '⚙️ Engine: Hulk misses.',
      '⚙️ Engine: Combat has ended.',
    ]);
    expect(ordered.map((block) => block.round)).toEqual([3, 3, 3]);
  });

  it('keeps local insertion order when a legacy payload has no server sequence', () => {
    const blocks = ACC877B6_ROUND_SHIFTED_SEQUENCE.map(
      ({ serverSequence: _serverSequence, ...block }) => block,
    );

    expect(orderCombatEngineBlocks(blocks).map((block) => block.sequence)).toEqual([0, 1, 2]);
  });

  it('orders a mixed set where only some payloads carry a server sequence', () => {
    // A staggered server rollout: two results are tagged, two are legacy. Local sequence and
    // server sequence are on different scales and must never be compared with each other.
    const blocks: CombatEngineBlock[] = [
      { sequence: 0, serverSequence: 30, round: 3, source: 'npc', lines: ['Hulk misses.'] },
      { sequence: 1, round: 3, source: 'npc', lines: ['Goblin flees.'] },
      { sequence: 2, serverSequence: 20, round: 3, source: 'player', lines: ['Veteran HIT 5.'] },
      { sequence: 3, round: 3, source: 'npc', lines: ['Combat has ended.'] },
    ];

    expect(orderCombatEngineBlocks(blocks).map((block) => block.lines[0])).toEqual([
      'Veteran HIT 5.',
      'Goblin flees.',
      'Hulk misses.',
      'Combat has ended.',
    ]);
  });
});
