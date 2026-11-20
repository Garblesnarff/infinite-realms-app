/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WizardContent from '../WizardContent';

import type { Character } from '@/types/character';

import { initialState, characterReducer } from '@/contexts/character/character-reducer';

const harness = vi.hoisted(() => ({
  current: null as { state: any; dispatch: React.Dispatch<any> } | null,
  navigate: null as null | ((path: string) => void),
  search: '',
  toast: vi.fn(),
  saveCharacter: vi.fn(async (character: Character) => ({ ...character, id: 'char-213' })),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => harness.current,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-213' } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/hooks/use-character-save', () => ({
  useCharacterSave: () => ({ saveCharacter: harness.saveCharacter, isSaving: false }),
}));
vi.mock('@/hooks/use-auto-scroll', () => ({
  useAutoScroll: () => ({
    scrollToTop: () => {},
    scrollToNavigation: () => {},
    scrollToBottom: () => {},
    scrollToElement: () => {},
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/character-background-generator', () => ({
  characterBackgroundGenerator: { generateCharacterBackground: vi.fn(async () => '') },
}));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: { saveCharacterSpells: vi.fn(async () => undefined) },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    updateCharacterStats: vi.fn(),
    listCharacters: vi.fn(async () => [
      {
        id: 'char-existing',
        name: 'Thorin',
        user_id: 'user-213',
        campaign_id: null,
        level: 1,
        race: null,
        class: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]),
  },
}));
vi.mock('@/utils/spell-id-mapping', () => ({
  convertSpellIdsToDatabase: vi.fn(() => []),
}));
vi.mock('@/infrastructure/api', async (importOriginal) => {
  const original = (await importOriginal()) as {
    llmApiClient: Record<string, unknown>;
    [key: string]: unknown;
  };
  return {
    ...original,
    llmApiClient: { ...original.llmApiClient, getImageQuotaStatus: async () => null },
  };
});

function NavProbe(): null {
  harness.navigate = useNavigate();
  harness.search = useLocation().search;
  return null;
}

function StateHarness(): React.JSX.Element {
  const [state, dispatch] = React.useReducer(characterReducer, initialState);
  harness.current = { state, dispatch: dispatch as React.Dispatch<any> };
  return (
    <>
      <NavProbe />
      <WizardContent />
    </>
  );
}

function renderWizard(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/app/characters/new?step=0']}>
        <StateHarness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('#213 duplicate name through the real wizard', () => {
  beforeEach(() => {
    harness.toast.mockClear();
    harness.current = null;
    harness.navigate = null;
  });

  it('warns but does not block Continue', async () => {
    renderWizard();

    const input = await screen.findByLabelText(/Name/);
    fireEvent.change(input, { target: { value: 'THORIN' } });

    expect(await screen.findByText('You already have a hero named THORIN.')).toBeTruthy();

    const btn = screen.getByRole('button', { name: 'Continue' });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);

    await waitFor(() => {
      expect(new URLSearchParams(harness.search).get('step')).toBe('1');
    });

    const destructive = harness.toast.mock.calls.filter(([arg]) => arg?.variant === 'destructive');
    expect(destructive).toEqual([]);
  });
});
