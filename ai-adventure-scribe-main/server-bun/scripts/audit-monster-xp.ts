#!/usr/bin/env bun
/**
 * #374 item 4 — no-XP audit.
 *
 * Lists authored campaign stat blocks that carry no explicit XP value.
 * A missing XP on a new campaign is a content error: at seating the award falls
 * back to the DMG difficulty threshold and logs COMBAT_XP_FALLBACK instead of the
 * exact 2014 sum. Existing campaigns are list-only here; content fixes are separate.
 *
 * Usage:
 *   DATABASE_URL=... bun scripts/audit-monster-xp.ts <campaign-id> [<campaign-id>...]
 *   DATABASE_URL=... bun scripts/audit-monster-xp.ts --all
 *
 * Exit 0 when the audit completes (it is a listing). Pass --strict to exit 1
 * when any block lacks XP, for gating new-campaign content in CI.
 * Requires DATABASE_URL (the db client throws at import without it).
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '../../db/client';
import { campaignChunks } from '../../db/schema/index';
import {
  buildCampaignMonsterIndex,
  findBlocksMissingXp,
  type MissingXpBlock,
} from '../src/services/combat/campaign-monster-index.js';
import { STAT_BEARING_CHUNK_TYPES } from '../src/services/combat/campaign-monster-resolution.js';

export type { MissingXpBlock };
export { findBlocksMissingXp };

async function auditCampaign(campaignId: string): Promise<MissingXpBlock[]> {
  const rows = await db
    .select({
      entityName: campaignChunks.entityName,
      chunkType: campaignChunks.chunkType,
      content: campaignChunks.content,
    })
    .from(campaignChunks)
    .where(
      and(
        eq(campaignChunks.campaignId, campaignId),
        inArray(campaignChunks.chunkType, [...STAT_BEARING_CHUNK_TYPES]),
        isNotNull(campaignChunks.entityName),
      ),
    );
  const index = buildCampaignMonsterIndex(
    campaignId,
    rows.flatMap((r) =>
      r.entityName === null
        ? []
        : [{ entityName: r.entityName, chunkType: r.chunkType, content: r.content }],
    ),
  );
  return findBlocksMissingXp(index);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const ids = args.filter((a) => a !== '--strict' && a !== '--all');

  let campaignIds = ids;
  if (args.includes('--all') || campaignIds.length === 0) {
    const rows = await db
      .selectDistinct({ campaignId: campaignChunks.campaignId })
      .from(campaignChunks);
    campaignIds = rows.map((r) => r.campaignId);
  }

  let total = 0;
  for (const id of campaignIds) {
    const missing = await auditCampaign(id);
    for (const m of missing) {
      console.log(
        `NO_XP  campaign=${m.campaignId} entity="${m.entityName}" chunk=${m.chunkType} coverage=${m.coverage}`,
      );
    }
    total += missing.length;
  }
  console.log(`audit-monster-xp: ${total} stat block(s) without XP across ${campaignIds.length} campaign(s)`);
  if (strict && total > 0) process.exit(1);
}

// Only run when executed directly (bun script.ts), not when imported.
if (import.meta.main) {
  await main();
}
