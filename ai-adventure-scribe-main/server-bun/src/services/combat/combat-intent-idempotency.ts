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
 * The claim protocol (FIX round: the first version only looked the stored
 * response up, so two requests with the same id that overlapped both ran —
 * a dropped socket while the server still works is the normal retry case,
 * and that is exactly when the overlap happens):
 *
 * 1. Before executing, the route claims the id: it inserts a PENDING row
 *    (`response` NULL, `claim_token` a UUID minted by the claimant). The
 *    primary key is the claim — the insert either wins the row or loses
 *    it, atomically.
 * 2. A second request that finds a pending row younger than
 *    `PENDING_TAKEOVER_AFTER_MS` gets a 409 (`resolveIntentClaim` returns
 *    `conflict`); the client waits a beat and retries with the same id,
 *    and by then the first delivery has usually stored its response.
 * 3. A pending row older than `PENDING_TAKEOVER_AFTER_MS` is taken over:
 *    the second request deletes it (only if still pending and still old —
 *    the delete is the atomic guard, and its staleness check runs on the
 *    DB clock via `now() - interval`, so an app/DB clock skew can never
 *    make a fresh row look stale) and claims the id itself. A first
 *    attempt that crashed or hung past 60 s therefore stops blocking its
 *    id, and a retry after a minute executes exactly once.
 * 4. After a successful commit the route fills the pending row with the
 *    response (`storeIntentResponse`); a retry after that replays it.
 *    The store and the release both carry the claim's `claim_token` as
 *    an owner token, so a first attempt that returns late — after a
 *    takeover owner re-claimed the id — can neither fill nor delete the
 *    owner's row: its store/release only touches the row its own claim
 *    created. (A `createdAt` timestamp cannot serve as the token:
 *    Postgres stores microseconds, a JS Date carries milliseconds, so
 *    the value read back never equals the stored value and the
 *    store/release WHERE matched zero rows.)
 * 5. If the execution itself is refused (a 4xx, pre-commit by
 *    construction), the route releases the claim (`releaseIntentClaim`
 *    deletes the pending row) so a retry can proceed immediately instead
 *    of 409ing for 60 s. A 5xx or a non-AppError throw leaves the row
 *    pending — the execution may have partially committed, and a retry
 *    must wait for the takeover window rather than re-execute at once.
 *    Only pending rows are ever deleted — a completed row is never
 *    released.
 *
 * Only successful (2xx) responses are stored — refusals (422/404) and
 * failures stay retryable, so a client can fix its payload and resubmit
 * with a fresh id. The store is best-effort by design: if the lookup or
 * the store fails, the route proceeds as if no id existed and the turn
 * still goes through; a failed cache degrades to no dedup, never to a
 * failed turn.
 *
 * Residuals, same as the DM reply cache (`session-message-service.ts`):
 * the store is not atomic with the execution — a crash in the window
 * between `executeCombatIntent` committing and the store landing means a
 * retry re-executes (bounded by the `expectedVersion` claims for
 * attacks/checks/spells; moves carry none). And a first attempt that hangs
 * past the 60 s takeover window can race the takeover owner into a second
 * execution. Both windows need the first attempt to be stuck for a minute;
 * execution is ~100 ms.
 */
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { combatIntentIdempotency } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';

// `db` is imported lazily, not at module top: `combat-intent-service.ts`
// does the same, so importing the intent routes stays safe for unit tests
// that run without a DATABASE_URL (the http suites). The lookup/store are
// best-effort — a failed import degrades to no dedup, never to a failed
// turn — so the dynamic import lives inside the existing try/catch.

const INTENT_REQUEST_ID_HEADER = 'x-request-id';

/** A client-supplied id longer than this is not a request id; ignore it. */
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * A pending claim older than this is taken over by the next request with
 * the same id. 60 s is far past the ~100 ms a healthy execution takes, so
 * a takeover means the first attempt crashed or hung — never a live one.
 */
export const PENDING_TAKEOVER_AFTER_MS = 60_000;

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

export type IntentClaim =
  | { status: 'proceed'; claimToken?: string }
  | { status: 'cached'; response: Record<string, unknown> }
  | { status: 'conflict' };

type ClaimAttempt =
  | { result: 'claimed'; claimToken: string }
  | { result: 'exists' | 'unavailable' };

async function tryClaimIntent(encounterId: string, requestId: string): Promise<ClaimAttempt> {
  try {
    const { db } = await import('../../../../db/client');
    const claimToken = crypto.randomUUID();
    const inserted = await db
      .insert(combatIntentIdempotency)
      .values({ encounterId, requestId, claimToken, response: null })
      .onConflictDoNothing({
        target: [combatIntentIdempotency.encounterId, combatIntentIdempotency.requestId],
      })
      .returning({
        requestId: combatIntentIdempotency.requestId,
      });
    const row = inserted[0];
    return row ? { result: 'claimed', claimToken } : { result: 'exists' };
  } catch (error) {
    logger.warn({
      msg: 'COMBAT_INTENT_IDEMPOTENCY_CLAIM_FAILED',
      encounterId,
      requestId,
      error,
    });
    return { result: 'unavailable' };
  }
}

