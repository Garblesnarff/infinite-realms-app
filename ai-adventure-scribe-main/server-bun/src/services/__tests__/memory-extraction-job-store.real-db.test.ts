/**
 * #846: the persisted-job store against a real Postgres.
 *
 * The unit suites mock the store with an in-memory Map that re-implements the
 * guarded transitions — so the SQL itself (the WHERE guards, the attempts cap,
 * the stale-running predicate) never executes there. This suite runs the real
 * store functions: claim, guarded complete + charge flag, release, the
 * exhaustion sweep, the accept-path reservation count, and the restart path
 * (persist in one "process", resume in another) through the real
 * persistMemoryExtractionJob / resumePendingMemoryExtractionJobs, with the
 * quota charge landing in a real ai_usage row exactly once.
 *
 * The model call is the only mocked boundary: the provider transport returns
 * an empty extraction, so no memories are written and no session fixture chain
 * is needed (the jobs table holds no FK to game_sessions by design).
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 * Without one the suite skips, per the harness contract.
 */
import { randomUUID } from 'crypto';

// The restart path charges through AIUsageService -> lib/db, which validates
// the full env; the real-db CI job only sets the database URLs, so provide
// harmless dummy values for the rest (additive only — never override a value
// the environment already provides).
process.env.PORT ??= '8888';
process.env.CORS_ORIGIN ??= 'http://localhost:3000';
process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

import { closeRealDb, describeWithDb, importWithRealDb, realDb, testId } from './fixtures/real-db.js';
import { aiUsage, memoryExtractionJobs } from '../../../../db/schema/index';

// The job module's only external effect besides the DB is the model call.
mock.module('../llm-provider-service.js', () => ({
  LLMProviderService: {
    extract: async () => ({ text: '[]' }),
  },
}));

const store = await importWithRealDb(() => import('../memory-extraction-job-store.js'));
const jobModule = await importWithRealDb(() => import('../memory-extraction-job.js'));

const USER = testId('mej-user');
const OTHER_USER = testId('mej-other');
// The restart test gets its own user so its ai_usage delta is exactly one row,
// independent of whatever the other tests left runnable for USER.
const RESTART_USER = testId('mej-restart');
const createdJobIds: string[] = [];

function newRow(id: string, userId = USER) {
  return {
    id,
    userId,
    plan: 'free',
    sessionId: randomUUID(),
    campaignId: null,
    characterId: null,
    kind: 'memories' as const,
    prompt: 'extract: the bridge is out',
    payloadHash: 'c'.repeat(64),
    maxTokens: 1000,
    turn: null,
    status: 'pending' as const,
    attempts: 0,
    charged: false,
    error: null,
  };
}

async function persist(id: string, userId = USER) {
  const row = await store.persistMemoryExtractionJob(newRow(id, userId));
  createdJobIds.push(id);
  return row;
}

