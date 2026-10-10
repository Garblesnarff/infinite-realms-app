/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #203: racial ability bonuses must survive save. Stored scores are final (base + racial,
 * once), and reads, sheet edits and level-up must not add or drop the bonus again.
 *
 * Drives the real useCharacterSave hook with the userDataApi boundary mocked, then rebuilds
 * the character from the stored stats the way a reload does.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCharacterSave } from '../use-character-save';
import { useCharacterStats, useEffectiveAbilityScores } from '../use-character-stats';

import type { AbilityScores, Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { dwarf } from '@/data/races/dwarf';
import { useToast } from '@/hooks/use-toast';
import { characterBackgroundGenerator } from '@/services/character-background-generator';
import { userDataApi } from '@/services/user-data-api';
import { convertSpellIdsToDatabase } from '@/utils/spell-id-mapping';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: vi.fn() }));
vi.mock('@/services/character-background-generator', () => ({
  characterBackgroundGenerator: { generateCharacterBackground: vi.fn() },
}));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: { saveCharacterSpells: vi.fn() },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    updateCharacterStats: vi.fn(),
  },
}));
vi.mock('@/utils/spell-id-mapping', () => ({
  convertSpellIdsToDatabase: vi.fn(() => []),
}));

type Scores = Record<keyof AbilityScores, number>;

// Standard-array wizard entry. Hill Dwarf adds CON +2 (race) and WIS +1 (subrace).
const BASE_SCORES: Scores = {
  strength: 15,
  dexterity: 14,
  constitution: 13,
  intelligence: 12,
  wisdom: 10,
  charisma: 8,
};

const toAbilityScores = (scores: Scores): AbilityScores =>
  Object.fromEntries(
    Object.entries(scores).map(([ability, score]) => [
      ability,
      { score, modifier: Math.floor((score - 10) / 2), savingThrow: false },
    ]),
  ) as unknown as AbilityScores;

const hillDwarf = dwarf.subraces?.find((s) => s.id === 'hill-dwarf');

const wizardCharacter = (): Character =>
  ({
    name: 'Brenna',
    level: 1,
    experience: 0,
    class: {
      id: 'fighter',
      name: 'Fighter',
      savingThrowProficiencies: ['strength', 'constitution'],
    },
    race: dwarf,
    subrace: hillDwarf,
    abilityScores: toAbilityScores(BASE_SCORES),
    savingThrowProficiencies: ['strength', 'constitution'],
    cantrips: [],
    knownSpells: [],
    preparedSpellIds: [],
    equipment: [],
    inventory: [],
  }) as unknown as Character;

/** Rebuild a character from stored stats, as a reload does: scores are final, read as-is. */
const reloadFromStats = (character: Character, stats: Record<string, number>): Character => {
  const abilityScores = toAbilityScores(
    Object.fromEntries(
      Object.keys(BASE_SCORES).map((ability) => [ability, stats[ability]]),
    ) as Scores,
  );
  return {
    ...character,
    id: 'char-1',
    abilityScores,
    character_stats: [{ ...stats, current_hit_points: stats.max_hit_points }],
  } as unknown as Character;
};

const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('#203 racial ability bonuses survive save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({ toast: vi.fn() } as any);
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } } as any);
    vi.mocked(useCampaign).mockReturnValue({ state: { campaign: null } } as any);
    vi.mocked(userDataApi.createCharacter).mockResolvedValue({ id: 'char-1' } as any);
    vi.mocked(userDataApi.updateCharacter).mockResolvedValue({} as any);
    vi.mocked(userDataApi.updateCharacterStats).mockResolvedValue({} as any);
    vi.mocked(characterBackgroundGenerator.generateCharacterBackground).mockResolvedValue('');
    vi.mocked(convertSpellIdsToDatabase).mockReturnValue([]);
  });

  it('finds the Hill Dwarf subrace used by this test', () => {
    expect(hillDwarf).toBeDefined();
  });

  it('creates with final scores, AC and HP, and reload does not double count', async () => {
    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    await act(async () => {
      await result.current.saveCharacter(wizardCharacter());
    });

    const created = vi.mocked(userDataApi.createCharacter).mock.calls[0][0] as any;
    expect(created.stats).toMatchObject({
      strength: 15,
      dexterity: 14,
      constitution: 15, // 13 + Dwarf +2
      intelligence: 12,
      wisdom: 11, // 10 + Hill Dwarf +1
      charisma: 8,
      armor_class: 12, // 10 + DEX mod (+2)
      max_hit_points: 12, // Fighter d10 + CON mod (+2)
      current_hit_points: 12,
    });

    const reloaded = reloadFromStats(wizardCharacter(), created.stats);

    const { result: effective } = renderHook(() => useEffectiveAbilityScores(reloaded));
    expect(effective.current?.constitution.score).toBe(15);
    expect(effective.current?.wisdom.score).toBe(11);

    const { result: stats } = renderHook(() => useCharacterStats(reloaded));
    expect(stats.current?.armorClass).toBe(12);
    // Strength 15 (+2) and Constitution 15 (+2) are both proficient, so each save is +4.
    expect(stats.current?.savingThrowModifiers.strength).toEqual({ modifier: 4, proficient: true });
    expect(stats.current?.savingThrowModifiers.constitution).toEqual({
      modifier: 4,
      proficient: true,
    });
  });

  it('a sheet edit at level 1 keeps final scores and does not re-add the bonus', async () => {
    const created = vi.mocked(userDataApi.createCharacter);
    const { result } = renderHook(() => useCharacterSave(), { wrapper });
    await act(async () => {
      await result.current.saveCharacter(wizardCharacter());
    });
    const stats = (created.mock.calls[0][0] as any).stats;
    const reloaded = reloadFromStats(wizardCharacter(), stats);

    await act(async () => {
      await result.current.saveCharacter(reloaded);
    });

    const update = vi.mocked(userDataApi.updateCharacterStats).mock.calls[0][1] as any;
    expect(update.constitution).toBe(15);
    expect(update.wisdom).toBe(11);
    expect(update.armor_class).toBe(12);
    expect(update.max_hit_points).toBe(12);
  });

  it('a level-up save keeps final scores and does not re-add the bonus', async () => {
    const created = vi.mocked(userDataApi.createCharacter);
    const { result } = renderHook(() => useCharacterSave(), { wrapper });
    await act(async () => {
      await result.current.saveCharacter(wizardCharacter());
    });
    const stats = (created.mock.calls[0][0] as any).stats;
    const levelled = { ...reloadFromStats(wizardCharacter(), stats), level: 2 } as Character;

    await act(async () => {
      await result.current.saveCharacter(levelled);
    });

    const update = vi.mocked(userDataApi.updateCharacterStats).mock.calls[0][1] as any;
    expect(update.constitution).toBe(15);
    expect(update.wisdom).toBe(11);
    // HP belongs to the vitals engine above level 1, so it is not sent.
    expect(update).not.toHaveProperty('max_hit_points');

    const { result: effective } = renderHook(() => useEffectiveAbilityScores(levelled));
    expect(effective.current?.constitution.score).toBe(15);
  });
});
