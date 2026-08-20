#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Backfill `memories.embedding` for every row written before the server-side write path existed.
 *
 * #1822: 4753 rows accumulated over nine months with no vector, because the only embedding call
 * was behind a build-time flag that was never on. PR2 (#1863) fixed new writes; this is the
 * one-time repair for the history, and it is PR4 of that issue's plan.
 *
 * Comparability is the whole point of the column, so this deliberately reuses the SAME shared
 * constants and normalisation as the live write path (`shared/embedding-limits.ts`:
 * gemini-embedding-001, 768 dims, RETRIEVAL_DOCUMENT, unit-normalised). A backfilled row and a
 * freshly written one must be rankable against each other; a second implementation here would be
 * a second chance to disagree.
 *
 * Writes via service-role SQL rather than `POST /v1/memories` — the HTTP route is per-row and
 * requires a user JWT, and this is an operator repair, not a user action.
 *
 * Idempotent: selects only `embedding IS NULL`, so an interrupted run resumes simply by being
 * re-run, and a completed run is a no-op. Oldest-first so a quota-truncated run leaves the
 * corpus contiguous rather than pockmarked.
 *
 * Dry run unless --apply is supplied, per the same convention as backfill-armor-class.ts.
 *
 * Usage:
 *   bun scripts/backfill-memory-embeddings.ts
 *   bun scripts/backfill-memory-embeddings.ts --apply
 */

import postgres from 'postgres';

import { EMBEDDING_DIMENSIONS } from '../shared/embedding-limits';
import { generateEmbeddings, initGemini } from '../tools/lore-keeper-ingest/src/embeddings';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 100;
const INTER_BATCH_SLEEP_MS = 250;

/**
 * `--limit N` stops after N rows. Its purpose is a one-batch smoke test before committing the
 * full run: a malformed UPDATE would otherwise burn thousands of paid embedding calls whose
 * results are then thrown away. Because the script resumes from `embedding IS NULL`, a limited
 * run is just a prefix of the full one — no separate cleanup, re-run without it to finish.
 */
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg === -1 ? null : Number(process.argv[limitArg + 1]);
if (LIMIT !== null && (!Number.isFinite(LIMIT) || LIMIT <= 0)) {
  throw new Error('--limit expects a positive integer');
}

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!API_KEY) throw new Error('GOOGLE_GEMINI_API_KEY is required');

const sql = postgres(DATABASE_URL);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: string;
  content: string;
}

const main = async (): Promise<void> => {
  initGemini(API_KEY);

  const [before] = await sql<{ total: string; embedded: string; nulls: string }[]>`
    SELECT count(*) AS total,
           count(embedding) AS embedded,
           count(*) - count(embedding) AS nulls
    FROM memories`;

  console.log('Memory embedding backfill');
  console.log(`  Mode:            ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`  Total rows:      ${before.total}`);
  console.log(`  Already embedded:${before.embedded}`);
  console.log(`  To embed:        ${before.nulls}`);

  const all = await sql<Row[]>`
    SELECT id, content
    FROM memories
    WHERE embedding IS NULL
    ORDER BY created_at ASC`;
  const rows = LIMIT === null ? all : all.slice(0, LIMIT);
  if (LIMIT !== null) console.log(`  Limit:           ${LIMIT} (smoke test of ${all.length})`);

  if (rows.length === 0) {
    console.log('\nNothing to do.');
    await sql.end();
    return;
  }

  const batches = Math.ceil(rows.length / BATCH_SIZE);
  console.log(`  Batches:         ${batches} of ${BATCH_SIZE}\n`);

  if (!APPLY) {
    console.log('Dry run — no writes. Sample of what would be embedded (oldest first):');
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.id}  ${JSON.stringify(r.content.slice(0, 70))}`);
    }
    console.log(`  ... and ${rows.length - 5} more`);
    console.log('\nRe-run with --apply to write.');
    await sql.end();
    return;
  }

  let updated = 0;
  const failedBatches: { index: number; error: string }[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const n = Math.floor(i / BATCH_SIZE) + 1;

    try {
      // generateEmbeddings does its own internal batching + truncation against the shared limits.
      const vectors = await generateEmbeddings(
        batch.map((r) => r.content),
        BATCH_SIZE,
      );

      if (vectors.length !== batch.length) {
        throw new Error(`expected ${batch.length} vectors, got ${vectors.length}`);
      }

      // One statement per batch rather than per row: 48 round trips instead of 4753.
      const payload = batch.map((r, j) => ({
        id: r.id,
        embedding: `[${vectors[j].join(',')}]`,
      }));

      await sql`
        UPDATE memories AS m
        SET embedding = v.embedding::vector(${sql.unsafe(String(EMBEDDING_DIMENSIONS))})
        FROM (VALUES ${sql(payload.map((p) => [p.id, p.embedding] as const))}) AS v(id, embedding)
        WHERE m.id = v.id::uuid`;

      updated += batch.length;
      const pct = ((updated / rows.length) * 100).toFixed(1);
      console.log(
        `  batch ${String(n).padStart(2)}/${batches}  +${batch.length}  (${updated}/${rows.length}, ${pct}%)`,
      );
    } catch (error) {
      // One bad batch must not abort the run: the remaining rows are still repairable, and a
      // partial backfill is strictly better than none because the next run resumes from nulls.
      const message = error instanceof Error ? error.message : String(error);
      failedBatches.push({ index: n, error: message });
      console.error(`  batch ${n}/${batches} FAILED: ${message}`);
    }

    if (i + BATCH_SIZE < rows.length) await sleep(INTER_BATCH_SLEEP_MS);
  }

  const [after] = await sql<{ total: string; embedded: string; nulls: string }[]>`
    SELECT count(*) AS total,
           count(embedding) AS embedded,
           count(*) - count(embedding) AS nulls
    FROM memories`;

  console.log('\nBackfill summary');
  console.log(`  Mode:            APPLY`);
  console.log(`  Rows updated:    ${updated}`);
  console.log(`  Failed batches:  ${failedBatches.length}`);
  for (const f of failedBatches) console.log(`    batch ${f.index}: ${f.error}`);
  console.log(`  Embedded before: ${before.embedded}`);
  console.log(`  Embedded after:  ${after.embedded}`);
  console.log(`  Still null:      ${after.nulls}`);

  await sql.end();
  if (failedBatches.length > 0) process.exit(1);
};

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
