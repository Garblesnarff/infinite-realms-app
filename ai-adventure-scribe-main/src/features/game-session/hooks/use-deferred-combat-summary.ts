import React from 'react';

import type { CombatEncounter } from '@/types/combat-encounter';
import type { ChatMessage } from '@/types/game';

import { combatMessageEndedCombat } from '@/utils/combat-engine-blocks';

/** Posts the summary anyway if this fight's terminal DM message never arrives. */
export const COMBAT_SUMMARY_FALLBACK_MS = 15_000;

interface DeferredCombatSummaryParams {
  isInCombat: boolean;
  activeEncounter: CombatEncounter | null | undefined;
  messages: ChatMessage[];
  /** True while history is hydrating; terminal messages seen then belong to earlier fights. */
  messagesLoading?: boolean;
  sendMessage: (message: ChatMessage) => unknown;
  /** Runs as soon as combat ends, before the summary is posted. */
  onCombatEnded?: () => void;
}

const messageKey = (message: ChatMessage, index: number): string =>
  message.id ?? (message.timestamp ? `${message.timestamp}|${message.text}` : `index:${index}`);

const terminalMessageKeys = (messages: ChatMessage[]): Set<string> =>
  new Set(
    messages
      .map((message, index) =>
        combatMessageEndedCombat(message) ? messageKey(message, index) : '',
      )
      .filter(Boolean),
  );

export function buildCombatSummaryMessage(
  encounter: CombatEncounter | null | undefined,
): ChatMessage {
  const rounds = encounter?.currentRound || encounter?.roundsElapsed || 1;
  const participants = (encounter?.participants || []).map((p) => ({
    name: p.name,
    damageDealt: (encounter?.actions || [])
      .filter((a) => a.participantId === p.id && a.damageDealt)
      .reduce((s, a) => s + (a.damageDealt || 0), 0),
    damageTaken: Math.max(0, (p.maxHitPoints || 0) - (p.currentHitPoints || 0)),
    status: p.isDead ? 'dead' : p.isUnconscious ? 'unconscious' : 'ok',
  }));
  const totalDamage = participants.reduce((s, x) => s + x.damageDealt, 0);
  return {
    text: 'Combat has ended.',
    sender: 'system',
    context: {
      combatData: {
        type: 'summary',
        summary: { rounds, totalDamage, participants, outcome: 'Combat concluded' },
      },
    },
  };
}

/**
 * "Combat has ended." is held until THIS fight's terminal DM message is in the transcript, so the
 * killing HIT reads before the summary (#2127).
 *
 * "This fight's" is the whole point: a session with two encounters already holds the first one's
 * terminal message, and a transcript-wide check lets the second summary jump ahead of its own
 * killing blow. The terminal messages already present when the fight began are the baseline, and
 * only one outside it counts. The baseline is taken at combat start rather than when the summary
 * is queued so a terminal message that lands just before `isInCombat` flips is still accepted.
 * A dropped terminal message must not lose the summary, so it is posted after a bounded wait.
 */
export function useDeferredCombatSummary({
  isInCombat,
  activeEncounter,
  messages,
  messagesLoading = false,
  sendMessage,
  onCombatEnded,
}: DeferredCombatSummaryParams): void {
  const prevInCombatRef = React.useRef(isInCombat);
  const lastEncounterRef = React.useRef<CombatEncounter | null>(null);
  const baselineRef = React.useRef<Set<string>>(terminalMessageKeys(messages));
  const pendingRef = React.useRef<{ encounter: CombatEncounter | null | undefined } | null>(null);
  const fallbackRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendMessageRef = React.useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const onCombatEndedRef = React.useRef(onCombatEnded);
  onCombatEndedRef.current = onCombatEnded;

  const flush = React.useCallback(() => {
    if (fallbackRef.current) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    void sendMessageRef.current(buildCombatSummaryMessage(pending.encounter));
  }, []);

  React.useEffect(() => {
    const startedCombat = !prevInCombatRef.current && isInCombat;
    const endedCombat = prevInCombatRef.current && !isInCombat;
    prevInCombatRef.current = isInCombat;

    if (startedCombat) {
      // A new fight while the previous summary is still waiting: post it now, before its
      // terminal message could be confused with this fight's.
      flush();
      baselineRef.current = terminalMessageKeys(messages);
    } else if (isInCombat && messagesLoading) {
      // Reloaded mid-fight: history that hydrates now predates this fight's end.
      baselineRef.current = terminalMessageKeys(messages);
    }
    if (isInCombat && activeEncounter) lastEncounterRef.current = activeEncounter;

    if (endedCombat) {
      pendingRef.current = { encounter: activeEncounter ?? lastEncounterRef.current };
      onCombatEndedRef.current?.();
      fallbackRef.current = setTimeout(flush, COMBAT_SUMMARY_FALLBACK_MS);
    }

    if (!pendingRef.current) return;
    const baseline = baselineRef.current;
    const thisFightEnded = messages.some(
      (message, index) =>
        combatMessageEndedCombat(message) && !baseline.has(messageKey(message, index)),
    );
    if (thisFightEnded) flush();
  }, [isInCombat, activeEncounter, messages, messagesLoading, flush]);

  React.useEffect(
    () => () => {
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    },
    [],
  );
}
