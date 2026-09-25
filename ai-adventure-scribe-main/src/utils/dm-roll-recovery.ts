import { isEngineChannelRollType } from './roll-request/engine-channel';

import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';

export interface PendingDmRollRequest {
  messageKey: string;
  requests: RollRequest[];
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

  const rawRequests = requestMessage.rollRequests ?? requestMessage.context?.rollRequests ?? [];
  const requests = rawRequests.filter(
    (request): request is RollRequest =>
      !!request && typeof request.type === 'string' && !isEngineChannelRollType(request.type),
  );
  if (requests.length === 0) return null;

  return {
    messageKey: requestMessage.id ?? requestMessage.timestamp ?? `message-${requestIndex}`,
    requests,
  };
}
