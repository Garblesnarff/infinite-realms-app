/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

import { useCombat } from '@/contexts/CombatContext';
import {
  rollGrappleCheck,
  createGrappledCondition,
  getGrappleActionDescription,
} from '@/utils/grappleUtils';
import GrappleActionPanel from '../GrappleActionPanel';
import logger from '@/lib/logger';

// Mock UI components to simplify testing
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => {
    return <div data-testid="mock-select" onClick={() => onValueChange('t1')}>{children}</div>;
  },
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <div>{placeholder}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-testid={`item-${value}`}>{children}</div>,
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(),
}));

vi.mock('@/utils/grappleUtils', () => ({
  rollGrappleCheck: vi.fn(),
  createGrappledCondition: vi.fn(),
  getGrappleActionDescription: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

describe('GrappleActionPanel', () => {
  const mockParticipantId = 'p1';
  const mockTargets = [
    { id: 't1', name: 'Goblin' },
    { id: 't2', name: 'Orc' },
  ];

  const mockParticipants = [
    { id: 'p1', name: 'Hero' },
    { id: 't1', name: 'Goblin' },
    { id: 't2', name: 'Orc' },
  ];

  const mockTakeAction = vi.fn().mockResolvedValue(undefined);
  const mockApplyCondition = vi.fn().mockResolvedValue(undefined);
  const mockUpdateParticipant = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    (useCombat as any).mockReturnValue({
      state: { activeEncounter: { participants: mockParticipants } },
      takeAction: mockTakeAction,
      applyCondition: mockApplyCondition,
      updateParticipant: mockUpdateParticipant,
    });
  });

  it('renders correctly with targets', () => {
    render(<GrappleActionPanel participantId={mockParticipantId} targets={mockTargets} />);
    expect(screen.getByRole('heading', { name: /Grapple/i })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Grapple' })).toBeDisabled();
  });

  it('enables the button when a target is selected', async () => {
    render(<GrappleActionPanel participantId={mockParticipantId} targets={mockTargets} />);
    const select = screen.getByTestId('mock-select');
    fireEvent.click(select);
    const button = screen.getByRole('button', { name: 'Grapple' });
    expect(button).not.toBeDisabled();
  });

  it('handles a successful grapple attempt and clears state after delay', async () => {
    vi.useFakeTimers();
    (rollGrappleCheck as any).mockReturnValue({
      success: true,
      dc: 15,
      roll: 18,
    });
    (createGrappledCondition as any).mockReturnValue({ id: 'cond-1', name: 'Grappled' });
    (getGrappleActionDescription as any).mockReturnValue('Hero grapples Goblin successfully!');

    render(<GrappleActionPanel participantId={mockParticipantId} targets={mockTargets} />);

    const select = screen.getByTestId('mock-select');
    fireEvent.click(select);

    const button = screen.getByRole('button', { name: 'Grapple' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(rollGrappleCheck).toHaveBeenCalled();
    expect(mockApplyCondition).toHaveBeenCalledWith('t1', { id: 'cond-1', name: 'Grappled' });
    expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', { actionTaken: true });
    expect(mockTakeAction).toHaveBeenCalled();

    expect(screen.getByText('Hero grapples Goblin successfully!')).toBeDefined();

    // Fast-forward 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText('Hero grapples Goblin successfully!')).toBeNull();
    vi.useRealTimers();
  });

  it('handles a failed grapple attempt', async () => {
    (rollGrappleCheck as any).mockReturnValue({
      success: false,
      dc: 15,
      roll: 10,
    });
    (getGrappleActionDescription as any).mockReturnValue('Hero fails to grapple Goblin.');

    render(<GrappleActionPanel participantId={mockParticipantId} targets={mockTargets} />);

    const select = screen.getByTestId('mock-select');
    fireEvent.click(select);

    const button = screen.getByRole('button', { name: 'Grapple' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockApplyCondition).not.toHaveBeenCalled();
    expect(mockUpdateParticipant).not.toHaveBeenCalled();
    expect(mockTakeAction).toHaveBeenCalled();
    expect(screen.getByText('Hero fails to grapple Goblin.')).toBeDefined();
  });

  it('logs error if grapple attempt throws', async () => {
    (rollGrappleCheck as any).mockImplementation(() => {
      throw new Error('Test Error');
    });

    render(<GrappleActionPanel participantId={mockParticipantId} targets={mockTargets} />);

    const select = screen.getByTestId('mock-select');
    fireEvent.click(select);

    const button = screen.getByRole('button', { name: 'Grapple' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(logger.error).toHaveBeenCalledWith('Error processing grapple action:', expect.any(Error));
  });

  it('does nothing if activeEncounter is missing', async () => {
    (useCombat as any).mockReturnValue({
      state: { activeEncounter: null },
      takeAction: mockTakeAction,
      applyCondition: mockApplyCondition,
      updateParticipant: mockUpdateParticipant,
    });

    render(<GrappleActionPanel participantId={mockParticipantId} targets={mockTargets} />);

    const select = screen.getByTestId('mock-select');
    fireEvent.click(select);

    const button = screen.getByRole('button', { name: 'Grapple' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(rollGrappleCheck).not.toHaveBeenCalled();
  });

  it('does nothing if participant is missing', async () => {
    (useCombat as any).mockReturnValue({
      state: { activeEncounter: { participants: mockParticipants.filter(p => p.id !== 'p1') } },
      takeAction: mockTakeAction,
      applyCondition: mockApplyCondition,
      updateParticipant: mockUpdateParticipant,
    });

    render(<GrappleActionPanel participantId={mockParticipantId} targets={mockTargets} />);

    const select = screen.getByTestId('mock-select');
    fireEvent.click(select);

    const button = screen.getByRole('button', { name: 'Grapple' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(rollGrappleCheck).not.toHaveBeenCalled();
  });

  it('does nothing if target is missing from encounter participants', async () => {
    (useCombat as any).mockReturnValue({
      state: { activeEncounter: { participants: mockParticipants.filter(p => p.id !== 't1') } },
      takeAction: mockTakeAction,
      applyCondition: mockApplyCondition,
      updateParticipant: mockUpdateParticipant,
    });

    render(<GrappleActionPanel participantId={mockParticipantId} targets={mockTargets} />);

    const select = screen.getByTestId('mock-select');
    fireEvent.click(select);

    const button = screen.getByRole('button', { name: 'Grapple' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(rollGrappleCheck).not.toHaveBeenCalled();
  });
});
