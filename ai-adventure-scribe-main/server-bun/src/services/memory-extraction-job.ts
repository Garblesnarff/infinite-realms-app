import { createHash, randomUUID } from 'crypto';

import { AIUsageService } from './ai-usage-service.js';
import { LLMProviderService } from './llm-provider-service.js';
import {
  claimMemoryExtractionJob,
  completeMemoryExtractionJob,
  failMemoryExtractionJob,
  listRunnableMemoryExtractionJobs,
  markMemoryExtractionJobCharged,
  persistMemoryExtractionJob,
  releaseMemoryExtractionJob,
  type MemoryExtractionJobRow,
} from './memory-extraction-job-store.js';
import { MemoryService } from './memory-service.js';
import { alert } from '../lib/alerting.js';
import { logger } from '../lib/logger.js';

import type { NewMemory } from '../../../db/schema/index';

/**
 * Server-owned memory extraction (#2148).
 *
 * The browser used to wait on /v1/llm/extract for the model's text, then parse it and write
 * the memories itself. The model takes 13–44 s; the browser gave up at 10 s. Every result was
 * thrown away, so memory extraction had not run for any production turn (#2144).
 *
 * Now the route accepts the job and returns 202 at once, and this module finishes it: call the
 * model, parse, and write the rows. Nothing waits on it. The rows reach the next turn the way
 * memories always have — the client reads them from the DB.
 *
 * #846: the accepted job is persisted to memory_extraction_jobs before the 202, so a restart
 * (every deploy) loses nothing. On startup the server resumes pending jobs and reclaims
 * orphaned running ones. Quota is charged when a job completes, never when it is accepted, so
 * a job that never runs is never charged — and completion wins a guarded status transition
 * first, so a raced job can never charge twice.
 */

export type MemoryExtractionKind = 'memories' | 'summary';

export interface MemoryExtractionJobInput {
  userId: string;
  plan: string;
  sessionId: string;
  campaignId?: string;
  characterId?: string;
  kind: MemoryExtractionKind;
  prompt: string;
  maxTokens: number;
  turn?: number;
}

/** How many executions a job gets before it is terminally failed. */
export const MAX_MEMORY_EXTRACTION_ATTEMPTS = 3;

/** Backoff between attempts: 30 s, 60 s. Timers are unref'd, so they never hold the process. */
export const MEMORY_EXTRACTION_RETRY_BASE_DELAY_MS = 30_000;

const ALLOWED_MEMORY_TYPES = new Set([
  'general',
  'npc',
  'location',
  'quest',
  'item',
  'event',
  'story_beat',
  'character_moment',
  'world_detail',
  'dialogue_gem',
  'atmosphere',
  'plot_point',
  'foreshadowing',
]);

// The prompt asks for 1–4. Anything past this is the model rambling, not memory.
const MAX_MEMORIES_PER_JOB = 10;

/** Same rule as the client's normalizeMemoryType: first segment of "npc|location", else general. */
function normalizeType(value: unknown): string {
  const first = typeof value === 'string' ? value.split('|', 1)[0].trim() : '';
  return ALLOWED_MEMORY_TYPES.has(first) ? first : 'general';
}

