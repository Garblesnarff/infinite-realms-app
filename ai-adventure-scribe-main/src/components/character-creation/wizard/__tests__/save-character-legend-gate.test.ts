import { describe, expect, it, vi } from 'vitest';

import { saveCharacterAndNavigate } from '../save-character-and-navigate';

import type { Character } from '@/types/character';

const character = { name: 'Ada' } as Character;

describe('wizard save on a Legend refusal (#1344)', () => {
  it('hands a LEGEND_REQUIRED refusal to the gate instead of a save error', async () => {
    const refusal = Object.assign(new Error('Creating your own hero is a Legend feature (403)'), {
      payload: { code: 'LEGEND_REQUIRED' },
    });
    const onLegendRequired = vi.fn();
    const toast = vi.fn();
    await saveCharacterAndNavigate({
      character,
      saveCharacter: vi.fn().mockRejectedValue(refusal),
      navigate: vi.fn(),
      searchParams: new URLSearchParams(),
      toast,
      onLegendRequired,
    });
    expect(onLegendRequired).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps the save-error toast for other failures', async () => {
    const onLegendRequired = vi.fn();
    const toast = vi.fn();
    await saveCharacterAndNavigate({
      character,
      saveCharacter: vi.fn().mockRejectedValue(new Error('network down')),
      navigate: vi.fn(),
      searchParams: new URLSearchParams(),
      toast,
      onLegendRequired,
    });
    expect(onLegendRequired).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save Error' }));
  });
});
