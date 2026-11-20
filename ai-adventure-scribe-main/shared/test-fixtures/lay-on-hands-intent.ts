/**
 * #1554: the exact bodies the client sends for Lay on Hands. The client wire test asserts the
 * client sends exactly these (src/services/combat/__tests__/lay-on-hands-intent-wire.test.ts);
 * the server schema test checks the combat body against the real route schema
 * (server-bun/src/routes/v1/combat/__tests__/lay-on-hands-intent-schema.test.ts), and the real-DB
 * route suite posts the sheet bodies through the real route (AGENTS.md §4).
 */

/** A heal of 5 from the action bar chip, sent as the intent route body. */
export const LAY_ON_HANDS_HEAL_INTENT_BODY = {
  intent: {
    type: 'lay_on_hands',
    actorId: 'participant-paladin',
    targetId: 'participant-ally',
    amount: 5,
    expectedVersion: 7,
  },
  source: 'player',
  origin: 'action_bar',
} as const;

/**
 * #1670: a heal the player chose in the More stepper: 3 of the 5 points the chip offered. The
 * stepper's amount travels as the intent's `amount`, so the wire body is the one the route accepts.
 */
export const LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY = {
  intent: {
    type: 'lay_on_hands',
    actorId: 'participant-paladin',
    targetId: 'participant-ally',
    amount: 3,
    expectedVersion: 7,
  },
  source: 'player',
  origin: 'action_bar',
} as const;

/** A poison cure from the action bar chip: 5 points, no amount. */
export const LAY_ON_HANDS_CURE_INTENT_BODY = {
  intent: {
    type: 'lay_on_hands',
    actorId: 'participant-paladin',
    targetId: 'participant-paladin',
    cure: 'poison',
    expectedVersion: 7,
  },
  source: 'player',
  origin: 'action_bar',
} as const;

/** The sheet's Lay on Hands row, heal self 5 out of combat (POST /v1/characters/:id/lay-on-hands). */
export const LAY_ON_HANDS_SHEET_HEAL_BODY = { amount: 5 } as const;

/** The sheet's Lay on Hands row, cure a disease out of combat. */
export const LAY_ON_HANDS_SHEET_CURE_BODY = { cure: 'disease' } as const;
