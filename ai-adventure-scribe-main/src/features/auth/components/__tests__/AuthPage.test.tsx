import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import AuthPage from '../AuthPage';

describe('AuthPage', () => {
  it('presents a branded return path before handing authentication to WorkOS', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AuthPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /your worlds are waiting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in or create an account/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /back to landing/i })).toHaveAttribute('href', '/');
  });
});
