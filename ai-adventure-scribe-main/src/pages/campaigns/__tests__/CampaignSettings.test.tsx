import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CampaignSettings from '../CampaignSettings';

import { tableSettingsKey } from '@/features/settings/table-settings';

const mockUser = { id: 'user-a' as string | null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.id ? { id: mockUser.id } : null }),
  useOptionalAuth: () => ({ user: mockUser.id ? { id: mockUser.id } : null }),
}));

const updateCampaign = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { updateCampaign: (...args: unknown[]) => updateCampaign(...args) },
}));

const renderPage = (): ReturnType<typeof render> =>
  render(<CampaignSettings campaignId="camp-1" rulesConfig={{}} />);

const readStored = (userId: string): Record<string, unknown> | null => {
  const raw = window.localStorage.getItem(tableSettingsKey(userId));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

describe('CampaignSettings shares PlayerSettings and keeps Level Advancement (#1347)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUser.id = 'user-a';
    updateCampaign.mockClear();
  });

  it('shows Dice sound and Level Advancement', () => {
    renderPage();
    expect(screen.getByRole('switch', { name: 'Dice sound' })).toBeInTheDocument();
    expect(screen.getByLabelText('Level Advancement')).toBeInTheDocument();
  });

  it('shows the shared table and narration controls including Show NPC Rolls', () => {
    renderPage();
    expect(screen.getByRole('switch', { name: 'Show target numbers' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Auto-play' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByLabelText('Reduce motion')).toBeInTheDocument();
    expect(screen.getByLabelText('Volume')).toBeInTheDocument();
    expect(screen.getByLabelText('Speed')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show NPC Rolls' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByText(/Coming Soon/i)).not.toBeInTheDocument();
  });

  it('starts Dice sound on by default', () => {
    renderPage();
    expect(screen.getByRole('switch', { name: 'Dice sound' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('saves a Dice sound change under the signed-in user and reloads it', () => {
    const first = renderPage();
    fireEvent.click(screen.getByRole('switch', { name: 'Dice sound' }));
    expect(readStored('user-a')).toMatchObject({ diceSound: false });
    first.unmount();

    renderPage();
    expect(screen.getByRole('switch', { name: 'Dice sound' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('keeps another user separate on the same browser', () => {
    const first = renderPage();
    fireEvent.click(screen.getByRole('switch', { name: 'Dice sound' }));
    first.unmount();

    mockUser.id = 'user-b';
    renderPage();
    expect(screen.getByRole('switch', { name: 'Dice sound' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('still saves Level Advancement to the campaign', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Level Advancement'), {
      target: { value: 'milestone' },
    });
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', {
      rules_config: { levelingMode: 'milestone' },
    });
  });

  it('saves nothing when no user is signed in', () => {
    mockUser.id = null;
    renderPage();
    fireEvent.click(screen.getByRole('switch', { name: 'Dice sound' }));
    expect(window.localStorage.length).toBe(0);
  });
});
