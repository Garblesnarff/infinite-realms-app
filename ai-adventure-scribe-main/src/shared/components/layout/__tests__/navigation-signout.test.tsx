import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import Navigation from '../navigation';

import { TooltipProvider } from '@/components/ui/tooltip';

const authState = vi.hoisted(() => ({
  value: {
    user: { id: 'user-1', email: 'player@example.com' } as { id: string; email: string } | null,
    userPlan: 'free' as string | null,
    isBlogAdmin: false,
    signOut: vi.fn(async () => {}),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.value,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('Navigation sign out redirect (#210 QA-018)', () => {
  it("navigates to '/' after Sign Out from a deep URL", async () => {
    authState.value.signOut.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/app/characters/abc']}>
        <TooltipProvider delayDuration={0}>
          <Navigation />
        </TooltipProvider>
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('location')).toHaveTextContent('/app/characters/abc');
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(authState.value.signOut).toHaveBeenCalled();
    expect(await screen.findByText('/')).toBeInTheDocument();
  });
});
