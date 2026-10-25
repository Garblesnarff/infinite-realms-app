import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { LEGAL_ROUTES } from '../legal-routes';

import { FooterSection } from '@/components/launch/FooterSection';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, userPlan: null, isBlogAdmin: false, signOut: vi.fn() }),
}));

const HEADINGS: Record<string, string> = {
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms of Service',
  '/cookies': 'Cookie Notice',
  '/contact': 'Contact',
};

const renderAt = (path: string) =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Suspense fallback={null}>
          <Routes>
            {LEGAL_ROUTES.map(({ path: p, Component }) => (
              <Route key={p} path={p} element={<Component />} />
            ))}
          </Routes>
        </Suspense>
      </MemoryRouter>
    </HelmetProvider>,
  );

describe('legal routes (#2258)', () => {
  it.each(Object.entries(HEADINGS))(
    '%s renders its heading and the draft banner',
    async (path, heading) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('Draft — under review');
    },
  );

  it('registers exactly the four public paths', () => {
    expect(LEGAL_ROUTES.map((r) => r.path).sort()).toEqual(Object.keys(HEADINGS).sort());
  });

  it('every legal link in the footer resolves to a registered route', () => {
    render(
      <MemoryRouter>
        <FooterSection />
      </MemoryRouter>,
    );
    const registered = new Set(LEGAL_ROUTES.map((r) => r.path));
    for (const path of Object.keys(HEADINGS)) {
      const link = document.querySelector(`footer a[href="${path}"]`);
      expect(link, `footer link ${path}`).not.toBeNull();
      expect(registered.has(path)).toBe(true);
    }
  });

  it('terms page carries the SRD 5.1 CC-BY-4.0 attribution (#985)', async (): Promise<void> => {
    renderAt('/terms');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Terms of Service' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not affiliated with or endorsed by Wizards of the Coast/),
    ).toBeInTheDocument();
    expect(screen.getByText(/includes material adapted from/)).toBeInTheDocument();
    expect(screen.getByText(/System Reference Document 5\.1/)).toBeInTheDocument();
    expect(screen.getByText(/Wizards of the Coast LLC/)).toBeInTheDocument();
    expect(
      screen.getByText(/Creative Commons Attribution 4\.0 International License/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/creativecommons\.org\/licenses\/by\/4\.0\/legalcode/),
    ).toBeInTheDocument();
  });

  it('footer shows the 2026 Infinite Realms copyright', () => {
    render(
      <MemoryRouter>
        <FooterSection />
      </MemoryRouter>,
    );
    expect(screen.getByText(/© 2026 Infinite Realms/)).toBeInTheDocument();
  });
});
