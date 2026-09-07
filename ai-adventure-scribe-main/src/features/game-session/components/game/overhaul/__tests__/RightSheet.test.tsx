import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RightSheet } from '../RightSheet';

import type { CharacterSheetVM } from '../types';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

const sheet: CharacterSheetVM = {
  name: 'Aldric Vale',
  subtitle: 'Human · Fighter (Champion)',
  level: 5,
  xpCurrent: 6500,
  xpMax: 14000,
  hpCurrent: 40,
  hpMax: 44,
  ac: 18,
  initiative: '+2',
  speed: 30,
  abilityScores: [],
  savingThrows: [],
  skills: [],
  attacks: [
    { id: 'a1', name: 'Longsword', bonus: '+6', damage: '1d8+3' },
    { id: 'a2', name: 'Shield Bash', bonus: '+5', damage: '1d4+3' },
  ],
  conditions: [],
  equipment: [],
  inventory: [],
};

describe('RightSheet attacks list', () => {
  it('lists attacks without a dead View All Attacks control', () => {
    render(<RightSheet c={sheet} />);

    expect(screen.getByText('Longsword')).toBeInTheDocument();
    expect(screen.getByText('Shield Bash')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View All Attacks/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/View All Attacks/i)).not.toBeInTheDocument();
  });
});
