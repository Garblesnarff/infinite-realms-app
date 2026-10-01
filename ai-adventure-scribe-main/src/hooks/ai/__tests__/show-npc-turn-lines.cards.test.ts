import { describe, expect, it, vi } from 'vitest';

import {
  attackAction,
  ENEMY_HITS_PLAYER,
  REEVES,
  SCHOLAR,
} from '../../../../shared/test-fixtures/engine-results';
import { showNpcTurnLines } from '../dm-actions-handler';

import type { LocalNotice } from '../types';

/** The participants the client holds: `mapAuthoritativeCombat` types every non-player `monster`. */
const participants = [
  { id: SCHOLAR.id, name: SCHOLAR.name, participantType: 'player', maxHitPoints: 7 },
  { id: REEVES.id, name: REEVES.name, participantType: 'monster', maxHitPoints: 11 },
];

describe('NPC turns shown before the player rolls (#2378, #2417)', () => {
  it('arrive as a card on the enemy side, with the player HP, and keep the engine line as text', () => {
    const notices: LocalNotice[] = [];
    showNpcTurnLines(
      {
        results: [
          {
            action: attackAction(REEVES, SCHOLAR),
            round: 1,
            outcomes: [],
            engineResult: ENEMY_HITS_PLAYER,
            actorIsPlayer: false,
            transcriptLines: [],
          },
        ],
        currentParticipant: null,
        round: 1,
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
      } as never,
      participants,
      (notice) => notices.push(notice),
    );

    expect(notices).toHaveLength(1);
    expect(notices[0].text).toContain('Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11');
    const [card] = notices[0].cards ?? [];
    expect(card.side).toBe('enemy');
    expect(card.badge).toEqual({ word: 'HIT', tone: 'red', icon: 'alert' });
    expect(card.hp).toEqual({ name: 'The Scholar', newHp: 4, lost: 3, maxHp: 7 });
  });

  it('has no cards for a line with no result behind it', () => {
    const onNotice = vi.fn();
    showNpcTurnLines(
      {
        results: [],
        capReached: true,
        transcriptLines: ['⚙️ Engine: NPC turn loop stopped after 4 iterations; paused.'],
      } as never,
      participants,
      onNotice,
    );

    expect(onNotice).toHaveBeenCalledWith({
      text: '⚙️ Engine: NPC turn loop stopped after 4 iterations; paused.',
      persist: true,
    });
  });
});
