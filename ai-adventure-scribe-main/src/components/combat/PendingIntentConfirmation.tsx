import React, { useMemo, useState } from 'react';

import type { CombatEncounter } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { userDataApi } from '@/services/user-data-api';
import { slugify } from '@/utils/slug';

interface PendingIntentConfirmationProps {
  encounter: CombatEncounter | null | undefined;
  onRefresh: () => Promise<CombatEncounter | null>;
  onSendFullMessage?: (message: string) => Promise<void>;
}

function matchesParticipant(
  participant: CombatEncounter['participants'][number],
  reference: string,
): boolean {
  return participant.id === reference || slugify(participant.name) === slugify(reference);
}

function isUnavailable(participant: CombatEncounter['participants'][number] | undefined): boolean {
  return Boolean(
    participant &&
    (participant.isActive === false ||
      participant.isDead ||
      participant.isUnconscious ||
      participant.currentHitPoints <= 0),
  );
}

/**
 * Presents the one pending player declaration when its actor reaches the current turn.
 *
 * The server has already stored the action and the current turn is server-owned. Strike first
 * atomically promotes that stored declaration, then sends its original text through the normal
 * DM/action pipeline. Do something else only clears the declaration; it never lets the DM invent
 * an outcome for the abandoned attack.
 */
export const PendingIntentConfirmation: React.FC<PendingIntentConfirmationProps> = ({
  encounter,
  onRefresh,
  onSendFullMessage,
}) => {
  const [busy, setBusy] = useState(false);

  const details = useMemo(() => {
    const pending = encounter?.pendingIntent;
    if (!encounter || !pending || encounter.currentTurnParticipantId !== pending.actorId) {
      return null;
    }
    const actor = encounter.participants.find((participant) =>
      matchesParticipant(participant, pending.actorId),
    );
    if (!actor || actor.participantType !== 'player') return null;
    const targets = pending.targetIds.map((targetId) =>
      encounter.participants.find((participant) => matchesParticipant(participant, targetId)),
    );
    // A target that disappeared from the authoritative roster is unavailable too. Never offer
    // Strike on a stale declaration just because the old slug no longer resolves to a row.
    const targetUnavailable = targets.some((target) => !target || isUnavailable(target));
    const targetName = targets.find(Boolean)?.name || pending.targetIds[0] || 'the declared target';
    return {
      pending,
      encounterId: encounter.id,
      targetName,
      targetUnavailable,
    };
  }, [encounter]);

  if (!details) return null;

  const actionLabel =
    details.pending.actionType === 'attack' ? 'strike' : details.pending.actionType;
  const targetStatus = details.targetUnavailable
    ? `${details.targetName} is no longer available as a target.`
    : `Your declared ${actionLabel} is ready.`;

  const clearIntent = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await userDataApi.clearPendingCombatIntent(details.encounterId);
      if (!response.ok) return;
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const promoteIntent = async (): Promise<void> => {
    const sendFullMessage = onSendFullMessage;
    if (details.targetUnavailable || !sendFullMessage) return;
    setBusy(true);
    try {
      const response = await userDataApi.promotePendingCombatIntent(details.encounterId);
      if (!response.ok) return;
      const payload = (await response.json().catch(() => null)) as {
        pendingIntent?: { sourceText?: string };
      } | null;
      const sourceText = payload?.pendingIntent?.sourceText || details.pending.sourceText;
      await onRefresh();
      await sendFullMessage(sourceText);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-xl border-2 border-infinite-gold/60 bg-card/95 p-4 shadow-lg"
      role="alert"
      aria-label="Pending combat action"
    >
      <p className="font-semibold text-card-foreground">{targetStatus}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {details.targetUnavailable
          ? 'Choose what to do instead.'
          : `Confirm ${actionLabel} against ${details.targetName}.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!details.targetUnavailable && (
          <Button
            type="button"
            variant="fantasy"
            disabled={busy || !onSendFullMessage}
            onClick={promoteIntent}
          >
            [Strike]
          </Button>
        )}
        <Button type="button" variant="outline" disabled={busy} onClick={clearIntent}>
          [Do something else]
        </Button>
      </div>
    </section>
  );
};
