import { act, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCombatLegalActions } from '../../../hooks/use-combat-legal-actions';
import { RightSheet } from '../overhaul/RightSheet';
import { buildCharacterSheet } from '../overhaul/useOverhaulViewModel';
import { useCharacterRefreshOnCombatUpdate } from '../use-character-refresh';

import type { CharacterAction } from '@/contexts/character/types';
import type { Character } from '@/types/character';

import { loadCharacterWithSpells } from '@/services/load-character-with-spells';

const api = vi.hoisted(() => ({
  remaining: 1,
  chip: 'second_wind' as 'second_wind' | 'action_surge',
  getCharacter: vi.fn(),
  equipment: vi.fn(),
  spells: vi.fn(),
  features: vi.fn(),
  subclass: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({ userDataApi: { getCharacter: api.getCharacter } }));
vi.mock('@/services/issue-1784-api', () => ({
  issue1784Api: { getCharacterEquipment: api.equipment },
}));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: { getCharacterSpells: api.spells },
}));
vi.mock('@/services/class-features-api', () => ({
  getCharacterClassFeatures: api.features,
  getCharacterSubclass: api.subclass,
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'enc-1',
        currentTurnParticipantId: 'pc-1',
        currentRound: 1,
        participants: [{ id: 'pc-1', participantType: 'player' }],
      },
    },
    refreshCombatState: api.refresh,
  }),
  useOptionalCombat: () => ({
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'enc-1',
        currentTurnParticipantId: 'pc-1',
        currentRound: 1,
        participants: [{ id: 'pc-1', participantType: 'player' }],
      },
    },
    refreshCombatState: api.refresh,
  }),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function Harness() {
  const [character, setCharacter] = useState<Character | null>(null);
  const dispatch = useCallback((action: CharacterAction) => {
    if (action.type === 'SET_CHARACTER') setCharacter(action.payload);
  }, []);
  useCharacterRefreshOnCombatUpdate('character-id', 'user-1', dispatch);
  useEffect(() => {
    void loadCharacterWithSpells('character-id').then(setCharacter);
  }, []);
  const combat = useCombatLegalActions({ enabled: true, onSendText: vi.fn() });
  return (
    <>
      {character && <RightSheet c={buildCharacterSheet(character)} />}
      <button onClick={() => void combat.runAction(combat.actions[0])}>Use feature</button>
    </>
  );
}

describe('#1376 in-session feature resource refresh', () => {
  beforeEach(() => {
    api.remaining = 1;
    api.chip = 'second_wind';
    api.getCharacter.mockResolvedValue({
      id: 'character-id',
      user_id: 'user-1',
      name: 'Fighter',
      race: 'Human',
      class: 'Fighter',
      level: 3,
      cantrips: '',
      known_spells: '',
      prepared_spells: '',
      ritual_spells: '',
      character_stats: [
        {
          strength: 10,
          dexterity: 14,
          constitution: 14,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
          max_hit_points: 28,
          current_hit_points: 28,
        },
      ],
    });
    api.equipment.mockResolvedValue([]);
    api.spells.mockResolvedValue({ cantrips: [], spells: [] });
    api.subclass.mockResolvedValue(null);
    api.features.mockImplementation(async () => ({
      features: [
        {
          featureId: 'second-wind-id',
          isActive: true,
          usesRemaining: api.remaining,
          feature: { featureName: 'Second Wind', usesCount: null },
        },
      ],
      usesRemaining: { 'second-wind-id': api.remaining },
    }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/legal-actions'))
        return {
          ok: true,
          json: async () => ({
            actorId: 'pc-1',
            actions: [
              {
                type: api.chip,
                label: api.chip === 'action_surge' ? 'Action Surge' : 'Second Wind',
              },
            ],
          }),
        } as Response;
      if (String(url).includes('/intent')) {
        api.remaining = 0;
        return { ok: true, json: async () => ({ result: {} }) } as Response;
      }
      throw new Error(`Unexpected request ${String(url)}`);
    });
  });
  it('refreshes the displayed pool after an accepted full-HP feature use', async () => {
    render(<Harness />);
    await screen.findAllByText('Second Wind');
    const resource = screen.getByRole('heading', { name: 'Second Wind' }).parentElement!;
    expect(within(resource).getByText('1 / 1')).toBeTruthy();
    await act(async () => {
      screen.getByText('Use feature').click();
    });
    await waitFor(() => expect(within(resource).getByText('0 / 1')).toBeTruthy());
    expect(api.features).toHaveBeenCalledTimes(2);
  });

  it('shows a spent Action Surge as 0/1 on load and after the combat use', async () => {
    api.chip = 'action_surge';
    const rows = (
      names: Array<[string, number]>,
    ): {
      features: Array<{
        featureId: string;
        isActive: boolean;
        usesRemaining: number;
        feature: { featureName: string; usesCount: number; levelAcquired: number };
      }>;
      usesRemaining: Record<string, number>;
    } => ({
      features: names.map(([featureName, usesRemaining]) => ({
        featureId: featureName,
        isActive: true,
        usesRemaining,
        feature: { featureName, usesCount: 1, levelAcquired: 2 },
      })),
      usesRemaining: {},
    });
    api.features.mockImplementation(async () => rows([['Action Surge (1 use)', api.remaining]]));
    const { unmount } = render(<Harness />);
    const shown = async (count: string): Promise<void> => {
      const heading = await screen.findByRole('heading', { name: 'Action Surge' });
      const resource = heading.parentElement?.parentElement;
      if (!resource) throw new Error('Action Surge resource row is missing');
      expect(within(resource).getAllByText(count).length).toBeGreaterThan(0);
    };
    await shown('1 / 1');
    await act(async () => {
      screen.getByText('Use feature').click();
    });
    await waitFor(() => shown('0 / 1'));
    unmount();
    // The unspent suffix row is last. The sheet must keep the name the spend picks.
    api.features.mockImplementation(async () =>
      rows([
        ['Action Surge', 0],
        ['Action Surge (1 use)', 1],
      ]),
    );
    render(<Harness />);
    await shown('0 / 1');
  });
});
