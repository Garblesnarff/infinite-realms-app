import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAvailableSpells } from '../useAvailableSpells';

import { convertApiSpellToSpell, spellApi } from '@/services/spellApi';

vi.mock('@/lib/auth-gate', () => ({
  waitForAuth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// API-shaped (server wire format) spell data: camelCase names, as returned
// by server-bun spellData.ts and consumed by convertApiSpellToSpell.
const apiFireball = {
  id: 'fireball-415',
  name: 'Fireball 415',
  level: 3,
  school: 'Evocation',
  castingTime: '1 action',
  range: '150 feet',
  duration: 'Instantaneous',
  description: 'A bright streak flashes from your pointing finger.',
  verbal: true,
  somatic: true,
  material: true,
  materialComponents: 'a tiny ball of bat guano and sulfur',
  concentration: false,
  ritual: false,
  damage: true,
  damageEffect: '8d6',
};

const apiShield = {
  id: 'shield-415',
  name: 'Shield 415',
  level: 1,
  school: 'Abjuration',
  castingTime: '1 reaction',
  range: 'Self',
  duration: '1 round',
  description: 'An invisible barrier of magical force appears.',
  verbal: false,
  somatic: true,
  material: false,
  concentration: false,
  ritual: false,
  damage: false,
};

describe('issue #415: converter and hook share one Spell naming', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (spellApi as unknown as { useLocalFallback: boolean }).useLocalFallback = false;
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('convertApiSpellToSpell emits the Spell snake_case names', () => {
    const converted = convertApiSpellToSpell(apiFireball);

    expect(converted.casting_time).toBe('1 action');
    expect(converted.range_text).toBe('150 feet');
    expect(converted.components_verbal).toBe(true);
    expect(converted.components_somatic).toBe(true);
    expect(converted.components_material).toBe(true);
    expect(converted.material_components).toBe('a tiny ball of bat guano and sulfur');
    expect(converted).not.toHaveProperty('castingTime');
    expect(converted).not.toHaveProperty('verbal');
  });

  it('useAvailableSpells filtering by casting time and verbal returns the converted spell (network mocked only)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [apiFireball, apiShield],
    });

    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // The real converter ran inside the real service: the hook's spells
    // carry the Spell type's snake_case names.
    expect(result.current.availableSpells).toHaveLength(2);
    const fireball = result.current.availableSpells.find((s) => s.id === 'fireball-415');
    expect(fireball?.casting_time).toBe('1 action');
    expect(fireball?.components_verbal).toBe(true);

    // Filter by the verbal component: only the verbal spell survives, and
    // it is the '1 action' spell.
    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        components: { verbal: true, somatic: false, material: false },
      });
    });

    expect(result.current.filteredSpells).toHaveLength(1);
    expect(result.current.filteredSpells[0].id).toBe('fireball-415');
    expect(result.current.filteredSpells[0].casting_time).toBe('1 action');
    expect(result.current.filteredSpells[0].components_verbal).toBe(true);
  });
});
