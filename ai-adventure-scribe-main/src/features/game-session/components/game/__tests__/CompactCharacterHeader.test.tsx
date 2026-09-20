/* eslint-disable @typescript-eslint/no-explicit-any */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CompactCharacterHeader } from '../CompactCharacterHeader';

import { useCharacter } from '@/contexts/CharacterContext';
import { supabase } from '@/integrations/supabase/client';
import { userDataApi } from '@/services/user-data-api';

// Mock dependencies
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCharacterCombatStatus: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('CompactCharacterHeader', () => {
  const mockOn = vi.fn().mockReturnThis();
  const mockSubscribe = vi.fn().mockReturnValue({ unsubscribe: vi.fn() });

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for supabase.from
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    // Default mock for supabase.channel
    (supabase.channel as any).mockReturnValue({
      on: mockOn,
      subscribe: mockSubscribe,
    });
  });

  it('renders "No character loaded" when state has no character', () => {
    (useCharacter as any).mockReturnValue({
      state: { character: null },
    });

    render(<CompactCharacterHeader />);
    expect(screen.getByText('No character loaded')).toBeInTheDocument();
  });

  it('renders character basic info correctly', async () => {
    const mockCharacter = {
      id: 'char-123',
      name: 'Grog',
      level: 5,
      race: { name: 'Goliath' },
      class: { name: 'Barbarian', hitDie: 12 },
      abilityScores: {
        strength: { score: 18, modifier: 4 },
        dexterity: { score: 14, modifier: 2 },
        constitution: { score: 16, modifier: 3 },
        intelligence: { score: 8, modifier: -1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 12, modifier: 1 },
      },
      character_stats: {
        current_hit_points: 55,
        max_hit_points: 55,
        armor_class: 15,
      },
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<CompactCharacterHeader />);

    expect(screen.getByText('Grog')).toBeInTheDocument();
    expect(screen.getByText(/Level 5 Goliath Barbarian/)).toBeInTheDocument();

    // Stored current/max HP is displayed directly.
    expect(screen.getByLabelText(/Hit Points: 55/)).toBeInTheDocument();

    // AC is read from the stored sheet value.
    expect(screen.getByLabelText(/Armor Class: 15/)).toBeInTheDocument();

    // Proficiency: floor((5-1)/4) + 2 = 1 + 2 = 3
    expect(screen.getByLabelText(/Proficiency Bonus: \+3/)).toBeInTheDocument();

    // Ability Modifiers
    expect(screen.getByLabelText('STR: +4')).toBeInTheDocument();
    expect(screen.getByLabelText('INT: -1')).toBeInTheDocument();
  });

  it('renders stored current/max HP when it differs from preview math', async () => {
    const mockCharacter = {
      id: 'char-stored-hp',
      name: 'The Apprentice',
      level: 5,
      race: { name: 'Human' },
      class: { name: 'Barbarian', hitDie: 12 },
      abilityScores: {
        dexterity: { modifier: 2 },
        constitution: { modifier: 3 },
      },
      character_stats: {
        current_hit_points: 7,
        max_hit_points: 20,
      },
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<CompactCharacterHeader />);

    await waitFor(() => {
      expect(screen.getByLabelText('Hit Points: 7 out of 20')).toBeInTheDocument();
    });
  });

  it('calculates Monk Unarmored Defense correctly (no shield)', () => {
    const mockCharacter = {
      id: 'char-monk',
      name: 'Li',
      level: 1,
      class: { name: 'Monk', hitDie: 8 },
      abilityScores: {
        dexterity: { modifier: 4 },
        wisdom: { modifier: 3 },
      },
      character_stats: {
        armor_class: 17,
      },
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<CompactCharacterHeader />);

    // AC is read from the stored sheet value.
    expect(screen.getByLabelText(/Armor Class: 17/)).toBeInTheDocument();
  });

  it('verifies server-routed combat HP fetching and display', async () => {
    const mockCharacter = {
      id: 'char-combat',
      name: 'Fighter',
      level: 1,
      class: { name: 'Fighter', hitDie: 10 },
      abilityScores: { constitution: { modifier: 2 } },
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    vi.mocked(userDataApi.getCharacterCombatStatus).mockResolvedValue({
      participant_id: 'part-456',
      encounter_id: 'enc-123',
      current_hp: 8,
      max_hp: 12,
      temp_hp: 5,
      is_conscious: true,
      death_saves_successes: 0,
      death_saves_failures: 0,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
    });

    render(<CompactCharacterHeader />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Hit Points: 8 out of 12 plus 5 temporary/)).toBeInTheDocument();
    });
  });

  it('uses the server status seam instead of a browser Supabase channel', async () => {
    const mockCharacter = {
      id: 'char-realtime',
      name: 'Rogue',
      level: 1,
      class: { name: 'Rogue', hitDie: 8 },
      abilityScores: { constitution: { modifier: 1 } },
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    vi.mocked(userDataApi.getCharacterCombatStatus).mockResolvedValue({
      participant_id: 'part-789',
      encounter_id: 'enc-123',
      current_hp: 9,
      max_hp: 9,
      temp_hp: 0,
      is_conscious: true,
      death_saves_successes: 0,
      death_saves_failures: 0,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
    });

    render(<CompactCharacterHeader />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Hit Points: 9/)).toBeInTheDocument();
    });

    expect(userDataApi.getCharacterCombatStatus).toHaveBeenCalledWith('char-realtime');
    expect(supabase.channel).not.toHaveBeenCalled();
  });
});
