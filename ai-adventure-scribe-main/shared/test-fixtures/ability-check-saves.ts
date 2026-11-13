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

/**
 * The player row as the server stores it after the save (#1477), built from the same
 * `serverVerdictLine` and `narrativeCheckCard` the route runs. The server test asserts these
 * rows match what it writes, so this fixture cannot drift from the server.
 */
export const ABILITY_CHECK_CARD_SUCCESS = {
  kind: 'check',
  side: 'party',
  line: 'Athletics check: 17 vs DC 15, SUCCESS',
  title: 'Athletics check',
  badge: { word: 'SUCCESS', tone: 'gold', icon: 'check' },
  detail: '17 vs DC 15',
};

export const ABILITY_CHECK_CARD_FAIL = {
  kind: 'check',
  side: 'party',
  line: 'Athletics check: 9 vs DC 15, FAIL',
  title: 'Athletics check',
  badge: { word: 'FAIL', tone: 'red', icon: 'alert' },
  detail: '9 vs DC 15',
};

/** A persisted narrative check row with the server's SUCCESS card (total 17 >= DC 15). */
export const ABILITY_CHECK_ROW_SUCCESS = {
  id: ABILITY_CHECK_SAVE_BODY.id,
  sender: 'player' as const,
  text: 'Athletics check: 17 (nat 12+5) success',
  timestamp: ATHLETICS_TIMESTAMP,
  context: {
    ...ABILITY_CHECK_SAVE_BODY.context,
    engineCards: [ABILITY_CHECK_CARD_SUCCESS],
  },
};

/** A persisted row with the server's FAIL card (total 9 < DC 15). The stored word is the server's. */
export const ABILITY_CHECK_ROW_FAIL = {
  id: '55555555-5555-4555-8555-555555555555',
  sender: 'player' as const,
  text: 'Athletics check: 9 (nat 4+5) fail',
  timestamp: ATHLETICS_TIMESTAMP,
  context: {
    ...ABILITY_CHECK_SAVE_BODY.context,
    engineCards: [ABILITY_CHECK_CARD_FAIL],
  },
};

/** A persisted check row with no server card (saved before the outcome, or not issued). */
export const ABILITY_CHECK_ROW_NO_CARD = {
  id: '66666666-6666-4666-8666-666666666666',
  sender: 'player' as const,
  text: 'Athletics check: 17 (nat 12+5) success',
  timestamp: ATHLETICS_TIMESTAMP,
  context: { ...ABILITY_CHECK_SAVE_BODY.context },
};
