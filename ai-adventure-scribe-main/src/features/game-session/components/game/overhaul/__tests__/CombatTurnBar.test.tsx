import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../../../../../shared/test-fixtures/dying-participant-wire';
import { summarizeCombatTurn } from '../combat-turn-order';
import { CombatTurnBar, CombatTurnBarLive } from '../CombatTurnBar';
import { LeftRail } from '../LeftRail';

import type { CombatEncounter } from '@/types/combat-encounter';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';

const live = vi.hoisted(() => ({
  encounter: null as CombatEncounter | null,
  messages: [] as Array<{ sender: string; context?: Record<string, unknown> }>,
  campaignName: null as string | null,
  character: null as unknown,
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { isInCombat: !!live.encounter, activeEncounter: live.encounter } }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ messages: live.messages }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    state: { campaign: live.campaignName ? { name: live.campaignName } : null },
  }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: live.character } }),
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

describe('turn bar (#2417, copy #85)', () => {
  it('names whose turn it is and the round, and drops the next line', () => {
    bar(2, 0);

    expect(screen.getByTestId('combat-turn-text').textContent).toBe('Your turn');
    expect(screen.getByTestId('combat-turn-sub').textContent).toBe('Round 2');
    expect(screen.getByText('Your turn. Round 2.')).toBeTruthy();
    expect(screen.queryByText('Next: Captain Sarah Reeves.')).toBeNull();
  });

  it('says You are down on the turn of a player at 0 HP whose saves are owed (#2518)', () => {
    // The Scholar as the server serves her, on the floor; the bar reads "You are down".
    const dying = mapAuthoritativeCombat({
      encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentRound: 3, currentTurnOrder: 0 },
      participants: [
        DYING_SCHOLAR_PARTICIPANT,
        {
          ...DYING_SCHOLAR_PARTICIPANT,
          id: 'm1',
          characterId: null,
          name: 'Captain Sarah Reeves',
          participantType: 'monster',
          vitalState: 'standing',
          status: {
            ...DYING_SCHOLAR_PARTICIPANT.status,
            currentHp: 7,
            isConscious: true,
            deathSavesFailures: 0,
          },
        },
      ],
    } as never);
    const summary = summarizeCombatTurn(dying)!;
    render(<CombatTurnBar summary={summary} busy={null} />);

    expect(screen.getByTestId('combat-turn-text').textContent).toBe('You are down');
    expect(screen.getByTestId('combat-turn-sub').textContent).toBe(
      '0 HP · roll a death saving throw',
    );
    expect(screen.getByText('You are down. 0 HP · roll a death saving throw.')).toBeTruthy();
  });

  it('names an enemy turn in teal and says to wait', () => {
    bar(2, 1);

    const text = screen.getByTestId('combat-turn-text');
    expect(text.textContent).toBe("Captain Sarah Reeves's turn");
    expect(text.className).toContain('text-infinite-teal');
    expect(screen.getByTestId('combat-turn-sub').textContent).toBe('Round 2 · wait for it to act');
  });

  it('reads as one sentence for a screen reader', () => {
    bar(2, 0);

    expect(screen.getByText('Your turn. Round 2.')).toBeTruthy();
  });

  it('puts that sentence in page text, with the visual bar hidden from a screen reader', () => {
    bar(2, 0);

    const sentence = screen.getByTestId('combat-turn-sentence');
    expect(sentence.className).toContain('sr-only');
    expect(sentence.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTestId('combat-turn-bar').hasAttribute('aria-label')).toBe(false);
    expect(screen.getByTestId('combat-turn-text').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByTestId('combat-turn-bar').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('combat-turn-bar').getAttribute('aria-live')).toBe('polite');
  });

  it('reads an enemy turn, a cast and an enemy acting as one sentence too', () => {
    const enemy = bar(2, 1);
    expect(
      screen.getByText("Captain Sarah Reeves's turn. Round 2 · wait for it to act."),
    ).toBeTruthy();
    enemy.unmount();

    const acting = bar(2, 1, 'acting');
    expect(screen.getByTestId('combat-turn-text').textContent).toContain(
      'Captain Sarah Reeves is acting…',
    );
    expect(
      screen.getByText('Captain Sarah Reeves is acting. Round 2 · wait for it to act.'),
    ).toBeTruthy();
    acting.unmount();

    bar(2, 0, 'casting');
    expect(screen.getByTestId('combat-turn-text').textContent).toContain('Casting…');
    expect(screen.getByText('Casting. Round 2.')).toBeTruthy();
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

  it('gives every token a 30 px circle and cuts a long title instead of scrolling sideways', () => {
    bar(2, 0);

    expect(screen.getByTestId('combat-turn-text').className).toContain('truncate');
    for (const pip of screen.getAllByTestId('combat-turn-pip')) {
      expect(pip.className).toContain('h-[30px]');
      expect(pip.className).toContain('w-[30px]');
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

  it('numbers duplicate token initials instead of showing two TH tokens', () => {
    const summary = summarizeCombatTurn(
      encounter(1, 0, [
        ['p1', 'The Hunter', 'player', 9],
        ['m1', 'The Hound', 'monster', 4],
      ]),
    )!;
    render(<CombatTurnBar summary={summary} busy={null} />);

    expect(screen.getAllByTestId('combat-turn-pip').map((pip) => pip.textContent)).toEqual([
      'H',
      'H2',
    ]);
  });

  it('shows one HP value in green at full health', () => {
    const summary = summarizeCombatTurn(encounter(1, 0))!;
    render(
      <CombatTurnBar summary={summary} busy={null} hp={{ current: 5, maximum: 7, temp: 0 }} />,
    );

    expect(screen.getByTestId('combat-turn-hp').textContent).toContain('5 / 7');
    expect(screen.getByTestId('combat-turn-hp').innerHTML).toContain('bg-ir-hp-good');
  });

  it('warns below half HP and goes red below a quarter', () => {
    const summary = summarizeCombatTurn(encounter(1, 0))!;
    const warned = render(
      <CombatTurnBar summary={summary} busy={null} hp={{ current: 2, maximum: 7, temp: 0 }} />,
    );
    expect(screen.getByTestId('combat-turn-hp').innerHTML).toContain('bg-ir-hp-warn');
    warned.unmount();

    render(
      <CombatTurnBar summary={summary} busy={null} hp={{ current: 1, maximum: 7, temp: 0 }} />,
    );
    expect(screen.getByTestId('combat-turn-hp').innerHTML).toContain('bg-ir-hp-bad');
  });

  it('shows temp HP as a plus, and a skeleton while HP is unknown', () => {
    const summary = summarizeCombatTurn(encounter(1, 0))!;
    const temp = render(
      <CombatTurnBar summary={summary} busy={null} hp={{ current: 7, maximum: 10, temp: 3 }} />,
    );
    expect(screen.getByTestId('combat-turn-hp').textContent).toContain('7 + 3 temp');
    temp.unmount();

    render(
      <CombatTurnBar
        summary={summary}
        busy={null}
        hp={{ current: null, maximum: null, temp: 0 }}
      />,
    );
    expect(screen.getByTestId('combat-turn-hp').getAttribute('aria-label')).toBe(
      'Loading hit points',
    );
  });

  it('names the nearest enemy and its distance on your turn', () => {
    const summary = summarizeCombatTurn(encounter(1, 0))!;
    render(
      <CombatTurnBar
        summary={summary}
        busy={null}
        enemyDistance={{ name: 'Glass Prowler', feet: 10 }}
      />,
    );

    expect(screen.getByTestId('combat-turn-sub').textContent).toBe(
      'Round 1 · Glass Prowler is 10 ft away',
    );
  });

  it('opens the map sheet from its narrow-width Map button', () => {
    const onOpenMap = vi.fn();
    const summary = summarizeCombatTurn(encounter(1, 0))!;
    render(<CombatTurnBar summary={summary} busy={null} onOpenMap={onOpenMap} />);

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(onOpenMap).toHaveBeenCalledTimes(1);
  });

  describe('wired to the fight', () => {
    beforeEach(() => {
      live.encounter = encounter(1, 0);
      live.messages = [];
      live.campaignName = null;
      live.character = null;
    });

    it('shows the Exploring strip outside a fight', () => {
      live.encounter = null;
      live.campaignName = 'The Eternal Feast';
      live.messages = [{ sender: 'dm', context: { location: 'The Market' } }];
      render(<CombatTurnBarLive turnInFlight={false} />);

      expect(screen.getByTestId('combat-turn-text').textContent).toBe('Exploring');
      expect(screen.getByTestId('combat-turn-sub').textContent).toBe(
        'The Eternal Feast · The Market',
      );
    });

    it('shows an HP skeleton on the Exploring strip while the sheet HP is unknown', () => {
      live.encounter = null;
      render(<CombatTurnBarLive turnInFlight={false} />);

      expect(screen.getByTestId('combat-turn-hp').getAttribute('aria-label')).toBe(
        'Loading hit points',
      );
    });

    it('reads the sheet HP on the Exploring strip', () => {
      live.encounter = null;
      live.character = { character_stats: { current_hit_points: 5, max_hit_points: 7 } };
      render(<CombatTurnBarLive turnInFlight={false} />);

      expect(screen.getByTestId('combat-turn-hp').textContent).toContain('5 / 7');
    });

    it('reads the encounter HP in combat, not the sheet HP', () => {
      live.character = { character_stats: { current_hit_points: 5, max_hit_points: 7 } };
      render(<CombatTurnBarLive turnInFlight={false} />);

      expect(screen.getByTestId('combat-turn-hp').textContent).toContain('7 / 7');
    });

    it('shows the loading strip while initiative is being rolled', () => {
      live.encounter = {
        ...encounter(1, 0),
        currentTurnParticipantId: undefined,
      };
      render(<CombatTurnBarLive turnInFlight={false} />);

      expect(screen.getByTestId('combat-turn-text').textContent).toBe('Setting up the fight…');
      expect(screen.getByTestId('combat-turn-sub').textContent).toBe(
        'Rolling initiative for Captain Sarah Reeves',
      );
    });

    it('shows the 150 px HP skeleton on the loading strip (#85)', () => {
      live.encounter = {
        ...encounter(1, 0),
        currentTurnParticipantId: undefined,
      };
      render(<CombatTurnBarLive turnInFlight={false} />);

      const hp = screen.getByTestId('combat-turn-hp');
      expect(hp.getAttribute('aria-label')).toBe('Loading hit points');
      expect(hp.className).toContain('w-[150px]');
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
