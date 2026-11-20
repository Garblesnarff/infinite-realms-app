import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import BasicInfo from '../BasicInfo';

import { CharacterProvider } from '@/contexts/CharacterContext';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const authHolder = vi.hoisted(() => ({ user: { id: 'user-213' } as { id: string } | null }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authHolder.user }),
}));

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: async () => {} }));

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderBasicInfo(client = makeClient()): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={client}>
      <CharacterProvider>
        <BasicInfo />
      </CharacterProvider>
    </QueryClientProvider>,
  );
}

describe('BasicInfo wizard step (#213)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the Name field when the input exceeds its limit', async () => {
    renderBasicInfo();

    const input = screen.getByLabelText(/Name/);
    fireEvent.change(input, { target: { value: 'A'.repeat(51) } });
    fireEvent.blur(input);

    expect(screen.getByRole('alert')).toHaveTextContent('Name must be 50 characters or less');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a duplicate warning for an existing hero name (case-insensitive, trimmed)', async () => {
    const rows = [
      {
        id: 'c1',
        name: 'Thorin Oakenshield',
        user_id: 'user-213',
        campaign_id: null,
        level: 1,
        race: null,
        class: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderBasicInfo();

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());

    const calledUrls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes('/v1/characters'))).toBe(true);
    expect(calledUrls.every((u) => !u.includes('campaign_id'))).toBe(true);

    const input = screen.getByLabelText(/Name/);
    fireEvent.change(input, { target: { value: '  thorin oakenshield ' } });

    expect(
      await screen.findByText('You already have a hero named thorin oakenshield.'),
    ).toBeTruthy();
  });

  it('shows no warning for a brand new name', async () => {
    const rows = [
      {
        id: 'c1',
        name: 'Thorin Oakenshield',
        user_id: 'user-213',
        campaign_id: null,
        level: 1,
        race: null,
        class: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderBasicInfo();

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());

    const input = screen.getByLabelText(/Name/);
    fireEvent.change(input, { target: { value: 'Brand New Hero' } });

    await waitFor(() => {
      expect(screen.queryByText(/You already have a hero named/)).toBeNull();
    });
  });

  it('does not load a roster or warn when no user is signed in', async () => {
    const previous = authHolder.user;
    authHolder.user = null;
    try {
      renderBasicInfo();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(fetch)).not.toHaveBeenCalled();

      const input = screen.getByLabelText(/Name/);
      fireEvent.change(input, { target: { value: 'Thorin Oakenshield' } });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.queryByText(/You already have a hero named/)).toBeNull();
    } finally {
      authHolder.user = previous;
    }
  });
});
