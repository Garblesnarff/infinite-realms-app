import type { NarrationSegment } from '@/hooks/use-ai-response';

type SegmentCarrier = {
  narrationSegments?: NarrationSegment[];
  context?: {
    narration_segments?: NarrationSegment[] | null;
  } | null;
};

export function persistableNarrationSegments(message: SegmentCarrier): NarrationSegment[] | null {
  const segments = message.narrationSegments ?? message.context?.narration_segments;
  return Array.isArray(segments) && segments.length > 0 ? segments : null;
}

export function narrationSegmentsFromPersistedContext(
  context: unknown,
): NarrationSegment[] | undefined {
  if (!context || typeof context !== 'object') {
    return undefined;
  }
  const segments = (context as { narration_segments?: unknown }).narration_segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    return undefined;
  }
  return segments as NarrationSegment[];
}

export function resolveNarrationSegments(
  message: SegmentCarrier,
  explicit?: NarrationSegment[],
): NarrationSegment[] | undefined {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const persisted = persistableNarrationSegments(message);
  return persisted ?? undefined;
}
