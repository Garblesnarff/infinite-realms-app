/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMagicItemAttunement } from '../use-magic-item-attunement';

import logger from '@/lib/logger';
import { restApi } from '@/services/rest-api';
import { validateAttunementRequirements, getAttunedItemCount } from '@/utils/magicItemEffects';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/magicItemEffects', () => ({
  validateAttunementRequirements: vi.fn(),
  getAttunedItemCount: vi.fn(),
}));

vi.mock('@/services/rest-api', () => ({
  restApi: {
    shortRest: vi.fn().mockResolvedValue({ restType: 'short', hpRestored: 0 }),
    attuneItem: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('useMagicItemAttunement', () => {
  const mockOnCharacterUpdate = vi.fn();

  const mockCharacter: any = {
    id: 'char-123',
    name: 'Test Character',
    inventory: [
      {
        itemId: 'magic-sword',
        quantity: 1,
        equipped: true,
        isMagic: true,
        requiresAttunement: true,
        isAttuned: false,
      },
      {
        itemId: 'bag-of-holding',
        quantity: 1,
        equipped: true,
        isMagic: true,
        requiresAttunement: false,
        isAttuned: false,
      },
      {
        itemId: 'ring-of-protection',
        quantity: 1,
        equipped: true,
        isMagic: true,
        requiresAttunement: true,
        isAttuned: true,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getAttunedItemCount as any).mockReturnValue(1);
    (validateAttunementRequirements as any).mockReturnValue({
      canAttune: true,
      reason: 'Meets all requirements',
    });
  });

  it('should initialize with correct state', () => {
    const { result } = renderHook(() =>
      useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
    );

    expect(result.current.isAttuning).toBe(false);
    expect(result.current.attunedItemCount).toBe(1);
    expect(result.current.canAttuneToMoreItems).toBe(true);
  });

  describe('attuneToItem', () => {
    it('should fail if item is not found in inventory', async () => {
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.attuneToItem('non-existent-item');
      });

      expect(response.success).toBe(false);
      expect(response.message).toBe('Item not found in inventory');
      expect(mockOnCharacterUpdate).not.toHaveBeenCalled();
    });

    it('should fail if item is already attuned', async () => {
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.attuneToItem('ring-of-protection');
      });

      expect(response.success).toBe(false);
      expect(response.message).toBe('Item is already attuned');
      expect(mockOnCharacterUpdate).not.toHaveBeenCalled();
    });

    it('should fail if attunement requirements are not met', async () => {
      (validateAttunementRequirements as any).mockReturnValue({
        canAttune: false,
        reason: 'Requires class: Wizard',
      });

      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.attuneToItem('magic-sword');
      });

      expect(response.success).toBe(false);
      expect(response.message).toBe('Requires class: Wizard');
      expect(mockOnCharacterUpdate).not.toHaveBeenCalled();
    });

    it('should successfully attune to an item', async () => {
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.attuneToItem('magic-sword');
      });

      expect(response.success).toBe(true);
      expect(response.message).toContain('Completed a short rest');
      expect(restApi.shortRest).toHaveBeenCalledWith('char-123');
      expect(restApi.attuneItem).toHaveBeenCalledWith('char-123', 'magic-sword');
      expect(mockOnCharacterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          inventory: expect.arrayContaining([
            expect.objectContaining({ itemId: 'magic-sword', isAttuned: true }),
          ]),
        }),
      );
    });

    it('should handle errors during attunement', async () => {
      // Force an error by making inventory null in a way that triggers an error in the hook
      const brokenCharacter = { ...mockCharacter, inventory: undefined };
      const { result } = renderHook(() =>
        useMagicItemAttunement(brokenCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.attuneToItem('magic-sword');
      });

      expect(response.success).toBe(false);
      expect(response.message).toBe('Item not found in inventory'); // Actually this fails gracefully because of the find call on undefined

      // Let's force a real throw
      (validateAttunementRequirements as any).mockImplementation(() => {
        throw new Error('Test error');
      });

      const { result: result2 } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );
      const response2 = await act(async () => {
        return await result2.current.attuneToItem('magic-sword');
      });

      expect(response2.success).toBe(false);
      expect(response2.message).toBe('Failed to attune to item');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('removeAttunement', () => {
    it('should fail if item is not found in inventory', async () => {
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.removeAttunement('non-existent-item');
      });

      expect(response.success).toBe(false);
      expect(response.message).toBe('Item not found in inventory');
      expect(mockOnCharacterUpdate).not.toHaveBeenCalled();
    });

    it('should fail if item is not attuned', async () => {
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.removeAttunement('magic-sword');
      });

      expect(response.success).toBe(false);
      expect(response.message).toBe('Item is not currently attuned');
      expect(mockOnCharacterUpdate).not.toHaveBeenCalled();
    });

    it('should successfully remove attunement from an item', async () => {
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.removeAttunement('ring-of-protection');
      });

      expect(response.success).toBe(true);
      expect(response.message).toContain('Successfully removed attunement');
      expect(mockOnCharacterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          inventory: expect.arrayContaining([
            expect.objectContaining({ itemId: 'ring-of-protection', isAttuned: false }),
          ]),
        }),
      );
    });

    it('should handle errors during removal', async () => {
      // Force an error
      mockOnCharacterUpdate.mockImplementationOnce(() => {
        throw new Error('Update failed');
      });

      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const response = await act(async () => {
        return await result.current.removeAttunement('ring-of-protection');
      });

      expect(response.success).toBe(false);
      expect(response.message).toBe('Failed to remove attunement');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getItemAttunementStatus', () => {
    it('should return correct status for existing items', () => {
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const status = result.current.getItemAttunementStatus('magic-sword');
      expect(status.isAttuned).toBe(false);
      expect(status.canAttune).toBe(true);

      const status2 = result.current.getItemAttunementStatus('ring-of-protection');
      expect(status2.isAttuned).toBe(true);
    });

    it('should return correct status for non-existent items', () => {
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const status = result.current.getItemAttunementStatus('ghost-item');
      expect(status.isAttuned).toBe(false);
      expect(status.canAttune).toBe(false);
      expect(status.reason).toBe('Item not found');
    });
  });

  describe('getAttunementSummary', () => {
    it('should return correct summary', () => {
      (getAttunedItemCount as any).mockReturnValue(2);
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const summary = result.current.getAttunementSummary();
      expect(summary.attunedCount).toBe(2);
      expect(summary.availableSlots).toBe(1);
      expect(summary.isAtCapacity).toBe(false);
    });

    it('should reflect capacity correctly', () => {
      (getAttunedItemCount as any).mockReturnValue(3);
      const { result } = renderHook(() =>
        useMagicItemAttunement(mockCharacter, mockOnCharacterUpdate),
      );

      const summary = result.current.getAttunementSummary();
      expect(summary.isAtCapacity).toBe(true);
      expect(summary.availableSlots).toBe(0);
    });
  });
});
