import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../../../../shared/npc-engine-message';
import {
  DEATH_SAVE_FAILED,
  ENEMY_HITS_PLAYER,
  ENEMY_STRIKES_DOWNED_PLAYER,
  REEVES,
  SCHOLAR,
} from '../../../../../../../shared/test-fixtures/engine-results';
import { CampaignEndState } from '../CampaignEndState';
import { FallenEndState, FallenStoryLog, finalEngineCards } from '../DeathScreen';

const state = vi.hoisted(() => ({
  messages: [] as unknown[],
  historyReady: true,
  hasMore: false,
  isLoading: false,
  isFetchingMore: false,
  loadMore: vi.fn(),
}));

vi.mock('@/contexts/MessageContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMessageContext: () => state,
    useOptionalMessageContext: () => ({ messages: state.messages }),
  };
});

const roster = [
  { id: SCHOLAR.id, name: SCHOLAR.name, participantType: 'player', maxHp: 7 },
  { id: REEVES.id, name: REEVES.name, participantType: 'monster', maxHp: 12 },
];

describe('death board cards (#1431)', () => {
  afterEach(() => {
    state.messages = [];
    state.hasMore = false;
    state.loadMore.mockClear();
  });

  it('FallenEndState shows saved final cards and no raw engine text', () => {
    const downed = buildNpcEngineMessage(
      roster,
      3,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_STRIKES_DOWNED_PLAYER,
    );
    const fatalSave = buildNpcEngineMessage(
      roster,
      3,
      { type: 'death_save', actorId: SCHOLAR.id },
      { deathSaves: [{ ...DEATH_SAVE_FAILED, roll: 2, successes: 1, failures: 3, isDead: true }] },
    );
    state.messages = [
      { id: 'downed', sender: 'system', text: downed.text, context: downed.context },
      { id: 'fatal', sender: 'system', text: fatalSave.text, context: fatalSave.context },
    ];

    render(
      <MemoryRouter>
        <FallenEndState characterName="The Scholar" chooseHeroHref="/x" />
      </MemoryRouter>,
    );

    const container = screen.getByTestId('death-screen-final-cards');
    expect(container.querySelectorAll('[data-testid="engine-result-card"]')).toHaveLength(2);
    const section = screen.getByText('HOW THEY FELL').closest('section') as HTMLElement;
    expect(section.textContent).not.toContain('⚙️ Engine:');
    expect(section.textContent).not.toContain('××');
  });

  it('finalEngineCards returns only the newest round, newest last', () => {
    const older = buildNpcEngineMessage(
      roster,
      1,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_HITS_PLAYER,
    );
    const newerA = buildNpcEngineMessage(
      roster,
      2,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_HITS_PLAYER,
    );
    const newerB = buildNpcEngineMessage(
      roster,
      2,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_HITS_PLAYER,
    );
    const messages = [
      { id: 'o', sender: 'system', text: older.text, context: older.context },
      { id: 'a', sender: 'system', text: newerA.text, context: newerA.context },
      { id: 'b', sender: 'system', text: newerB.text, context: newerB.context },
    ];
    const cards = finalEngineCards(messages);
    expect(cards).toHaveLength(2);
  });

  it('FallenStoryLog renders cards, round dividers and end footer', () => {
    const r1a = buildNpcEngineMessage(
      roster,
      1,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_HITS_PLAYER,
    );
    const r1b = buildNpcEngineMessage(
      roster,
      1,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_HITS_PLAYER,
    );
    const r2 = buildNpcEngineMessage(
      roster,
      2,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_HITS_PLAYER,
    );
    state.messages = [
      { id: 'a', sender: 'system', text: r1a.text, context: r1a.context },
      { id: 'b', sender: 'system', text: r1b.text, context: r1b.context },
      { id: 'c', sender: 'system', text: r2.text, context: r2.context },
    ];
    state.hasMore = false;

    const { rerender } = render(<FallenStoryLog />);
    const log = screen.getByTestId('death-screen-story-log');
    expect(log.querySelectorAll('[data-testid="engine-result-card"]')).toHaveLength(3);
    const dividers = screen.getAllByTestId('death-story-round-divider');
    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toHaveTextContent('Round 1');
    expect(dividers[1]).toHaveTextContent('Round 2');
    expect(screen.getByTestId('death-story-end')).toHaveTextContent(
      'End of the saved story. Nothing more can be added.',
    );

    state.hasMore = true;
    rerender(<FallenStoryLog />);
    expect(screen.queryByTestId('death-story-end')).not.toBeInTheDocument();

    state.hasMore = false;
  });

  it('FallenEndState prefers restored cards over finalLines', () => {
    const downed = buildNpcEngineMessage(
      roster,
      3,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_STRIKES_DOWNED_PLAYER,
    );
    const fatalSave = buildNpcEngineMessage(
      roster,
      3,
      { type: 'death_save', actorId: SCHOLAR.id },
      { deathSaves: [{ ...DEATH_SAVE_FAILED, roll: 2, successes: 1, failures: 3, isDead: true }] },
    );
    state.messages = [
      { id: 'downed', sender: 'system', text: downed.text, context: downed.context },
      { id: 'fatal', sender: 'system', text: fatalSave.text, context: fatalSave.context },
    ];

    render(
      <MemoryRouter>
        <FallenEndState
          characterName="The Scholar"
          chooseHeroHref="/x"
          finalLines={['⚙️ Engine: raw line']}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('death-screen-final-cards')).toBeInTheDocument();
    expect(screen.queryByTestId('death-screen-final-lines')).not.toBeInTheDocument();
  });

  it('FallenEndState falls back to finalLines with no messages', () => {
    state.messages = [];
    render(
      <MemoryRouter>
        <FallenEndState
          characterName="The Scholar"
          chooseHeroHref="/x"
          finalLines={['⚙️ Engine: raw line']}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('death-screen-final-lines')).toBeInTheDocument();
  });

  it('story log of a combined downed strike has no Engine text and shows status sentence', () => {
    const combined = buildNpcEngineMessage(
      [
        { id: REEVES.id, name: REEVES.name, participantType: 'monster', maxHp: 12 },
        { id: SCHOLAR.id, name: SCHOLAR.name, participantType: 'player', maxHp: 7 },
      ],
      4,
      { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
      ENEMY_STRIKES_DOWNED_PLAYER,
    );
    state.messages = [{ id: 'combined-downed-strike', sender: 'system', ...combined }];
    render(<FallenStoryLog />);
    const log = screen.getByTestId('death-screen-story-log');
    expect(log.textContent).not.toContain('Engine:');
    expect(screen.getByTestId('death-story-status')).toHaveTextContent(
      /^The Scholar is unconscious\.$/,
    );
  });

  it('heading has !outline-none, not bare outline-none', () => {
    render(
      <MemoryRouter>
        <CampaignEndState mode="fallen" characterName="The Scholar" chooseHeroHref="/x" />
      </MemoryRouter>,
    );
    const h1 = screen.getByRole('heading', { name: 'The Scholar has fallen' });
    expect(h1).toHaveClass('!outline-none');
    expect(h1.className.split(/\s+/)).not.toContain('outline-none');

    render(
      <MemoryRouter>
        <FallenEndState characterName="The Scholar" chooseHeroHref="/x" />
      </MemoryRouter>,
    );
    const h2 = screen.getAllByRole('heading', { name: 'The Scholar has fallen' })[1];
    expect(h2).toHaveClass('!outline-none');
    expect(h2.className.split(/\s+/)).not.toContain('outline-none');
  });
});
