/**
 * Turn-1 shapes from the two stranger runs that dead-ended on their first check (#2280), and the
 * exact body the client posts to `POST /v1/sessions/:id/messages` for each DM reply.
 *
 * Shared on purpose. #2250's client tests mocked the API, so a body the route's schema refuses
 * (`message: ''` against `minLength: 1`) passed every test and 422'd on every narrative roll in
 * production. The client test asserts the save queue sends exactly `wireBody`; the server test
 * posts that same `wireBody` through the real route schema and the real error pipeline.
 */

export interface DmRollReplyTurn {
  name: string;
  /** The row id the client reserves for the turn (`dmMessageId`). */
  dmMessageId: string;
  timestamp: string;
  playerInput: string;
  reply: {
    text: string;
    narrationSegments: Array<{ type: 'dm' | 'character'; text: string; character?: string }>;
    context: { emotion: string; intent: string; combat_transition: 'none' };
  };
  rollRequests: Array<{
    type: 'skill_check';
    formula: string;
    purpose: string;
    dc?: number;
  }>;
  /** The DM row as the client saves it. */
  wireBody: Record<string, unknown>;
}

function wireBody(turn: Omit<DmRollReplyTurn, 'wireBody'>): Record<string, unknown> {
  return {
    id: turn.dmMessageId,
    message: turn.reply.text,
    speaker_type: 'dm',
    context: {
      location: null,
      emotion: turn.reply.context.emotion,
      intent: turn.reply.context.intent,
      handouts: null,
      combat_transition: turn.reply.context.combat_transition,
      scene_spec: false,
      combat_engine_blocks: null,
      combat_ended: false,
      narration_segments: turn.reply.narrationSegments,
      rollRequests: turn.rollRequests.map((request, index) => ({
        ...request,
        rollRequestId: `${turn.dmMessageId}:roll:${index}`,
      })),
    },
    timestamp: turn.timestamp,
  };
}

const run11: Omit<DmRollReplyTurn, 'wireBody'> = {
  name: 'run 11 (The Faithful, The Eternal Feast): Insight on turn 1',
  dmMessageId: '0354e278-af2a-442c-9f01-dd702ae0a9ad',
  timestamp: '2026-09-26T03:03:05.900Z',
  playerInput:
    '"I am here to serve, as Helm serves." I study Remy\'s face closely while he talks. Is he hiding something about the previous owner?',
  reply: {
    text: 'Remy\'s smile holds a beat too long. "Serve," he repeats, in that smooth, radio-host baritone, the word crackling like static. His eyes flick to the portrait above the bar and back. Read him, if you can.',
    narrationSegments: [
      { type: 'dm', text: "Remy's smile holds a beat too long." },
      { type: 'character', character: 'Remy', text: '"Serve," he repeats.' },
    ],
    context: { emotion: 'neutral', intent: 'response', combat_transition: 'none' },
  },
  rollRequests: [
    {
      type: 'skill_check',
      formula: '1d20+6',
      purpose: "Insight check to read Remy's motives and determine if he is hiding information",
      dc: 15,
    },
  ],
};

const m5: Omit<DmRollReplyTurn, 'wireBody'> = {
  name: 'run M5 (The Apprentice, Academy of Arcane Gastronomy): Perception on turn 1',
  dmMessageId: '7c1d5a52-3f0e-4a8b-9d2a-5e41b8c0f7aa',
  timestamp: '2026-09-26T03:02:10.000Z',
  playerInput:
    'I follow the scorched-sugar smell down the corridor, staying alert — I look around for anything dangerous, strange, or out of place.',
  reply: {
    text: 'The corridor narrows. Scorched sugar hangs in the air, and somewhere ahead a copper pot rattles on its hook though nothing touches it. Look carefully.',
    narrationSegments: [{ type: 'dm', text: 'The corridor narrows.' }],
    context: { emotion: 'neutral', intent: 'response', combat_transition: 'none' },
  },
  rollRequests: [
    {
      type: 'skill_check',
      formula: '1d20+1',
      purpose: 'Perception check to notice anything unusual or dangerous in the corridor',
    },
  ],
};

export const RUN_11_INSIGHT: DmRollReplyTurn = { ...run11, wireBody: wireBody(run11) };
export const M5_PERCEPTION: DmRollReplyTurn = { ...m5, wireBody: wireBody(m5) };
export const DM_ROLL_REPLY_TURNS: DmRollReplyTurn[] = [RUN_11_INSIGHT, M5_PERCEPTION];

/** What #2250 posted for run 11's turn: a second, text-less row under the reply's id. */
export const TEXTLESS_PENDING_ROLL_BODY: Record<string, unknown> = {
  id: run11.dmMessageId,
  message: '',
  speaker_type: 'dm',
  context: {
    location: null,
    emotion: null,
    intent: 'pending_roll_request',
    handouts: null,
    combat_transition: null,
    scene_spec: false,
    combat_engine_blocks: null,
    combat_ended: false,
    narration_segments: null,
    rollRequests: run11.rollRequests,
  },
  timestamp: run11.timestamp,
};

/**
 * #2291: the system line saved when the player cancels run 11's Insight check, as the client's
 * save queue posts it (`declinedRollMessage` → `use-message-queue`), under a fixed id and time.
 */
export const DECLINED_ROLL_LINE = {
  id: '5f0b7c1e-2d4a-4e8f-9a61-3c2b1d0e9f77',
  timestamp: '2026-09-26T03:03:20.000Z',
  text: `You chose not to roll: ${run11.rollRequests[0]?.purpose}.`,
};

export const DECLINED_ROLL_BODY: Record<string, unknown> = {
  id: DECLINED_ROLL_LINE.id,
  message: DECLINED_ROLL_LINE.text,
  speaker_type: 'system',
  context: {
    location: null,
    emotion: null,
    intent: 'roll_declined',
    handouts: null,
    combat_transition: null,
    scene_spec: false,
    combat_engine_blocks: null,
    combat_ended: false,
    narration_segments: null,
  },
  timestamp: DECLINED_ROLL_LINE.timestamp,
};
