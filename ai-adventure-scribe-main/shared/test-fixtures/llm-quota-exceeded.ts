/**
 * The daily-quota refusal of `POST /v1/llm/generate`, on both sides of the wire (#2443).
 *
 * Run M10: the free plan's 30th `llm` unit was spent at 02:27:55Z and the next generate was
 * answered 402 in 6 ms. `llm-generate-quota-402.test.ts` posts a DM-turn body through the real
 * route and asserts this exact answer; the client tests feed it to the real client.
 */

/** When the plan's usage period turns over; the route serialises the `Date` it gets from the service. */
export const QUOTA_RESET_AT = '2026-10-02T00:00:00.000Z';

/** The JSON body the route returns (`server-bun/src/routes/v1/llm.ts`, the `!quota.allowed` branch). */
export const quotaExceededBody = {
  error: 'AI quota exceeded',
  remaining: 0,
  resetAt: QUOTA_RESET_AT,
};
