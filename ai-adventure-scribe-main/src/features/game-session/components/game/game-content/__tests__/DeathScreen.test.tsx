import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CampaignEndState } from '../CampaignEndState';
import { buildChooseHeroHref, finalEngineLines, FallenEndState } from '../DeathScreen';

const messageState = vi.hoisted(() => ({ messages: undefined as unknown[] | undefined }));
vi.mock('@/contexts/MessageContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useOptionalMessageContext: () =>
      messageState.messages ? { messages: messageState.messages } : undefined,
  };
});

import type { RenderResult } from '@testing-library/react';

// #2456/#2517: the death state must render an end state with clear choices —
// never the "Checking whose turn it is… / Resuming…" resume loop. It is a
// page state, not a dismissible overlay: "Read the story so far" opens a
// read-only view INSIDE the end state and there is no way back to a live
// composer from it.

const renderEndState = (props: {
  characterName?: string | null;
  finalLines?: string[];
  campaignName?: string | null;
  chooseHeroHref?: string;
  chooseHeroPending?: boolean;
  storyContent?: React.ReactNode;
}): RenderResult =>
  render(
    <MemoryRouter>
      <FallenEndState
        characterName={props.characterName}
        finalLines={props.finalLines}
        campaignName={props.campaignName}
        chooseHeroHref={props.chooseHeroHref ?? '/app/characters/create?campaign=camp-1'}
        chooseHeroPending={props.chooseHeroPending}
        storyContent={props.storyContent}
      />
    </MemoryRouter>,
  );

