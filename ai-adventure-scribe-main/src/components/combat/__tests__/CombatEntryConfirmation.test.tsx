import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CombatEntryConfirmation } from '../CombatEntryConfirmation';

describe('CombatEntryConfirmation', () => {
  it('offers the entry Strike and decline actions before seating', () => {
    const confirm = vi.fn();
    const decline = vi.fn();

    render(
      <CombatEntryConfirmation
        confirmation={{
          spec: {
            actorLabel: 'The Storyteller',
            combatantLabels: ['Vance'],
            initiativeRoll: null,
            initiativeModifier: 2,
          },
          confirm,
          decline,
        }}
      />,
    );

    expect(screen.getByText('Initiative: (auto-rolled by the engine)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[Strike]' }));
    fireEvent.click(screen.getByRole('button', { name: '[Do something else]' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledTimes(1);
  });
});
