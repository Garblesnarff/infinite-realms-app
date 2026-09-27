import { isEngineChannelRollType } from './roll-request/engine-channel';

import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';

export interface PendingDmRollRequest {
  messageKey: string;
  requests: RollRequest[];
}

/**
 * The narrative roll requests a DM row carries. Engine-owned `attack` and `initiative` requests
 * are dropped: the engine prompts for those dice itself.
 */
function narrativeRollRequestsOf(message: ChatMessage): RollRequest[] {
  if (message.sender !== 'dm') return [];
  const raw = message.rollRequests ?? message.context?.rollRequests;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (request): request is RollRequest =>
      !!request && typeof request.type === 'string' && !isEngineChannelRollType(request.type),
  );
}

/**
 * DM replies whose prose must not be shown yet (#2280): the reply asked for a narrative roll and
 * no player message follows it, so the roll is unanswered. Its prose may already describe an
 * outcome the player has not rolled; it appears once the roll (or any later player message)
 * lands. The same rule holds live and after a reload, because both read the saved row.
 *
 * Also hides the text-less `pending_roll_request` rows #2250 tried to write; none were ever saved
 * (every one was refused with a 422), so that is only a guard.
 */
export function withheldDmRollReplies(messages: readonly ChatMessage[]): Set<ChatMessage> {
  const withheld = new Set<ChatMessage>();
  let answered = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender === 'player') {
      answered = true;
      continue;
    }
    if (message.sender === 'dm' && message.context?.intent === 'pending_roll_request') {
      withheld.add(message);
      continue;
    }
    if (!answered && narrativeRollRequestsOf(message).length > 0) withheld.add(message);
  }
  return withheld;
}

/**
 * Returns narrative roll requests from the latest DM request that has no later player message.
 * A later player message means the player moved on, even when it was not formatted as a die roll.
 */
export function latestUnansweredDmRollRequest(
  messages: readonly ChatMessage[],
): PendingDmRollRequest | null {
  let requestIndex = -1;
  let requestMessage: ChatMessage | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const requests = message.rollRequests ?? message.context?.rollRequests;
    if (message.sender === 'dm' && Array.isArray(requests) && requests.length > 0) {
      requestIndex = index;
      requestMessage = message;
      break;
    }
  }

  if (
    !requestMessage ||
    messages.slice(requestIndex + 1).some((message) => message.sender === 'player')
  ) {
    return null;
  }

  const requests = narrativeRollRequestsOf(requestMessage);
  if (requests.length === 0) return null;

  return {
    messageKey: requestMessage.id ?? requestMessage.timestamp ?? `message-${requestIndex}`,
    requests,
  };
}
