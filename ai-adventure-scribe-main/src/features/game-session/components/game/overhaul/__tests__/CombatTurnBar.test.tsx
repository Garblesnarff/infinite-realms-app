import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../../../../../shared/test-fixtures/dying-participant-wire';
import { summarizeCombatTurn, type CombatTurnSummary } from '../combat-turn-order';
import { CombatTurnBar, CombatTurnBarLive } from '../CombatTurnBar';
import { LeftRail } from '../LeftRail';
import { buildEncounterCombatants } from '../useOverhaulViewModel';

import type { CombatEncounter } from '@/types/combat-encounter';

import {
  mapAuthoritativeCombat,
  type AuthoritativeCombatPayload,
} from '@/contexts/combat/authoritative-combat-state';

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
  it('names whose turn it is and the round, and shows the next line', () => {
    bar(2, 0);

    expect(screen.getByTestId('combat-turn-text').textContent).toBe('Your turn');
    expect(screen.getByTestId('combat-turn-sub').textContent).toBe('Round 2');
    expect(screen.getByTestId('combat-turn-sentence').textContent).toContain('Your turn. Round 2.');
    expect(screen.getByTestId('combat-turn-next').textContent).toBe('Next: Captain Sarah Reeves.');
  });

  it('says You are down on the turn of a player at 0 HP whose saves are owed (#2518)', () => {
    // The Scholar as the server serves her, on the floor; the bar reads "You are down".
    const dying = mapAuthoritativeCombat({
      encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentRound: 3, currentTurnOrder: 0 },
      participants: [
        {
          ...DYING_SCHOLAR_PARTICIPANT,
          conditions: [...DYING_SCHOLAR_PARTICIPANT.conditions],
        },
        {
          ...DYING_SCHOLAR_PARTICIPANT,
          id: 'm1',
          characterId: null,
          name: 'Captain Sarah Reeves',
          participantType: 'monster',
          vitalState: 'standing',
          conditions: [...DYING_SCHOLAR_PARTICIPANT.conditions],
          status: {
            ...DYING_SCHOLAR_PARTICIPANT.status,
            currentHp: 7,
            isConscious: true,
            deathSavesFailures: 0,
          },
        },
      ],
    });
    const summary = summarizeCombatTurn(dying)!;
    render(<CombatTurnBar summary={summary} busy={null} />);

    expect(screen.getByTestId('combat-turn-text').textContent).toBe('You are down');
    expect(screen.getByTestId('combat-turn-sub').textContent).toBe(
      '0 HP · roll a death saving throw',
    );
    expect(screen.getByTestId('combat-turn-sentence').textContent).toContain(
      'You are down. 0 HP · roll a death saving throw.',
    );
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

    expect(screen.getByTestId('combat-turn-sentence').textContent).toContain('Your turn. Round 2.');
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
    expect(screen.getByTestId('combat-turn-sentence').textContent).toContain(
      "Captain Sarah Reeves's turn. Round 2 · wait for it to act.",
    );
    enemy.unmount();

    const acting = bar(2, 1, 'acting');
    expect(screen.getByTestId('combat-turn-text').textContent).toContain(
      'Captain Sarah Reeves is acting…',
    );
    expect(screen.getByTestId('combat-turn-sentence').textContent).toContain(
      'Captain Sarah Reeves is acting. Round 2 · wait for it to act.',
    );
    acting.unmount();

    bar(2, 0, 'casting');
    expect(screen.getByTestId('combat-turn-text').textContent).toContain('Casting…');
    expect(screen.getByTestId('combat-turn-sentence').textContent).toContain('Casting. Round 2.');
  });

  it('leaves out a participant the server has taken out of the order', () => {
    const seats: Seat[] = [SCHOLAR, ['m0', 'Removed Goblin', 'monster', 6, true], REEVES];
    const summary = summarizeCombatTurn(encounter(1, 1, seats))!;

    expect(summary.actors.map((actor) => actor.name)).toEqual(['The Scholar', REEVES[1]]);
    expect(summary.active.name).toBe(REEVES[1]);
    expect(summary.turn).toBe(2);
    expect(summary.nextLine).toBe('Next: The Scholar starts round 2.');
  });

  it('uses the server participant order even when initiative numbers do not sort that way', () => {
    const summary = summarizeCombatTurn(
      encounter(2, 0, [
        ['p1', 'The Scholar', 'player', 4],
        ['m1', 'Captain Sarah Reeves', 'monster', 20],
      ]),
    )!;
    expect(summary.actors.map((actor) => actor.name)).toEqual([
      'The Scholar',
      'Captain Sarah Reeves',
    ]);
    expect(summary.turn).toBe(1);
    expect(summary.active.name).toBe('The Scholar');
    expect(summary.nextLine).toBe('Next: Captain Sarah Reeves.');
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

describe('stable and multi-player vital states (#1431)', () => {
  const wireParticipant = (
    overrides: Partial<AuthoritativeCombatPayload['participants'][number]> = {},
  ): AuthoritativeCombatPayload['participants'][number] => ({
    ...DYING_SCHOLAR_PARTICIPANT,
    conditions: [...DYING_SCHOLAR_PARTICIPANT.conditions],
    ...overrides,
  });

  const standingStatus = {
    ...DYING_SCHOLAR_PARTICIPANT.status,
    currentHp: 7,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  };

  afterEach(() => document.body.classList.remove('ir-table-look'));

  it('does not mark a stable 0 HP player Dying when an enemy owns the turn', () => {
    const stableEncounter = mapAuthoritativeCombat({
      encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentRound: 4, currentTurnOrder: 2 },
      participants: [
        wireParticipant({
          vitalState: 'stabilized',
          status: {
            ...DYING_SCHOLAR_PARTICIPANT.status,
            currentHp: 0,
            isConscious: false,
            deathSavesSuccesses: 3,
            deathSavesFailures: 0,
          },
        }),
        wireParticipant({
          id: 'ally',
          characterId: null,
          name: 'Standing companion',
          participantType: 'npc',
          vitalState: 'standing',
          initiative: 10,
          status: standingStatus,
        }),
        wireParticipant({
          id: 'enemy',
          characterId: null,
          name: 'Captain Sarah Reeves',
          participantType: 'monster',
          vitalState: 'standing',
          initiative: 4,
          status: standingStatus,
        }),
      ],
    });
    document.body.classList.add('ir-table-look');
    const summary = summarizeCombatTurn(stableEncounter)!;
    render(<CombatTurnBar summary={summary} busy={null} playerDown />);

    expect(summary.active.name).toBe('Captain Sarah Reeves');
    expect(screen.queryByTestId('combat-turn-dying')).toBeNull();
    expect(screen.getByTestId('combat-turn-text').textContent).not.toBe('Dying');
  });

  it('does not mark a stable 0 HP player Dying while a healthy player is also standing', () => {
    const stableEncounter = mapAuthoritativeCombat({
      encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentRound: 4, currentTurnOrder: 0 },
      participants: [
        wireParticipant({
          vitalState: 'stabilized',
          status: {
            ...DYING_SCHOLAR_PARTICIPANT.status,
            currentHp: 0,
            isConscious: false,
            deathSavesSuccesses: 3,
            deathSavesFailures: 0,
          },
        }),
        wireParticipant({
          id: 'healthy',
          name: 'Healthy hero',
          vitalState: 'standing',
          initiative: 10,
          status: standingStatus,
        }),
      ],
    });
    document.body.classList.add('ir-table-look');
    const summary = summarizeCombatTurn(stableEncounter)!;
    render(<CombatTurnBar summary={summary} busy={null} playerDown />);

    expect(summary.active.name).toBe('The Scholar');
    expect(screen.getByTestId('combat-turn-text').textContent).toBe('Your turn');
    expect(screen.queryByTestId('combat-turn-dying')).toBeNull();
  });

  it('does not mark a healthy active player Dying when another player is down', () => {
    const multiEncounter = mapAuthoritativeCombat({
      encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentRound: 4, currentTurnOrder: 1 },
      participants: [
        wireParticipant({
          id: 'downed',
          name: 'Downed hero',
          vitalState: 'dying',
          status: {
            ...DYING_SCHOLAR_PARTICIPANT.status,
            currentHp: 0,
            isConscious: false,
            deathSavesSuccesses: 0,
            deathSavesFailures: 2,
          },
        }),
        wireParticipant({
          id: 'healthy',
          name: 'Healthy hero',
          vitalState: 'standing',
          initiative: 10,
          status: standingStatus,
        }),
        wireParticipant({
          id: 'enemy',
          characterId: null,
          name: 'Captain Sarah Reeves',
          participantType: 'monster',
          vitalState: 'standing',
          initiative: 4,
          status: standingStatus,
        }),
      ],
    });
    document.body.classList.add('ir-table-look');
    const summary = summarizeCombatTurn(multiEncounter)!;
    render(<CombatTurnBar summary={summary} busy={null} playerDown />);

    expect(summary.active.name).toBe('Healthy hero');
    expect(screen.getByTestId('combat-turn-text').textContent).toBe('Your turn');
    const chips = screen.queryAllByTestId('combat-turn-dying');
    expect(chips).toHaveLength(1);
    const downedPip = screen
      .getAllByTestId('combat-turn-pip')
      .find((pip) => pip.textContent?.includes('Downed hero'));
    expect(downedPip?.querySelector('[data-testid="combat-turn-dying"]')).not.toBeNull();
    const healthyPip = screen
      .getAllByTestId('combat-turn-pip')
      .find((pip) => pip.textContent?.includes('Healthy hero'));
    expect(healthyPip?.querySelector('[data-testid="combat-turn-dying"]')).toBeNull();
  });

  it('binds the legacy fallback to the active player only when it has no authoritative state', () => {
    const active = {
      id: 'active',
      name: 'Active hero',
      initials: 'AH',
      initiative: 15,
      isPlayer: true,
      isEnemy: false,
      isDying: false,
      actionTaken: false,
      state: 'now' as const,
    };
    const other = {
      ...active,
      id: 'other',
      name: 'Other hero',
      initials: 'OH',
      initiative: 10,
      state: 'waiting' as const,
    };
    const summary: CombatTurnSummary = {
      round: 1,
      actors: [active, other],
      turn: 1,
      active,
      nextLine: '',
    };
    document.body.classList.add('ir-table-look');
    render(<CombatTurnBar summary={summary} busy={null} playerDown />);

    expect(screen.getByTestId('combat-turn-text').textContent).toBe('Dying');
    const activePip = screen
      .getAllByTestId('combat-turn-pip')
      .find((pip) => pip.textContent?.includes('Active hero'));
    const otherPip = screen
      .getAllByTestId('combat-turn-pip')
      .find((pip) => pip.textContent?.includes('Other hero'));
    expect(activePip?.querySelector('[data-testid="combat-turn-dying"]')).not.toBeNull();
    expect(otherPip?.querySelector('[data-testid="combat-turn-dying"]')).toBeNull();
  });

  it('still marks an ordinary dying player Dying', () => {
    const dyingEncounter = mapAuthoritativeCombat({
      encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentRound: 4, currentTurnOrder: 0 },
      participants: [
        wireParticipant(),
        wireParticipant({
          id: 'enemy',
          characterId: null,
          name: 'Captain Sarah Reeves',
          participantType: 'monster',
          vitalState: 'standing',
          initiative: 4,
          status: standingStatus,
        }),
      ],
    });
    document.body.classList.add('ir-table-look');
    const summary = summarizeCombatTurn(dyingEncounter)!;
    render(<CombatTurnBar summary={summary} busy={null} playerDown />);

    expect(screen.getByTestId('combat-turn-text').textContent).toBe('Dying');
    expect(screen.queryAllByTestId('combat-turn-dying')).toHaveLength(1);
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

  it('labels authoritative dying, stable and dead states instead of the initiative state', () => {
    const status = {
      ...DYING_SCHOLAR_PARTICIPANT.status,
      currentHp: 0,
      isConscious: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    };
    const wire = (
      overrides: Partial<AuthoritativeCombatPayload['participants'][number]>,
    ): AuthoritativeCombatPayload['participants'][number] => ({
      ...DYING_SCHOLAR_PARTICIPANT,
      conditions: [...DYING_SCHOLAR_PARTICIPANT.conditions],
      status: { ...status },
      ...overrides,
    });
    const authoritative = mapAuthoritativeCombat({
      encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentRound: 4, currentTurnOrder: 3 },
      participants: [
        wire({ id: 'd', name: 'Dying hero', initiative: 18, vitalState: 'dying' }),
        wire({
          id: 's',
          name: 'Stable hero',
          initiative: 12,
          vitalState: 'stabilized',
          status: { ...status, deathSavesSuccesses: 3 },
        }),
        wire({
          id: 'x',
          name: 'Dead hero',
          initiative: 8,
          vitalState: 'dead',
          status: { ...status, deathSavesFailures: 3 },
        }),
        wire({
          id: 'h',
          name: 'Healthy hero',
          initiative: 4,
          vitalState: 'standing',
          status: { ...status, currentHp: 7, isConscious: true },
        }),
      ],
    });
    const turn = summarizeCombatTurn(authoritative)!;
    render(
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
          round: authoritative.currentRound,
          combatants: buildEncounterCombatants(authoritative, turn),
        }}
      />,
    );

    expect(
      Array.from(document.querySelectorAll('[data-vital-state]')).map((chip) => chip.textContent),
    ).toEqual(['Unconscious', 'Stable', 'Dead']);
    const healthyRow = screen.getByText('Healthy hero').closest('[data-state]');
    expect(healthyRow?.textContent).toContain('Now');
    expect(screen.queryByText('Down')).toBeNull();
  });
});

describe('Table turn bar (#1428)', () => {
  it('shows the engine round, position and next actor with one pip per active combatant', () => {
    document.body.classList.add('ir-table-look');
    try {
      const view = bar(2, 0);
      expect(screen.getByTestId('combat-turn-text')).toHaveTextContent('Your turn');
      expect(screen.getByTestId('combat-turn-sub')).toHaveTextContent('Round 2 · Turn 1 of 2');
      expect(screen.getByTestId('combat-turn-next')).toHaveTextContent(
        'Next: Captain Sarah Reeves.',
      );
      expect(screen.getAllByTestId('combat-turn-pip')).toHaveLength(2);
      view.unmount();
      bar(2, 1);
      expect(screen.getByTestId('combat-turn-text')).toHaveTextContent(
        "Captain Sarah Reeves's turn",
      );
      expect(screen.getByTestId('combat-turn-sub')).toHaveTextContent('Round 2 · Turn 2 of 2');
      expect(screen.getByTestId('combat-turn-next')).toHaveTextContent(
        'Next: The Scholar starts round 3.',
      );
    } finally {
      document.body.classList.remove('ir-table-look');
    }
  });
});