function stripAssetTags(text: string): string {
  return text
    .replace(/\[ASSET:[^\]]+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The model is asked for 1–10, the live calculateImportance scale (#2283). */
function clampImportance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(10, Math.round(value)));
}

/**
 * #353: normalize text for verbatim-quote verification. The model is asked to
 * copy the quote verbatim from the exchange; normalization tolerates only
 * case and whitespace differences, not paraphrase.
 */
function normalizeForQuoteMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * #353: verify the model's `quote` actually appears in the extraction prompt
 * (which contains the exchange verbatim). A quote that isn't in the prompt is
 * a hallucinated grounding — the memory is dropped. Returns true when the
 * memory may be kept.
 */
function isQuoteGrounded(quote: unknown, prompt: string): boolean {
  // #353 FIX: a missing quote is not grounding — letting it pass would let the
  // model bypass the guard by omitting quotes. A ≤3-char quote grounds nothing
  // either (same bypass class). Fail closed: drop both like a hallucinated one.
  if (typeof quote !== 'string') return false;
  const normalized = normalizeForQuoteMatch(quote);
  if (normalized.length < 4) return false;
  return normalizeForQuoteMatch(prompt).includes(normalized);
}

/**
 * Turn the model's text into memory rows. The session and campaign come from the job, never
 * from the model's output: the prompt echoes a session id back, and trusting it would let the
 * model write into whatever session it names.
 */
export function parseExtractionText(
  text: string,
  job: Pick<
    MemoryExtractionJobInput,
    'sessionId' | 'campaignId' | 'characterId' | 'kind' | 'turn' | 'prompt'
  >,
  jobId: string,
): NewMemory[] {
  const base = { sessionId: job.sessionId, campaignId: job.campaignId };

  if (job.kind === 'summary') {
    const summary = text.trim();
    if (!summary) return [];
    return [
      {
        ...base,
        content: summary,
        type: 'story_beat',
        memoryType: 'campaign_summary',
        // 9 is the old 1-5 top (5) under the #2283 rescale, so new summaries rank with migrated ones.
        importance: 9,
        metadata: { source: 'periodic_summary', turn: job.turn, jobId },
      },
    ];
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
  const list = (parsed as { memories?: unknown })?.memories;
  if (!Array.isArray(list)) return [];

  const rows: NewMemory[] = [];
  for (const item of list.slice(0, MAX_MEMORIES_PER_JOB)) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const content = typeof raw.content === 'string' ? stripAssetTags(raw.content) : '';
    if (!content) continue;
    // #353: drop memories whose grounding quote isn't in the prompt. A fake
    // quote means the model hallucinated the names/dates in the content.
    if (!isQuoteGrounded(raw.quote, job.prompt ?? '')) {
      logger.warn({
        msg: 'memory_extraction.ungrounded_dropped',
        jobId,
        sessionId: job.sessionId,
        content: content.slice(0, 120),
        quote: typeof raw.quote === 'string' ? raw.quote.slice(0, 120) : null,
      });
      continue;
    }
    const modelMetadata =
      raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : {};
    rows.push({
      ...base,
      content,
      type: normalizeType(raw.type),
      importance: clampImportance(raw.importance),
      emotionalTone: typeof raw.emotional_tone === 'string' ? raw.emotional_tone : null,
      metadata: {
        ...modelMetadata,
        ...(typeof raw.category === 'string' ? { category: raw.category } : {}),
        ...(typeof raw.quote === 'string' ? { quote: raw.quote } : {}),
        source: 'llm_extraction',
        jobId,
        ...(job.characterId ? { characterId: job.characterId } : {}),
      },
    });
  }
  return rows;
}

export interface MemoryExtractionOutcome {
  inserted: number;
  status: 'completed' | 'failed';
  /** Present when status is 'failed': the reason recorded on the job row. */
  error?: string;
}

/**
 * Run one extraction to completion. Never throws: this runs with no caller to throw to.
 *
 * Rows are written by a single multi-row INSERT after the model call succeeds and parses, so a
 * failed model call — or a failed write — leaves no partial rows behind.
 */
export async function runMemoryExtractionJob(
  jobId: string,
  input: MemoryExtractionJobInput,
): Promise<MemoryExtractionOutcome> {
  const startedAt = performance.now();
  const logBase = {
    jobId,
    sessionId: input.sessionId,
    kind: input.kind,
    turn: input.turn,
  };
  const elapsed = () => Math.round(performance.now() - startedAt);

  try {
    const result = await LLMProviderService.extract({
      prompt: input.prompt,
      maxTokens: input.maxTokens,
    });

    if (result.error) {
      alert('llm_extraction_degraded', { error: result.error });
      logger.warn({
        ...logBase,
        msg: 'memory_extraction.failed',
        stage: 'llm',
        error: result.error,
        durationMs: elapsed(),
      });
      return { inserted: 0, status: 'failed', error: result.error };
    }

    if (result.usage && result.provider) {
      await AIUsageService.recordProviderUsage({
        userId: input.userId,
        plan: input.plan,
        type: 'llm_system',
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      }).catch((error: unknown) => {
        logger.warn({
          ...logBase,
          msg: 'memory_extraction.usage_record_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const rows = parseExtractionText(result.text ?? '', input, jobId);
    if (rows.length > 0) {
      await MemoryService.insert(rows, input.userId);
    }

    logger.info({
      ...logBase,
      msg: 'memory_extraction.completed',
      model: result.model,
      inserted: rows.length,
      textLength: typeof result.text === 'string' ? result.text.length : 0,
      durationMs: elapsed(),
    });
    return { inserted: rows.length, status: 'completed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({
      ...logBase,
      msg: 'memory_extraction.failed',
      stage: 'exception',
      error: message,
      durationMs: elapsed(),
    });
    return { inserted: 0, status: 'failed', error: message };
  }
}

// Jobs accepted but not yet finished in this process.
const inFlightJobIds = new Set<string>();

export function inFlightMemoryExtractionJobs(): number {
  return inFlightJobIds.size;
}

function payloadHash(input: MemoryExtractionJobInput): string {
  const canonical = {
    sessionId: input.sessionId,
    campaignId: input.campaignId ?? null,
    characterId: input.characterId ?? null,
    kind: input.kind,
    prompt: input.prompt,
    maxTokens: input.maxTokens,
    turn: input.turn ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function rowToInput(row: MemoryExtractionJobRow): MemoryExtractionJobInput {
  return {
    userId: row.userId,
    plan: row.plan,
    sessionId: row.sessionId,
    campaignId: row.campaignId ?? undefined,
    characterId: row.characterId ?? undefined,
    kind: row.kind as MemoryExtractionKind,
    prompt: row.prompt,
    maxTokens: row.maxTokens,
    turn: row.turn ?? undefined,
  };
}

/** How many charge attempts a completed job gets before the leak is alerted. */
export const MAX_MEMORY_EXTRACTION_CHARGE_ATTEMPTS = 3;

/**
 * One charge attempt: consume the unit, then flag the row. Returns true when the
 * unit was consumed. The flag write is best-effort — once the consume has landed,
 * a failed flag write must not trigger a retry (the retry would consume twice);
 * the flag is diagnostic and its own failure is logged on its own line.
 */
async function attemptCharge(
  claimed: MemoryExtractionJobRow,
  logBase: Record<string, unknown>,
  chargeAttempt: number,
): Promise<boolean> {
  try {
    const quota = await AIUsageService.checkQuotaAndConsume({
      userId: claimed.userId,
      plan: claimed.plan,
      type: 'llm_system',
      units: 1,
    });
    if (!quota.allowed) {
      logger.warn({ ...logBase, msg: 'memory_extraction.charge_quota_exhausted', chargeAttempt });
      return false;
    }
  } catch (error: unknown) {
    logger.error({
      ...logBase,
      msg: 'memory_extraction.charge_failed',
      chargeAttempt,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  await markMemoryExtractionJobCharged(claimed.id).catch((error: unknown) => {
    logger.error({
      ...logBase,
      msg: 'memory_extraction.charge_mark_failed',
      error: error instanceof Error ? error.message : String(error),
      note: 'quota was consumed; the charged flag is stale, do not re-charge',
    });
  });
  return true;
}

/**
 * Retry a charge that did not land (usage store down, or quota exhausted between
 * the accept pre-check and completion). Scheduled with backoff on an unref'd
 * timer, like execution retries. Retries only re-run when the consume itself did
 * not land, so a job is never charged twice; when the attempts run out the leak
 * is alerted — a completed row with charged=false after the alert is an
 * accounting fact, not a silent leak.
 */
function scheduleChargeRetry(
  claimed: MemoryExtractionJobRow,
  logBase: Record<string, unknown>,
  chargeAttempt: number,
): void {
  if (chargeAttempt >= MAX_MEMORY_EXTRACTION_CHARGE_ATTEMPTS) {
    logger.error({ ...logBase, msg: 'memory_extraction.charge_retries_exhausted' });
    alert('memory_extraction_charge_failed', {
      sessionId: claimed.sessionId,
      error: `job ${claimed.id} completed but its quota unit was never charged`,
    });
    return;
  }
  const delay = MEMORY_EXTRACTION_RETRY_BASE_DELAY_MS * chargeAttempt;
  logger.info({ ...logBase, msg: 'memory_extraction.charge_retry_scheduled', chargeAttempt, delayMs: delay });
  const timer = setTimeout(() => {
    void (async () => {
      const consumed = await attemptCharge(claimed, logBase, chargeAttempt + 1);
      if (!consumed) scheduleChargeRetry(claimed, logBase, chargeAttempt + 1);
    })().catch((retryError: unknown) => {
      logger.error({
        ...logBase,
        msg: 'memory_extraction.charge_retry_crashed',
        error: retryError instanceof Error ? retryError.message : String(retryError),
      });
      scheduleChargeRetry(claimed, logBase, chargeAttempt + 1);
    });
  }, delay);
  // The charge must never hold the process open; uncharged rows are visible in the table.
  timer.unref?.();
}

/**
 * Execute one claimed job: run the extraction, then settle the row. Never throws —
 * every store call in the settle phase is guarded, and a settle failure releases the
 * row back to pending so startup resume or the stale reclaim retries it instead of
 * stranding it in 'running'.
 *
 * The completed transition is guarded on status='running' and happens before the quota
 * charge, so a job that loses a race (shutdown release, a reclaiming process) is never
 * charged, and the job that won the transition charges exactly once.
 */
async function executeClaimedJob(
  claimed: MemoryExtractionJobRow,
): Promise<MemoryExtractionOutcome> {
  const logBase = { jobId: claimed.id, sessionId: claimed.sessionId, attempt: claimed.attempts };

  // Idempotency: a previous execution may already have written this job's rows
  // (crash, or a shutdown release that lost the completion race below). Then there
  // is nothing to run — settle straight to completed; the charge still lands once.
  let alreadyWritten = false;
  try {
    alreadyWritten = await MemoryService.existsByExtractionJobId(claimed.id, claimed.sessionId);
  } catch (error: unknown) {
    logger.warn({
      ...logBase,
      msg: 'memory_extraction.dedup_check_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const outcome = alreadyWritten
    ? { inserted: 0, status: 'completed' as const }
    : await runMemoryExtractionJob(claimed.id, rowToInput(claimed));

  const settle = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (error: unknown) {
      logger.error({
        ...logBase,
        msg: 'memory_extraction.settle_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      // Best-effort recovery: back to pending so the job is retried, never stranded.
      await releaseMemoryExtractionJob(claimed.id, 'settle failed').catch(() => {});
      return false;
    }
  };

  if (outcome.status === 'completed') {
    let transitioned: boolean | null = null;
    await settle(async () => {
      transitioned = await completeMemoryExtractionJob(claimed.id, false);
    });
    if (transitioned === null) return outcome; // settle failed; row released for retry
    if (!transitioned) {
      logger.warn({ ...logBase, msg: 'memory_extraction.complete_race_lost' });
      return outcome;
    }
    // This process owns the completed row: charge the unit now, exactly once.
    const charged = await attemptCharge(claimed, logBase, 1);
    if (!charged) {
      // The row is completed; the charge is retried with backoff, then alerted.
      scheduleChargeRetry(claimed, logBase, 1);
    }
    return outcome;
  }

  const error = outcome.error ?? 'unknown failure';
  if (claimed.attempts < MAX_MEMORY_EXTRACTION_ATTEMPTS) {
    const released = await settle(() => releaseMemoryExtractionJob(claimed.id, error));
    if (!released) return outcome; // a retry was already scheduled by the settle recovery
    const delay = MEMORY_EXTRACTION_RETRY_BASE_DELAY_MS * claimed.attempts;
    logger.info({ ...logBase, msg: 'memory_extraction.retry_scheduled', delayMs: delay, error });
    const timer = setTimeout(() => {
      void claimAndExecuteById(claimed.id, 'pending').catch((retryError: unknown) => {
        logger.error({
          ...logBase,
          msg: 'memory_extraction.retry_crashed',
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
      });
    }, delay);
    // A retry must never hold the process open; a restart reclaims the row instead.
    timer.unref?.();
  } else {
    logger.warn({ ...logBase, msg: 'memory_extraction.attempts_exhausted', error });
    await settle(() => failMemoryExtractionJob(claimed.id, error));
    // Terminal failure is never charged: the job never completed.
  }
  return outcome;
}

/**
 * Claim a persisted job and execute it. Returns null when another process holds the claim.
 * Never throws: the store calls are the only fallible part and they run first.
 */
async function claimAndExecuteById(
  jobId: string,
  expectedStatus: 'pending' | 'running',
): Promise<MemoryExtractionOutcome | null> {
  let claimed: MemoryExtractionJobRow | null;
  try {
    claimed = await claimMemoryExtractionJob(jobId, expectedStatus);
  } catch (error: unknown) {
    logger.error({
      msg: 'memory_extraction.claim_failed',
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!claimed) {
    logger.warn({ msg: 'memory_extraction.claim_lost', jobId });
    return null;
  }
  inFlightJobIds.add(claimed.id);
  try {
    return await executeClaimedJob(claimed);
  } finally {
    inFlightJobIds.delete(claimed.id);
  }
}

/**
 * Start a job: persist the row first, then execute it without waiting.
 * The row must exist before the 202 goes out, so a crash after the response
 * still leaves a resumable job. Throws when persistence fails — the route must
 * not 202 a job it could not store.
 */
export async function startMemoryExtractionJob(input: MemoryExtractionJobInput): Promise<{
  jobId: string;
  done: Promise<MemoryExtractionOutcome>;
}> {
  const jobId = randomUUID();
  logger.info({
    jobId,
    sessionId: input.sessionId,
    kind: input.kind,
    turn: input.turn,
    promptLength: input.prompt.length,
    msg: 'memory_extraction.accepted',
  });
  const persisted = await persistMemoryExtractionJob({
    id: jobId,
    userId: input.userId,
    plan: input.plan,
    sessionId: input.sessionId,
    campaignId: input.campaignId ?? null,
    characterId: input.characterId ?? null,
    kind: input.kind,
    prompt: input.prompt,
    payloadHash: payloadHash(input),
    maxTokens: input.maxTokens,
    turn: input.turn ?? null,
    status: 'pending',
    attempts: 0,
    charged: false,
    error: null,
  });
  // The claim cannot lose here: nothing else knows the id yet. If it somehow
  // does, a sweep picks up the still-pending row so it is not stranded for the
  // process's whole lifetime.
  const done = claimAndExecuteById(persisted.id, 'pending')
    .then((outcome) => {
      if (outcome) return outcome;
      void resumePendingMemoryExtractionJobs();
      return { inserted: 0, status: 'failed' as const, error: 'claim lost' };
    })
    .catch((error: unknown) => {
      logger.error({
        msg: 'memory_extraction.execute_crashed',
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { inserted: 0, status: 'failed' as const, error: 'executor crashed' };
    });
  return { jobId, done };
}

/**
 * Resume jobs that survived a restart: anything still pending, plus running jobs whose
 * heartbeat went stale (their process died mid-execution). Called once at startup by the
 * non-standby process. Never throws: a failed claim logs and the sweep continues.
 */
export async function resumePendingMemoryExtractionJobs(
  limit = 100,
): Promise<{ resumed: number }> {
  let resumed = 0;
  let rows: MemoryExtractionJobRow[];
  try {
    rows = await listRunnableMemoryExtractionJobs(limit);
  } catch (error: unknown) {
    logger.error({
      msg: 'memory_extraction.resume_list_failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return { resumed: 0 };
  }
  for (const row of rows) {
    if (inFlightJobIds.has(row.id)) continue;
    resumed += 1;
    void claimAndExecuteById(row.id, row.status === 'running' ? 'running' : 'pending').catch(
      (error: unknown) => {
        logger.error({
          msg: 'memory_extraction.resume_failed',
          jobId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }
  if (resumed > 0) {
    logger.info({ msg: 'memory_extraction.resumed', count: resumed });
  }
  return { resumed };
}

/**
 * Shutdown hook (#846): release this process's in-flight jobs back to pending so the next
 * startup resumes them immediately instead of waiting out the stale-running window.
 * Best-effort and bounded; the index.ts shutdown races it against a timeout.
 */
export async function releaseInFlightMemoryExtractionJobs(signal: string): Promise<void> {
  const ids = [...inFlightJobIds];
  if (ids.length === 0) return;
  logger.warn({
    msg: 'memory_extraction.shutdown_release',
    count: ids.length,
    signal,
    note: 'jobs persist in memory_extraction_jobs and resume on startup',
  });
  await Promise.allSettled(
    ids.map((id) => releaseMemoryExtractionJob(id, `interrupted by ${signal}; resumes on startup`)),
  );
}
