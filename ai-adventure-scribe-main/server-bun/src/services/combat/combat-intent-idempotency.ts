/**
 * #51: server-side dedup for retried combat-intent POSTs.
 *
 * The client mints one `x-request-id` per intent submission
 * (`combat-action-executor.ts`) and resends it on a retry. The first
 * delivery executes and its response is stored here; a retry with the same
 * id returns the stored response without re-executing, so a dropped
 * response can never double-apply the intent (a second Dash, a second
 * attack roll, a second spell slot).
 *
 * Only successful (2xx) responses are stored — refusals (422/404) and
 * failures stay retryable, so a client can fix its payload and resubmit
 * with a fresh id. The store is best-effort by design: if the lookup or
 * the store fails, the route proceeds as if no id existed and the turn
 * still goes through; a failed cache degrades to no dedup, never to a
 * failed turn.
 *
 * Deliberate limit, same as the DM reply cache (`session-message-service.ts`):
 * no in-flight mutex. The id is minted once per client call and retries
 * are sequential, so a concurrent same-id duplicate cannot arise from the
 * retry path; two genuinely concurrent same-id submissions would both
 * execute and the second store is a no-op. The store is also not atomic
 * with the execution: a crash (or a lost response) in the window between
 * `executeCombatIntent` committing and the store landing means a retry
 * re-executes. The lost-response case is covered — the store is awaited
 * before the response is returned — but a retry landing while the first
 * attempt is still executing is not: it misses the cache and re-executes.
 * Attacks, checks, and spells are bounded there by their `expectedVersion`
 * claims (a duplicate is refused), but moves are not — a move carries no
 * `expectedVersion` in either dialect, and a re-executed move succeeds
 * with cost 0 and records a second identical "moved to" DM fact. The
 * window is narrow (the retry delay is 1 s; execution is ~100 ms) and is
 * accepted as a residual: closing it needs a pending-row claim or a
 * versioned move, both bigger than this item.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { combatIntentIdempotency } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';

const INTENT_REQUEST_ID_HEADER = 'x-request-id';

/** A client-supplied id longer than this is not a request id; ignore it. */
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * The client-supplied idempotency key for this submission, or `undefined`
 * when the client sent none. Reads the header directly: the pipeline's
 * `requestIdOf` returns a server-generated UUID when no header is present,
 * and that UUID must never become a dedup key — no client will ever resend
 * it, so a row keyed by it could never be replayed. Only a header the
 * client actually sent dedupes.
 */
export function clientRequestIdOf(request: Request): string | undefined {
  const raw = request.headers.get(INTENT_REQUEST_ID_HEADER)?.trim();
  if (!raw || raw.length > MAX_REQUEST_ID_LENGTH) return undefined;
  return raw;
}

export async function getCachedIntentResponse(
  encounterId: string,
  requestId: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const [row] = await db
      .select({ response: combatIntentIdempotency.response })
      .from(combatIntentIdempotency)
      .where(
        and(
          eq(combatIntentIdempotency.encounterId, encounterId),
          eq(combatIntentIdempotency.requestId, requestId),
        ),
      )
      .limit(1);
    const response = row?.response;
    return response && typeof response === 'object' && !Array.isArray(response)
      ? response
      : undefined;
  } catch (error) {
    logger.warn({
      msg: 'COMBAT_INTENT_IDEMPOTENCY_LOOKUP_FAILED',
      encounterId,
      requestId,
      error,
    });
    return undefined;
  }
}

export async function storeIntentResponse(
  encounterId: string,
  requestId: string,
  response: Record<string, unknown>,
): Promise<void> {
  try {
    await db
      .insert(combatIntentIdempotency)
      .values({ encounterId, requestId, response })
      .onConflictDoNothing({
        target: [combatIntentIdempotency.encounterId, combatIntentIdempotency.requestId],
      });
  } catch (error) {
    logger.warn({
      msg: 'COMBAT_INTENT_IDEMPOTENCY_STORE_FAILED',
      encounterId,
      requestId,
      error,
    });
  }
}
