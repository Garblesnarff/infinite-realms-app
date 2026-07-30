/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAvailableSpells } from '../useAvailableSpells';

import { spellApi } from '@/services/spellApi';

// Mock dependencies
vi.mock('@/services/spellApi', () => ({
  spellApi: {
    getClassSpells: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockCantrips = [
  {
    id: 'fire-bolt',
    name: 'Fire Bolt',
    level: 0,
    school: 'Evocation',
    description: 'A mote of fire.',
    components_verbal: true,
    components_somatic: true,
    components_material: false,
    concentration: false,
    ritual: false,
    damage: true,
  },
  {
    id: 'guidance',
    name: 'Guidance',
    level: 0,
    school: 'Divination',
    description: 'You touch one willing creature.',
    components_verbal: true,
    components_somatic: false,
    components_material: false,
    concentration: true,
    ritual: false,
    damage: false,
  },
];

const mockSpells = [
  {
    id: 'magic-missile',
    name: 'Magic Missile',
    level: 1,
    school: 'Evocation',
    description: 'Three glowing darts of magical force.',
    components_verbal: true,
    components_somatic: true,
    components_material: false,
    concentration: false,
    ritual: false,
    damage: true,
  },
  {
    id: 'detect-magic',
    name: 'Detect Magic',
    level: 1,
    school: 'Divination',
    description: 'For the duration, you sense the presence of magic.',
    components_verbal: true,
    components_somatic: false,
    components_material: true,
    concentration: true,
    ritual: true,
    damage: false,
  },
  {
    id: 'shield',
    name: 'Shield',
    level: 1,
    school: 'Abjuration',
    description: 'An invisible barrier of magical force appears.',
    components_verbal: false,
    components_somatic: true,
    components_material: false,
    concentration: false,
    ritual: false,
    damage: false,
  },
];

describe('useAvailableSpells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (spellApi.getClassSpells as any).mockResolvedValue({
      cantrips: mockCantrips,
      spells: mockSpells,
    });
  });

  it('should not fetch spells if isSpellcaster is false', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: false, className: 'Fighter', level: 1 }),
    );

    expect(result.current.isLoadingSpells).toBe(false);
    expect(spellApi.getClassSpells).not.toHaveBeenCalled();
    expect(result.current.availableCantrips).toEqual([]);
    expect(result.current.availableSpells).toEqual([]);
  });

  it('should not fetch spells if className is missing', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: undefined, level: 1 }),
    );

    expect(result.current.isLoadingSpells).toBe(false);
    expect(spellApi.getClassSpells).not.toHaveBeenCalled();
  });

  it('should fetch spells successfully', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    expect(result.current.isLoadingSpells).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    expect(spellApi.getClassSpells).toHaveBeenCalledWith('Wizard', 1);

    // Verify that spells are processed with search strings
    expect(result.current.availableCantrips[0]).toMatchObject(mockCantrips[0]);
    expect(result.current.availableCantrips[0]).toHaveProperty('_searchString');
    expect(result.current.availableSpells[0]).toMatchObject(mockSpells[0]);
    expect(result.current.availableSpells[0]).toHaveProperty('_searchString');

    expect(result.current.spellsError).toBeNull();
  });

  it('should handle fetch errors', async () => {
    (spellApi.getClassSpells as any).mockRejectedValue(new Error('API Error'));

    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    expect(result.current.spellsError).toBe('API Error');
    expect(result.current.availableCantrips).toEqual([]);
    expect(result.current.availableSpells).toEqual([]);
  });

  it('should handle fetch errors with non-Error objects', async () => {
    (spellApi.getClassSpells as any).mockRejectedValue('String Error');

    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    expect(result.current.spellsError).toBe('Failed to load spells');
  });

  it('should filter spells by search term (name and description)', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setSearchTerm('Magic');
    });

    // Matches 'Magic Missile' (name), 'Detect Magic' (name), and 'Shield' (description contains 'magical')
    expect(result.current.filteredSpells).toHaveLength(3);
    expect(result.current.filteredSpells.map((s) => s.name)).toContain('Magic Missile');
    expect(result.current.filteredSpells.map((s) => s.name)).toContain('Detect Magic');
    expect(result.current.filteredSpells.map((s) => s.name)).toContain('Shield');
    expect(result.current.filteredCantrips).toHaveLength(0);
  });

  it('should filter spells by search term (description)', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setSearchTerm('barrier');
    });

    expect(result.current.filteredSpells).toHaveLength(1);
    expect(result.current.filteredSpells[0].name).toBe('Shield');
  });

  it('should filter spells by school', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        schools: ['Evocation'],
      });
    });

    expect(result.current.filteredCantrips).toHaveLength(1);
    expect(result.current.filteredCantrips[0].name).toBe('Fire Bolt');
    expect(result.current.filteredSpells).toHaveLength(1);
    expect(result.current.filteredSpells[0].name).toBe('Magic Missile');
  });

  it('should filter spells by components', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    // Test verbal filter
    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        components: { verbal: true, somatic: false, material: false },
      });
    });
    expect(result.current.filteredCantrips).toHaveLength(2); // Fire Bolt, Guidance
    expect(result.current.filteredSpells).toHaveLength(2); // Magic Missile, Detect Magic (Shield is missing verbal)

    // Test somatic filter
    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        components: { verbal: false, somatic: true, material: false },
      });
    });
    expect(result.current.filteredCantrips).toHaveLength(1); // Fire Bolt (Guidance is missing somatic)
    expect(result.current.filteredSpells).toHaveLength(2); // Magic Missile, Shield (Detect Magic is missing somatic)

    // Test material filter
    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        components: { verbal: false, somatic: false, material: true },
      });
    });
    expect(result.current.filteredCantrips).toHaveLength(0);
    expect(result.current.filteredSpells).toHaveLength(1); // Detect Magic

    // Test combined components
    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        components: { verbal: true, somatic: true, material: false },
      });
    });
    expect(result.current.filteredCantrips).toHaveLength(1); // Fire Bolt
    expect(result.current.filteredSpells).toHaveLength(1); // Magic Missile
  });

  it('should filter spells by search term matching school', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setSearchTerm('Divination');
    });

    expect(result.current.filteredCantrips).toHaveLength(1);
    expect(result.current.filteredCantrips[0].name).toBe('Guidance');
    expect(result.current.filteredSpells).toHaveLength(1);
    expect(result.current.filteredSpells[0].name).toBe('Detect Magic');
  });

  it('should handle search term with no matches', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setSearchTerm('NonExistentSpell');
    });

    expect(result.current.filteredCantrips).toHaveLength(0);
    expect(result.current.filteredSpells).toHaveLength(0);
  });

  it('should filter spells by properties (concentration)', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        properties: { concentration: true, ritual: false, damage: false },
      });
    });

    expect(result.current.filteredCantrips).toHaveLength(1);
    expect(result.current.filteredCantrips[0].name).toBe('Guidance');
    expect(result.current.filteredSpells).toHaveLength(1);
    expect(result.current.filteredSpells[0].name).toBe('Detect Magic');
  });

  it('should filter spells by properties (ritual)', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        properties: { concentration: false, ritual: true, damage: false },
      });
    });

    expect(result.current.filteredCantrips).toHaveLength(0);
    expect(result.current.filteredSpells).toHaveLength(1);
    expect(result.current.filteredSpells[0].name).toBe('Detect Magic');
  });

  it('should filter spells by properties (damage)', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setFilters({
        ...result.current.filters,
        properties: { concentration: false, ritual: false, damage: true },
      });
    });

    expect(result.current.filteredCantrips).toHaveLength(1);
    expect(result.current.filteredCantrips[0].name).toBe('Fire Bolt');
    expect(result.current.filteredSpells).toHaveLength(1);
    expect(result.current.filteredSpells[0].name).toBe('Magic Missile');
  });

  it('should combine multiple filters', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    act(() => {
      result.current.setSearchTerm('Magic');
      result.current.setFilters({
        ...result.current.filters,
        properties: { concentration: true, ritual: false, damage: false },
      });
    });

    expect(result.current.filteredSpells).toHaveLength(1);
    expect(result.current.filteredSpells[0].name).toBe('Detect Magic');
  });

  it('should allow refetching spells', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
    );

    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));
    expect(spellApi.getClassSpells).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetchSpells();
    });

    expect(spellApi.getClassSpells).toHaveBeenCalledTimes(2);
  });

  describe('Return Reference Stability', () => {
    it('should maintain stable return object reference across renders when dependencies do not change', async () => {
      const { result, rerender } = renderHook(() =>
        useAvailableSpells({ isSpellcaster: true, className: 'Wizard', level: 1 }),
      );

      await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

      const firstReturn = result.current;
      rerender();
      const secondReturn = result.current;

      expect(firstReturn).toBe(secondReturn);
    });
  });
});