describeWithDb('memory extraction job store (real DB, #846)', () => {
  beforeAll(() => {
    if (!store.persistMemoryExtractionJob) throw new Error('store not loaded');
  });

  afterAll(async () => {
    const db = realDb();
    for (const id of createdJobIds) {
      await db.delete(memoryExtractionJobs).where(eq(memoryExtractionJobs.id, id));
    }
    await db.delete(aiUsage).where(eq(aiUsage.userId, USER));
    await db.delete(aiUsage).where(eq(aiUsage.userId, OTHER_USER));
    await db.delete(aiUsage).where(eq(aiUsage.userId, RESTART_USER));
    await closeRealDb();
  });

  test('persist -> claim is single-winner; a second claim stands down', async () => {
    const id = randomUUID();
    const persisted = await persist(id);
    expect(persisted.status).toBe('pending');
    expect(persisted.attempts).toBe(0);

    const claimed = await store.claimMemoryExtractionJob(id, 'pending');
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('running');
    expect(claimed!.attempts).toBe(1);

    // The row is running now: a pending-claim and a fresh running-claim both lose.
    expect(await store.claimMemoryExtractionJob(id, 'pending')).toBeNull();
    expect(await store.claimMemoryExtractionJob(id, 'running')).toBeNull();
  });

  test('guarded complete fires once; the charge flag flips once', async () => {
    const id = randomUUID();
    await persist(id);
    await store.claimMemoryExtractionJob(id, 'pending');

    expect(await store.completeMemoryExtractionJob(id, false)).toBe(true);
    // Already completed: the guarded transition cannot fire again, so a raced
    // executor can never reach the charge a second time.
    expect(await store.completeMemoryExtractionJob(id, false)).toBe(false);
    expect(await store.markMemoryExtractionJobCharged(id)).toBe(true);
    expect(await store.markMemoryExtractionJobCharged(id)).toBe(false);

    const row = await store.getMemoryExtractionJob(id);
    expect(row).toMatchObject({ status: 'completed', charged: true });
  });

  test('release returns a running job to pending; fail is terminal and running-only', async () => {
    const id = randomUUID();
    await persist(id);
    // Fail/release require 'running': on a pending row both are no-ops.
    expect(await store.failMemoryExtractionJob(id, 'nope')).toBe(false);
    expect(await store.releaseMemoryExtractionJob(id, 'nope')).toBe(false);

    await store.claimMemoryExtractionJob(id, 'pending');
    expect(await store.releaseMemoryExtractionJob(id, 'model outage')).toBe(true);
    expect(await store.getMemoryExtractionJob(id)).toMatchObject({
      status: 'pending',
      error: 'model outage',
    });

    await store.claimMemoryExtractionJob(id, 'pending');
    expect(await store.failMemoryExtractionJob(id, 'terminal')).toBe(true);
    expect(await store.getMemoryExtractionJob(id)).toMatchObject({ status: 'failed' });
  });

  test('attempts cap: a row at the cap is unclaimable, unlisted, and swept to failed', async () => {
    const id = randomUUID();
    await persist(id);
    const db = realDb();
    await db
      .update(memoryExtractionJobs)
      .set({
        status: 'running',
        attempts: store.MAX_MEMORY_EXTRACTION_JOB_ATTEMPTS,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      })
      .where(eq(memoryExtractionJobs.id, id));

    expect(await store.claimMemoryExtractionJob(id, 'running')).toBeNull();
    const runnable = await store.listRunnableMemoryExtractionJobs(100);
    expect(runnable.map((r) => r.id)).not.toContain(id);

    const swept = await store.failExhaustedMemoryExtractionJobs();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await store.getMemoryExtractionJob(id)).toMatchObject({ status: 'failed' });
  });

  test('countActive counts pending + running for the accept-path reservation', async () => {
    const pendingId = randomUUID();
    const runningId = randomUUID();
    const doneId = randomUUID();
    await persist(pendingId);
    await persist(runningId);
    await persist(doneId);
    await store.claimMemoryExtractionJob(runningId, 'pending');
    await store.claimMemoryExtractionJob(doneId, 'pending');
    await store.completeMemoryExtractionJob(doneId, true);

    expect(await store.countActiveMemoryExtractionJobs(USER)).toBeGreaterThanOrEqual(2);
    const mine = await store.countActiveMemoryExtractionJobs(OTHER_USER);
    expect(mine).toBe(0);
  });

  test('restart path: a job persisted by a dead process is resumed and charged once', async () => {
    const id = randomUUID();
    await persist(id, RESTART_USER);

    // "Process 2" boots: resume claims the pending row, the (mocked) model
    // returns an empty extraction, the job completes and the real quota
    // service consumes exactly one llm_system unit for the job's user.
    const before = await realDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(aiUsage)
      .where(eq(aiUsage.userId, RESTART_USER));
    await jobModule.resumePendingMemoryExtractionJobs();

    let row = await store.getMemoryExtractionJob(id);
    // Wait for charged too: the charge lands right after the completed
    // transition in the same execution, and reading in between is a race.
    for (let i = 0; i < 50 && !(row?.status === 'completed' && row?.charged); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      row = await store.getMemoryExtractionJob(id);
    }
    expect(row).toMatchObject({ status: 'completed', charged: true });

    const after = await realDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(aiUsage)
      .where(eq(aiUsage.userId, RESTART_USER));
    expect(after[0].count - before[0].count).toBe(1);
  });
});
