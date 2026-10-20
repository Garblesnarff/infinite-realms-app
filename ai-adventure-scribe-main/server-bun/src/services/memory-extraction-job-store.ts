import { and, asc, eq, lt, or, sql } from 'drizzle-orm';

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
 * a dead process and becomes claimable again. Model calls take at most ~60 s,
 * so this is far beyond any live execution; it only fires after a real crash.
 */
export const STALE_RUNNING_JOB_MS = 15 * 60 * 1000;

/** Insert the row the 202 hands back. Throws on DB error: the route must not 202 then. */
export async function persistMemoryExtractionJob(
  row: NewMemoryExtractionJobRow,
): Promise<MemoryExtractionJobRow> {
  const [inserted] = await db.insert(memoryExtractionJobs).values(row).returning();
  return inserted;
}

/**
 * Claim a job for execution: pending -> running, or stale-running -> running.
 * Bumps attempts and the heartbeat. Returns null when another process holds
 * the claim (or the row is not in the expected state).
 */
export async function claimMemoryExtractionJob(
  id: string,
  expectedStatus: 'pending' | 'running',
): Promise<MemoryExtractionJobRow | null> {
  const where =
    expectedStatus === 'pending'
      ? and(eq(memoryExtractionJobs.id, id), eq(memoryExtractionJobs.status, 'pending'))
      : and(
          eq(memoryExtractionJobs.id, id),
          eq(memoryExtractionJobs.status, 'running'),
          lt(memoryExtractionJobs.updatedAt, new Date(Date.now() - STALE_RUNNING_JOB_MS)),
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

/** Jobs eligible to start now: anything pending, plus orphaned running jobs. */
export async function listRunnableMemoryExtractionJobs(
  limit: number,
): Promise<MemoryExtractionJobRow[]> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_JOB_MS);
  return db
    .select()
    .from(memoryExtractionJobs)
    .where(
      or(
        eq(memoryExtractionJobs.status, 'pending'),
        and(
          eq(memoryExtractionJobs.status, 'running'),
          lt(memoryExtractionJobs.updatedAt, staleBefore),
        ),
      ),
    )
    .orderBy(asc(memoryExtractionJobs.createdAt))
    .limit(limit);
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
