import { render, screen } from '@testing-library/react';
import { expect, describe, it, vi } from 'vitest';
import React from 'react';
import GrappleActionPanel from '../GrappleActionPanel';
import WeaponManagementPanel from '../WeaponManagementPanel';
import ResourceConsumptionPanel from '../ResourceConsumptionPanel';

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
    it('has correctly linked label and select trigger with aria-label', () => {
      const targets = [{ id: '1', name: 'Goblin' }];
      render(<GrappleActionPanel participantId="p1" targets={targets} />);

      const label = screen.getByText('Target');
      const selectTrigger = screen.getByRole('combobox', { name: /select grapple target/i });

      expect(label).toBeDefined();
      expect(selectTrigger).toBeDefined();
      expect(selectTrigger.getAttribute('id')).toBe(label.getAttribute('for'));
      expect(selectTrigger.getAttribute('title')).toBe('Select a target to grapple');
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
      const mainTrigger = screen.getByRole('combobox', { name: /select main hand weapon/i });
      expect(mainTrigger.getAttribute('id')).toBe(mainLabel.getAttribute('for'));
      expect(mainTrigger.getAttribute('title')).toBe('Choose a weapon to equip in main hand');

      const offLabel = screen.getByText('Off-Hand');
      const offTrigger = screen.getByRole('combobox', { name: /select off-hand weapon/i });
      expect(offTrigger.getAttribute('id')).toBe(offLabel.getAttribute('for'));
      expect(offTrigger.getAttribute('title')).toBe('Choose a weapon to equip in off-hand');
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

      const unequipMain = screen.getByRole('button', { name: /unequip main hand/i });
      expect(unequipMain.getAttribute('title')).toBe('Unequip main hand weapon');

      const unequipOff = screen.getByRole('button', { name: /unequip off-hand/i });
      expect(unequipOff.getAttribute('title')).toBe('Unequip off-hand weapon');
    });
  });

  describe('ResourceConsumptionPanel', () => {
    it('has correctly linked label and select trigger with aria-label', () => {
      const participant = {
        id: 'p1',
        name: 'Hero',
        resources: { kiPoints: { current: 1, max: 2 } }
      };
      render(<ResourceConsumptionPanel participant={participant as any} onClose={() => {}} />);

      const label = screen.getByText('Select Resource');
      const selectTrigger = screen.getByRole('combobox', { name: /select resource to consume/i });

      expect(label).toBeDefined();
      expect(selectTrigger).toBeDefined();
      expect(selectTrigger.getAttribute('id')).toBe(label.getAttribute('for'));
      expect(selectTrigger.getAttribute('title')).toBe('Choose a resource to use');
    });
  });
});
