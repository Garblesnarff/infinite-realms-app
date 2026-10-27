import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CampaignCompleteEndState } from '../CompletionScreen';

import type { RenderResult } from '@testing-library/react';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';

// #1020: when the server completes the session at the campaign's ending, the
// completion end state replaces the game screen — a page state, not a
// dismissible overlay, like the fallen end state. "Read the story so far"
// opens the read-only log INSIDE the end state; there is no way back to a
// live composer from it, because the session is complete.

const SUMMARY = 'The party chose the Sunken Temple landing as the Clock filled.';

const renderEndState = (props: {
  characterName?: string | null;
  campaignName?: string | null;
  summary?: string | null;
  chooseHeroHref?: string;
  chooseHeroPending?: boolean;
  storyContent?: React.ReactNode;
  experience?: number | null;
}): RenderResult =>
  render(
    <MemoryRouter>
      <CampaignCompleteEndState
        characterName={props.characterName}
        campaignName={props.campaignName}
        summary={props.summary}
        chooseHeroHref={props.chooseHeroHref ?? '/app/characters/create?campaign=camp-1'}
        chooseHeroPending={props.chooseHeroPending}
        storyContent={props.storyContent}
        experience={props.experience}
      />
    </MemoryRouter>,
  );

describe('CampaignCompleteEndState (#1020)', () => {
  it('renders the completion state with the character and campaign names', () => {
    renderEndState({ characterName: 'Tavo Brejo', campaignName: "The Gardener's Heir" });

    expect(screen.getByTestId('completion-screen')).toBeInTheDocument();
    expect(screen.getByText('Adventure complete')).toBeInTheDocument();
    expect(screen.getByText(/Tavo Brejo has finished The Gardener's Heir/)).toBeInTheDocument();
  });

  it('falls back to generic names when character and campaign are missing', () => {
    renderEndState({ characterName: null, campaignName: null });

    expect(screen.getByText(/Your character has finished this campaign/)).toBeInTheDocument();
  });

  it('shows the ending summary the server stored', () => {
    renderEndState({ characterName: 'Tavo Brejo', summary: SUMMARY });

    expect(screen.getByTestId('completion-screen-summary')).toHaveTextContent(SUMMARY);
  });

  it('shows no summary block when the completion carried none', () => {
    renderEndState({ characterName: 'Tavo Brejo', summary: null });

    expect(screen.queryByTestId('completion-screen-summary')).not.toBeInTheDocument();
  });

  it('offers clear choices: choose a new hero, explore campaigns, read the story', () => {
    renderEndState({
      characterName: 'Tavo Brejo',
      campaignName: "The Gardener's Heir",
      storyContent: <p>The log</p>,
    });

    expect(screen.getByTestId('completion-screen-new-character')).toHaveTextContent(
      'Begin again with a new hero',
    );
    expect(screen.getByTestId('completion-screen-explore')).toHaveTextContent(
      'Explore other campaigns',
    );
    expect(screen.getByTestId('completion-screen-read-story')).toHaveTextContent(
      'Read the story so far',
    );
  });

  it('disables "Choose a new hero" while the hero-pick route is still resolving', () => {
    renderEndState({ characterName: 'Tavo Brejo', chooseHeroPending: true });

    expect(screen.getByTestId('completion-screen-new-character')).toBeDisabled();
  });

  it('reads the story inside the end state and returns to the end state', () => {
    renderEndState({ characterName: 'Tavo Brejo', storyContent: <p>The log</p> });

    fireEvent.click(screen.getByTestId('completion-screen-read-story'));

    expect(screen.getByTestId('completion-screen-story')).toBeInTheDocument();
    expect(screen.getByText('The log')).toBeInTheDocument();
    expect(screen.queryByTestId('completion-screen')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('completion-screen-story-back'));

    expect(screen.getByTestId('completion-screen')).toBeInTheDocument();
  });
});

describe('CampaignCompleteEndState waits for the sheet refresh (#1161)', () => {
  const CHAR_1175 = { id: 'char-1', name: 'Tavo Brejo', experience: 1175 };
  const CHAR_1500 = { id: 'char-1', name: 'Tavo Brejo', experience: 1500 };

  /** Seeds the context once, on mount, like the game screen's initial load. */
  function SeedCharacter({ character }: { character: unknown }): React.ReactElement | null {
    const { dispatch } = useCharacter();
    React.useEffect(() => {
      dispatch({ type: 'SET_CHARACTER', payload: character as never });
    }, [dispatch, character]);
    return null;
  }

  /** Stands in for the refresh hook's refetch landing (SET_CHARACTER). */
  function RefreshButton({ fresh }: { fresh: unknown }): React.ReactElement {
    const { dispatch } = useCharacter();
    return (
      <button
        type="button"
        data-testid="simulate-refresh"
        onClick={() => dispatch({ type: 'SET_CHARACTER', payload: fresh as never })}
      >
        Refresh
      </button>
    );
  }

  it('shows an explicit experience prop immediately, without waiting', () => {
    renderEndState({ characterName: 'Tavo Brejo', experience: 1500 });

    expect(screen.getByTestId('completion-screen-experience')).toHaveTextContent('1,500 XP');
  });

  it('holds the XP line until the sheet refresh lands, then shows the fresh total', () => {
    // The live path mounts with the pre-award sheet already in context
    // (remount with a new key models that: the fresh screen's mount-time
    // character is the stale 1,175). Only the refresh landing may settle it.
    const tree = (key: string): React.ReactElement => (
      <MemoryRouter>
        <CharacterProvider>
          <SeedCharacter character={CHAR_1175} />
          <CampaignCompleteEndState
            key={key}
            characterName="Tavo Brejo"
            campaignName="Happily Ever After"
            summary="The end."
            chooseHeroHref="/app/characters/create?campaign=camp-1"
          />
          <RefreshButton fresh={CHAR_1500} />
        </CharacterProvider>
      </MemoryRouter>
    );
    const { rerender } = render(tree('v1'));
    // Setup: the seeded screen settled on the seed and shows 1,175.
    expect(screen.getByTestId('completion-screen-experience')).toHaveTextContent('1,175 XP');

    // Remount: the new screen mounts with 1,175 already in context, so it waits.
    rerender(tree('v2'));
    expect(screen.queryByTestId('completion-screen-experience')).not.toBeInTheDocument();

    // The ending turn's refresh lands: context 1,175 -> 1,500, line appears fresh.
    fireEvent.click(screen.getByTestId('simulate-refresh'));
    expect(screen.getByTestId('completion-screen-experience')).toHaveTextContent('1,500 XP');
  });
});
