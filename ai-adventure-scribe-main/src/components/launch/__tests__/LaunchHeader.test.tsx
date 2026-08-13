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
});
