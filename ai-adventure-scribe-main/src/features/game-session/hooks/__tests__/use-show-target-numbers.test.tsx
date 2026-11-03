import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { showTargetNumbersByDefault } from '../../../../../shared/show-target-numbers';
import { useShowTargetNumbers } from '../use-show-target-numbers';

const campaign = vi.hoisted(() => ({
  difficulty: undefined as string | undefined,
  id: undefined as string | undefined,
  rules: undefined as Record<string, unknown> | undefined,
}));
const updateCampaign = vi.hoisted(() => vi.fn(async () => ({})));

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

describe('Show target numbers (#2417)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    campaign.difficulty = undefined;
    campaign.id = undefined;
    campaign.rules = undefined;
    updateCampaign.mockClear();
  });

  it.each([
    ['easy', true],
    ['medium', true],
    ['Medium', true],
    ['hard', false],
    ['Hard', false],
    ['deadly', false],
    ['Deadly', false],
    ['medium-hard', true],
    ['Medium Challenge', true],
    ['easy', true],
    [undefined, true],
  ])('starts %s as %s', (difficulty, expected) => {
    campaign.difficulty = difficulty;

    expect(showTargetNumbersByDefault(difficulty)).toBe(expected);
    expect(renderHook(() => useShowTargetNumbers()).result.current.showTargetNumbers).toBe(
      expected,
    );
  });

  it('lets the player override the difficulty, and keeps the choice', () => {
    campaign.difficulty = 'hard';
    const first = renderHook(() => useShowTargetNumbers());
    expect(first.result.current.showTargetNumbers).toBe(false);

    act(() => first.result.current.setShowTargetNumbers(true));
    expect(first.result.current.showTargetNumbers).toBe(true);
    first.unmount();

    const second = renderHook(() => useShowTargetNumbers());
    expect(second.result.current.showTargetNumbers).toBe(true);
    act(() => second.result.current.setShowTargetNumbers(false));
    campaign.difficulty = 'easy';
    expect(renderHook(() => useShowTargetNumbers()).result.current.showTargetNumbers).toBe(false);
  });

  it('updates every reader at once', () => {
    const reader = renderHook(() => useShowTargetNumbers());
    const toggle = renderHook(() => useShowTargetNumbers());

    act(() => toggle.result.current.setShowTargetNumbers(false));

    expect(reader.result.current.showTargetNumbers).toBe(false);
  });

  it('uses the campaign rule when the player has not chosen', () => {
    campaign.difficulty = 'hard';
    campaign.rules = { show_target_numbers: true };
    expect(renderHook(() => useShowTargetNumbers()).result.current.showTargetNumbers).toBe(true);
  });

  it('writes the player choice onto the open campaign rules', () => {
    campaign.id = 'camp-1';
    campaign.rules = { levelingMode: 'xp' };
    const hook = renderHook(() => useShowTargetNumbers());
    act(() => hook.result.current.setShowTargetNumbers(false));
    expect(window.localStorage.getItem('ui:showTargetNumbers:v1')).toBe('off');
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', {
      rules_config: { levelingMode: 'xp', show_target_numbers: false },
    });
  });
});
