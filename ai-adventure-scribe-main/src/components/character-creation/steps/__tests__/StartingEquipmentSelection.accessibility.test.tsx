import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import StartingEquipmentSelection from '../StartingEquipmentSelection';

import { TooltipProvider } from '@/components/ui/tooltip';

// Mock the context and hooks
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: {
      character: {
        class: { id: 'fighter', name: 'Fighter' },
        abilityScores: {
          dexterity: { modifier: 2 },
          constitution: { modifier: 2 },
          wisdom: { modifier: 1 },
        },
      },
    },
    dispatch: vi.fn(),
  }),
  CharacterProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('StartingEquipmentSelection Accessibility', () => {
  it('should have accessible radio group and options', () => {
    render(
      <TooltipProvider>
        <StartingEquipmentSelection />
      </TooltipProvider>,
    );

    // Check if RadioGroup has aria-labelledby
    const radioGroup = screen.getByRole('radiogroup');
    const title = screen.getByText('Equipment Method');
    expect(radioGroup).toHaveAttribute('aria-labelledby', title.id);

    // Check if radio items have correct labels linked via id/htmlFor
    const packageRadio = screen.getByLabelText(/Equipment Package/i);
    const goldRadio = screen.getByLabelText(/Starting Gold/i);

    expect(packageRadio).toBeInTheDocument();
    expect(goldRadio).toBeInTheDocument();
  });

  it('should have purely decorative icons hidden from screen readers', () => {
    const { container } = render(
      <TooltipProvider>
        <StartingEquipmentSelection />
      </TooltipProvider>,
    );

    // Check for aria-hidden="true" on explicitly identified icons
    // We avoid checking ALL svgs because Radix components might inject some

    // Package icons
    const packageIcons = container.querySelectorAll('svg.text-blue-500, svg.text-green-500');
    packageIcons.forEach((icon) => {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    // Coins icons
    const coinsIcons = container.querySelectorAll('svg.text-yellow-500');
    coinsIcons.forEach((icon) => {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    // Sword icons
    const swordIcons = container.querySelectorAll('svg.text-red-500');
    swordIcons.forEach((icon) => {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('should have a descriptive title on the apply button', () => {
    render(
      <TooltipProvider>
        <StartingEquipmentSelection />
      </TooltipProvider>,
    );

    const applyButton = screen.getByRole('button', { name: /Apply/i });
    expect(applyButton).toHaveAttribute('title', 'Apply selection to your character');
  });
});
