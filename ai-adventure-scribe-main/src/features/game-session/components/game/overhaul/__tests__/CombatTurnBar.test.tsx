import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { summarizeCombatTurn } from '../combat-turn-order';
import { CombatTurnBar, CombatTurnBarLive } from '../CombatTurnBar';
import { LeftRail } from '../LeftRail';

import type { CombatEncounter } from '@/types/combat-encounter';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';

const live = vi.hoisted(() => ({
  encounter: null as CombatEncounter | null,
  messages: [] as Array<{ sender: string; context?: Record<string, unknown> }>,
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { isInCombat: !!live.encounter, activeEncounter: live.encounter } }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ messages: live.messages }),
}));

type Seat = [id: string, name: string, type: string, initiative: number, inactive?: boolean];

const SCHOLAR: Seat = ['p1', 'The Scholar', 'player', 9];
const REEVES: Seat = ['m1', 'Captain Sarah Reeves', 'monster', 4];

/** The encounter the client holds, from its only producer of one. */
const encounter = (round: number, turnIndex: number, seats: Seat[] = [SCHOLAR, REEVES]) =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-1',
      sessionId: 'session-1',
      status: 'active',
      currentRound: round,
      currentTurnOrder: turnIndex,
      startedAt: '2026-09-29T00:00:00.000Z',
    },
    participants: seats.map(([id, name, participantType, initiative, inactive]) => ({
      id,
      name,
      participantType,
      initiative,
      initiativeModifier: 0,
      armorClass: 11,
      maxHp: 7,
      speed: 30,
      isActive: !inactive,
      status: { currentHp: 7, maxHp: 7, tempHp: 0, isConscious: true },
    })),
  });

const bar = (round: number, turnIndex: number, busy: 'casting' | 'acting' | null = null) => {
  const summary = summarizeCombatTurn(encounter(round, turnIndex))!;
  return render(<CombatTurnBar summary={summary} busy={busy} />);
};