describe('FallenEndState (#2456, #2517)', () => {
  it('renders the end state with the fallen character name', () => {
    renderEndState({ characterName: 'The Scholar' });

    expect(screen.getByTestId('death-screen')).toBeInTheDocument();
    expect(screen.getByText('The Scholar has fallen')).toBeInTheDocument();
  });

  it('falls back to a generic name when the character name is missing', () => {
    renderEndState({ characterName: null });

    expect(screen.getByText('Your character has fallen')).toBeInTheDocument();
  });

  it('offers clear choices: choose a new hero, explore campaigns, read the story', () => {
    renderEndState({
      characterName: 'The Scholar',
      campaignName: 'Abyssal Descent',
      storyContent: <p>The log</p>,
    });

    expect(screen.getByTestId('death-screen-new-character')).toHaveTextContent('Choose a new hero');
    expect(
      screen.getByText('Abyssal Descent goes on. The Scholar’s story is kept.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('death-screen-explore')).toHaveTextContent('Explore other campaigns');
    expect(screen.getByTestId('death-screen-read-story')).toHaveTextContent(
      'Read the story so far',
    );
    // Table 11: story, then a new hero, then explore, then the realm.
    // The design wins over the old order that led with the hero pick.
    const story = screen.getByTestId('death-screen-read-story');
    const hero = screen.getByTestId('death-screen-new-character');
    const explore = screen.getByTestId('death-screen-explore');
    const realm = screen.getByTestId('death-screen-realm');
    expect(story.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hero.compareDocumentPosition(explore) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(explore.compareDocumentPosition(realm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('disables "Choose a new hero" while the hero-pick route is still resolving', () => {
    renderEndState({ characterName: 'The Scholar', chooseHeroPending: true });

    expect(screen.getByTestId('death-screen-new-character')).toBeDisabled();
  });

  it('#2517: carries the engine final lines when the killing turn produced them', () => {
    // Lines as the engine writes them in the killing round (run D2, #2516):
    // the raw transcript carries the `⚙️ Engine:` prefix, which the screen
    // strips so the fallen hero's last moments read as narration.
    renderEndState({
      characterName: 'The Scholar',
      finalLines: [
        '⚙️ Engine: Vitruvian Spider rolled 11 + 3 = 14 vs AC 11 against The Scholar with strike — HIT. 3 piercing damage. The Scholar is now at 0 HP and is unconscious.',
        '⚙️ Engine: Rolled 2: the third failure. The Scholar is dead.',
      ],
    });

    const lines = screen.getByTestId('death-screen-final-lines');
    expect(lines).toHaveTextContent('The Scholar is now at 0 HP and is unconscious.');
    expect(lines).toHaveTextContent('Rolled 2: the third failure. The Scholar is dead.');
    expect(lines).not.toHaveTextContent('Engine:');
  });

  it('#136: renders nothing for how they fell or the run until those lines exist', () => {
    // The old screen invented "The Scholar is dead." when the killing turn
    // carried no lines. Table 11 hides both blocks instead of a placeholder.
    renderEndState({ characterName: 'The Scholar' });

    expect(screen.queryByTestId('death-screen-final-lines')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'HOW THEY FELL' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'THE RUN' })).not.toBeInTheDocument();
    expect(screen.queryByText('The Scholar is dead.')).not.toBeInTheDocument();
  });

  it('does not render the resume-loop text', () => {
    renderEndState({ characterName: 'The Scholar' });

    expect(screen.queryByText('Checking whose turn it is…')).not.toBeInTheDocument();
    expect(screen.queryByText('Resuming…')).not.toBeInTheDocument();
    expect(screen.queryByText('Resume turn')).not.toBeInTheDocument();
  });

  it('opens the story inside the end state and back, never dismissing to a game', () => {
    renderEndState({
      characterName: 'The Scholar',
      storyContent: <p data-testid="story-body">The saved log</p>,
    });

    fireEvent.click(screen.getByTestId('death-screen-read-story'));
    expect(screen.getByTestId('death-screen-story')).toBeInTheDocument();
    expect(screen.getByTestId('story-body')).toBeInTheDocument();
    // The end state card is gone while reading; there is no composer anywhere.
    expect(screen.queryByTestId('death-screen')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('death-screen-story-back'));
    expect(screen.getByTestId('death-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('death-screen-story')).not.toBeInTheDocument();
  });

  it('has no read-story choice when no story content is available', () => {
    renderEndState({ characterName: 'The Scholar' });

    expect(screen.queryByTestId('death-screen-read-story')).not.toBeInTheDocument();
  });

  it('shows the run only when the caller already has the numbers', () => {
    render(
      <MemoryRouter>
        <CampaignEndState
          mode="fallen"
          characterName="The Scholar"
          campaignName="Abyssal Descent"
          chooseHeroHref="/explore"
          finalLines={['Rolled 2: the third failure.']}
          runSummary={{
            turns: 16,
            fights: 1,
            monstersDefeated: 0,
            rounds: 4,
            fatalRoll: '2',
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'HOW THEY FELL' })).toBeInTheDocument();
    expect(screen.getByTestId('death-screen-final-lines')).toHaveTextContent(
      'Rolled 2: the third failure.',
    );
    expect(screen.getByRole('heading', { name: 'THE RUN' })).toBeInTheDocument();
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('Rounds survived')).toBeInTheDocument();
    expect(screen.getByText('Last roll')).toBeInTheDocument();
  });
});

describe('buildChooseHeroHref (#2517)', () => {
  it('routes a starter campaign through its hero pick', () => {
    expect(buildChooseHeroHref({ starterSlug: 'abyssal-descent', campaignId: 'camp-1' })).toBe(
      '/explore/abyssal-descent?campaignId=camp-1#heroes',
    );
  });

  it('routes a custom campaign through creation carrying the campaign', () => {
    expect(buildChooseHeroHref({ campaignId: 'camp-9' })).toBe(
      '/app/characters/create?campaign=camp-9',
    );
  });

  it('never emits the bare character-create route', () => {
    expect(buildChooseHeroHref({})).toBe('/explore');
    expect(buildChooseHeroHref({ starterSlug: 'x' })).not.toBe('/app/characters/create');
  });
});

const engineMessage = (
  round: number,
  lines: string[],
): { sender: string; context: Record<string, unknown> } => ({
  sender: 'system',
  context: {
    combatEngineBlocks: [{ sequence: round, round, source: 'npc', lines }],
  },
});

describe('finalEngineLines (#2517 reload)', () => {
  it('takes the last round of engine lines, newest last, at most three', () => {
    const messages = [
      engineMessage(1, ['⚙️ Engine: round one']),
      engineMessage(2, ['⚙️ Engine: round two, first', '⚙️ Engine: round two, second']),
      { sender: 'dm', context: {} },
      engineMessage(3, ['⚙️ Engine: a', '⚙️ Engine: b', '⚙️ Engine: c', '⚙️ Engine: d']),
    ];
    expect(finalEngineLines(messages)).toEqual(['⚙️ Engine: b', '⚙️ Engine: c', '⚙️ Engine: d']);
  });

  it('reads the same round across messages and ignores other senders', () => {
    const messages = [
      engineMessage(4, ['⚙️ Engine: first half']),
      { sender: 'player', context: { combatEngineBlocks: [{ round: 9, lines: ['nope'] }] } },
      engineMessage(4, ['⚙️ Engine: second half']),
    ];
    expect(finalEngineLines(messages)).toEqual(['⚙️ Engine: first half', '⚙️ Engine: second half']);
  });

  it('returns nothing when the log holds no engine blocks', () => {
    expect(finalEngineLines([{ sender: 'dm', context: {} }])).toEqual([]);
    expect(finalEngineLines([])).toEqual([]);
  });
});

describe('FallenEndState restored and fade (#2517, board Death)', () => {
  afterEach(() => {
    messageState.messages = undefined;
  });

  it('shows the engine final lines from the saved log after a reload', () => {
    messageState.messages = [engineMessage(2, ['⚙️ Engine: The Scholar is dead.'])];
    renderEndState({ characterName: 'The Scholar' });
    expect(screen.getByText('HOW THEY FELL')).toBeInTheDocument();
    expect(screen.getByTestId('death-screen-final-lines')).toHaveTextContent(
      'The Scholar is dead.',
    );
    expect(screen.queryByText(/Dungeon Master/)).not.toBeInTheDocument();
  });

  it('renders no How They Fell section when the saved log has no engine lines', () => {
    messageState.messages = [{ sender: 'dm', context: {} }];
    renderEndState({ characterName: 'The Scholar' });
    expect(screen.queryByText('HOW THEY FELL')).not.toBeInTheDocument();
  });

  it('prefers the live final lines over the saved log', () => {
    messageState.messages = [engineMessage(2, ['⚙️ Engine: from the log'])];
    renderEndState({ characterName: 'The Scholar', finalLines: ['⚙️ Engine: from the death'] });
    expect(screen.getByTestId('death-screen-final-lines')).toHaveTextContent('from the death');
    expect(screen.queryByText('from the log')).not.toBeInTheDocument();
  });

  it('fades the screen in only when asked (a live death)', () => {
    const { unmount } = render(
      <MemoryRouter>
        <FallenEndState characterName="The Scholar" chooseHeroHref={null} fadeIn />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('death-screen')).toHaveClass('ir-end-fade-in');
    unmount();
    renderEndState({ characterName: 'The Scholar' });
    expect(screen.getByTestId('death-screen')).not.toHaveClass('ir-end-fade-in');
  });
});
