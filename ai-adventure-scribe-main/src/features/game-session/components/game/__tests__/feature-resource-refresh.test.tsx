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
      <button onClick={() => void combat.runAction(combat.actions[0])}>Use Second Wind</button>
    </>
  );
}

describe('#1376 in-session feature resource refresh', () => {
  beforeEach(() => {
    api.remaining = 1;
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
            actions: [{ type: 'second_wind', label: 'Second Wind' }],
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
      screen.getByText('Use Second Wind').click();
    });
    await waitFor(() => expect(within(resource).getByText('0 / 1')).toBeTruthy());
    expect(api.features).toHaveBeenCalledTimes(2);
  });
});
