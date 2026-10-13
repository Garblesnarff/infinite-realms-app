import React from 'react';

import { DyingPanel } from './DyingPanel';

import type { MessageSendContext } from '../../chat/MessageList';

import { useOptionalCombat } from '@/contexts/CombatContext';
import { participantVital } from '@/services/combat/participant-vital';
import {
  representPendingDeathSaveRoll,
  wasDeathSavePromptDismissed,
} from '@/services/combat/player-roll-bridge';

/** The player row the dying turn leaves in the story: the roll the player is about to make. */
export const DEATH_SAVE_TURN_TEXT = 'Death saving throw.';

export interface DyingComposerSlotProps {
  /** The message handler's send. The dying turn goes through it like every other turn. */
  onSendMessage: (message: string, context?: MessageSendContext) => Promise<void>;
  /** A turn is being answered: the engine and the DM are still working on the last one. */
  isProcessing: boolean;
  /** The roll prompt is open in the tray (it carries the Roll button and the countdown). */
  promptOpen: boolean;
  /** The composer, shown whenever the character is on their feet. */
  children: React.ReactNode;
}

/**
 * The composer, or — while the player's character is on the floor — the dying panel in its place
 * (#2518, spec §8 of #2520). It also starts the dying turn: when the order reaches a player at 0
 * HP with saves owed, it sends the one thing that turn holds, the death saving throw, so the
 * roll prompt opens on its own. Nothing the player types can reach the engine while they are
 * down: there is no composer to type in.
 *
 * Each (encounter, round, turn holder, tally) sends once. A turn that did not complete (a failed
 * send, a refused save) leaves the panel's Roll button to try again; it never loops.
 */
export const DyingComposerSlot: React.FC<DyingComposerSlotProps> = ({
  onSendMessage,
  isProcessing,
  promptOpen,
  children,
}) => {
  const combat = useOptionalCombat();
  const encounter =
    combat?.state.isInCombat && combat.state.activeEncounter?.phase === 'active'
      ? combat.state.activeEncounter
      : null;
  const player = encounter?.participants.find(
    (participant) => participant.participantType === 'player',
  );
  const vital = player ? participantVital(player) : 'standing';
  const isOwnTurn = Boolean(player && encounter?.currentTurnParticipantId === player.id);

  const turnKey =
    encounter && player && vital === 'dying' && isOwnTurn
      ? [
          encounter.id,
          encounter.currentRound,
          encounter.currentTurnParticipantId,
          player.deathSaves.successes,
          player.deathSaves.failures,
        ].join(':')
      : null;
  const sentKeyRef = React.useRef<string | null>(null);
  // #261 CB-025: the panel's Roll button is a retry path only. While the auto-send for the
  // current turn is in flight the button must not render at all — a click in that window
  // dispatched a duplicate turn the server's compare-and-set then refused. A send that
  // actually failed records its turn key here so the button comes back as the retry.
  const [failedKey, setFailedKey] = React.useState<string | null>(null);
  // Dismissing the death-save prompt is "not now", not "never" (RG-019): the bridge's 45 s
  // timer keeps running as the stall guard, and the Roll button stays visible so the player
  // can re-open the prompt and roll when ready. Keyed like failedKey so a new tally or a
  // settled turn clears it.
  const [dismissedKey, setDismissedKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!turnKey || isProcessing || promptOpen || sentKeyRef.current === turnKey) return;
    sentKeyRef.current = turnKey;
    setFailedKey(null);
    void onSendMessage(DEATH_SAVE_TURN_TEXT, { intent: 'death_save_turn' }).catch(() => {
      // The send queue reports its own failure; the panel's Roll button stays for a retry.
      setFailedKey(turnKey);
    });
  }, [turnKey, isProcessing, promptOpen, onSendMessage]);

  /** The panel button's retry: the one send allowed after the auto-send failed. */
  const retryDyingTurn = React.useCallback(() => {
    if (!turnKey || failedKey !== turnKey) return;
    setFailedKey(null);
    void onSendMessage(DEATH_SAVE_TURN_TEXT, { intent: 'death_save_turn' }).catch(() => {
      setFailedKey(turnKey);
    });
  }, [onSendMessage, turnKey, failedKey]);

  // After a dismiss the bridge still holds the waiting death-save prompt with its timer
  // running. Record this turn key so the Roll button stays visible until the tally changes,
  // the turn settles, or a new prompt is requested.
  React.useEffect(() => {
    if (turnKey && wasDeathSavePromptDismissed()) {
      setDismissedKey(turnKey);
    } else if (!turnKey) {
      setDismissedKey(null);
    }
  }, [turnKey, promptOpen, isProcessing]);

  /** The panel button after a dismiss: re-open the waiting prompt; the timer keeps running. */
  const rollAfterDismiss = React.useCallback(() => {
    if (!turnKey || dismissedKey !== turnKey) return;
    representPendingDeathSaveRoll();
  }, [turnKey, dismissedKey]);

  if (!player || (vital !== 'dying' && vital !== 'stable')) return <>{children}</>;

  // The Roll button is the retry for a failed send, not a second way to roll: it renders
  // only when this turn's auto-send actually failed — or when the player dismissed the
  // death-save prompt and can roll when ready (RG-019: dismiss alone never rolls).
  const retryFailedSend = turnKey !== null && failedKey === turnKey;
  const rollAfterDismissedPrompt = turnKey !== null && dismissedKey === turnKey;
  const onRoll = retryFailedSend
    ? retryDyingTurn
    : rollAfterDismissedPrompt
      ? rollAfterDismiss
      : undefined;

  return (
    <DyingPanel
      name={player.displayName ?? player.name}
      state={vital === 'stable' ? 'stable' : 'dying'}
      successes={player.deathSaves.successes}
      failures={player.deathSaves.failures}
      isOwnTurn={isOwnTurn}
      promptOpen={promptOpen}
      onRoll={onRoll}
    />
  );
};
