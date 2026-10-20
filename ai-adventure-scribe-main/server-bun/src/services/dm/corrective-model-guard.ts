/**
 * #841: quota + binding gate for corrective model calls.
 *
 * The handout-actions and tactical-map/dm-actions routes fire at most one
 * corrective LLM reprompt per batch (both services use a single shared
 * retried flag per POST; a second refusal is logged/dropped, never looped).
 * Those calls bypassed quota, usage accounting and rate limits, and could be
 * summoned at will with fabricated action batches. Every corrective call now
 * passes this gate:
 *
 * 1. Binding — the request must name the DM reply (message id) whose actions
 *    are being corrected. The reply must be one the server generated for this
 *    session (see dm-turn-action-registry.ts), and when the refusal names a
 *    handout key, that key must be one the DM actually used. This denies
 *    unknown keys and unbound replies. It does not stop a caller replaying a
 *    key the DM did emit — such a call is still charged to the caller's own
 *    llm_system quota and rate-limited, so the remaining exposure is the
 *    caller's own budget.
 * 2. Quota — 'llm_system' (background-task quota, like memory extraction):
 *    the store must be reachable and the quota not exhausted.
 * 3. Charge — checkQuotaAndConsume after a usable correction (#196), plus
 *    recordProviderUsage, exactly as the images and tts routes do. The two
 *    calls are independent: if a racing call loses its charge, the provider
 *    row still records the real spend and the call is not double-charged.
 */

import { dmTurnActions } from './dm-turn-action-registry.js';
import { logger } from '../../lib/logger.js';
import { AIUsageService } from '../ai-usage-service.js';

export type CorrectiveCallKind = 'handout' | 'tactical_map';

/** The AIUsageService surface a corrective call needs; mirrored from tts.ts. */
export type CorrectiveUsageService = Pick<
  typeof AIUsageService,
  'assertUsageStoreAvailable' | 'getQuotaStatus' | 'checkQuotaAndConsume' | 'recordProviderUsage'
>;

export interface PrepareCorrectiveCallParams {
  userId: string;
  plan?: string;
  sessionId: string;
  kind: CorrectiveCallKind;
  /**
   * The DM reply the corrected action came from. Required: without a reply the
   * server generated for this session, the call is refused.
   */
  dmReplyId?: string | null;
  /** The refused action's handout key, when it has one. */
  refusedHandoutKey?: string | null;
  /** Injected by tests; production uses AIUsageService. */
  usageService?: CorrectiveUsageService;
}

export interface CorrectiveCallDenied {
  ok: false;
  reason:
    | 'no_dm_reply'
    | 'handout_key_not_in_dm_reply'
    | 'quota_exceeded'
    | 'usage_store_unavailable';
}

export interface CorrectiveCallAllowed {
  ok: true;
  /** Charge the call now that the model produced a usable correction. Never throws. */
  recordUsage: (result: {
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  }) => Promise<void>;
}

export async function prepareCorrectiveCall(
  params: PrepareCorrectiveCallParams,
): Promise<CorrectiveCallDenied | CorrectiveCallAllowed> {
  const usageService = params.usageService ?? AIUsageService;
  const plan = params.plan || 'free';
  const logBase = { msg: 'CORRECTIVE_CALL_DENIED', sessionId: params.sessionId, kind: params.kind };

  // Binding: the corrected action must come from a DM reply this session owns.
  const entry = params.dmReplyId ? dmTurnActions(params.sessionId, params.dmReplyId) : null;
  if (!entry) {
    logger.info({ ...logBase, reason: 'no_dm_reply' });
    return { ok: false, reason: 'no_dm_reply' };
  }
  if (params.kind === 'handout') {
    if (params.refusedHandoutKey != null && params.refusedHandoutKey.length > 0) {
      // #841 F02: a fabricated unknown key may not summon a paid call.
      if (!entry.handoutKeys.has(params.refusedHandoutKey)) {
        logger.info({ ...logBase, reason: 'handout_key_not_in_dm_reply' });
        return { ok: false, reason: 'handout_key_not_in_dm_reply' };
      }
    } else if (!entry.hasHandoutActions) {
      logger.info({ ...logBase, reason: 'no_dm_reply' });
      return { ok: false, reason: 'no_dm_reply' };
    }
  } else if (!entry.hasMapActions) {
    logger.info({ ...logBase, reason: 'no_dm_reply' });
    return { ok: false, reason: 'no_dm_reply' };
  }

  // Quota check before the provider call, as the images and tts routes do.
  try {
    await usageService.assertUsageStoreAvailable();
  } catch {
    logger.warn({ ...logBase, reason: 'usage_store_unavailable' });
    return { ok: false, reason: 'usage_store_unavailable' };
  }
  const quota = await usageService.getQuotaStatus({ userId: params.userId, plan, type: 'llm_system' });
  if (quota.remaining < 1) {
    logger.info({ ...logBase, reason: 'quota_exceeded' });
    return { ok: false, reason: 'quota_exceeded' };
  }

  const recordUsage = async (result: {
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void> => {
    try {
      // Charge only now that a usable correction exists (#196). A racing call
      // at limit-1 can still pass the check above; its charge is then refused
      // by the store — the correction was still produced, the provider row
      // below still records the real spend, and nothing is double-charged.
      await usageService.checkQuotaAndConsume({
        userId: params.userId,
        plan,
        type: 'llm_system',
        units: 1,
      });
    } catch (error) {
      // The correction already exists: a failed charge must not turn the
      // request into a 500. Log and move on, as the images/tts routes do for
      // their recording step.
      logger.warn({
        msg: 'CORRECTIVE_CALL_USAGE_FAILED',
        sessionId: params.sessionId,
        kind: params.kind,
        stage: 'charge',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await usageService.recordProviderUsage({
        userId: params.userId,
        plan,
        type: 'llm_system',
        provider: result.provider || 'unknown',
        model: result.model,
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
        sessionId: params.sessionId,
      });
    } catch (error) {
      logger.warn({
        msg: 'CORRECTIVE_CALL_USAGE_FAILED',
        sessionId: params.sessionId,
        kind: params.kind,
        stage: 'record',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return { ok: true, recordUsage };
}
