import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LandingMemory } from '../LandingMemory';

describe('LandingMemory', () => {
  it('visibly labels the notes as an example and keeps the board notes', () => {
    render(<LandingMemory />);

    expect(screen.getByText('Example')).toBeVisible();
    expect(screen.getByText('The DM remembers this story.')).toBeInTheDocument();
    expect(
      screen.getByText('The iron piton is new, hammered in by the last expedition.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The Vitruvian Spider is stitched from the dead of the last expedition.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A torn page: “Day 9. The ropes were cut from below.”'),
    ).toBeInTheDocument();
  });

  // #1679: the "Example" label is 12 px (text-xs), per #1664.
  it('sets the Example label at 12 px', () => {
    render(<LandingMemory />);

    expect(screen.getByText('Example')).toHaveClass('text-xs');
    expect(screen.getByText('Example')).not.toHaveClass('text-[11px]');
  });
});
