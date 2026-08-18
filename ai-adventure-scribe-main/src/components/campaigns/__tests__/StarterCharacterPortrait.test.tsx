import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';

import { StarterCharacterPortrait } from '../StarterCharacterPortrait';

const fallback = <span data-testid="fallback-icon">icon</span>;

describe('StarterCharacterPortrait', () => {
  it('renders the image when a portrait URL is provided', () => {
    render(
      <StarterCharacterPortrait
        name="Valerius"
        portraitUrl="https://example.com/portrait.png"
        fallback={fallback}
      />,
    );

    const img = screen.getByRole('img', { name: 'Valerius' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/portrait.png');
  });

  it('shows an honest "coming soon" fallback when no portrait URL is linked', () => {
    render(<StarterCharacterPortrait name="Valerius" portraitUrl={null} fallback={fallback} />);

    expect(screen.getByRole('img', { name: 'Valerius portrait coming soon' })).toBeInTheDocument();
    expect(screen.getByTestId('fallback-icon')).toBeInTheDocument();
  });

  it('shows an "unavailable" fallback when a linked portrait fails to load', () => {
    render(
      <StarterCharacterPortrait
        name="Valerius"
        portraitUrl="https://example.com/portrait.png"
        fallback={fallback}
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Valerius' }));

    expect(screen.getByRole('img', { name: 'Valerius portrait unavailable' })).toBeInTheDocument();
  });

  it('resets the error state when the portrait URL changes', () => {
    const { rerender } = render(
      <StarterCharacterPortrait
        name="Valerius"
        portraitUrl="https://example.com/portrait.png"
        fallback={fallback}
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Valerius' }));
    expect(screen.getByRole('img', { name: 'Valerius portrait unavailable' })).toBeInTheDocument();

    rerender(
      <StarterCharacterPortrait
        name="Valerius"
        portraitUrl="https://example.com/portrait-2.png"
        fallback={fallback}
      />,
    );

    const img = screen.getByRole('img', { name: 'Valerius' });
    expect(img).toHaveAttribute('src', 'https://example.com/portrait-2.png');
  });
});
