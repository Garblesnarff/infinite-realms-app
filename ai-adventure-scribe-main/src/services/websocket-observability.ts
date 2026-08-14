import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

export const MALFORMED_PEER_FRAME_REPORT_INTERVAL_MS = 60 * 1000;

export interface MalformedPeerFrameReportState {
  lastReportedAt: number | null;
  suppressedCount: number;
}

export interface MalformedPeerFrameContext {
  channel: string;
  sessionId?: string;
  error: unknown;
}

export function createMalformedPeerFrameReportState(): MalformedPeerFrameReportState {
  return { lastReportedAt: null, suppressedCount: 0 };
}

/**
 * Keep malformed peer frames non-fatal while making bursts observable. The count is batched
 * into one warning/telemetry report per channel and interval so a noisy peer cannot flood the
 * browser console or the client-failure endpoint.
 */
export function reportMalformedPeerFrame(
  state: MalformedPeerFrameReportState,
  { channel, sessionId, error }: MalformedPeerFrameContext,
  now = Date.now(),
): void {
  state.suppressedCount += 1;

  if (
    state.lastReportedAt !== null &&
    now - state.lastReportedAt < MALFORMED_PEER_FRAME_REPORT_INTERVAL_MS
  ) {
    return;
  }

  const count = state.suppressedCount;
  state.lastReportedAt = now;
  state.suppressedCount = 0;
  const detail = error instanceof Error ? error.message : String(error);

  logger.warn('[WebSocket] Ignoring malformed peer frame', {
    channel,
    count,
    error: detail,
  });
  userDataApi.reportClientFailure(
    'malformed_ws_frame',
    sessionId,
    `channel=${channel}; count=${count}; ${detail}`,
  );
}
