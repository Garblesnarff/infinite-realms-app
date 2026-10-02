import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { DeathScreen } from '../DeathScreen';

import type { RenderResult } from '@testing-library/react';

// #2456: the death state must render an end screen with clear choices — never
// the "Checking whose turn it is… / Resuming…" resume loop.

const renderDeathScreen = (props: {
  characterName?: string | null;
  onDismiss?: () => void;
}): RenderResult =>
  render(
    <MemoryRouter>
      <DeathScreen characterName={props.characterName} onDismiss={props.onDismiss ?? (() => {})} />
    </MemoryRouter>,
  );

describe('DeathScreen (#2456)', () => {
  it('renders the end screen with the fallen character name', () => {
    renderDeathScreen({ characterName: 'The Scholar' });

    expect(screen.getByTestId('death-screen')).toBeInTheDocument();
    expect(screen.getByText('The Scholar has fallen')).toBeInTheDocument();
  });

  it('falls back to a generic name when the character name is missing', () => {
    renderDeathScreen({ characterName: null });

    expect(screen.getByText('Your character has fallen')).toBeInTheDocument();
  });

  it('offers clear choices: new character, explore campaigns, read the story', () => {
    renderDeathScreen({ characterName: 'The Scholar' });

    expect(screen.getByTestId('death-screen-new-character')).toHaveTextContent(
      'Create a new character',
    );
    expect(screen.getByTestId('death-screen-explore')).toHaveTextContent('Explore campaigns');
    expect(screen.getByTestId('death-screen-read-epilogue')).toHaveTextContent(
      'Read the story so far',
    );
  });

  it('does not render the resume-loop text', () => {
    renderDeathScreen({ characterName: 'The Scholar' });

    expect(screen.queryByText('Checking whose turn it is…')).not.toBeInTheDocument();
    expect(screen.queryByText('Resuming…')).not.toBeInTheDocument();
    expect(screen.queryByText('Resume turn')).not.toBeInTheDocument();
  });

  it('calls onDismiss when the player chooses to read the story', () => {
    const onDismiss = vi.fn();
    renderDeathScreen({ characterName: 'The Scholar', onDismiss });

    fireEvent.click(screen.getByTestId('death-screen-read-epilogue'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
