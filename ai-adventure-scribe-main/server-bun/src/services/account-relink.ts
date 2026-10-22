/**
 * #206 (M4): WorkOS environment switch — account re-link.
 *
 * `users.id` is the WorkOS user id. When prod moves from the staging WorkOS
 * environment to the production one, every returning user arrives with a NEW
 * WorkOS id while their rows still carry the old one. On sign-in, if no
 * `users` row has the new id but exactly one row has the email WorkOS
 * verified for this sign-in, that row and every row it owns move to the new
 * id in one transaction, so the player keeps their campaigns, characters and
 * history. More than one match (or an unverified email) moves nothing — the
 * sign-in proceeds as a fresh account, as it did before this step existed.
 *
 * The owned-column census below is the drizzle schema (db/schema) grepped for
 * every text column that stores a users.id: `user_id`, `characters.owner_id`,
 * `character_permissions.granted_by`, and the `created_by` columns of the
 * scene/vision tables. Two columns are deliberately NOT moved:
 * `blog_authors.user_id` and `tokens.created_by` are `uuid` (Supabase-era) and
 * cannot hold a WorkOS text id, so no row in them can belong to a WorkOS
 * account. Log lines carry ids only — never the email.
 *
 * Email identity is case-insensitive in this codebase (billing resolves
 * users with `lower(email) = lower(...)` for the same reason): the match
 * below compares lowered addresses, so an address whose case differs
 * between the two WorkOS environments still matches, and two legacy rows
 * differing only by case count as the ambiguous two, never as one match.
 *
 * Takeover guard: a verified-email match alone is not enough to move an
 * account. If the matched row's email went stale (the owner changed their
 * WorkOS email and never signed in again), a DIFFERENT WorkOS account that
 * later verifies that address would otherwise inherit the whole account.
 * So the move happens only when the old id no longer resolves as a user in
 * the WorkOS environment that issued this sign-in (`getUser` → not found):
 * at the environment cutover the old ids are staging ids and never resolve;
 * a still-live old id means the two accounts coexist, and nothing moves.
 * When liveness cannot be confirmed either way, nothing moves AND the step
 * must retry on the next sign-in — so that branch throws
 * (RelinkLivenessUnknownError) to make the callback skip its row-creating
 * upsert, exactly like a failed move; returning quietly would let the
 * upsert create the new id's row and seal the account behind it.
 *
 * Concurrency: the decision is re-validated inside the transaction (the
 * new id must still be row-less and the email must still match exactly the
 * same old row), and the users-row update must affect exactly one row. A
 * concurrent callback that linked or created the account first aborts this
 * one quietly (WORKOS_ACCOUNT_RELINK_SKIPPED_RACE) instead of rolling back
 * on a primary-key violation or logging a re-link that never happened.
 */
import { eq, sql } from 'drizzle-orm';

import {
  aiUsage,
  campaigns,
  characterFolders,
  characterPermissions,
  characters,
  feedback,
  fogOfWar,
  measurementTemplates,
  memoryExtractionJobs,
  sceneDrawings,
  scenes,
  sessionChronicles,
  users,
  visionBlockingShapes,
} from '../../../db/schema/index';
import { db } from '../lib/drizzle';
import { logger } from '../lib/logger';

import type { WorkOS } from '@workos-inc/node';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown inside the move transaction when a concurrent callback won the race. */
class RelinkRaceAbort extends Error {}

/**
 * Thrown when the takeover guard cannot confirm the old id is gone from
 * WorkOS (the liveness call failed some other way than not-found). The
 * callback treats it like any failed re-link: no fresh users row is
 * created, and the step retries on the next sign-in.
 */
export class RelinkLivenessUnknownError extends Error {}

/**
 * True when the error chain carries a unique-violation on the users
 * primary key — a concurrent callback created the new id's row between
 * this transaction's revalidation and its users-row update. That is a
 * lost race (the winner's own re-link ran first), not a data failure.
 */
