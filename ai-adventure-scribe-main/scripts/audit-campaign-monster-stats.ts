#!/usr/bin/env bun
/* eslint-disable max-lines -- report formatting, as with the sibling audit/backfill scripts */
/**
 * Coverage audit for campaign-authored monster stat blocks.
 *
 * 163 campaign bibles is a content migration, and a parser with a silent 80% success rate
 * means 20% of creatures still fight at 11 HP with nobody finding out until a paying player
 * meets one. This script runs the SAME parser combat runs — no second implementation that
 * could drift — across every campaign in `campaign_chunks` and turns that into a fixable
 * list instead of a surprise.
 *
 * Usage:
 *
 *     cd ai-adventure-scribe-main
 *     DATABASE_URL=postgres://... bun scripts/audit-campaign-monster-stats.ts
 *
 * Options:
 *     --campaign <id>   audit a single campaign
 *     --json            emit machine-readable JSON instead of the text report
 *     --quiet           summary and failures only; skip the per-creature listing
 *
 * Exit code is 0 even when creatures fail to parse: this is a reporting tool, and a
 * non-zero exit would make it useless in the very situation it exists to describe.
 */
import { asc, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema/index';
import {
  gradeCoverage,
  parseAuthoredStatBlock,
  type AuthoredStatField,
  type ParseCoverage,
} from '../server-bun/src/services/combat/authored-stat-block-parser.ts';

const STAT_BEARING_CHUNK_TYPES = ['monster', 'encounter'] as const;

/** Chunk types a bible might file a creature under WITHOUT combat ever reading them. */
const NARRATIVE_CREATURE_TYPES = ['npc_tier1', 'npc_tier2', 'npc_tier3'] as const;

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Point it at the database holding campaign_chunks.');
  process.exit(2);
}

const client = postgres(connectionString, { max: 2, onnotice: () => {} });
const db = drizzle(client, { schema });

interface CreatureReport {
  campaignId: string;
  entityName: string;
  chunkType: string;
  coverage: ParseCoverage;
  parsedFields: AuthoredStatField[];
  unparsedLabels: string[];
  maxHp?: number;
  armorClass?: number;
}

interface CampaignReport {
  campaignId: string;
  title: string | null;
  chunkCount: number;
  full: number;
  partial: number;
  none: number;
  creatures: CreatureReport[];
  /** Creatures filed under an NPC tier that combat does not read. Content-taxonomy gap. */
  narrativeOnlyCreatureCount: number;
}

const singleCampaign = option('--campaign');

const campaignRows = await db
  .select({ id: schema.starterCampaigns.id, title: schema.starterCampaigns.title })
  .from(schema.starterCampaigns)
  .orderBy(asc(schema.starterCampaigns.id));

const campaigns = singleCampaign
  ? campaignRows.filter((row) => row.id === singleCampaign)
  : campaignRows;

if (campaigns.length === 0) {
  console.error(
    singleCampaign ? `No campaign with id "${singleCampaign}".` : 'No campaigns found.',
  );
  await client.end();
  process.exit(2);
}

const chunkRows = await db
  .select({
    campaignId: schema.campaignChunks.campaignId,
    entityName: schema.campaignChunks.entityName,
    chunkType: schema.campaignChunks.chunkType,
    content: schema.campaignChunks.content,
  })
  .from(schema.campaignChunks)
  .where(
    inArray(schema.campaignChunks.chunkType, [
      ...STAT_BEARING_CHUNK_TYPES,
      ...NARRATIVE_CREATURE_TYPES,
    ]),
  );

const byCampaign = new Map<string, CampaignReport>();
for (const campaign of campaigns) {
  byCampaign.set(campaign.id, {
    campaignId: campaign.id,
    title: campaign.title,
    chunkCount: 0,
    full: 0,
    partial: 0,
    none: 0,
    creatures: [],
    narrativeOnlyCreatureCount: 0,
  });
}

for (const row of chunkRows) {
  const report = byCampaign.get(row.campaignId);
  if (!report || !row.entityName) continue;

  const isStatBearing = (STAT_BEARING_CHUNK_TYPES as readonly string[]).includes(row.chunkType);
  const parsed = parseAuthoredStatBlock(row.content);
  const coverage = gradeCoverage(parsed);

  if (!isStatBearing) {
    // An NPC-tier chunk that nevertheless carries real stats is a taxonomy bug worth naming:
    // combat will never read it, so that creature fights generic no matter how good the parser.
    if (coverage !== 'none') report.narrativeOnlyCreatureCount += 1;
    continue;
  }

  report.chunkCount += 1;
  report[coverage] += 1;
  report.creatures.push({
    campaignId: row.campaignId,
    entityName: row.entityName,
    chunkType: row.chunkType,
    coverage,
    parsedFields: parsed.parsedFields,
    unparsedLabels: parsed.unparsedLabels,
    maxHp: parsed.maxHp,
    armorClass: parsed.armorClass,
  });
}