describe('turn bar (#2417)', () => {
  it('names the round, the turn and who holds it, and who is next', () => {
    bar(2, 0);

    expect(screen.getByTestId('combat-turn-bar').textContent).toContain('Round 2');
    expect(screen.getByTestId('combat-turn-text').textContent).toBe('Turn 1 of 2 · Your turn');
    expect(screen.getByText('Next: Captain Sarah Reeves.')).toBeTruthy();
  });

  it('names an enemy turn in red and says the round starts over after the last actor', () => {
    bar(2, 1);

    const text = screen.getByTestId('combat-turn-text');
    expect(text.textContent).toBe('Turn 2 of 2 · Captain Sarah Reeves');
    expect(text.className).toContain('text-red-400');
    expect(screen.getByText('Next: The Scholar starts round 3.')).toBeTruthy();
  });

  it('reads as one sentence for a screen reader', () => {
    bar(2, 0);

    expect(screen.getByText('Round 2. Turn 1 of 2. Your turn.')).toBeTruthy();
  });

  it('puts that sentence in page text, with the visual bar hidden from a screen reader', () => {
    bar(2, 0);

    const sentence = screen.getByTestId('combat-turn-sentence');
    expect(sentence.className).toContain('sr-only');
    expect(sentence.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTestId('combat-turn-bar').hasAttribute('aria-label')).toBe(false);
    expect(screen.getByTestId('combat-turn-text').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('reads an enemy turn, a cast and an enemy acting as one sentence too', () => {
    const enemy = bar(2, 1);
    expect(screen.getByText('Round 2. Turn 2 of 2. Captain Sarah Reeves.')).toBeTruthy();
    enemy.unmount();

    const acting = bar(2, 1, 'acting');
    expect(screen.getByTestId('combat-turn-text').textContent).toContain(
      'Captain Sarah Reeves is acting…',
    );
    expect(screen.getByText('Round 2. Turn 2 of 2. Captain Sarah Reeves is acting.')).toBeTruthy();
    acting.unmount();

    bar(2, 0, 'casting');
    expect(screen.getByTestId('combat-turn-text').textContent).toContain('Casting…');
    expect(screen.getByText('Round 2. Turn 1 of 2. Casting.')).toBeTruthy();
  });

  it('leaves out a participant the server has taken out of the order', () => {
    const seats: Seat[] = [SCHOLAR, ['m0', 'Removed Goblin', 'monster', 6, true], REEVES];
    const summary = summarizeCombatTurn(encounter(1, 1, seats))!;

    expect(summary.actors.map((actor) => actor.name)).toEqual(['The Scholar', REEVES[1]]);
    expect(summary.active.name).toBe(REEVES[1]);
    expect(summary.turn).toBe(2);
    expect(summary.nextLine).toBe('Next: The Scholar starts round 2.');
  });

  it('draws one pip per actor: spent, now, waiting', () => {
    bar(1, 1);

    expect(screen.getAllByTestId('combat-turn-pip').map((pip) => pip.dataset.state)).toEqual([
      'acted',
      'now',
    ]);
  });

  it('keeps Round N on one line and gives a phone the short turn text and initials', () => {
    bar(2, 0);

    expect(screen.getByText('Round 2').className).toContain('whitespace-nowrap');
    expect(
      within(screen.getByTestId('combat-turn-text')).getByText(/Turn 1 of 2/).className,
    ).toContain('hidden sm:inline');
    for (const pip of screen.getAllByTestId('combat-turn-pip')) {
      expect(pip.className).toContain('sm:h-2.5');
    }
  });

  // jsdom has no layout, so this pins the classes that stopped the sideways scroll measured at
  // 390, 320 and 1024 px in Chromium: the pip row wraps and the active name is cut, not pushed out.
  it('lets a long fight wrap its pips and cut a long name instead of scrolling sideways', () => {
    bar(2, 0);

    expect(screen.getAllByTestId('combat-turn-pip')[0].parentElement?.className).toContain(
      'flex-wrap',
    );
    expect(screen.getByTestId('combat-turn-text').className).toContain('truncate');
  });

  describe('wired to the fight', () => {
    beforeEach(() => {
      live.encounter = encounter(1, 0);
      live.messages = [];
    });

    it('is absent outside a fight', () => {
      live.encounter = null;
      render(<CombatTurnBarLive turnInFlight={false} />);

      expect(screen.queryByTestId('combat-turn-bar')).toBeNull();
    });

    it('says Casting… while the sheet cast is being answered', () => {
      live.messages = [{ sender: 'player', context: { intent: 'spell_cast' } }];
      render(<CombatTurnBarLive turnInFlight />);

      expect(screen.getByTestId('combat-turn-text').textContent).toContain('Casting…');
    });

    it('says the enemy is acting while one holds the turn and a turn is being answered', () => {
      live.encounter = encounter(1, 1);
      live.messages = [{ sender: 'player', context: {} }];
      render(<CombatTurnBarLive turnInFlight />);

      expect(screen.getByTestId('combat-turn-text').textContent).toContain(
        'Captain Sarah Reeves is acting…',
      );
    });

    it('says Your turn on the player’s own turn, answered or not', () => {
      live.messages = [{ sender: 'player', context: {} }];
      render(<CombatTurnBarLive turnInFlight />);

      expect(screen.getByTestId('combat-turn-text').textContent).toContain('Your turn');
    });
  });
});

describe('encounter list (#2417)', () => {
  const rail = (round: number, turnIndex: number, seats?: Seat[]) => {
    const current = encounter(round, turnIndex, seats);
    const turn = summarizeCombatTurn(current)!;
    return render(
      <LeftRail
        campaign={{
          name: 'Test',
          chapter: 'Chapter 1',
          objective: '',
          objectiveTasks: [],
        }}
        party={[]}
        partyMax={4}
        combat={{
          active: true,
          round: current.currentRound,
          actedCount: turn.turn - 1,
          combatants: current.participants.map((participant) => ({
            id: participant.id,
            initiative: participant.initiative,
            name: participant.name,
            isEnemy: participant.participantType !== 'player',
            isActive: current.currentTurnParticipantId === participant.id,
            state: turn.actors.find((actor) => actor.id === participant.id)?.state,
          })),
        }}
      />,
    );
  };

  it('heads the list with the round and how many have acted, and tags each row', () => {
    rail(2, 1);

    expect(screen.getByText('Round 2')).toBeTruthy();
    expect(screen.getByText('1 of 2 have acted this round')).toBeTruthy();
    const rows = Array.from(document.querySelectorAll('[data-state]'));
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Acted'),
      expect.stringContaining('Now'),
    ]);
  });

  it('writes an enemy row in white with a red edge, and rings the row whose turn it is', () => {
    rail(2, 1);

    const [player, enemy] = Array.from(document.querySelectorAll('[data-state]'));
    expect(enemy.className).toContain('border-l-red-500');
    expect(enemy.className).toContain('text-white');
    expect(enemy.className).not.toMatch(/text-red/);
    expect(enemy.className).toContain('ring-infinite-gold');
    expect(player.className).not.toContain('ring-infinite-gold');
  });

  it('marks everyone behind the turn holder as waiting', () => {
    rail(1, 0, [SCHOLAR, REEVES, ['m2', 'Second Guard', 'monster', 2]]);

    expect(screen.getByText('0 of 3 have acted this round')).toBeTruthy();
    expect(
      Array.from(document.querySelectorAll('[data-state]')).map(
        (row) => (row as HTMLElement).dataset.state,
      ),
    ).toEqual(['now', 'waiting', 'waiting']);
  });
});
