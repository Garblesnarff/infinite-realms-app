/**
 * #1576: the exact body the sheet sends for Second Wind (POST /v1/characters/:id/second-wind).
 * The client wire test asserts the client sends exactly this (src/services/__tests__/second-wind-wire.test.ts);
 * the real-DB route suite posts it through the real characters route (AGENTS.md §4).
 */
export const SECOND_WIND_SHEET_BODY = {} as const;
