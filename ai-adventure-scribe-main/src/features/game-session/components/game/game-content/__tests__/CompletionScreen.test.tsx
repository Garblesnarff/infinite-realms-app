import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CampaignCompleteEndState } from '../CompletionScreen';

import type { RenderResult } from '@testing-library/react';

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
      />
    </MemoryRouter>,
  );

describe('CampaignCompleteEndState (#1020)', () => {
  it('renders the completion state with the character and campaign names', () => {
    renderEndState({ characterName: 'Tavo Brejo', campaignName: "The Gardener's Heir" });

    expect(screen.getByTestId('completion-screen')).toBeInTheDocument();
    expect(screen.getByText('Adventure complete')).toBeInTheDocument();
    expect(
      screen.getByText(/Tavo Brejo has finished The Gardener's Heir/),
    ).toBeInTheDocument();
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
      'Choose a new hero',
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
