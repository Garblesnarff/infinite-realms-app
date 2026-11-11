/**
 * #1477: the save the client posts today for a narrative ability check (Athletics outside a fight).
 *
 * The body carries the formatter line and the `rollRequestId` only. No `engineCards`, no badge and
 * no outcome field: the server writes those (`server-bun/src/routes/v1/session-messages.ts`).
 * Shared so the server test posts this exact body through the real route schema.
 */

/** The DM row that issued the check (the client's reserved `dmMessageId`). */
export const ATHLETICS_DM_ROW_ID = '33333333-3333-4333-8333-333333333333';
export const ATHLETICS_ROLL_REQUEST_ID = `${ATHLETICS_DM_ROW_ID}:roll:0`;
export const ATHLETICS_DC = 15;
export const ATHLETICS_TIMESTAMP = '2026-11-11T02:00:00.000Z';

/** The formatter line the client writes. Its `success` word is the client's, not the verdict. */
export const ATHLETICS_CHECK_LINE = 'Athletics check: 17 (nat 12+5) success';

export const ABILITY_CHECK_SAVE_BODY = {
  id: '44444444-4444-4444-8444-444444444444',
  timestamp: ATHLETICS_TIMESTAMP,
  message: ATHLETICS_CHECK_LINE,
  speaker_type: 'player',
  context: {
    location: null,
    emotion: null,
    intent: 'dice_roll',
    rollRequestId: ATHLETICS_ROLL_REQUEST_ID,
    handouts: null,
    combat_transition: null,
    scene_spec: false,
    combat_engine_blocks: null,
    combat_ended: false,
    narration_segments: null,
  },
};