function isUsersPkRace(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (
      e.code === '23505' &&
      typeof e.constraint_name === 'string' &&
      e.constraint_name.includes('users')
    ) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

/**
 * Every (table, column) update that moves one user's owned rows to a new id,
 * as thunks: building a drizzle query starts it, so each statement is only
 * constructed inside the transaction loop, immediately before it is awaited.
 */
function ownedRowMoves(tx: Tx, oldId: string, newId: string): (() => Promise<unknown>)[] {
  return [
    () => tx.update(campaigns).set({ userId: newId }).where(eq(campaigns.userId, oldId)),
    () => tx.update(characters).set({ userId: newId }).where(eq(characters.userId, oldId)),
    () => tx.update(characters).set({ ownerId: newId }).where(eq(characters.ownerId, oldId)),
    () =>
      tx.update(sessionChronicles).set({ userId: newId }).where(eq(sessionChronicles.userId, oldId)),
    () => tx.update(aiUsage).set({ userId: newId }).where(eq(aiUsage.userId, oldId)),
    () =>
      tx
        .update(characterPermissions)
        .set({ userId: newId })
        .where(eq(characterPermissions.userId, oldId)),
    () =>
      tx
        .update(characterPermissions)
        .set({ grantedBy: newId })
        .where(eq(characterPermissions.grantedBy, oldId)),
    () =>
      tx.update(characterFolders).set({ userId: newId }).where(eq(characterFolders.userId, oldId)),
    () => tx.update(feedback).set({ userId: newId }).where(eq(feedback.userId, oldId)),
    () => tx.update(fogOfWar).set({ userId: newId }).where(eq(fogOfWar.userId, oldId)),
    () =>
      tx
        .update(visionBlockingShapes)
        .set({ createdBy: newId })
        .where(eq(visionBlockingShapes.createdBy, oldId)),
    () =>
      tx
        .update(memoryExtractionJobs)
        .set({ userId: newId })
        .where(eq(memoryExtractionJobs.userId, oldId)),
    () => tx.update(scenes).set({ userId: newId }).where(eq(scenes.userId, oldId)),
    () =>
      tx.update(sceneDrawings).set({ createdBy: newId }).where(eq(sceneDrawings.createdBy, oldId)),
    () =>
      tx
        .update(measurementTemplates)
        .set({ createdBy: newId })
        .where(eq(measurementTemplates.createdBy, oldId)),
  ];
}

export interface WorkosSignInIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
}

/** True only when the WorkOS error positively says "no such user". */
function isWorkosNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; status?: unknown };
  return e.name === 'NotFoundException' || e.status === 404;
}

/** The users rows carrying this email, compared case-insensitively. */
async function findUsersByEmail(
  run: Pick<typeof db, 'query'>,
  email: string,
): Promise<{ id: string }[]> {
  return run.query.users.findMany({
    where: sql`lower(${users.email}) = lower(${email})`,
    columns: { id: true },
  });
}

/**
 * Re-link the account behind a WorkOS sign-in to its previous id, when the
 * sign-in's id is new and exactly one existing row carries its verified
 * email. Returns true when a re-link happened. Never throws on the ambiguous
 * cases — those are logged and left alone. Throws on real failures
 * (database, transaction) and on unconfirmable old-id liveness
 * (RelinkLivenessUnknownError), so the caller can avoid sealing the account
 * behind a freshly created row (see the auth callback).
 */
export async function relinkWorkosAccountIfNeeded(
  user: WorkosSignInIdentity,
  client: Pick<WorkOS, 'userManagement'>,
): Promise<boolean> {
  const byId = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (byId) return false;
  if (!user.emailVerified) return false;

  const matches = await findUsersByEmail(db, user.email);
  if (matches.length === 0) return false;
  if (matches.length > 1) {
    logger.warn({
      msg: 'WORKOS_ACCOUNT_RELINK_SKIPPED_AMBIGUOUS_EMAIL',
      newUserId: user.id,
      matchCount: matches.length,
    });
    return false;
  }

  const oldId = matches[0].id;

  // Takeover guard (see the header): move only when the old id is confirmed
  // gone from the WorkOS environment that issued this sign-in. A live old id
  // — or a liveness check that errors any other way — moves nothing. The
  // check is a network call, so it runs before the transaction opens; the
  // transaction re-validates the database state it depends on.
  let oldIdStillLive: boolean;
  try {
    await client.userManagement.getUser(oldId);
    oldIdStillLive = true;
  } catch (error) {
    if (!isWorkosNotFound(error)) {
      logger.warn({
        msg: 'WORKOS_ACCOUNT_RELINK_SKIPPED_OLD_ID_LIVENESS_UNKNOWN',
        oldUserId: oldId,
        newUserId: user.id,
      });
      throw new RelinkLivenessUnknownError(`liveness unconfirmed for old id ${oldId}`);
    }
    oldIdStillLive = false;
  }
  if (oldIdStillLive) {
    logger.warn({
      msg: 'WORKOS_ACCOUNT_RELINK_SKIPPED_OLD_ID_STILL_ACTIVE',
      oldUserId: oldId,
      newUserId: user.id,
    });
    return false;
  }

  try {
    await db.transaction(async (tx) => {
      const nowById = await tx.query.users.findFirst({ where: eq(users.id, user.id) });
      if (nowById) throw new RelinkRaceAbort();
      const nowMatches = await findUsersByEmail(tx, user.email);
      if (nowMatches.length !== 1 || nowMatches[0].id !== oldId) throw new RelinkRaceAbort();

      for (const move of ownedRowMoves(tx, oldId, user.id)) {
        await move();
      }
      const updated = await tx
        .update(users)
        .set({ id: user.id, updatedAt: new Date() })
        .where(eq(users.id, oldId))
        .returning({ id: users.id });
      if (updated.length !== 1) throw new RelinkRaceAbort();
    });
  } catch (error) {
    if (error instanceof RelinkRaceAbort || isUsersPkRace(error)) {
      logger.warn({
        msg: 'WORKOS_ACCOUNT_RELINK_SKIPPED_RACE',
        oldUserId: oldId,
        newUserId: user.id,
      });
      return false;
    }
    throw error;
  }
  logger.info({ msg: 'WORKOS_ACCOUNT_RELINKED', oldUserId: oldId, newUserId: user.id });
  return true;
}
