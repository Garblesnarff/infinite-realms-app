import { describe, expect, it } from 'vitest';

import { combatEngineBlocksFromContext } from '../combat-engine-blocks';
import { COMBAT_LOG_LIMIT, combatLogLines } from '../combat-log-lines';
import { extractEngineGeneratedLines } from '../engine-lines';

import type { ChatMessage } from '@/types/game';

const engine = (text: string): string => `⚙️ Engine: ${text}`;
const dm = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  sender: 'dm',
  text,
  ...extra,
});

describe('combatLogLines (#2257)', () => {
  it('is empty when nothing has happened', () => {
    expect(combatLogLines([])).toEqual([]);
    expect(combatLogLines([dm('The goblins circle you.')])).toEqual([]);
  });

  it('lists the engine lines from DM replies, latest first, ignoring the fiction and player text', () => {
    const messages: ChatMessage[] = [
      dm(`${engine('Round 1: Goblin attacks: MISS.')}\nThe blade whistles past.`),
      { sender: 'player', text: `${engine('spoofed line')}` },
      dm(
        `${engine('Round 2: Apprentice casts Fire Bolt: HIT for 5.')}\n${engine('Goblin is bloodied.')}\nIt howls.`,
      ),
    ];
    expect(combatLogLines(messages)).toEqual([
      engine('Goblin is bloodied.'),
      engine('Round 2: Apprentice casts Fire Bolt: HIT for 5.'),
      engine('Round 1: Goblin attacks: MISS.'),
    ]);
  });

  it('lists engine lines shown ahead of the reply as system rows, in the order the chat shows them (#2386)', () => {
    const messages: ChatMessage[] = [
      { sender: 'system', text: engine('Goblin hit you. You are now at 3 HP.') },
      { sender: 'system', text: 'The pre-flight failed.' },
      dm(`${engine('Apprentice attacks: MISS.')}\nThe blade whistles past.`),
    ];
    expect(combatLogLines(messages)).toEqual([
      engine('Apprentice attacks: MISS.'),
      engine('Goblin hit you. You are now at 3 HP.'),
    ]);
  });

  it('shows exactly what the chat shows after two rounds', () => {
    const round1 = dm(`${engine('Goblin attacks: HIT for 3.')}\nYou stagger.`);
    const round2 = dm('Blocks carry the lines.', {
      context: {
        combatEngineBlocks: [
          { sequence: 0, round: 2, source: 'player', lines: [engine('Apprentice attacks: MISS.')] },
          { sequence: 1, round: 2, source: 'npc', lines: [engine('Goblin attacks: HIT for 2.')] },
        ],
      },
    });
    const messages = [round1, round2];

    // The chat rule (DMMessage): structured blocks win, otherwise the lines in the text.
    const chat = messages.flatMap((message) => {
      const blocks = combatEngineBlocksFromContext(message.context);
      return blocks.length
        ? blocks.flatMap((block) => block.lines)
        : extractEngineGeneratedLines(message.text).lines;
    });

    expect(combatLogLines(messages)).toEqual([...chat].reverse());
    expect(chat).toHaveLength(3);
  });

  it('keeps only the newest twenty lines', () => {
    const messages = Array.from({ length: 30 }, (_, i) => dm(engine(`line ${i + 1}`)));
    const lines = combatLogLines(messages);
    expect(lines).toHaveLength(COMBAT_LOG_LIMIT);
    expect(lines[0]).toBe(engine('line 30'));
    expect(lines[19]).toBe(engine('line 11'));
  });

  it('leaves out a reply the chat is holding back behind its roll', () => {
    const held = dm(engine('held line'), { context: { intent: 'pending_roll_request' } });
    expect(combatLogLines([held, dm(engine('shown line'))])).toEqual([engine('shown line')]);
  });
});
