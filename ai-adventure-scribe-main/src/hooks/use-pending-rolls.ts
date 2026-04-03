/**
 * usePendingRolls Hook
 * Tracks pending dice roll requests in the message list
 */

import { useMemo } from 'react';

import { useMessageContext } from '@/contexts/MessageContext';
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

    // Find the most recent DM message
    const dmMessages = messages.filter((m) => m.sender === 'dm');
    if (dmMessages.length === 0) {
      return {
        hasPendingRolls: false,
        pendingRequests: [],
        lastDMMessage: null,
      };
    }

    const lastDMMessage = dmMessages[dmMessages.length - 1];

    // Check if there have been any player responses after the last DM message
    const lastDMMessageIndex = messages?.findIndex((m) => m === lastDMMessage) ?? -1;
    const playerResponsesAfter =
      lastDMMessageIndex >= 0
        ? (messages?.slice(lastDMMessageIndex + 1) ?? []).filter((m) => m.sender === 'player')
        : [];

    // Parse roll requests from the last DM message
    const rollRequests = parseRollRequests(lastDMMessage.text);

    // Check if the last player message overall was a dice roll
    // This handles the case where:
    //   1. DM requests roll
    //   2. Player rolls
    //   3. AI incorrectly requests ANOTHER roll (bug we're mitigating)
    // In step 3, playerResponsesAfter is empty (no messages after buggy AI response),
    // but lastPlayerMessage IS a dice roll, so we suppress the notification.
    //
    // Tradeoff: If AI correctly requests a NEW roll immediately after player rolls,
    // we'd briefly suppress that too. But the dice UI remains available, and once
    // the player takes any other action, normal behavior resumes.
    const playerMessages = messages.filter((m) => m.sender === 'player');
    const lastPlayerMessage =
      playerMessages.length > 0 ? playerMessages[playerMessages.length - 1] : null;

    // Detect dice roll patterns in player message
    const isDiceRollMessage = (msg: typeof lastPlayerMessage): boolean => {
      if (!msg) return false;
      if (msg.context?.intent === 'dice_roll') return true;
      const text = msg.text || '';
      return (
        /:\s*\d+\s*[✓✗]/u.test(text) || // "Perception: 15 ✓" or "Investigation: 7 ✗"
        /rolled?\s+\d+/i.test(text) || // "rolled 15" or "I roll 15"
        /\d+\s*[✓✗]/u.test(text) // "15 ✓" anywhere
      );
    };

    const wasJustDiceRoll = isDiceRollMessage(lastPlayerMessage);

    // Pending if: roll requests exist AND player hasn't responded with a dice roll
    // Two checks needed:
    //   1. wasJustDiceRoll - catches buggy "AI requests roll right after player rolled"
    //   2. playerResponsesAfter - catches normal "player rolled after DM requested"
    const hasPendingRolls =
      rollRequests.length > 0 &&
      !wasJustDiceRoll &&
      !playerResponsesAfter.some((msg) => isDiceRollMessage(msg));

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

  return {
    hasLatestPendingRoll: hasPendingRolls && pendingRequests.length > 0,
    latestPendingRoll: pendingRequests.length > 0 ? pendingRequests[0] : null,
  };
};
