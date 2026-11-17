import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { getCharacter: vi.fn(), updateCharacter: vi.fn() },
}));

vi.mock('@/services/issue-1784-api', () => ({
  issue1784Api: { getCharacterEquipment: vi.fn() },
}));

vi.mock('@/services/class-features-api', () => ({
  getCharacterClassFeatures: vi.fn(async () => ({ features: [] })),
  getCharacterSubclass: vi.fn(async () => 'Oath of Devotion'),
}));

const { stableAuth } = vi.hoisted(() => ({ stableAuth: { user: { id: 'user-123' } } }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => stableAuth,
}));

const { mockToast, mockNavigate } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/utils/validation', () => ({
  isValidUUID: vi.fn(() => true),
}));

vi.mock('@/lib/logger', () => {
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { logger, default: logger };
});

vi.mock('../lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useCharacterData } from '../use-character-data';

import { issue1784Api } from '@/services/issue-1784-api';
import { userDataApi } from '@/services/user-data-api';
import { getAlwaysPreparedSpells } from '@/utils/character/subclass-grants';

const characterId = '550e8400-e29b-41d4-a716-446655440000';

describe('useCharacterData granted subclass (#1593)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(issue1784Api.getCharacterEquipment).mockResolvedValue([]);
    vi.mocked(userDataApi.getCharacter).mockResolvedValue({
      id: characterId,
      user_id: 'user-123',
      name: 'Sir Oath',
      race: 'Human',
      class: 'Paladin',
      level: 3,
      character_stats: {
        strength: 16,
        dexterity: 10,
        constitution: 14,
        intelligence: 8,
        wisdom: 12,
        charisma: 14,
      },
    });
  });

  it('sets subclassName from the granted class identity so the oath spells are always prepared', async () => {
    const { result } = renderHook(() => useCharacterData(characterId));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.character?.subclassName).toBe('Oath of Devotion');
    expect(getAlwaysPreparedSpells(result.current.character)).toEqual(
      expect.arrayContaining(['Protection from Evil and Good', 'Sanctuary']),
    );
  });
});
