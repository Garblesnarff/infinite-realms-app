import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ActionPanel from '../ActionPanel';

import type { Encounter } from '@/types/combat';

import { TooltipProvider } from '@/components/ui/tooltip';

describe('ActionPanel player controls', () => {
  it('does not expose turn advancement or initiative rolling by default', () => {
    const participant = {
      id: 'p1',
      name: 'Hero',
      participantType: 'player',
      currentHitPoints: 10,
      maxHitPoints: 10,
      temporaryHitPoints: 0,
      conditions: [],
      deathSaves: { successes: 0, failures: 0 },
    };

    render(
      <TooltipProvider>
        <ActionPanel
          activeEncounter={{ participants: [participant] } as unknown as Encounter}
          currentParticipantId="p1"
          selectedEnemyId={null}
          actionValidation={null}
          onCombatAction={vi.fn()}
          onNextTurn={vi.fn()}
          onOpenSpellPicker={vi.fn()}
          onRollInitiative={vi.fn()}
          onTwoWeaponAttack={vi.fn()}
          onEnhancedAttack={vi.fn()}
          onClassFeatureUse={vi.fn()}
          onRacialTraitUse={vi.fn()}
          onDeathSave={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByRole('button', { name: /Next Turn/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Roll Initiative/i })).toBeNull();
  });
});
