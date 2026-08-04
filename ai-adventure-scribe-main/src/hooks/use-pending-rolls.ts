/**
 * usePendingRolls Hook
 * Tracks pending dice roll requests in the message list
 */

import { useMemo } from 'react';

import type { RollRequest } from '@/types/roll-request';

import { useMessageContext } from '@/contexts/MessageContext';
import { parseMessageOptions } from '@/utils/parseMessageOptions';
import { parseRollRequests } from '@/utils/rollRequestParser';

/**
 * Hook to detect if there are pending dice roll requests
 * Returns true if the last DM message contains unresolved roll requests
 */
export const usePendingRolls = () => {
  const { messages } = useMessageContext();

  const pendingRolls = useMemo(() => {
    if (!messages || messages.length === 0) {
      return {
        hasPendingRolls: false,
        pendingRequests: [],
        lastDMMessage: null,
      };
    }

    // ⚡ Bolt: Optimized to find messages in a single O(N) backward pass instead of multiple filters
    let lastDMMessage = null;
    let lastPlayerMessage = null;
    let hasPlayerDiceRollAfterLastDM = false;

    // Detect dice roll patterns in player message
    const isDiceRollMessage = (msg: (typeof messages)[0] | null): boolean => {
      if (!msg) return false;
      if (msg.context?.intent === 'dice_roll') return true;
      const text = msg.text || '';
      return (
        /:\s*\d+\s*[✓✗]/u.test(text) || // "Perception: 15 ✓" or "Investigation: 7 ✗"
        /rolled?\s+\d+/i.test(text) || // "rolled 15" or "I roll 15"
        /\d+\s*[✓✗]/u.test(text) // "15 ✓" anywhere
      );
    };

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (msg.sender === 'player') {
        const isRoll = isDiceRollMessage(msg);
        if (!lastPlayerMessage) {
          lastPlayerMessage = msg;
        }
        if (!lastDMMessage && isRoll) {
          // Since we are going backwards and haven't hit a DM message yet,
          // this player message is chronologically AFTER the last DM message.
          hasPlayerDiceRollAfterLastDM = true;
        }
      } else if (msg.sender === 'dm' && !lastDMMessage) {
        lastDMMessage = msg;
      }

      // We can stop once we've found the last DM message AND the last player message
      if (lastDMMessage && lastPlayerMessage) break;
    }

    if (!lastDMMessage) {
      return {
        hasPendingRolls: false,
        pendingRequests: [],
        lastDMMessage: null,
      };
    }

    // Prefer the structured roll requests the message was persisted with (see
    // EnhancedChatMessage.rollRequests, populated by processRollRequests()). Only fall back to
    // the regex prose parser for older messages that predate the structured field — and even
    // then, strip action options first. Option text routinely contains combat-shaped language
    // ("wield the shimmering cleaver", "confront Balthazar") that the prose parser misreads as a
    // real roll request, manufacturing a phantom pending-roll banner that disables chat input.
    // See #1658.
    const dmMessage = lastDMMessage as (typeof messages)[0] & { rollRequests?: RollRequest[] };
    const rollRequests =
      dmMessage.rollRequests ?? parseRollRequests(parseMessageOptions(lastDMMessage.text).content);

    // Check if the last player message overall was a dice roll (mitigates buggy AI re-requesting)
    const wasJustDiceRoll = isDiceRollMessage(lastPlayerMessage);

    // Pending if: roll requests exist AND player hasn't responded with a dice roll
    const hasPendingRolls =
      rollRequests.length > 0 && !wasJustDiceRoll && !hasPlayerDiceRollAfterLastDM;

    return {
      hasPendingRolls,
      pendingRequests: hasPendingRolls ? rollRequests : [],
      lastDMMessage: hasPendingRolls ? lastDMMessage : null,
    };
  }, [messages]);

  return pendingRolls;
};

/**
 * Hook to get the most recent pending roll request
 */
export const useLatestPendingRoll = () => {
  const { hasPendingRolls, pendingRequests } = usePendingRolls();

  return useMemo(
    () => ({
      hasLatestPendingRoll: hasPendingRolls && pendingRequests.length > 0,
      latestPendingRoll: pendingRequests.length > 0 ? pendingRequests[0] : null,
    }),
    [hasPendingRolls, pendingRequests],
  );
};
