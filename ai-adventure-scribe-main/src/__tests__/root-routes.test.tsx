import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../App';

// The real /app/* subtree needs auth; the redirect target only needs to prove
// /account lands on a route the app subtree owns.
vi.mock('../routes/ProtectedAppRoutes', () => ({
  ProtectedAppRoutes: () => <div>app subtree</div>,
}));

describe('App root routes', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it("redirects /account to /app/account (#2343 C8)", () => {
    window.history.pushState({}, '', '/account');
    render(<App />);

    expect(window.location.pathname).toBe('/app/account');
  });
});
