import { describe, expect, it } from 'vitest';

import {
  messagesSupersededByCombatEnd,
  orderCombatEngineBlocks,
  type CombatEngineBlock,
} from '../combat-engine-blocks';

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

describe('messagesSupersededByCombatEnd (#864)', () => {
  // Fixture shapes follow the real producers: use-ai-response.ts marks the DM reply that
  // ended a fight with `context.combatEnded: true`, and use-deferred-combat-summary.ts
  // posts the summary as a system message with `context.combatData: { type: 'summary', … }`.
  const dm = (text: string, context?: Record<string, unknown>) => ({
    sender: 'dm',
    text,
    context,
  });
  const player = (text: string) => ({ sender: 'player', text });
  const summary = () => ({
    sender: 'system',
    text: 'Combat has ended.',
    context: {
      combatData: {
        type: 'summary',
        summary: { rounds: 1, totalDamage: 9, participants: [], outcome: 'Combat concluded' },
      },
    },
  });

  it('supersedes the pre-fight messages once the terminal DM reply and summary land', () => {
    const preFight = dm('The professor watches you. A. **Press the Professor further**');
    const fightBeat = dm('The guardian lumbers toward you.');
    const terminal = dm('The guardian falls.', { combatEnded: true });
    const messages = [preFight, player('I press him.'), fightBeat, terminal, summary()];

    const superseded = messagesSupersededByCombatEnd(messages);

    expect(superseded.has(preFight)).toBe(true);
    expect(superseded.has(fightBeat)).toBe(true);
    // The reply that ended the fight keeps its own (post-combat) options.
    expect(superseded.has(terminal)).toBe(false);
  });

  it('supersedes nothing while the fight is still running', () => {
    const preFight = dm('The professor watches you.');
    const fightBeat = dm('The guardian lumbers toward you.');

    expect(messagesSupersededByCombatEnd([preFight, fightBeat]).size).toBe(0);
  });

  it('supersedes pre-fight messages when the fallback summary posts before the terminal reply', () => {
    const preFight = dm('The professor watches you.');
    const terminal = dm('The guardian falls.', { combatEnded: true });
    const messages = [preFight, summary(), terminal];

    const superseded = messagesSupersededByCombatEnd(messages);

    expect(superseded.has(preFight)).toBe(true);
    expect(superseded.has(terminal)).toBe(false);
  });

  it('does not supersede post-combat replies that landed before a late summary', () => {
    // The deferred summary awaits the server damage-summary fetch before posting, so a
    // reply drawn from the terminal's own options can precede it in the transcript.
    const preFight = dm('The professor watches you. A. **Press the Professor further**');
    const terminal = dm('The guardian falls.', { combatEnded: true });
    const postCombat = dm('Dust settles over the hall. A. **Search the desk**');
    const messages = [preFight, terminal, postCombat, summary()];

    const superseded = messagesSupersededByCombatEnd(messages);

    expect(superseded.has(preFight)).toBe(true);
    expect(superseded.has(terminal)).toBe(false);
    expect(superseded.has(postCombat)).toBe(false);
  });

  it('recognizes the snake_case combat_ended flag on DB-hydrated rows', () => {
    // use-message-queue.ts persists only `combat_ended` for a terminal DM row; after a
    // reload the transcript carries no camelCase key.
    const preFight = dm('The professor watches you.');
    const terminal = dm('The guardian falls.', { combat_ended: true });
    const messages = [preFight, terminal, summary()];

    const superseded = messagesSupersededByCombatEnd(messages);

    expect(superseded.has(preFight)).toBe(true);
    expect(superseded.has(terminal)).toBe(false);
  });

  it("supersedes the first fight's post-combat reply once a second fight ends", () => {
    const firstTerminal = dm('The guardian falls.', { combatEnded: true });
    const betweenFights = dm('The hall is quiet again.');
    const secondTerminal = dm('The wraith dissolves.', { combatEnded: true });
    const messages = [firstTerminal, summary(), betweenFights, secondTerminal, summary()];

    const superseded = messagesSupersededByCombatEnd(messages);

    expect(superseded.has(betweenFights)).toBe(true);
    expect(superseded.has(secondTerminal)).toBe(false);
  });
});
