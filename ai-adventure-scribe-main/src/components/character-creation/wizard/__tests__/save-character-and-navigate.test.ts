import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Character } from '@/types/character';
import type { NavigateFunction } from 'react-router-dom';

import { saveCharacterAndNavigate } from '@/components/character-creation/wizard/save-character-and-navigate';
import {
  WIZARD_DRAFT_VERSION,
  clearWizardDraft,
  getWizardDraftKey,
  readWizardDraft,
  writeWizardDraft,
} from '@/components/character-creation/wizard/wizard-draft';

vi.mock('@/services/analytics', () => ({
  analytics: {
    detectArtStyle: () => 'test-style',
    characterCreationCompleted: vi.fn(),
  },
}));

const character = { name: 'Saved Hero', id: 'char-1' } as Character;

function makeDeps(overrides: Record<string, unknown> = {}): {
  character: Character;
  saveCharacter: ReturnType<typeof vi.fn>;
  navigate: NavigateFunction;
  searchParams: URLSearchParams;
  toast: ReturnType<typeof vi.fn>;
  onSaved: ReturnType<typeof vi.fn>;
} {
  return {
    character,
    saveCharacter: vi.fn(async () => ({ ...character })),
    navigate: vi.fn() as unknown as NavigateFunction,
    searchParams: new URLSearchParams(),
    toast: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
}

describe('saveCharacterAndNavigate (#208 clear-on-complete)', () => {
  const DRAFT_KEY = getWizardDraftKey('user-1');

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  function seedDraft(): void {
    writeWizardDraft(DRAFT_KEY, {
      version: WIZARD_DRAFT_VERSION,
      character,
      step: 3,
      campaignId: null,
      updatedAt: new Date().toISOString(),
    });
    expect(readWizardDraft(DRAFT_KEY)).not.toBeNull();
  }

  it('clears the seeded draft on complete through the real onSaved wiring', async () => {
    // WizardContent wires onSaved: () => clearDraft(), and clearDraft calls the
    // real clearWizardDraft(key). This proves the draft is actually gone after
    // a successful save — not just that onSaved was invoked.
    seedDraft();
    const deps = makeDeps({ onSaved: () => clearWizardDraft(DRAFT_KEY) });
    await saveCharacterAndNavigate(deps);

    expect(deps.navigate).toHaveBeenCalledWith('/app/characters');
    expect(readWizardDraft(DRAFT_KEY)).toBeNull();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('leaves the draft in place when the save fails', async () => {
    seedDraft();
    const onSaved = vi.fn();
    const deps = makeDeps({
      onSaved,
      saveCharacter: vi.fn(async () => null),
    });
    await saveCharacterAndNavigate(deps);

    expect(onSaved).not.toHaveBeenCalled();
    expect(readWizardDraft(DRAFT_KEY)).not.toBeNull();
  });
  it('calls onSaved and navigates when the save succeeds with an id', async () => {
    const deps = makeDeps();
    await saveCharacterAndNavigate(deps);

    expect(deps.onSaved).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith('/app/characters');
    expect(deps.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Success!' }),
    );
  });

  it('does not call onSaved when the save returns null', async () => {
    const deps = makeDeps({ saveCharacter: vi.fn(async () => null) });
    await saveCharacterAndNavigate(deps);

    expect(deps.onSaved).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('does not call onSaved when the saved character has no id', async () => {
    const deps = makeDeps({ saveCharacter: vi.fn(async () => ({ name: 'No Id' })) });
    await saveCharacterAndNavigate(deps);

    expect(deps.onSaved).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('does not call onSaved when the save throws', async () => {
    const deps = makeDeps({
      saveCharacter: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    await saveCharacterAndNavigate(deps);

    expect(deps.onSaved).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Save Error' }),
    );
  });
});
