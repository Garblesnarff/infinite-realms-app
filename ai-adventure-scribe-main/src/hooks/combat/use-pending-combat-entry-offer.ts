/**
 * #913: offer a stored combat entry to the tab that is already open.
 *
 * A generate response can fail to arrive while the server has already stored
 * the proposal. Reload recovered it by re-reading the player's line. This
 * hook reads the same proposal from `GET /active` and from the session
 * socket's `combat_state_updated` frame, then seats it through the one
 * delivery the generate handler also uses.
 */
import { useEffect, useState } from 'react';

import { readAuthoritativeCombat } from '@/contexts/combat/use-authoritative-combat-sync';
import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import {
  currentCombatEntryPlayer,
  onCombatEntryPlayerSourceChange,
  startCombatEntryDelivery,
  type DeliverableCombatEntry,
} from '@/services/combat/combat-entry-delivery';

const PENDING_POLL_MS = 5_000;

function offer(sessionId: string, pending: DeliverableCombatEntry): void {
  const player = currentCombatEntryPlayer();
  if (!player) return;
  void startCombatEntryDelivery({ sessionId, pending, player })
    .then((result) => {
      if (result.kind !== 'seated' && result.kind !== 'already-seated') return;
      window.dispatchEvent(
        new CustomEvent('combat-entry-seated', {
          detail: { sessionId, encounterId: result.encounterId },
        }),
      );
      window.dispatchEvent(new CustomEvent('combat-state-updated'));
    })
    .catch((error: unknown) => {
      logger.warn('[CombatEntry] pending offer could not be seated', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    });
}

/** Poll and socket delivery for a session that has no seated encounter yet. */
export function usePendingCombatEntryOffer(sessionId: string | undefined): void {
  const { state } = useCombat();
  const encounterId = state.activeEncounter?.id ?? null;
  const [playerReady, setPlayerReady] = useState(() => currentCombatEntryPlayer() != null);

  useEffect(
    () => onCombatEntryPlayerSourceChange(() => setPlayerReady(currentCombatEntryPlayer() != null)),
    [],
  );

  useEffect(() => {
    if (!sessionId || encounterId || !playerReady) return;
    let cancelled = false;
    const deliver = (pending: DeliverableCombatEntry | null | undefined): void => {
      if (cancelled || !pending) return;
      offer(sessionId, pending);
    };
    const onCombatState = (event: Event): void => {
      const detail = (event as CustomEvent<{ combatEntryPending?: DeliverableCombatEntry }>).detail;
      deliver(detail?.combatEntryPending);
    };
    const poll = (): void => {
      void readAuthoritativeCombat(sessionId).then((read) => {
        if (read.state === 'none') deliver(read.pending);
      });
    };
    window.addEventListener('combat-state-updated', onCombatState);
    poll();
    const timer = setInterval(poll, PENDING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('combat-state-updated', onCombatState);
    };
  }, [encounterId, playerReady, sessionId]);
}