type IntentRow = { response: Record<string, unknown> | null } | 'missing' | 'unavailable';

async function readIntentRow(encounterId: string, requestId: string): Promise<IntentRow> {
  try {
    const { db } = await import('../../../../db/client');
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
    if (!row) return 'missing';
    return { response: row.response };
  } catch (error) {
    logger.warn({
      msg: 'COMBAT_INTENT_IDEMPOTENCY_LOOKUP_FAILED',
      encounterId,
      requestId,
      error,
    });
    return 'unavailable';
  }
}

/**
 * Delete a stale pending row; true when this caller removed it. The
 * staleness check runs on the DB clock (`now() - interval`), not the app
 * clock, so a skew between the two can never make a fresh row look stale.
 */
async function takeOverStaleIntent(encounterId: string, requestId: string): Promise<boolean> {
  try {
    const { db } = await import('../../../../db/client');
    const deleted = await db
      .delete(combatIntentIdempotency)
      .where(
        and(
          eq(combatIntentIdempotency.encounterId, encounterId),
          eq(combatIntentIdempotency.requestId, requestId),
          isNull(combatIntentIdempotency.response),
          lt(
            combatIntentIdempotency.createdAt,
            sql`now() - make_interval(secs => ${PENDING_TAKEOVER_AFTER_MS / 1000})`,
          ),
        ),
      )
      .returning({ requestId: combatIntentIdempotency.requestId });
    return deleted.length > 0;
  } catch (error) {
    logger.warn({
      msg: 'COMBAT_INTENT_IDEMPOTENCY_TAKEOVER_FAILED',
      encounterId,
      requestId,
      error,
    });
    return false;
  }
}

/**
 * Claim this id for the caller's execution, replay a completed one, or
 * report that a live first attempt already holds it. The loop is bounded:
 * a claim lost to a takeover in the same instant re-reads once and then
 * answers 409 rather than executing a second time. A store that is
 * unavailable degrades to no dedup — the caller proceeds and the turn
 * still goes through.
 */
export async function resolveIntentClaim(
  encounterId: string,
  requestId: string,
): Promise<IntentClaim> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const claim = await tryClaimIntent(encounterId, requestId);
    if (claim.result === 'claimed') {
      return { status: 'proceed', claimToken: claim.claimToken };
    }
    if (claim.result === 'unavailable') return { status: 'proceed' };
    // The row exists. Try the takeover first: it only deletes a row that
    // is still pending and still old on the DB clock, so a completed row
    // and a fresh pending row both survive it untouched.
    if (await takeOverStaleIntent(encounterId, requestId)) continue;
    const row = await readIntentRow(encounterId, requestId);
    if (row === 'unavailable') return { status: 'proceed' };
    if (row === 'missing') continue;
    if (row.response && typeof row.response === 'object' && !Array.isArray(row.response)) {
      return { status: 'cached', response: row.response };
    }
    return { status: 'conflict' };
  }
  return { status: 'conflict' };
}

/**
 * Fill the caller's pending claim with the completed response, so a retry
 * replays it. Only fills the row this caller's own claim created: the
 * `claimToken` owner token (the UUID the claim minted) means a first
 * attempt that returns late — after a takeover owner re-claimed the id —
 * can never fill the owner's row. Best-effort — a failed store never fails
 * the turn; the pending row is then taken over after 60 s and a late
 * retry re-executes.
 */
export async function storeIntentResponse(
  encounterId: string,
  requestId: string,
  response: Record<string, unknown>,
  claimToken?: string,
): Promise<void> {
  try {
    const { db } = await import('../../../../db/client');
    await db
      .update(combatIntentIdempotency)
      .set({ response })
      .where(
        and(
          eq(combatIntentIdempotency.encounterId, encounterId),
          eq(combatIntentIdempotency.requestId, requestId),
          isNull(combatIntentIdempotency.response),
          ...(claimToken ? [eq(combatIntentIdempotency.claimToken, claimToken)] : []),
        ),
      );
  } catch (error) {
    logger.warn({
      msg: 'COMBAT_INTENT_IDEMPOTENCY_STORE_FAILED',
      encounterId,
      requestId,
      error,
    });
  }
}

/**
 * Release a pending claim after the execution was refused, so a retry can
 * proceed immediately instead of 409ing until the takeover window. Only
 * deletes the row this caller's own claim created (`claimToken` owner
 * token) — a completed response is never released, and neither is a
 * takeover owner's live row. Best-effort.
 */
export async function releaseIntentClaim(
  encounterId: string,
  requestId: string,
  claimToken?: string,
): Promise<void> {
  try {
    const { db } = await import('../../../../db/client');
    await db
      .delete(combatIntentIdempotency)
      .where(
        and(
          eq(combatIntentIdempotency.encounterId, encounterId),
          eq(combatIntentIdempotency.requestId, requestId),
          isNull(combatIntentIdempotency.response),
          ...(claimToken ? [eq(combatIntentIdempotency.claimToken, claimToken)] : []),
        ),
      );
  } catch (error) {
    logger.warn({
      msg: 'COMBAT_INTENT_IDEMPOTENCY_RELEASE_FAILED',
      encounterId,
      requestId,
      error,
    });
  }
}
