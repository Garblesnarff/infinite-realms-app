/**
 * Scene State Client
 *
 * Reads the server-rendered `<scene_state>` ground-truth block for a session.
 *
 * The block is built server-side from the `narrative_facts` ledger by lookup (not by
 * similarity retrieval), so the client never assembles or interprets facts — it fetches
 * an opaque string and hands it to the prompt builder verbatim. Ground truth that cannot
 * be read is simply absent: this never throws, because a missing scene state must degrade
 * the turn's quality, not break the turn.
 *
 * Degrading is not the same as going quiet, though. v2 guardrail 3 forbids silent catches
 * on continuity paths, so a failed read still reports `scene_state_fetch_failed` through
 * the client-failure telemetry route (#1680), which pages via the same server-side
 * `alert()` as `scene_state_render_failed`. The report is fire-and-forget by contract and
 * cannot delay or fail the turn.
 */
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

export async function fetchSceneState(sessionId: string): Promise<string | null> {
  try {
    const data = await userDataApi.getNarrativeSceneState(sessionId);
    const block = data?.scene_state;
    return typeof block === 'string' && block.trim().length > 0 ? block : null;
  } catch (sceneStateError) {
    logger.warn('[SceneState] Failed to fetch scene state (non-fatal):', sceneStateError);
    userDataApi.reportClientFailure(
      'scene_state_fetch_failed',
      sessionId,
      sceneStateError instanceof Error ? sceneStateError.message : String(sceneStateError),
    );
    return null;
  }
}
