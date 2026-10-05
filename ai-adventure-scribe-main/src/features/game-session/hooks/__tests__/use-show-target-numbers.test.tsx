import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { showTargetNumbersByDefault } from '../../../../../shared/show-target-numbers';
import { useShowTargetNumbers } from '../use-show-target-numbers';

const campaign = vi.hoisted(() => ({ difficulty: undefined as string | undefined }));

vi.mock('@/contexts/CampaignContext', () => ({
  useOptionalCampaign: () => ({ state: { campaign: { difficulty_level: campaign.difficulty } } }),
}));

describe('Show target numbers (#2417)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    campaign.difficulty = undefined;
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
});
