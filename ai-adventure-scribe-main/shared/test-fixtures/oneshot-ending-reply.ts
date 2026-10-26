/**
 * #1084: a one-shot's ending reply as POST /v1/llm/generate sends it.
 *
 * Producer: the route's response-text rewrite in
 * `server-bun/src/routes/v1/llm.ts` — `rewriteNarrationSegmentsFromEnvelope`
 * (`server-bun/src/services/dm/dm-response-schema.ts`) over the parsed
 * envelope after `applyStoryEnding` set `campaign_ending` to the stored
 * summary. `ONESHOT_ENDING_DONE_PAYLOAD.text` is that function's exact output
 * for `ONESHOT_ENDING_ENVELOPE` in the narrative phase; the server test
 * `oneshot-ending-reply.fixture.test.ts` pins it, and the client test drives
 * it through the streamed path to the end-state screen.
 */
export const ONESHOT_ENDING_SUMMARY =
  'The wish is amended at a fair price, and the debt is paid in full.';

/** The applied envelope the route rewrites (model reply + server-set ending). */
export const ONESHOT_ENDING_ENVELOPE = {
  text: 'The last coin settles in the ledger, and the wish closes around you like a door. The road home is open.',
  options: [],
  roll_requests: [],
  combat_transition: 'none',
  xp_award: null,
  campaign_ending: { summary: ONESHOT_ENDING_SUMMARY },
} as const;

/** The SSE `done` event's payload (same shape as the JSON response). */
export const ONESHOT_ENDING_DONE_PAYLOAD = {
  parsed: true,
  text: '{"text":"The last coin settles in the ledger, and the wish closes around you like a door. The road home is open.","options":[],"roll_requests":[],"combat_transition":"none","xp_award":null,"campaign_ending":{"summary":"The wish is amended at a fair price, and the debt is paid in full."},"combat_actions":[],"map_actions":[]}',
  provider: 'openrouter',
  model: 'test-model',
  usageIds: [],
  dmReplyPersisted: true,
  dmReplyMessageId: 'dm-reply-1084',
} as const;
