/**
 * Token Selection Slice - Selected, targeted, hovered, dragged tokens
 * and optimistic position updates.
 */

import type { BattleMapState, TokenSelectionSlice } from './types';
import type { StateCreator } from 'zustand';

export const createTokenSelectionSlice: StateCreator<
  BattleMapState,
  [],
  [],
  TokenSelectionSlice
> = (set) => ({
  selectedTokenIds: [],
  targetedTokenIds: [],
  hoveredTokenId: null,
  draggedTokenId: null,
  optimisticTokenUpdates: new Map(),

  selectToken: (tokenId, multiSelect = false) =>
    set(
      (state) => ({
        selectedTokenIds: multiSelect ? [...state.selectedTokenIds, tokenId] : [tokenId],
      }),
      false,
      'battleMap/selectToken',
    ),

  deselectToken: (tokenId) =>
    set(
      (state) => ({
        selectedTokenIds: state.selectedTokenIds.filter((id) => id !== tokenId),
      }),
      false,
      'battleMap/deselectToken',
    ),

  toggleSelectToken: (tokenId) =>
    set(
      (state) => ({
        selectedTokenIds: state.selectedTokenIds.includes(tokenId)
          ? state.selectedTokenIds.filter((id) => id !== tokenId)
          : [...state.selectedTokenIds, tokenId],
      }),
      false,
      'battleMap/toggleSelectToken',
    ),

  clearSelection: () => set({ selectedTokenIds: [] }, false, 'battleMap/clearSelection'),

  targetToken: (tokenId, replace = false) =>
    set(
      (state) => ({
        targetedTokenIds: replace
          ? [tokenId]
          : state.targetedTokenIds.includes(tokenId)
            ? state.targetedTokenIds
            : [...state.targetedTokenIds, tokenId],
      }),
      false,
      'battleMap/targetToken',
    ),

  clearTargets: () => set({ targetedTokenIds: [] }, false, 'battleMap/clearTargets'),

  setHoveredToken: (tokenId) =>
    set({ hoveredTokenId: tokenId }, false, 'battleMap/setHoveredToken'),

  setDraggedToken: (tokenId) =>
    set({ draggedTokenId: tokenId }, false, 'battleMap/setDraggedToken'),

  addOptimisticUpdate: (tokenId, x, y, optimisticId) =>
    set(
      (state) => {
        const updates = new Map(state.optimisticTokenUpdates);
        updates.set(tokenId, { x, y, optimisticId });
        return { optimisticTokenUpdates: updates };
      },
      false,
      'battleMap/addOptimisticUpdate',
    ),

  removeOptimisticUpdate: (optimisticId) =>
    set(
      (state) => {
        const updates = new Map(state.optimisticTokenUpdates);
        for (const [tokenId, update] of updates.entries()) {
          if (update.optimisticId === optimisticId) {
            updates.delete(tokenId);
            break;
          }
        }
        return { optimisticTokenUpdates: updates };
      },
      false,
      'battleMap/removeOptimisticUpdate',
    ),

  clearOptimisticUpdates: () =>
    set({ optimisticTokenUpdates: new Map() }, false, 'battleMap/clearOptimisticUpdates'),
});
