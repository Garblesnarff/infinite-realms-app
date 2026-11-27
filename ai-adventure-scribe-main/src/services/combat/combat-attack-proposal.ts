import type {
  ClientCombatIntent,
  CombatRefusalDetails,
} from '@/services/combat/combat-action-executor';

import { logServerRequestId } from '@/infrastructure/api/request-id-log';
import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';

/** The engine's answer to "what would this attack be?", as the popup needs to render it. */
export interface CombatAttackProposal {
  movementOnly: boolean;
  legal?: boolean;
  refusal?: string | null;
  weaponName?: string;
  attackBonus?: number;
  bless?: boolean;
  targetAc?: number;
  baseAc?: number;
  coverBonus?: number;
  advantage?: boolean;
  disadvantage?: boolean;
  advantageSources?: string[];
  disadvantageSources?: string[];
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
  // #1787 (strategist FIX round 2): no idempotency key here — the server
  // returns a proposal before the route's dedup lookup (intents.ts), so a
  // key would be ignored, not honoured. The retry on a network blip comes
  // from the gate's explicit propose allowlist (rest-client.ts). Known
  // exception (#1802): a non-off-hand melee proposal can move the actor
  // and append a DM tactical fact, so a retry can duplicate the fact.
  // (The window.fetch wrapper in main.tsx still stamps a fresh
  // per-attempt x-request-id on the wire; that is observability, not
  // dedup — the server ignores propose keys and it is never resent.)
  const response = await fetchWithAuth(`/v1/combat/${encodeURIComponent(encounterId)}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, source: 'dm', phase: 'propose' }),
  });
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

/** The engine's answer to "what would this spell be?" (#2233). */
export interface CombatSpellProposal {
  movementOnly: false;
  spellId: string;
  spellName: string;
  kind: 'attack' | 'save' | 'auto-hit';
  attackBonus: number;
  bless?: boolean;
  saveDC: number;
  targetAc: number;
  advantage: boolean;
  disadvantage: boolean;
  advantageSources?: string[];
  disadvantageSources?: string[];
  targetLabel?: string;
}

/**
 * Asks the engine what a spell cast would be, without casting it. The popup reads the spell's
 * name, attack bonus, and target AC from here, so it can only ever offer the spell the engine
 * will resolve, at the bonus the engine will add. A spell the caster does not have is refused
 * here, before any dialog opens.
 */
export async function proposeAuthoritativeSpell(
  encounterId: string,
  intent: Extract<ClientCombatIntent, { type: 'spell' }>,
): Promise<CombatSpellProposal> {
  // #1787 (strategist FIX round 2): no idempotency key here — the server
  // returns a proposal before the route's dedup lookup (intents.ts), so a
  // key would be ignored, not honoured. The retry on a network blip comes
  // from the gate's explicit propose allowlist (rest-client.ts).
  // (The window.fetch wrapper in main.tsx still stamps a fresh
  // per-attempt x-request-id on the wire; that is observability, not
  // dedup — the server ignores propose keys and it is never resent.)
  const response = await fetchWithAuth(`/v1/combat/${encodeURIComponent(encounterId)}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, source: 'dm', phase: 'propose' }),
  });
  logServerRequestId('/v1/combat', response);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new CombatIntentRefusedError(
      String(payload.error || `Spell proposal rejected (${response.status})`),
      response.status,
      (payload as { details?: CombatRefusalDetails }).details,
    );
  return payload.proposal as CombatSpellProposal;
}
