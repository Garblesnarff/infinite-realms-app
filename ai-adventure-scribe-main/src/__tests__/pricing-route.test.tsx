import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../App';

import { launchPageContent } from '@/data/launchPageContent';

// /pricing is public and needs no auth; the protected /app subtree is not under test here.
vi.mock('../routes/ProtectedAppRoutes', () => ({
  ProtectedAppRoutes: () => <div>app subtree</div>,
}));

describe('/pricing route (#227)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders the landing pricing section on its own URL', async () => {
    window.history.pushState({}, '', '/pricing');
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: launchPageContent.pricing.headline }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/pricing');
  });
});