const reports = [...byCampaign.values()];
const totals = reports.reduce(
  (acc, report) => ({
    chunkCount: acc.chunkCount + report.chunkCount,
    full: acc.full + report.full,
    partial: acc.partial + report.partial,
    none: acc.none + report.none,
    narrativeOnly: acc.narrativeOnly + report.narrativeOnlyCreatureCount,
  }),
  { chunkCount: 0, full: 0, partial: 0, none: 0, narrativeOnly: 0 },
);

if (flag('--json')) {
  console.log(JSON.stringify({ totals, campaigns: reports }, null, 2));
  await client.end();
  process.exit(0);
}

const pct = (n: number, total: number): string =>
  total === 0 ? '  n/a' : `${((n / total) * 100).toFixed(1).padStart(5)}%`;

console.log('Campaign monster stat coverage');
console.log('='.repeat(78));
console.log(
  `${'campaign'.padEnd(38)} ${'chunks'.padStart(6)} ${'full'.padStart(5)} ${'part'.padStart(5)} ${'none'.padStart(5)}`,
);
console.log('-'.repeat(78));

const withoutAnyStatChunks: CampaignReport[] = [];
for (const report of reports.sort((a, b) => a.campaignId.localeCompare(b.campaignId))) {
  if (report.chunkCount === 0) withoutAnyStatChunks.push(report);
  console.log(
    `${report.campaignId.slice(0, 38).padEnd(38)} ${String(report.chunkCount).padStart(6)} ${String(report.full).padStart(5)} ${String(report.partial).padStart(5)} ${String(report.none).padStart(5)}`,
  );
}

console.log('-'.repeat(78));
console.log(
  `${'TOTAL'.padEnd(38)} ${String(totals.chunkCount).padStart(6)} ${String(totals.full).padStart(5)} ${String(totals.partial).padStart(5)} ${String(totals.none).padStart(5)}`,
);
console.log(
  `\nfully parsed ${pct(totals.full, totals.chunkCount)}   partial ${pct(totals.partial, totals.chunkCount)}   unparsed ${pct(totals.none, totals.chunkCount)}`,
);

const failures = reports.flatMap((report) =>
  report.creatures.filter((creature) => creature.coverage !== 'full'),
);

if (failures.length > 0) {
  console.log(`\nCreatures that will NOT fight at fully authored stats (${failures.length}):`);
  console.log('-'.repeat(78));
  for (const creature of failures) {
    const missing = [
      creature.maxHp === undefined ? 'HP' : null,
      creature.armorClass === undefined ? 'AC' : null,
    ]
      .filter(Boolean)
      .join('+');
    const why = creature.unparsedLabels.length
      ? `unreadable label(s): ${creature.unparsedLabels.join(', ')}`
      : 'no stat labels present';
    console.log(
      `  [${creature.coverage.padEnd(7)}] ${creature.campaignId} / ${creature.entityName} — missing ${missing} (${why})`,
    );
  }
}

if (withoutAnyStatChunks.length > 0) {
  console.log(
    `\nCampaigns with ZERO stat-bearing chunks (${withoutAnyStatChunks.length}) — every creature fights generic:`,
  );
  for (const report of withoutAnyStatChunks) {
    const note = report.narrativeOnlyCreatureCount
      ? ` (${report.narrativeOnlyCreatureCount} creature(s) with stats filed under an npc_tier chunk_type, which combat does not read — taxonomy gap)`
      : ' (no authored mechanics anywhere — content gap, not a parser gap)';
    console.log(`  ${report.campaignId}${note}`);
  }
}

if (totals.narrativeOnly > 0) {
  console.log(
    `\n${totals.narrativeOnly} creature(s) across all campaigns carry parseable stats under an npc_tier chunk_type.`,
  );
  console.log(
    "  Combat reads only chunk_type in ('monster','encounter'), so these fight generic regardless of parser quality.",
  );
}

if (!flag('--quiet')) {
  console.log('\nPer-creature detail:');
  console.log('-'.repeat(78));
  for (const report of reports) {
    if (report.creatures.length === 0) continue;
    console.log(`\n${report.campaignId} — ${report.title ?? '(untitled)'}`);
    for (const creature of report.creatures) {
      const stats = `HP ${creature.maxHp ?? '—'} / AC ${creature.armorClass ?? '—'}`;
      console.log(
        `  ${creature.coverage.padEnd(7)} ${creature.entityName.padEnd(34)} ${stats.padEnd(20)} ${creature.parsedFields.join(',')}`,
      );
    }
  }
}

// Row-count sanity line: proves the audit saw the table it thinks it saw.
const [{ total } = { total: 0 }] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(schema.campaignChunks);
console.log(`\nScanned ${chunkRows.length} creature-bearing chunks of ${total} total chunks.`);

await client.end();
