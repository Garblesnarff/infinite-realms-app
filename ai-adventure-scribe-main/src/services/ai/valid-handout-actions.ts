import { isHandoutAction } from './dm-response-schema';

import type { DMHandoutAction } from './dm-response-schema';

/** Keep only handout payloads that the session route's canonical parser accepts. */
export function filterValidHandoutActions(actions: unknown[]): {
  actions: DMHandoutAction[];
  dropped: number;
} {
  const validActions = actions.filter(isHandoutAction);
  return { actions: validActions, dropped: actions.length - validActions.length };
}
