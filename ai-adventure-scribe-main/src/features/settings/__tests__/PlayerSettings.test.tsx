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
    expect(
      screen.getByText('Shows the DC and AC on checks and attacks. Default for this campaign: off (Hard).'),
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem('ui:showTargetNumbers:v1')).toBe('on');
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', {
      rules_config: { levelingMode: 'xp', show_target_numbers: true },
    });
  });

  it('states the rules flag as the default when the campaign sets show_target_numbers', () => {
    campaign.rules = { levelingMode: 'xp', show_target_numbers: true };
    render(<PlayerSettings />);
    expect(
      screen.getByText('Shows the DC and AC on checks and attacks. Default for this campaign: on (Hard).'),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show target numbers' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('defaults the Table look on and saves the off choice', () => {
    render(<PlayerSettings />);
    const toggle = screen.getByRole('switch', { name: 'Table look' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(readStored()).toMatchObject({ tableLook: false });
  });

  it('turns Dice sound off', () => {
    render(<PlayerSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Dice sound' }));
    expect(readStored()).toMatchObject({ diceSound: false });
  });

  it('lets Reduce motion follow the system, then force reduce, then follow again', () => {
    render(<PlayerSettings />);
    const motion = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(motion).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement.dataset.reduceMotion).toBeUndefined();

    fireEvent.click(motion);
    expect(motion).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset.reduceMotion).toBe('on');

    fireEvent.click(motion);
    expect(motion).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement.dataset.reduceMotion).toBeUndefined();
    expect(readStored()).toMatchObject({ reduceMotion: 'system' });
  });

  it('shows Reduce motion off for a stored off choice; toggling on then off writes system', () => {
    window.localStorage.setItem(tableSettingsKey('user-a'), JSON.stringify({ reduceMotion: 'off' }));
    render(<PlayerSettings />);
    const motion = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(motion).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(motion);
    expect(motion).toHaveAttribute('aria-checked', 'true');
    expect(readStored()).toMatchObject({ reduceMotion: 'on' });

    fireEvent.click(motion);
    expect(motion).toHaveAttribute('aria-checked', 'false');
    // The board's binary switch cannot represent 'off': once the player flips
    // it, the stored choice becomes 'system'. Disclosed in the PR, not silent.
    expect(readStored()).toMatchObject({ reduceMotion: 'system' });
  });

  it('starts Read new DM messages aloud off and turns it on', () => {
    render(<PlayerSettings />);
    const autoPlay = screen.getByRole('switch', { name: 'Read new DM messages aloud' });
    expect(autoPlay).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(autoPlay);
    expect(autoPlay).toHaveAttribute('aria-checked', 'true');
    expect(readStored()).toMatchObject({ narrationAutoPlay: true });
  });

  it('saves Volume for the narration player and shows the percent', () => {
    render(<PlayerSettings />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '40' } });
    expect(readStored()).toMatchObject({ narrationVolume: 0.4 });
    expect(window.localStorage.getItem(VOICE_VOLUME_KEY)).toBe('0.4');
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('saves Speed for the narration player', () => {
    render(<PlayerSettings />);
    fireEvent.click(screen.getByRole('radio', { name: '1.5×' }));
    expect(readStored()).toMatchObject({ narrationSpeed: 1.5 });
    expect(window.localStorage.getItem(VOICE_RATE_KEY)).toBe('1.5');
  });

  it('shows all four speeds as radio buttons with 1x selected', () => {
    render(<PlayerSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Speed' });
    expect(group).toBeInTheDocument();
    for (const label of ['0.75×', '1×', '1.25×', '1.5×']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: '1×' })).toHaveAttribute('aria-checked', 'true');
  });

  it('starts Show NPC Rolls on by default and turns it off', () => {
    render(<PlayerSettings />);
    const toggle = screen.getByRole('switch', { name: 'Show NPC Rolls' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(readStored()).toMatchObject({ showNPCRolls: false });
  });

  it('starts Table look on by default and turns it off', () => {
    render(<PlayerSettings />);
    const toggle = screen.getByRole('switch', { name: 'Table look' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(readStored()).toMatchObject({ tableLook: false });
  });

  it('saves Level Advancement to the open campaign', () => {
    render(<PlayerSettings />);
    fireEvent.change(screen.getByLabelText('Level Advancement'), {
      target: { value: 'milestone' },
    });
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', {
      rules_config: { levelingMode: 'milestone' },
    });
  });

  it('shows every setting on one page', () => {
    render(<PlayerSettings />);
    for (const name of [
      'Show target numbers',
      'Show NPC Rolls',
      'Table look',
      'Dice sound',
      'Reduce motion',
      'Read new DM messages aloud',
    ]) {
      expect(screen.getByRole('switch', { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Volume')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Speed' })).toBeInTheDocument();
    expect(screen.getByLabelText('Level Advancement')).toBeInTheDocument();
  });

  it('keeps each control after the settings are mounted again', () => {
    const first = render(<PlayerSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Show target numbers' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Dice sound' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Read new DM messages aloud' }));
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('radio', { name: '0.75×' }));
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
    expect(screen.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Read new DM messages aloud' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Show NPC Rolls' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByLabelText('Volume')).toHaveValue('40');
    expect(screen.getByRole('radio', { name: '0.75×' })).toHaveAttribute('aria-checked', 'true');
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
