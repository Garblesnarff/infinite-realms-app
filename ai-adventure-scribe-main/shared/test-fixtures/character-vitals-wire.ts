/**
 * The exact JSON bodies the client posts to the out-of-combat and in-combat vitals routes
 * (#621 Part A).
 *
 * Shared on purpose: the client test asserts `userDataApi` sends exactly these bodies, and the
 * server tests post the same bodies through the real Elysia route schema (AGENTS.md section 4).
 * A mocked client cannot catch a body the route refuses.
 */

/** `POST /v1/characters/:id/damage` — the client sends this for every damage_taken roll. */
export const DAMAGE_WIRE_BODY = { amount: 8 } as const;

/** `POST /v1/characters/:id/heal` — the client sends this for every heal. */
export const HEAL_WIRE_BODY = { amount: 5 } as const;
