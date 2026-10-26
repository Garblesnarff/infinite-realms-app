/**
 * #1084: the shared ending-reply fixture is the route's real output. The
 * client test drives `ONESHOT_ENDING_DONE_PAYLOAD` to the end-state screen;
 * this pins its `text` to what `rewriteNarrationSegmentsFromEnvelope` (the
 * /v1/llm/generate response-text rewrite) produces for the applied envelope,
 * so the fixture cannot drift from the producer.
 */
import { describe, expect, it } from 'bun:test';

import {
  ONESHOT_ENDING_DONE_PAYLOAD,
  ONESHOT_ENDING_ENVELOPE,
  ONESHOT_ENDING_SUMMARY,
} from '../../../../../shared/test-fixtures/oneshot-ending-reply';
import { rewriteNarrationSegmentsFromEnvelope } from '../dm-response-schema';

describe('one-shot ending reply fixture (#1084)', () => {
  it('is the route rewrite of the applied ending envelope', () => {
    const envelope = structuredClone(ONESHOT_ENDING_ENVELOPE) as Record<string, unknown>;
    const text = rewriteNarrationSegmentsFromEnvelope(
      envelope,
      JSON.stringify(ONESHOT_ENDING_ENVELOPE),
      'narrative',
    );
    expect(text).toBe(ONESHOT_ENDING_DONE_PAYLOAD.text);
    expect(JSON.parse(text).campaign_ending).toEqual({ summary: ONESHOT_ENDING_SUMMARY });
  });
});
