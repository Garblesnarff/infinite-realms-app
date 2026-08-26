import { render, screen } from '@testing-library/react';
import React from 'react';
import { expect, describe, it, vi } from 'vitest';

import InitiativeTracker from '../InitiativeTracker';

import { TooltipProvider } from '@/components/ui/tooltip';

// Mock the useCombat hook
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: {
      activeEncounter: {
        currentRound: 1,
        roundsElapsed: 0,
        currentTurnParticipantId: 'p1',
        participants: [
          {
            id: 'p1',
            name: 'Thorin',
            initiative: 15,
            armorClass: 18,
            currentHitPoints: 40,
            maxHitPoints: 40,
            temporaryHitPoints: 0,
            participantType: 'player',
            conditions: [],
            deathSaves: { successes: 0, failures: 0 },
          },
          {
            id: 'p2',
            name: 'Orc',
            initiative: 10,
            armorClass: 13,
            currentHitPoints: 15,
            maxHitPoints: 15,
            temporaryHitPoints: 0,
            participantType: 'monster',
            conditions: [],
            deathSaves: { successes: 0, failures: 0 },
          }
        ],
      },
      isInCombat: true,
    },
    nextTurn: vi.fn(),
    rollInitiative: vi.fn(),
  })),
}));

// Mock the useCampaignAssetsContext hook
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: vi.fn(() => ({
    getAssetImageUrl: vi.fn(() => null),
  })),
}));

describe('InitiativeTracker Accessibility', () => {
  it('renders initiative scores with descriptive aria-labels', () => {
    render(
      <TooltipProvider>
        <InitiativeTracker />
      </TooltipProvider>
    );

    expect(screen.getByLabelText(/Initiative: 15/i)).toBeDefined();
    expect(screen.getByLabelText(/Initiative: 10/i)).toBeDefined();
  });

  it('renders participant type icons with aria-labels', () => {
    render(
      <TooltipProvider>
        <InitiativeTracker />
      </TooltipProvider>
    );

    const playerIcon = screen.getByLabelText('Player');
    expect(playerIcon).toBeDefined();

    const monsterIcon = screen.getByLabelText('Monster');
    expect(monsterIcon).toBeDefined();
  });

  it('renders Armor Class with descriptive aria-labels', () => {
    render(
      <TooltipProvider>
        <InitiativeTracker />
      </TooltipProvider>
    );

    expect(screen.getByLabelText(/Armor Class: 18/i)).toBeDefined();
    expect(screen.getByLabelText(/Armor Class: 13/i)).toBeDefined();
  });

  it('hides client-authoritative combat controls and numeric enemy HP', () => {
    render(
      <TooltipProvider>
        <InitiativeTracker />
      </TooltipProvider>
    );

    expect(
      screen.queryByRole('button', { name: /Roll initiative for all participants/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Advance to the next participant's turn/i }),
    ).toBeNull();
    expect(screen.getByLabelText('Orc Health bar')).toBeDefined();
    expect(screen.queryByText('15/15')).toBeNull();
    expect(screen.getByText('40/40')).toBeDefined();
  });
});
