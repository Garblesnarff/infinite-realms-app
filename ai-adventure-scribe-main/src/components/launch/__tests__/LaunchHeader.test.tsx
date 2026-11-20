import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { LaunchHeader } from '../LaunchHeader';

describe('LaunchHeader', () => {
  it('keeps the app sign-in path visible on the public landing page', () => {
    render(
      <MemoryRouter>
        <LaunchHeader />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/app');
  });

  // #1679: the header is one row at 390, and the logo and Sign in are 44 px tap targets (#1664).
  it('keeps the header on one row with 44 px logo and sign-in targets', () => {
    render(
      <MemoryRouter>
        <LaunchHeader />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Infinite Realms home' })).toHaveClass('min-h-11');
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveClass('min-h-11');
    const row = screen.getByRole('link', { name: 'Infinite Realms home' }).parentElement;
    expect(row).toHaveClass('flex', 'justify-between');
    expect(row).not.toHaveClass('flex-wrap');
  });
});
