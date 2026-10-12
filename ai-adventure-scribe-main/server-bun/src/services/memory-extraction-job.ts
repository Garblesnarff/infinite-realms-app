import { randomUUID } from 'crypto';

import { AIUsageService } from './ai-usage-service.js';
import { LLMProviderService } from './llm-provider-service.js';
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
 * The job lives in this process only. A restart mid-job loses that one extraction, which is
 * no worse than today, where every extraction is lost.
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

/**
 * Run one extraction to completion. Never throws: this runs with no caller to throw to.
 *
 * Rows are written by a single multi-row INSERT after the model call succeeds and parses, so a
 * failed model call — or a failed write — leaves no partial rows behind.
 */
export async function runMemoryExtractionJob(
  jobId: string,
  input: MemoryExtractionJobInput,
): Promise<{ inserted: number; status: 'completed' | 'failed' }> {
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
      return { inserted: 0, status: 'failed' };
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
    logger.error({
      ...logBase,
      msg: 'memory_extraction.failed',
      stage: 'exception',
      error: error instanceof Error ? error.message : String(error),
      durationMs: elapsed(),
    });
    return { inserted: 0, status: 'failed' };
  }
}

// Jobs accepted but not yet finished. A restart drops them; shutdown logs how many (#2186).
let inFlightJobs = 0;

export function inFlightMemoryExtractionJobs(): number {
  return inFlightJobs;
}

/** Shutdown hook: record the jobs this process is about to drop, so a lost extraction is visible. */
export function logAbandonedMemoryExtractionJobs(signal: string): void {
  if (inFlightJobs === 0) return;
  logger.warn({ msg: 'memory_extraction.abandoned', count: inFlightJobs, signal });
}

/** Start a job without waiting for it. Returns the id the 202 hands back. */
export function startMemoryExtractionJob(input: MemoryExtractionJobInput): {
  jobId: string;
  done: Promise<{ inserted: number; status: 'completed' | 'failed' }>;
} {
  const jobId = randomUUID();
  logger.info({
    jobId,
    sessionId: input.sessionId,
    kind: input.kind,
    turn: input.turn,
    promptLength: input.prompt.length,
    msg: 'memory_extraction.accepted',
  });
  inFlightJobs += 1;
  // runMemoryExtractionJob never rejects, so finally always runs exactly once per job.
  const done = runMemoryExtractionJob(jobId, input).finally(() => {
    inFlightJobs -= 1;
  });
  return { jobId, done };
}
