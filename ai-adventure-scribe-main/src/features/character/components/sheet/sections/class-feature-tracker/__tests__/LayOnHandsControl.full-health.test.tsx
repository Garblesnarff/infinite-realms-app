import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LayOnHandsControl } from '../LayOnHandsControl';

import { SheetHitPointsContext } from '@/contexts/sheet-hit-points';

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer access-token' })),
  loadCachedSession: vi.fn(() => ({ access_token: 'access-token' })),
}));

// #1643: at full HP the Heal self button is disabled with the reason beside it.
describe('LayOnHandsControl at full health (#1643)', () => {
  it('disables Heal self and says why when the hero is at full HP', () => {
    render(
      <SheetHitPointsContext.Provider value={{ current: 12, maximum: 12 }}>
        <LayOnHandsControl characterId="char-1" pool={5} />
      </SheetHitPointsContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Heal self' })).toBeDisabled();
    expect(screen.getByText('You are already at full health.')).toBeInTheDocument();
  });

  // #1679: the hint is the Heal self button's description, not a loose paragraph.
  it('describes the disabled Heal self button with the full-health hint', () => {
    render(
      <SheetHitPointsContext.Provider value={{ current: 12, maximum: 12 }}>
        <LayOnHandsControl characterId="char-1" pool={5} />
      </SheetHitPointsContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Heal self' })).toHaveAccessibleDescription(
      'You are already at full health.',
    );
  });

  it('leaves Heal self enabled and shows no hint when the hero is hurt', () => {
    render(
      <SheetHitPointsContext.Provider value={{ current: 7, maximum: 12 }}>
        <LayOnHandsControl characterId="char-1" pool={5} />
      </SheetHitPointsContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Heal self' })).toBeEnabled();
    expect(screen.queryByText('You are already at full health.')).toBeNull();
  });
});

// #1643: the refusal toast names the server's reason and no HTTP status number.
describe('LayOnHandsControl refusal toast (#1643)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows the server reason for a 422 without the status number', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'That target is already at full health',
          code: 'BUSINESS_LOGIC_ERROR',
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(
      <SheetHitPointsContext.Provider value={{ current: 7, maximum: 12 }}>
        <LayOnHandsControl characterId="char-1" pool={5} />
      </SheetHitPointsContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Heal self' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Lay on Hands',
          description: 'That target is already at full health',
          variant: 'destructive',
        }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent).toEqual({ amount: 1 });
  });
});
