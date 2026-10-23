import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  memoryExtractionJobs,
  type MemoryExtractionJobRow,
  type NewMemoryExtractionJobRow,
} from '../../../db/schema/index';

/**
 * Persistence for accepted memory extraction jobs (#846).
 *
 * Every status transition is guarded by the row's current status in the WHERE
 * clause, so two processes racing the same job — a deploy handoff, a stale
 * running-job reclaim against an executor that just woke up — can never run,
 * complete, or fail the same job twice. The loser gets zero rows back and
 * stands down; only the winner runs the side effects (execution, quota
 * charge).
 */
export type { MemoryExtractionJobRow, NewMemoryExtractionJobRow };

/**
 * A running job whose updated_at is older than this is treated as orphaned by
 * a dead process and becomes claimable again. updated_at is the row's
 * last-transition time — nothing refreshes it during execution — so staleness
 * is measured from the claim. An extraction call tries up to two provider
 * candidates at up to ~60 s each (~120 s worst case at the default timeout),
 * so this is far beyond a healthy live execution; it fires after a real crash.
 * The non-model phases (dedup check, usage write, memory insert) share the
 * database and carry no timeout of their own: a pathological stall past this
 * window can race a second executor — the guarded completion still charges
 * only once, but both executors can pass the dedup check and write duplicate
 * memories. That residual risk is accepted; a real fix is an execution
 * heartbeat or timeouts on those phases.
 */
export const STALE_RUNNING_JOB_MS = 15 * 60 * 1000;

/**
 * Execution budget for one job, mirrored from MAX_MEMORY_EXTRACTION_ATTEMPTS in
 * the job module (a literal here so the store stays import-cycle free): a row at
 * the cap is never claimed again — a job that kills the process mid-run must not
 * be reclaimed on every restart forever.
 */
export const MAX_MEMORY_EXTRACTION_JOB_ATTEMPTS = 3;

/** Insert the row the 202 hands back. Throws on DB error: the route must not 202 then. */
export async function persistMemoryExtractionJob(
  row: NewMemoryExtractionJobRow,
): Promise<MemoryExtractionJobRow> {
  const [inserted] = await db.insert(memoryExtractionJobs).values(row).returning();
  return inserted;
}

/**
 * Insert a job row only while the user is below `maxActiveJobs` active
 * (pending + running) jobs — the accept path's burst reservation, made atomic
 * (#883). The route used to count with countActiveMemoryExtractionJobs and
 * persist in two separate steps, so two concurrent accepts for the same user
 * could both pass the count before either insert landed, and the burst guard
 * (#846 item 5) promised more extractions than the quota will pay for.
 *
 * The count and the insert run in one transaction holding a pg advisory lock
 * keyed on the user id — the same shape as the quota consume's TOCTOU fix in
 * ai-usage-service and the hit-dice race guard in rest-hit-dice-service. The
 * lock is xact-scoped: a second accept for the user blocks until the first
 * commits, then counts the first's row. Returns null when the cap is already
 * reached; the caller refuses the accept. Throws on DB error, like persist.
 */
