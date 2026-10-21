import React from 'react';

import type { CombatEncounter } from '@/types/combat-encounter';
import type { ChatMessage } from '@/types/game';

import { getAuthHeaders } from '@/services/auth/TokenService';
import { combatMessageEndedCombat } from '@/utils/combat-engine-blocks';

/** Posts the summary anyway if this fight's terminal DM message never arrives. */
export const COMBAT_SUMMARY_FALLBACK_MS = 15_000;

/** The server damage-summary fetch must not hold the summary hostage. */
export const COMBAT_DAMAGE_SUMMARY_TIMEOUT_MS = 8_000;

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';

/**
 * The wire shape of `GET /v1/combat/:encounterId/damage-summary`, aggregated server-side
 * from `combat_damage_log` (#570). The client's in-memory encounter cannot produce these
 * numbers for a server-driven fight: authoritative encounters map `actions: []`, and the
 * final HP state is discarded when the server ends the fight in the same read as the
 * killing blow.
 */
export interface ServerDamageSummaryParticipant {
  participantId: string;
  name: string;
  damageDealt: number;
  damageTaken: number;
  status: 'dead' | 'unconscious' | 'ok';
}

export interface ServerDamageSummary {
  encounterId: string;
  rounds: number;
  totalDamage: number;
  participants: ServerDamageSummaryParticipant[];
}

export async function fetchCombatDamageSummary(
  encounterId: string,
): Promise<ServerDamageSummary> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMBAT_DAMAGE_SUMMARY_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${apiBase}/v1/combat/${encodeURIComponent(encounterId)}/damage-summary`,
      { headers: getAuthHeaders(), signal: controller.signal },
    );
    if (!response.ok) throw new Error(`damage-summary ${response.status}`);
    const body = (await response.json()) as { summary?: ServerDamageSummary };
    if (!body.summary) throw new Error('damage-summary missing summary');
    return body.summary;
  } finally {
    clearTimeout(timeout);
  }
}

/** The CombatSummaryMessage card shape, from a server damage summary. */
export function buildCombatSummaryMessageFromServer(
  summary: ServerDamageSummary,
): ChatMessage {
  return {
    text: 'Combat has ended.',
    sender: 'system',
    context: {
      combatData: {
        type: 'summary',
        summary: {
          rounds: summary.rounds,
          totalDamage: summary.totalDamage,
          participants: summary.participants.map((p) => ({
            name: p.name,
            damageDealt: p.damageDealt,
            damageTaken: p.damageTaken,
            status: p.status,
          })),
          outcome: 'Combat concluded',
        },
      },
    },
  };
}

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
 * Posts the summary for an ended encounter. A server-driven fight fetches the real damage
 * totals from the server (#570); anything else — a local manual-combat encounter, or a
 * failed or timed-out fetch — falls back to the in-memory encounter build.
 */
async function postCombatSummary(
  encounter: CombatEncounter | null | undefined,
  sendMessage: (message: ChatMessage) => unknown,
): Promise<void> {
  if (encounter?.origin === 'server' && encounter.id) {
    let summary: ServerDamageSummary | undefined;
    try {
      summary = await fetchCombatDamageSummary(encounter.id);
    } catch (error) {
      // A failed fetch must not silently produce a zero-damage summary (#570 D4-013):
      // log it so the fallback is visible in diagnostics.
      console.warn('[combat-summary] server damage-summary fetch failed, using in-memory fallback', error);
      // Fall through to the in-memory build below.
    }
    if (summary) {
      // The send stays outside the try: a throwing sendMessage after a good fetch must
      // not fall through and post the in-memory summary a second time.
      await sendMessage(buildCombatSummaryMessageFromServer(summary));
      return;
    }
  }
  await sendMessage(buildCombatSummaryMessage(encounter));
}

/**
 * "Combat has ended." is held until THIS fight's terminal message is in the transcript, so the
 * killing HIT reads before the summary (#2127). The terminal message is the DM reply that
 * narrates the end, or — for a fight the server ended through the combat intent endpoints,
 * where no DM turn runs — the terminal engine row/notice that presents the end (#976).
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
    void postCombatSummary(pending.encounter, sendMessageRef.current);
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
