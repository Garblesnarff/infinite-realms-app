import {
  buildStructuredCombatStartPayload,
  type StructuredCombatResponse,
} from './structured-combat-payload';

import { userDataApi } from '@/services/user-data-api';

export { buildStructuredCombatStartPayload };
export type { StructuredCombatResponse };

export async function startStructuredCombatTransition(
  sessionId: string,
  character: Record<string, unknown>,
  response: StructuredCombatResponse,
): Promise<Response | null> {
  const payload = buildStructuredCombatStartPayload(character, response);
  return payload ? userDataApi.startStructuredCombat(sessionId, payload) : null;
}
