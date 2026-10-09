import { isEngineChannelRollType } from './roll-request/engine-channel';

import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';

/** Intent of the system line saved when the player cancels a narrative roll (#2291). */
export const ROLL_DECLINED_INTENT = 'roll_declined';

/**
 * The transcript line for a cancelled narrative roll (#2291). It answers the DM's request the
 * way a roll would: the withheld reply shows, a reload does not re-open the popup, and the next
 * DM turn reads "System: You chose not to roll: …" in its history.
 */
export function declinedRollMessage(
  description: string | undefined,
  rollRequestId?: string,
): ChatMessage {
  return {
    text: `You chose not to roll: ${description?.trim() || 'the requested check'}.`,
    sender: 'system',
    timestamp: new Date().toISOString(),
    context: { intent: ROLL_DECLINED_INTENT, ...(rollRequestId ? { rollRequestId } : {}) },
  };
}

/**
 * How a later message answers a DM reply's roll requests (#2291 round 2):
 * - a dice-roll player message or a declined-roll line answers ONE request — a reply with two
 *   checks is queued as a batch and each check is rolled or cancelled on its own, in order;
 * - any other player message answers them ALL — the player moved on in their own words.
 */
function answerKind(message: ChatMessage): 'one' | 'all' | null {
  if (message.sender === 'player') return message.context?.intent === 'dice_roll' ? 'one' : 'all';
  if (message.sender === 'system' && message.context?.intent === ROLL_DECLINED_INTENT) return 'one';
  return null;
}

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

export function identifyDmRollRequests(requests: RollRequest[], messageKey: string): RollRequest[] {
  const identities = new Map<string, string>();
  return requests.map((request, index) => {
    // Legacy rows have no id. Match the existing queue's duplicate boundary once, then
    // carry that identity in the saved answer rather than matching result descriptions.
    const key = JSON.stringify([
      request.type,
      request.purpose,
      request.formula,
      request.advantage,
      request.disadvantage,
      request.dc,
      request.ac,
    ]);
    const rollRequestId =
      request.rollRequestId ?? identities.get(key) ?? `${messageKey}:roll:${index}`;
    identities.set(key, rollRequestId);
    return { ...request, rollRequestId };
  });
}

/** The requests of `messages[index]` still owed, in the order the batch asks for them. */
function unansweredRequestsAt(messages: readonly ChatMessage[], index: number): RollRequest[] {
  const message = messages[index];
  const requests = identifyDmRollRequests(
    narrativeRollRequestsOf(message),
    message.id ?? message.timestamp ?? `message-${index}`,
  );
  const owed = new Map(requests.map((request) => [request.rollRequestId!, request]));
  for (let later = index + 1; later < messages.length && owed.size > 0; later += 1) {
    const answer = messages[later];
    const kind = answerKind(answer);
    if (kind === 'all') return [];
    if (kind !== 'one') continue;
    if (answer.context?.rollRequestId) owed.delete(answer.context.rollRequestId);
    // Compatibility for answers written before request ids were persisted.
    else owed.delete(owed.keys().next().value!);
  }
  return Array.from(owed.values());
}

/**
 * DM replies whose prose must not be shown yet (#2280): the reply asked for narrative rolls and
 * at least one is still owed. Each dice-roll message or declined-roll line (#2291) answers one
 * request; any other player message answers all of them. The prose may already describe an
 * outcome the player has not rolled, so it appears only once every request is answered. The same
 * rule holds live and after a reload, because both read the saved rows.
 *
 * Also hides the text-less `pending_roll_request` rows #2250 tried to write; none were ever saved
 * (every one was refused with a 422), so that is only a guard.
 */
export function withheldDmRollReplies(messages: readonly ChatMessage[]): Set<ChatMessage> {
  const withheld = new Set<ChatMessage>();
  messages.forEach((message, index) => {
    if (message.sender !== 'dm') return;
    if (message.context?.intent === 'pending_roll_request') withheld.add(message);
    else if (unansweredRequestsAt(messages, index).length > 0) withheld.add(message);
  });
  return withheld;
}

/**
 * The requests still owed by the latest DM reply that asked for rolls. With a two-check batch
 * where the first was rolled or cancelled, that is the second check alone (#2291 round 2).
 */
export function latestUnansweredDmRollRequest(
  messages: readonly ChatMessage[],
): PendingDmRollRequest | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const requests = message.rollRequests ?? message.context?.rollRequests;
    if (message.sender !== 'dm' || !Array.isArray(requests) || requests.length === 0) continue;

    const owed = unansweredRequestsAt(messages, index);
    if (owed.length === 0) return null;
    return {
      messageKey: message.id ?? message.timestamp ?? `message-${index}`,
      requests: owed,
    };
  }
  return null;
}