export async function persistMemoryExtractionJobWithinActiveCap(
  row: NewMemoryExtractionJobRow,
  maxActiveJobs: number,
): Promise<MemoryExtractionJobRow | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.userId}::text, 0))`,
    );
    const [counted] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryExtractionJobs)
      .where(
        and(
          eq(memoryExtractionJobs.userId, row.userId),
          inArray(memoryExtractionJobs.status, ['pending', 'running']),
        ),
      );
    if ((counted?.count ?? 0) >= maxActiveJobs) return null;
    const [inserted] = await tx.insert(memoryExtractionJobs).values(row).returning();
    return inserted;
  });
}

/** Read a job row by id. Used after an ambiguous settle to see what actually committed. */
export async function getMemoryExtractionJob(id: string): Promise<MemoryExtractionJobRow | null> {
  const [job] = await db
    .select()
    .from(memoryExtractionJobs)
    .where(eq(memoryExtractionJobs.id, id))
    .limit(1);
  return job ?? null;
}

/**
 * Claim a job for execution: pending -> running, or stale-running -> running.
 * Rows at the attempts cap are never claimable; the exhaustion sweep fails them.
 * Bumps attempts and updated_at. Returns null when another process holds
 * the claim (or the row is not in the expected state).
 */
export async function claimMemoryExtractionJob(
  id: string,
  expectedStatus: 'pending' | 'running',
): Promise<MemoryExtractionJobRow | null> {
  const attemptsUnderCap = lt(memoryExtractionJobs.attempts, MAX_MEMORY_EXTRACTION_JOB_ATTEMPTS);
  const where =
    expectedStatus === 'pending'
      ? and(
          eq(memoryExtractionJobs.id, id),
          eq(memoryExtractionJobs.status, 'pending'),
          attemptsUnderCap,
        )
      : and(
          eq(memoryExtractionJobs.id, id),
          eq(memoryExtractionJobs.status, 'running'),
          lt(memoryExtractionJobs.updatedAt, new Date(Date.now() - STALE_RUNNING_JOB_MS)),
          attemptsUnderCap,
        );
  const [claimed] = await db
    .update(memoryExtractionJobs)
    .set({
      status: 'running',
      attempts: sql`attempts + 1`,
      updatedAt: new Date(),
    })
    .where(where)
    .returning();
  return claimed ?? null;
}

/** Jobs eligible to start now: under the attempts cap, pending or orphaned running. */
export async function listRunnableMemoryExtractionJobs(
  limit: number,
): Promise<MemoryExtractionJobRow[]> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_JOB_MS);
  return db
    .select()
    .from(memoryExtractionJobs)
    .where(
      and(
        lt(memoryExtractionJobs.attempts, MAX_MEMORY_EXTRACTION_JOB_ATTEMPTS),
        or(
          eq(memoryExtractionJobs.status, 'pending'),
          and(
            eq(memoryExtractionJobs.status, 'running'),
            lt(memoryExtractionJobs.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .orderBy(asc(memoryExtractionJobs.createdAt))
    .limit(limit);
}

/**
 * Fail rows that burned their whole attempts budget without completing (a job
 * that kept killing its process mid-run). Runs at startup before resume so the
 * terminal state is recorded instead of the row sitting claimable forever.
 * Returns how many rows were failed.
 */
export async function failExhaustedMemoryExtractionJobs(): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_JOB_MS);
  const failed = await db
    .update(memoryExtractionJobs)
    .set({
      status: 'failed',
      error: 'attempts exhausted without completing',
      updatedAt: new Date(),
    })
    .where(
      and(
        sql`${memoryExtractionJobs.attempts} >= ${MAX_MEMORY_EXTRACTION_JOB_ATTEMPTS}`,
        or(
          eq(memoryExtractionJobs.status, 'pending'),
          and(
            eq(memoryExtractionJobs.status, 'running'),
            lt(memoryExtractionJobs.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning({ id: memoryExtractionJobs.id });
  return failed.length;
}

/**
 * A user's accepted-but-unfinished jobs (pending + running). The accept path
 * subtracts this from the remaining quota so a burst of 202s cannot promise
 * more extractions than the quota will pay for at completion.
 */
export async function countActiveMemoryExtractionJobs(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memoryExtractionJobs)
    .where(
      and(
        eq(memoryExtractionJobs.userId, userId),
        inArray(memoryExtractionJobs.status, ['pending', 'running']),
      ),
    );
  return row?.count ?? 0;
}

/** Mark a running job completed. Returns false when the row left 'running' already. */
export async function completeMemoryExtractionJob(
  id: string,
  charged: boolean,
): Promise<boolean> {
  const [done] = await db
    .update(memoryExtractionJobs)
    .set({
      status: 'completed',
      charged,
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(memoryExtractionJobs.id, id), eq(memoryExtractionJobs.status, 'running')))
    .returning({ id: memoryExtractionJobs.id });
  return done !== undefined;
}

/**
 * Flag a completed job as quota-charged. The executor only calls this after
 * winning the completed transition, so the flag flips at most once per job.
 */
export async function markMemoryExtractionJobCharged(id: string): Promise<boolean> {
  const [updated] = await db
    .update(memoryExtractionJobs)
    .set({ charged: true, updatedAt: new Date() })
    .where(
      and(
        eq(memoryExtractionJobs.id, id),
        eq(memoryExtractionJobs.status, 'completed'),
        eq(memoryExtractionJobs.charged, false),
      ),
    )
    .returning({ id: memoryExtractionJobs.id });
  return updated !== undefined;
}

/** Release a running job back to pending for another attempt. Returns false on a lost race. */
export async function releaseMemoryExtractionJob(id: string, error: string): Promise<boolean> {
  const [released] = await db
    .update(memoryExtractionJobs)
    .set({ status: 'pending', error, updatedAt: new Date() })
    .where(and(eq(memoryExtractionJobs.id, id), eq(memoryExtractionJobs.status, 'running')))
    .returning({ id: memoryExtractionJobs.id });
  return released !== undefined;
}

/** Mark a running job terminally failed (attempts exhausted). Never charges. */
export async function failMemoryExtractionJob(id: string, error: string): Promise<boolean> {
  const [failed] = await db
    .update(memoryExtractionJobs)
    .set({ status: 'failed', error, updatedAt: new Date() })
    .where(and(eq(memoryExtractionJobs.id, id), eq(memoryExtractionJobs.status, 'running')))
    .returning({ id: memoryExtractionJobs.id });
  return failed !== undefined;
}
