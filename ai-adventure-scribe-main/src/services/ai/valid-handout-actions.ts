import { isHandoutAction, MAX_HANDOUT_ACTIONS_PER_REQUEST } from './dm-response-schema';

import type { DMHandoutAction } from './dm-response-schema';

/**
 * Keep only handout payloads that the session route's canonical parser accepts.
 * The route also caps a request at MAX_HANDOUT_ACTIONS_PER_REQUEST actions, so
 * a longer valid batch is trimmed to the first N and the rest count as dropped
 * (the caller logs the drop) instead of sending a batch the route 422s.
 */
export function filterValidHandoutActions(actions: unknown[]): {
  actions: DMHandoutAction[];
  dropped: number;
} {
  const validActions = actions.filter(isHandoutAction);
  const actionsToSend = validActions.slice(0, MAX_HANDOUT_ACTIONS_PER_REQUEST);
  return { actions: actionsToSend, dropped: actions.length - actionsToSend.length };
}
