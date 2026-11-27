import { useEffect, useSyncExternalStore } from 'react';

import { useStageComposerDraft } from '../chat/composer-draft';

/**
 * #1754: the plaque (GameMainContent's header portal), the left rail (GameLeftPanel) and the
 * phone sheet (GameMainContent) are separate trees, so the open map and a "Travel here"
 * request go through this one store, as map-move-mode.ts does for the fight board.
 */
interface StoryMapState {
  /** The player's campaign whose map is open, or null when closed. */
  campaignId: string | null;
  /** The text a "Travel here" asked for; the composer bridge stages it once. */
  travel: { id: number; text: string } | null;
}

let state: StoryMapState = { campaignId: null, travel: null };
let trigger: HTMLElement | null = null;
const listeners = new Set<() => void>();

const set = (next: Partial<StoryMapState>): void => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Opens the map; `from` gets focus back on close (design §9: Escape returns to the plaque). */
export function openStoryMap(campaignId: string, from?: HTMLElement | null): void {
  trigger = from ?? null;
  set({ campaignId });
}

export function closeStoryMap(): void {
  if (state.campaignId === null) return;
  set({ campaignId: null });
  const target = trigger;
  trigger = null;
  target?.focus();
}

/** Puts "I travel to <place>." in the composer. It never sends. */
export function requestTravel(placeName: string): void {
  set({ travel: { id: (state.travel?.id ?? 0) + 1, text: `I travel to ${placeName}.` } });
}

export function useOpenStoryMapCampaign(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => state.campaignId,
    () => null,
  );
}

function useTravelRequest(): StoryMapState['travel'] {
  return useSyncExternalStore(
    subscribe,
    () => state.travel,
    () => null,
  );
}

/**
 * Rendered inside the ComposerDraftProvider: hands a travel request to the composer, which
 * fills and focuses itself (ChatInput, #760).
 */
export function StoryMapTravelBridge(): null {
  const travel = useTravelRequest();
  const stage = useStageComposerDraft();
  useEffect(() => {
    if (!travel || !stage) return;
    stage(travel.text);
    set({ travel: null });
  }, [travel, stage]);
  return null;
}

/** Tests only: back to closed with no request. */
export function resetStoryMapState(): void {
  trigger = null;
  state = { campaignId: null, travel: null };
  listeners.forEach((listener) => listener());
}
