import { describe, expect, it } from 'vitest';

import {
  attackAction,
  ENEMY_FAILS_SAVE,
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../shared/test-fixtures/engine-results';
import { combatLogLines } from '../combat-log-lines';

import type { ChatMessage } from '@/types/game';

import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';

const parts = [
  ...formatCombatEngineParts(attackAction(REEVES, SCHOLAR), ENEMY_HITS_PLAYER, FIGHT_ROSTER, {
    targetHp: true,
    targetMaxHp: 7,
  }),
  ...formatCombatEngineParts(spellAction(SCHOLAR, REEVES), ENEMY_FAILS_SAVE, FIGHT_ROSTER),
];

const dm = (context: Record<string, unknown>): ChatMessage =>
  ({ sender: 'dm', text: 'Steel rings.', context }) as ChatMessage;

describe('combat log and Show target numbers (#2417)', () => {
  const withCards = dm({
    combatEngineBlocks: [
      {
        sequence: 0,
        round: 1,
        source: 'npc',
        lines: parts.map((part) => part.line),
        cards: parts.map((part) => part.card),
      },
    ],
  });

  it('keeps the AC and the DC while the setting is on', () => {
    const log = combatLogLines([withCards]).join('\n');

    expect(log).toContain('vs AC 11');
    expect(log).toContain('vs DC 14');
  });

  it('leaves them out while it is off, for every line a card stands for', () => {
    const log = combatLogLines([withCards], undefined, false).join('\n');

    expect(log).toContain('rolled 14 + 0 = 14 against The Scholar');
    expect(log).toContain('DEX save 6 —');
    expect(log).not.toContain('vs AC ?');
    expect(log).not.toContain('vs AC');
    expect(log).not.toContain('AC 11');
    expect(log).not.toContain('DC');
  });

  it('cannot hide the numbers of a line saved before cards, and says nothing else changed', () => {
    const legacy = dm({
      combatEngineBlocks: [{ sequence: 0, round: 1, source: 'npc', lines: [parts[0].line] }],
    });

    expect(combatLogLines([legacy], undefined, false)).toEqual([parts[0].line]);
  });
});
