import { render, screen } from '@testing-library/react';
import React from 'react';
import { expect, describe, it, vi } from 'vitest';

import GrappleActionPanel from '../GrappleActionPanel';
import ResourceConsumptionPanel from '../ResourceConsumptionPanel';
import WeaponManagementPanel from '../WeaponManagementPanel';

// Mock the useCombat hook
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: { activeEncounter: { participants: [] } },
    takeAction: vi.fn(),
    applyCondition: vi.fn(),
    updateParticipant: vi.fn(),
    equipMainHandWeapon: vi.fn(),
    equipOffHandWeapon: vi.fn(),
    unequipMainHandWeapon: vi.fn(),
    unequipOffHandWeapon: vi.fn(),
  })),
}));

describe('Combat Action Panels Accessibility', () => {
  describe('GrappleActionPanel', () => {
    it('has correctly linked label and select trigger', () => {
      const targets = [{ id: '1', name: 'Goblin' }];
      render(<GrappleActionPanel participantId="p1" targets={targets} />);

      const label = screen.getByText('Target');
      const selectTrigger = screen.getByRole('combobox', { name: /target/i });

      expect(label).toBeDefined();
      expect(selectTrigger).toBeDefined();
      expect(selectTrigger.getAttribute('id')).toBe(label.getAttribute('for'));
    });

    it('has accessible grapple button with tooltip', () => {
      const targets = [{ id: '1', name: 'Goblin' }];
      render(<GrappleActionPanel participantId="p1" targets={targets} />);

      const grappleBtn = screen.getByRole('button', { name: /grapple target/i });
      expect(grappleBtn).toBeDefined();
    });
  });

  describe('WeaponManagementPanel', () => {
    it('has correctly linked labels and select triggers for main and off-hand', () => {
      const inventory = [
        { id: 'w1', name: 'Longsword', category: 'weapon' },
        { id: 'w2', name: 'Dagger', category: 'weapon', weaponProperties: { light: true } }
      ];
      render(<WeaponManagementPanel participantId="p1" inventory={inventory as any} />);

      const mainLabel = screen.getByText('Main Hand');
      const mainTrigger = screen.getByRole('combobox', { name: /main hand weapon/i });
      expect(mainTrigger.getAttribute('id')).toBe(mainLabel.getAttribute('for'));

      const offLabel = screen.getByText('Off-Hand');
      const offTrigger = screen.getByRole('combobox', { name: /off-hand weapon/i });
      expect(offTrigger.getAttribute('id')).toBe(offLabel.getAttribute('for'));
    });

    it('has accessible unequip buttons when weapons are equipped', () => {
      const weapon = { id: 'w1', name: 'Longsword', category: 'weapon' };
      render(
        <WeaponManagementPanel
          participantId="p1"
          inventory={[]}
          mainHandWeapon={weapon as any}
          offHandWeapon={weapon as any}
        />
      );

      const unequipMain = screen.getByRole('button', { name: /unequip longsword from main hand/i });
      expect(unequipMain).toBeDefined();

      const unequipOff = screen.getByRole('button', { name: /unequip longsword from off-hand/i });
      expect(unequipOff).toBeDefined();
    });
  });

  describe('ResourceConsumptionPanel', () => {
    it('has correctly linked label and select trigger', () => {
      const participant = {
        id: 'p1',
        name: 'Hero',
        resources: { kiPoints: { current: 1, max: 2 } }
      };
      render(<ResourceConsumptionPanel participant={participant as any} onClose={() => {}} />);

      const label = screen.getByText('Select Resource');
      // When aria-label is removed, it should fall back to the linked Label's text
      const selectTrigger = screen.getByRole('combobox', { name: /select resource/i });

      expect(label).toBeDefined();
      expect(selectTrigger).toBeDefined();
      expect(selectTrigger.getAttribute('id')).toBe(label.getAttribute('for'));
    });

    it('has accessible action buttons with tooltips', () => {
      const participant = {
        id: 'p1',
        name: 'Hero',
        resources: { kiPoints: { current: 1, max: 2 } }
      };
      render(<ResourceConsumptionPanel participant={participant as any} onClose={() => {}} />);

      const consumeBtn = screen.getByRole('button', { name: /consume resource/i });
      expect(consumeBtn).toBeDefined();

      const cancelBtn = screen.getByRole('button', { name: /cancel resource consumption/i });
      expect(cancelBtn).toBeDefined();
    });
  });
});
