/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import ResourceConsumptionPanel from '../ResourceConsumptionPanel';

import type { CombatParticipant } from '@/types/combat';

import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';

// Mock CombatContext
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

// Mock Select components using a simpler approach that renders standard HTML elements directly
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: any) => {
    return (
      <select
        value={value || ''}
        onChange={(e) => onValueChange(e.target.value)}
        data-testid="select-mock"
      >
        <option value="">Choose a resource</option>
        {children}
      </select>
    );
  },
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <>{placeholder}</>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => (
    <option value={value}>{children}</option>
  ),
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Zap: () => <div data-testid="icon-zap" />,
}));

describe('ResourceConsumptionPanel', () => {
  const mockTakeAction = vi.fn();
  const mockOnClose = vi.fn();

  const wizardParticipant: Partial<CombatParticipant> = {
    id: 'p1',
    name: 'Gandalf',
    spellSlots: {
      '1': { current: 3, max: 4 },
      '2': { current: 2, max: 3 },
    },
  };

  const monkParticipant: Partial<CombatParticipant> = {
    id: 'p2',
    name: 'Lee',
    resources: {
      kiPoints: { current: 5, max: 10 },
    },
  };

  const paladinParticipant: Partial<CombatParticipant> = {
    id: 'p3',
    name: 'Arthur',
    resources: {
      layOnHands: { current: 15, max: 20 },
      channelDivinity: { current: 1, max: 1 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useCombat as any).mockReturnValue({
      takeAction: mockTakeAction,
    });
  });

  it('renders available resources for a Wizard', () => {
    render(
      <ResourceConsumptionPanel
        participant={wizardParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText('Spell Slot')).toBeInTheDocument();
    expect(screen.queryByText('Ki Points')).not.toBeInTheDocument();

    // Check summary
    expect(screen.getByText(/Current Resources/i)).toBeInTheDocument();
    expect(screen.getByText(/L1: 3\/4/i)).toBeInTheDocument();
    expect(screen.getByText(/L2: 2\/3/i)).toBeInTheDocument();
  });

  it('renders available resources for a Monk', () => {
    render(
      <ResourceConsumptionPanel
        participant={monkParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText('Ki Points')).toBeInTheDocument();
    expect(screen.queryByText('Spell Slot')).not.toBeInTheDocument();

    // Check summary
    expect(screen.getByText(/Ki Points:/i)).toBeInTheDocument();
    expect(screen.getByText(/5\/10/i)).toBeInTheDocument();
  });

  it('updates state and shows amount input for applicable resources', () => {
    render(
      <ResourceConsumptionPanel
        participant={monkParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');
    fireEvent.change(select, { target: { value: 'ki-points' } });

    expect(screen.getByLabelText(/Amount/i)).toBeInTheDocument();
    const amountInput = screen.getByLabelText(/Amount/i) as HTMLInputElement;
    expect(amountInput.value).toBe('1');

    fireEvent.change(amountInput, { target: { value: '2' } });
    expect(amountInput.value).toBe('2');
  });

  it('hides amount input for resources like Rage or Channel Divinity', () => {
    render(
      <ResourceConsumptionPanel
        participant={paladinParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');
    fireEvent.change(select, { target: { value: 'channel-divinity' } });

    expect(screen.queryByLabelText(/Amount/i)).not.toBeInTheDocument();
  });

  it('calls takeAction with correct parameters for spell slots', async () => {
    mockTakeAction.mockResolvedValueOnce(undefined);

    render(
      <ResourceConsumptionPanel
        participant={wizardParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');
    fireEvent.change(select, { target: { value: 'spell-slot' } });

    const consumeButton = screen.getByRole('button', { name: /Consume/i });
    fireEvent.click(consumeButton);

    expect(mockTakeAction).toHaveBeenCalledWith({
      participantId: 'p1',
      actionType: 'cast_spell',
      description: 'Gandalf casts a spell using a spell slot',
      resourceUsed: 'spell-slot',
      resourceAmount: 1,
    });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('calls takeAction with correct parameters for ki points and amount', async () => {
    mockTakeAction.mockResolvedValueOnce(undefined);

    render(
      <ResourceConsumptionPanel
        participant={monkParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');
    fireEvent.change(select, { target: { value: 'ki-points' } });

    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(amountInput, { target: { value: '3' } });

    const consumeButton = screen.getByRole('button', { name: /Consume/i });
    fireEvent.click(consumeButton);

    expect(mockTakeAction).toHaveBeenCalledWith({
      participantId: 'p2',
      actionType: 'use_class_feature',
      description: 'Lee spends 3 ki points',
      resourceUsed: 'ki-points',
      resourceAmount: 3,
    });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('handles takeAction error', async () => {
    const error = new Error('Failed to take action');
    mockTakeAction.mockRejectedValueOnce(error);

    render(
      <ResourceConsumptionPanel
        participant={monkParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');
    fireEvent.change(select, { target: { value: 'ki-points' } });

    const consumeButton = screen.getByRole('button', { name: /Consume/i });
    fireEvent.click(consumeButton);

    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('Error consuming resource:', error);
    });
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    render(
      <ResourceConsumptionPanel
        participant={wizardParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('disables Consume button when no resource is selected', () => {
    render(
      <ResourceConsumptionPanel
        participant={wizardParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const consumeButton = screen.getByRole('button', { name: /Consume/i });
    expect(consumeButton).toBeDisabled();
  });

  it('renders all resource summary types', () => {
    const fullParticipant: Partial<CombatParticipant> = {
      id: 'p4',
      name: 'Omni',
      spellSlots: { '1': { current: 1, max: 1 } },
      resources: {
        kiPoints: { current: 1, max: 1 },
        sorceryPoints: { current: 1, max: 1 },
        rages: { current: 1, max: 1 },
        bardic_inspiration: { current: 1, max: 1 },
        channelDivinity: { current: 1, max: 1 },
        actionSurge: { current: 1, max: 1 },
        layOnHands: { current: 1, max: 1 },
      }
    };

    render(
      <ResourceConsumptionPanel
        participant={fullParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText(/Spell Slots:/i)).toBeInTheDocument();
    expect(screen.getByText(/Ki Points:/i)).toBeInTheDocument();
    expect(screen.getByText(/Sorcery Points:/i)).toBeInTheDocument();
    expect(screen.getByText(/Rages:/i)).toBeInTheDocument();
    expect(screen.getByText(/Bardic Inspiration:/i)).toBeInTheDocument();
    expect(screen.getByText(/Channel Divinity:/i)).toBeInTheDocument();
    expect(screen.getByText(/Action Surge:/i)).toBeInTheDocument();
    expect(screen.getByText(/Lay on Hands:/i)).toBeInTheDocument();
  });

  it('calls takeAction with correct parameters for sorcery points and rage', async () => {
    const barbarianParticipant: Partial<CombatParticipant> = {
      id: 'p5',
      name: 'Grog',
      resources: {
        rages: { current: 2, max: 3 },
        sorceryPoints: { current: 4, max: 4 },
      },
    };

    render(
      <ResourceConsumptionPanel
        participant={barbarianParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');

    // Test Sorcery Points
    fireEvent.change(select, { target: { value: 'sorcery-points' } });
    fireEvent.click(screen.getByRole('button', { name: /Consume/i }));

    expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
      resourceUsed: 'sorcery-points',
      actionType: 'use_class_feature',
      description: 'Grog spends 1 sorcery point'
    }));

    // Test Rage
    fireEvent.change(select, { target: { value: 'rage' } });
    fireEvent.click(screen.getByRole('button', { name: /Consume/i }));

    expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
      resourceUsed: 'rage',
      actionType: 'use_class_feature',
      description: 'Grog enters a rage'
    }));
  });

  it('calls takeAction with correct parameters for bardic inspiration and action surge', async () => {
    const multiParticipant: Partial<CombatParticipant> = {
      id: 'p6',
      name: 'Vax',
      resources: {
        bardic_inspiration: { current: 3, max: 3 },
        actionSurge: { current: 1, max: 1 },
      },
    };

    render(
      <ResourceConsumptionPanel
        participant={multiParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');

    // Test Bardic Inspiration
    fireEvent.change(select, { target: { value: 'bardic-inspiration' } });
    fireEvent.click(screen.getByRole('button', { name: /Consume/i }));

    expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
      resourceUsed: 'bardic-inspiration',
      actionType: 'use_class_feature',
      description: 'Vax uses Bardic Inspiration'
    }));

    // Test Action Surge
    fireEvent.change(select, { target: { value: 'action-surge' } });
    fireEvent.click(screen.getByRole('button', { name: /Consume/i }));

    expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
      resourceUsed: 'action-surge',
      actionType: 'action_surge',
      description: 'Vax uses Action Surge'
    }));
  });

  it('calls takeAction with correct parameters for lay on hands', async () => {
    render(
      <ResourceConsumptionPanel
        participant={paladinParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');
    fireEvent.change(select, { target: { value: 'lay-on-hands' } });

    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(amountInput, { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: /Consume/i }));

    expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
      resourceUsed: 'lay-on-hands',
      actionType: 'use_class_feature',
      description: 'Arthur uses Lay on Hands to heal',
      resourceAmount: 10
    }));
  });

  it('calls takeAction with correct parameters for channel divinity', async () => {
    render(
      <ResourceConsumptionPanel
        participant={paladinParticipant as CombatParticipant}
        onClose={mockOnClose}
      />
    );

    const select = screen.getByTestId('select-mock');
    fireEvent.change(select, { target: { value: 'channel-divinity' } });

    fireEvent.click(screen.getByRole('button', { name: /Consume/i }));

    expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
      resourceUsed: 'channel-divinity',
      actionType: 'use_class_feature',
      description: 'Arthur uses Channel Divinity'
    }));
  });
});
