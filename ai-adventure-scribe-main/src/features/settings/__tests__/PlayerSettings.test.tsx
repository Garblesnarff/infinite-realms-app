import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GameSettingsButton } from '@/features/game-session/components/game/game-content/GameSettingsButton';
import { TargetNumbersToggle } from '@/features/game-session/components/game/game-content/TargetNumbersToggle';
import { PlayerSettings } from '@/features/settings/PlayerSettings';
import { tableSettingsKey } from '@/features/settings/table-settings';
import { VOICE_RATE_KEY, VOICE_VOLUME_KEY } from '@/features/settings/voice-preferences';

const mockUser = { id: 'user-a' as string | null };
const campaign = vi.hoisted(() => ({
  id: 'camp-1' as string | undefined,
  difficulty: 'hard' as string | undefined,
  rules: { levelingMode: 'xp' } as Record<string, unknown>,
}));
const updateCampaign = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.id ? { id: mockUser.id } : null }),
  useOptionalAuth: () => ({ user: mockUser.id ? { id: mockUser.id } : null }),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useOptionalCampaign: () => ({
    state: {
      campaign: {
        id: campaign.id,
        difficulty_level: campaign.difficulty,
        rules_config: campaign.rules,
      },
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { updateCampaign },
}));

const readStored = (): Record<string, unknown> => {
  const raw = window.localStorage.getItem(tableSettingsKey('user-a'));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
};

describe('PlayerSettings (#1347)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.reduceMotion;
    mockUser.id = 'user-a';
    campaign.id = 'camp-1';
    campaign.difficulty = 'hard';
    campaign.rules = { levelingMode: 'xp' };
    updateCampaign.mockClear();
  });

  it('turns Show target numbers on and stores that choice on the campaign', () => {
    render(<PlayerSettings />);
    const toggle = screen.getByRole('switch', { name: 'Show target numbers' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem('ui:showTargetNumbers:v1')).toBe('on');
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', {
      rules_config: { levelingMode: 'xp', show_target_numbers: true },
    });
  });

  it('turns Dice sound off', () => {
    render(<PlayerSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Dice sound' }));
    expect(readStored()).toMatchObject({ diceSound: false });
  });

  it('lets Reduce motion follow the system, then force reduce, then allow', () => {
    render(<PlayerSettings />);
    const motion = screen.getByLabelText('Reduce motion');
    expect(motion).toHaveValue('system');
    expect(document.documentElement.dataset.reduceMotion).toBeUndefined();

    fireEvent.change(motion, { target: { value: 'on' } });
    expect(document.documentElement.dataset.reduceMotion).toBe('on');

    fireEvent.change(motion, { target: { value: 'off' } });
    expect(document.documentElement.dataset.reduceMotion).toBe('off');
    expect(readStored()).toMatchObject({ reduceMotion: 'off' });
  });

  it('starts Auto-play off and turns it on', () => {
    render(<PlayerSettings />);
    const autoPlay = screen.getByRole('switch', { name: 'Auto-play' });
    expect(autoPlay).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(autoPlay);
    expect(autoPlay).toHaveAttribute('aria-checked', 'true');
    expect(readStored()).toMatchObject({ narrationAutoPlay: true });
  });

  it('saves Volume for the narration player', () => {
    render(<PlayerSettings />);
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '40' } });
    expect(readStored()).toMatchObject({ narrationVolume: 0.4 });
    expect(window.localStorage.getItem(VOICE_VOLUME_KEY)).toBe('0.4');
  });

  it('saves Speed for the narration player', () => {
    render(<PlayerSettings />);
    fireEvent.change(screen.getByLabelText('Speed'), { target: { value: '1.5' } });
    expect(readStored()).toMatchObject({ narrationSpeed: 1.5 });
    expect(window.localStorage.getItem(VOICE_RATE_KEY)).toBe('1.5');
  });

  it('starts Show NPC Rolls on by default and turns it off', () => {
    render(<PlayerSettings />);
    const toggle = screen.getByRole('switch', { name: 'Show NPC Rolls' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(readStored()).toMatchObject({ showNPCRolls: false });
  });

  it('keeps each control after the settings are mounted again', () => {
    const first = render(<PlayerSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Show target numbers' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Dice sound' }));
    fireEvent.change(screen.getByLabelText('Reduce motion'), { target: { value: 'on' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-play' }));
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Speed'), { target: { value: '0.75' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Show NPC Rolls' }));
    first.unmount();

    render(<PlayerSettings />);
    expect(screen.getByRole('switch', { name: 'Show target numbers' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Dice sound' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByLabelText('Reduce motion')).toHaveValue('on');
    expect(screen.getByRole('switch', { name: 'Auto-play' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Show NPC Rolls' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByLabelText('Volume')).toHaveValue('40');
    expect(screen.getByLabelText('Speed')).toHaveValue('0.75');
  });

  it('uses the same Show target numbers choice as the in-game header button', () => {
    render(
      <>
        <TargetNumbersToggle />
        <PlayerSettings />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show target numbers: Off' }));
    expect(screen.getByRole('switch', { name: 'Show target numbers' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Show target numbers: On' })).toBeInTheDocument();
  });

  it('opens the shared settings from the gear button', async () => {
    render(<GameSettingsButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('switch', { name: 'Dice sound' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Narration' })).toBeInTheDocument();
  });
});
