import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { buildChooseHeroHref, FallenEndState } from '../DeathScreen';

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

    expect(screen.getByTestId('death-screen-new-character')).toHaveTextContent(
      'Choose a new hero',
    );
    expect(screen.getByText("Begin Abyssal Descent again with a new hero. The Scholar’s story is kept.")).toBeInTheDocument();
    expect(screen.getByTestId('death-screen-explore')).toHaveTextContent('Explore other campaigns');
    expect(screen.getByTestId('death-screen-read-story')).toHaveTextContent(
      'Read the story so far',
    );
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

  it('#2517: omits the final-lines block when no lines were carried', () => {
    renderEndState({ characterName: 'The Scholar' });

    expect(screen.queryByTestId('death-screen-final-lines')).not.toBeInTheDocument();
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
});

describe('buildChooseHeroHref (#2517)', () => {
  it('routes a starter campaign through its hero pick', () => {
    expect(
      buildChooseHeroHref({ starterSlug: 'abyssal-descent', campaignId: 'camp-1' }),
    ).toBe('/explore/abyssal-descent/choose-character?campaignId=camp-1');
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
