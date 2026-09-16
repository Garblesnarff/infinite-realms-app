import type {
  ClientCombatIntent,
  CombatRefusalDetails,
} from '@/services/combat/combat-action-executor';

import { logServerRequestId } from '@/infrastructure/api/request-id-log';
import { getAuthHeaders } from '@/services/auth/TokenService';
import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

/** The engine's answer to "what would this attack be?", as the popup needs to render it. */
export interface CombatAttackProposal {
  movementOnly: boolean;
  legal?: boolean;
  refusal?: string | null;
  weaponName?: string;
  attackBonus?: number;
  targetAc?: number;
  advantage?: boolean;
  disadvantage?: boolean;
  targetLabel?: string;
  requestedWeapon?: string | null;
  weaponSubstituted?: boolean;
}

/**
 * Asks the engine what an attack would be, without performing it.
 *
 * Used only on the player's own attacks, to fill the dice popup with the bonus, AC, and
 * advantage state the resolution will actually apply. Refusals are surfaced the same way
 * `executeAuthoritativeCombatIntent` surfaces them, so an out-of-turn or unresolvable proposal
 * is repairable by the same machinery that repairs a refused commit.
 */
export async function proposeAuthoritativeAttack(
  encounterId: string,
  intent: Extract<ClientCombatIntent, { type: 'attack' }>,
): Promise<CombatAttackProposal> {
  const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  const response = await fetch(
    `${API_BASE_URL}/v1/combat/${encodeURIComponent(encounterId)}/intent`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ intent, source: 'dm', phase: 'propose' }),
    },
  );
  logServerRequestId('/v1/combat', response);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new CombatIntentRefusedError(
      String(payload.error || `Attack proposal rejected (${response.status})`),
      response.status,
      (payload as { details?: CombatRefusalDetails }).details,
    );
  return payload.proposal as CombatAttackProposal;
}
