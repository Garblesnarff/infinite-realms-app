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
 * account. Log lines carry ids only — never the email. Email matching is
 * exact, on the address WorkOS returns for this sign-in — the spec's
 * "exactly one row has this verified email", with no case folding.
 */
import { eq } from 'drizzle-orm';

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

/**
 * Re-link the account behind a WorkOS sign-in to its previous id, when the
 * sign-in's id is new and exactly one existing row carries its verified
 * email. Returns true when a re-link happened. Never throws on the ambiguous
 * cases — those are logged and left alone.
 */
export async function relinkWorkosAccountIfNeeded(user: WorkosSignInIdentity): Promise<boolean> {
  const byId = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (byId) return false;
  if (!user.emailVerified) return false;

  const matches = await db.query.users.findMany({ where: eq(users.email, user.email) });
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
  await db.transaction(async (tx) => {
    for (const move of ownedRowMoves(tx, oldId, user.id)) {
      await move();
    }
    await tx
      .update(users)
      .set({ id: user.id, updatedAt: new Date() })
      .where(eq(users.id, oldId));
  });
  logger.info({ msg: 'WORKOS_ACCOUNT_RELINKED', oldUserId: oldId, newUserId: user.id });
  return true;
}
