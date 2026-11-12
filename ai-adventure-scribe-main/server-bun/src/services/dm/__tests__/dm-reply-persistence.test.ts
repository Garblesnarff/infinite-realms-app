/* eslint-disable max-lines -- the boundary, the written text, the never-throw contract and the watchdog. */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// #2218: the server keeps the DM reply it generated. These cover the boundary (which turns the
// server may write), the text it writes, the never-throw contract, and the watchdog line.

type AddMessageCall = { data: Record<string, unknown>; userId: string };
let addMessageCalls: AddMessageCall[] = [];
let addMessageImpl: () => Promise<unknown> = async () => ({ id: 'row' });
let warnings: Record<string, unknown>[] = [];
let errors: Record<string, unknown>[] = [];
type PublishCall = { sessionId: string; messageId: string; rollRequests: unknown[] };
let publishCalls: PublishCall[] = [];
let publishImpl: (params: PublishCall) => void = (params) => {
  publishCalls.push(params);
};

mock.module('../../session/session-message-service.js', () => ({
  SessionMessageService: {
    addMessage: async (data: Record<string, unknown>, userId: string) => {
      addMessageCalls.push({ data, userId });
      return addMessageImpl();
    },
  },
}));
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (line: unknown) => warnings.push(line as Record<string, unknown>),
  error: (line: unknown) => errors.push(line as Record<string, unknown>),
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));

mock.module('../dm-fallback-broadcast.js', () => ({
  publishDmFallbackRow: (params: PublishCall) => publishImpl(params),
}));

const {
  canTransitionDmReply,
  DM_REPLY_RECORD_EXPIRY_MS,
  dmReplySkipReason,
  expireStaleHeldReplies,
  persistFallbackDmReply,
  persistGeneratedDmReply,
  provisionalDmText,
  publishHeldReplyAtSeating,
  publishReadyDmReply,
  scheduleDmReplyWatchdog,
} = await import('../dm-reply-persistence.js');

type DmReplyRecord = {
  id: string;
  sessionId: string;
  userId: string;
  state: DmReplyRecordState;
  text: string;
  envelope: Record<string, unknown> | null;
  createdAt: Date;
};
type DmReplyRecordState = 'held' | 'ready' | 'persisted' | 'cancelled';
type DmReplyTransitionResult =
  | { ok: true; state: DmReplyRecordState }
  | { ok: false; reason: 'no_record' | 'illegal_from'; state?: DmReplyRecordState };
interface DmReplyRecordStore {
  read(id: string): Promise<DmReplyRecord | null>;
  insertHeld(record: Omit<DmReplyRecord, 'state' | 'createdAt'>): Promise<void>;
  transition(id: string, to: DmReplyRecordState): Promise<DmReplyTransitionResult>;
}

// The shape the model actually returns on an ordinary exploration turn: every array present,
// most of them empty (dmResponseSchema requires them).
const explorationEnvelope = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  text: 'Cold air rises from the stair. Somewhere below, water drips on stone.',
  options: [
    'A. **Descend carefully**, testing each step.',
    'B. **Listen**, hold still and wait for another sound.',
  ],
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
  ...overrides,
});

const MESSAGE_ID = '5d0f2c1e-8a4b-4c3d-9e2f-1a2b3c4d5e6f';

beforeEach(() => {
  addMessageCalls = [];
  addMessageImpl = async () => ({ id: MESSAGE_ID });
  warnings = [];
  errors = [];
  publishCalls = [];
  publishImpl = (params) => {
    publishCalls.push(params);
  };
});

describe('dmReplySkipReason — the same boundary as the client early render', () => {
  test('an ordinary exploration turn is persistable', () => {
    expect(dmReplySkipReason(explorationEnvelope())).toBeNull();
  });

  test('a narrative roll turn is held back: its prose may run past the roll (#2139)', () => {
    expect(
      dmReplySkipReason(
        explorationEnvelope({ roll_requests: [{ type: 'skill_check', formula: '1d20+3' }] }),
      ),
    ).toBe('roll_requests');
  });

  test('combat entry, pending entry and combat actions are held back', () => {
    expect(dmReplySkipReason(explorationEnvelope({ combat_transition: 'start' }))).toBe(
      'combat_start',
    );
    expect(
      dmReplySkipReason(explorationEnvelope({ combat_entry_pending: { trigger: 'model' } })),
    ).toBe('combat_entry_pending');
    expect(dmReplySkipReason(explorationEnvelope({ combat_actions: [{ type: 'attack' }] }))).toBe(
      'combat_actions',
    );
    expect(dmReplySkipReason(explorationEnvelope({ combatants: [{ name: 'Ghoul' }] }))).toBe(
      'combat_actions',
    );
  });

  test('a reply claiming harm is held back until the client has ruled on it (#2373)', () => {
    expect(
      dmReplySkipReason(
        explorationEnvelope({
          text:
            'As you speak, you narrowly avoid a strike from the entity, though a glancing blow ' +
            'still leaves you feeling rattled and wounded.',
        }),
      ),
    ).toBe('unverified_harm_claim');
    // The player's own spell, narrated outside combat, is not a claim against them.
    expect(
      dmReplySkipReason(explorationEnvelope({ text: 'Your spell lights the corridor ahead.' })),
    ).toBeNull();
  });

  test('a roll-result turn is not run through the harm detector: the client gate does not run there', () => {
    const harmful = explorationEnvelope({
      text:
        'As you speak, you narrowly avoid a strike from the entity, though a glancing blow ' +
        'still leaves you feeling rattled and wounded.',
    });
    expect(dmReplySkipReason(harmful, { narrationGated: false })).toBeNull();
    // A silent turn, and a client that does not say, keep the detector.
    expect(dmReplySkipReason(harmful, { narrationGated: true })).toBe('unverified_harm_claim');
    expect(dmReplySkipReason(harmful)).toBe('unverified_harm_claim');
    // Everything else the client holds back stays held back on a roll turn.
    expect(
      dmReplySkipReason(
        { ...harmful, roll_requests: [{ type: 'skill_check', formula: '1d20' }] },
        { narrationGated: false },
      ),
    ).toBe('roll_requests');
  });

  test('an unparsed or empty completion is not written', () => {
    expect(dmReplySkipReason(null)).toBe('unparsed_envelope');
    expect(dmReplySkipReason(explorationEnvelope({ text: '   ' }))).toBe('empty_text');
  });
});

describe('provisionalDmText', () => {
  test('narration then the lettered options, as the early render builds it', () => {
    expect(provisionalDmText(explorationEnvelope())).toBe(
      'Cold air rises from the stair. Somewhere below, water drips on stone.\n\n' +
        'A. **Descend carefully**, testing each step.\n' +
        'B. **Listen**, hold still and wait for another sound.',
    );
  });

  test('narration alone when the model gave no options', () => {
    expect(provisionalDmText(explorationEnvelope({ options: [] }))).toBe(
      'Cold air rises from the stair. Somewhere below, water drips on stone.',
    );
  });

  test('each offered choice once when the model repeated its options (#864)', () => {
    expect(
      provisionalDmText(
        explorationEnvelope({
          options: [
            'A. **Descend carefully**, testing each step.',
            'B. **Listen**, hold still and wait for another sound.',
            'C. **Descend carefully**, testing each step.',
            'D. **Listen**, hold still and wait for another sound.',
          ],
        }),
      ),
    ).toBe(
      'Cold air rises from the stair. Somewhere below, water drips on stone.\n\n' +
        'A. **Descend carefully**, testing each step.\n' +
        'B. **Listen**, hold still and wait for another sound.',
    );
  });

  test('each offered choice once when the model also wrote them into the text (#864 reopened)', () => {
    expect(
      provisionalDmText(
        explorationEnvelope({
          text:
            'Cold air rises from the stair. Somewhere below, water drips on stone.\n\n' +
            'A. **Descend carefully**, testing each step.\n' +
            'B. **Listen**, hold still and wait for another sound.',
        }),
      ),
    ).toBe(
      'Cold air rises from the stair. Somewhere below, water drips on stone.\n\n' +
        'A. **Descend carefully**, testing each step.\n' +
        'B. **Listen**, hold still and wait for another sound.',
    );
  });
});

describe('persistGeneratedDmReply', () => {
  test('writes one provisional dm row under the reserved id, for the session owner', async () => {
    const result = await persistGeneratedDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      envelope: explorationEnvelope(),
    });

    expect(result).toEqual({ persisted: true });
    expect(addMessageCalls).toHaveLength(1);
    expect(addMessageCalls[0]).toEqual({
      userId: 'user-1',
      data: expect.objectContaining({
        id: MESSAGE_ID,
        sessionId: 'session-1',
        speakerType: 'dm',
        message: provisionalDmText(explorationEnvelope()),
        context: expect.objectContaining({ provisional: true, intent: 'response' }),
      }),
    });
  });

  test('writes nothing for a turn the client reports as in combat', async () => {
    const result = await persistGeneratedDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      envelope: explorationEnvelope(),
      clientInCombat: true,
    });

    expect(result).toEqual({ persisted: false, reason: 'client_in_combat' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('writes nothing for a cancellable sheet cast, so reload cannot resurrect its prose (#1021)', async () => {
    const result = await persistGeneratedDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      envelope: explorationEnvelope(),
      holdProse: true,
    });

    expect(result).toEqual({ persisted: false, reason: 'client_cancellable' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('the fallback never resurrects a cancelled sheet cast, even one carrying a roll request (#1021)', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'client_cancellable',
      envelope: explorationEnvelope({
        text: 'The bolt streaks toward the goblin.',
        roll_requests: [{ type: 'attack', formula: '1d20+5' }],
      }),
    });

    expect(result).toEqual({ persisted: false, skipped: 'client_cancellable' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('writes nothing for a roll turn and says why', async () => {
    const result = await persistGeneratedDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      envelope: explorationEnvelope({ roll_requests: [{ type: 'save', formula: '1d20' }] }),
    });

    expect(result).toEqual({ persisted: false, reason: 'roll_requests' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('writes nothing for a reply claiming harm: the client saves the one it keeps (#2373)', async () => {
    const result = await persistGeneratedDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      envelope: explorationEnvelope({ text: 'The blow leaves you wounded and bleeding.' }),
    });

    expect(result).toEqual({ persisted: false, reason: 'unverified_harm_claim' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('a failed write never throws, and is logged at error', async () => {
    addMessageImpl = async () => {
      throw new Error('Session not found');
    };

    const result = await persistGeneratedDmReply({
      userId: 'user-1',
      sessionId: 'someone-elses-session',
      messageId: MESSAGE_ID,
      envelope: explorationEnvelope(),
    });

    expect(result).toEqual({ persisted: false, reason: 'write_failed' });
    expect(errors).toEqual([
      expect.objectContaining({
        msg: 'DM_REPLY_SERVER_PERSIST_FAILED',
        sessionId: 'someone-elses-session',
      }),
    ]);
  });
});

describe('scheduleDmReplyWatchdog', () => {
  test('persists a server-side fallback and logs DM_REPLY_UNPERSISTED when this turn was never saved', async () => {
    let checked: string | undefined;

    await scheduleDmReplyWatchdog({
      sessionId: '175d1a5c-0000-4000-8000-000000000000',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      generatedAt: new Date('2026-08-26T09:53:49.900Z'),
      envelope: explorationEnvelope({
        text: 'Dust coats every surface. Something glints under the desk.',
        roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Search the room', dc: 15 }],
      }),
      userId: 'user-1',
      delayMs: 5,
      hasDmRow: async (messageId) => {
        checked = messageId;
        return false;
      },
    });

    // Turn-granular: a later turn's row must not mask this turn's loss (#783).
    expect(checked).toBe(MESSAGE_ID);
    // The fallback row carries the reply under the turn's id, with the roll
    // requests in context so a reload restores the popup (#783).
    expect(addMessageCalls).toHaveLength(1);
    expect(addMessageCalls[0]?.data).toMatchObject({
      id: MESSAGE_ID,
      sessionId: '175d1a5c-0000-4000-8000-000000000000',
      speakerType: 'dm',
      message:
        'Dust coats every surface. Something glints under the desk.\n\nA. **Descend carefully**, testing each step.\nB. **Listen**, hold still and wait for another sound.',
      context: expect.objectContaining({
        intent: 'response',
        provisional: true,
        rollRequests: [{ type: 'check', formula: '1d20', purpose: 'Search the room', dc: 15 }],
      }),
    });
    expect(addMessageCalls[0]?.userId).toBe('user-1');
    expect(warnings).toEqual([
      {
        msg: 'DM_REPLY_UNPERSISTED',
        sessionId: '175d1a5c-0000-4000-8000-000000000000',
        messageId: MESSAGE_ID,
        reason: 'roll_requests',
        waitedMs: 5,
        fallbackPersisted: true,
      },
    ]);
  });

  test('names the rolls when the envelope has no prose', async () => {
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      generatedAt: new Date(),
      envelope: explorationEnvelope({
        text: '  ',
        roll_requests: [{ type: 'save', formula: '1d20+2', purpose: 'Dodge the falling rocks' }],
      }),
      userId: 'user-1',
      delayMs: 5,
      hasDmRow: async () => false,
    });

    expect(addMessageCalls).toHaveLength(1);
    expect(addMessageCalls[0]?.data).toMatchObject({
      message: 'The DM asks for a roll: Dodge the falling rocks.',
    });
    expect(warnings).toEqual([
      expect.objectContaining({ msg: 'DM_REPLY_UNPERSISTED', fallbackPersisted: true }),
    ]);
  });

  test('logs without a fallback when there is no envelope to persist', async () => {
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'unparsed_envelope',
      generatedAt: new Date(),
      envelope: null,
      userId: 'user-1',
      delayMs: 5,
      hasDmRow: async () => false,
    });

    expect(addMessageCalls).toHaveLength(0);
    expect(warnings).toEqual([
      expect.objectContaining({ msg: 'DM_REPLY_UNPERSISTED', fallbackPersisted: false }),
    ]);
  });

  test('logs without a fallback for gate-rejected prose', async () => {
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'unverified_harm_claim',
      generatedAt: new Date(),
      envelope: explorationEnvelope({
        text: 'The blow leaves you wounded and bleeding.',
        roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Stay conscious' }],
      }),
      userId: 'user-1',
      delayMs: 5,
      hasDmRow: async () => false,
    });

    // The narration gate rejected this prose; the fallback must not resurrect it (#2373).
    expect(addMessageCalls).toHaveLength(0);
    expect(warnings).toEqual([
      expect.objectContaining({ msg: 'DM_REPLY_UNPERSISTED', fallbackPersisted: false }),
    ]);
  });

  test('logs without a fallback for combat turns', async () => {
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'combat_start',
      generatedAt: new Date(),
      envelope: explorationEnvelope({
        text: 'The goblin raises its blade.',
        combat_transition: 'start',
        roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Spot the ambush' }],
      }),
      userId: 'user-1',
      delayMs: 5,
      hasDmRow: async () => false,
      // #1416: inject the encounter seam; the default would query the database here.
      hasActiveEncounter: async () => false,
    });

    expect(addMessageCalls).toHaveLength(0);
    expect(warnings).toEqual([
      expect.objectContaining({ msg: 'DM_REPLY_UNPERSISTED', fallbackPersisted: false }),
    ]);
  });

  test('stays quiet when the client saved the reply', async () => {
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      generatedAt: new Date(),
      delayMs: 5,
      hasDmRow: async () => true,
    });

    expect(warnings).toEqual([]);
    expect(addMessageCalls).toHaveLength(0);
  });

  test('a failing check is reported, not thrown', async () => {
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      generatedAt: new Date(),
      delayMs: 5,
      hasDmRow: async () => {
        throw new Error('connection reset');
      },
    });

    expect(warnings).toEqual([
      expect.objectContaining({ msg: 'DM_REPLY_WATCHDOG_FAILED', sessionId: 'session-1' }),
    ]);
  });
});

describe('persistFallbackDmReply', () => {
  test('writes nothing without an envelope', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: null,
    });
    expect(result).toEqual({ persisted: false });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('writes nothing without roll requests', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope(),
    });
    expect(result).toEqual({ persisted: false });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('skips gate-rejected prose', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'unverified_harm_claim',
      envelope: explorationEnvelope({
        roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Stay conscious' }],
      }),
    });
    expect(result).toEqual({ persisted: false, skipped: 'unverified_harm_claim' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('skips combat turns', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'combat_start',
      envelope: explorationEnvelope({
        combat_transition: 'start',
        roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Spot the ambush' }],
      }),
    });
    expect(result).toEqual({ persisted: false, skipped: 'combat_start' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('a combat envelope with roll requests is skipped even when the reason is roll_requests', async () => {
    // dmReplySkipReason returns 'roll_requests' before the combat checks, so the
    // watchdog arrives with reason 'roll_requests'; the envelope conditions must
    // still hold the fallback back.
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        combat_transition: 'start',
        roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Spot the ambush' }],
      }),
    });
    expect(result).toEqual({ persisted: false, skipped: 'combat_start' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('a failed write never throws, and is logged at error', async () => {
    addMessageImpl = async () => {
      throw new Error('Session not found');
    };
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Search the room' }],
      }),
    });
    expect(result).toEqual({ persisted: false });
    expect(errors).toEqual([
      expect.objectContaining({
        msg: 'DM_REPLY_FALLBACK_PERSIST_FAILED',
        sessionId: 'session-1',
      }),
    ]);
  });

  test('writes the narration without the superseded roll requests when the fight is live (#1390)', async () => {
    // The gate-rewritten envelope: combat_transition 'none' plus the pending
    // entry, carrying the initiative roll request the fight superseded.
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        combat_transition: 'none',
        combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
        roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      }),
      hasActiveEncounter: async () => true,
      declinedActorKeys: async () => [],
    });
    expect(result).toEqual({ persisted: true });
    expect(addMessageCalls).toHaveLength(1);
    const data = addMessageCalls[0]?.data as Record<string, unknown>;
    expect(data['message']).toContain('Cold air rises from the stair');
    const context = data['context'] as Record<string, unknown>;
    expect(context['combat_transition']).toBe('none');
    expect(context['provisional']).toBe(true);
    expect('rollRequests' in context).toBe(false);
    expect(publishCalls).toHaveLength(0);
  });

  test('still skips the combat envelope when no fight is live (#1390)', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        combat_transition: 'none',
        combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
        roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      }),
      hasActiveEncounter: async () => false,
    });
    expect(result).toEqual({ persisted: false, skipped: 'combat_entry_pending' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('a combat_start envelope with a live fight is written as narration, not a transition (#1390)', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        combat_transition: 'start',
        roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      }),
      hasActiveEncounter: async () => true,
      declinedActorKeys: async () => [],
    });
    expect(result).toEqual({ persisted: true });
    const context = (addMessageCalls[0]?.data as Record<string, unknown>)['context'] as Record<
      string,
      unknown
    >;
    expect(context['combat_transition']).toBe('none');
    expect('rollRequests' in context).toBe(false);
  });

  test('a bypass with no narration writes nothing (#1390)', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        text: '   ',
        combat_transition: 'none',
        combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
        roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      }),
      hasActiveEncounter: async () => true,
      declinedActorKeys: async () => [],
    });
    expect(result).toEqual({ persisted: false, skipped: 'combat_entry_pending' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('a live fight does not bypass prose asserting an undecided outcome (#1390)', async () => {
    // #2139: confirming the fight does not validate the dice outcomes its
    // prose asserts, so the fabricated-outcome guard still holds the row.
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        text: 'The blow leaves you wounded and bleeding.',
        combat_transition: 'none',
        combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
        roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      }),
      hasActiveEncounter: async () => true,
      declinedActorKeys: async () => [],
    });
    expect(result).toEqual({ persisted: false, skipped: 'combat_entry_pending' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('a live fight does not bypass a fight the player declined (#1390)', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        combat_transition: 'none',
        combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
        roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      }),
      hasActiveEncounter: async () => true,
      declinedActorKeys: async () => ['head chef balthazar'],
    });
    expect(result).toEqual({ persisted: false, skipped: 'combat_entry_pending' });
    expect(addMessageCalls).toHaveLength(0);
  });

  test('an unrelated decline does not block the bypass (#1390)', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope({
        combat_transition: 'none',
        combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
        roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      }),
      hasActiveEncounter: async () => true,
      declinedActorKeys: async () => ['gilded husk'],
    });
    expect(result).toEqual({ persisted: true });
    expect(addMessageCalls).toHaveLength(1);
  });
});

describe('persistFallbackDmReply live push (#800 item 3)', () => {
  const rollEnvelope = (): Record<string, unknown> =>
    explorationEnvelope({
      roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Search the room' }],
    });

  test('a persisted fallback is pushed to live tabs with its requests', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: rollEnvelope(),
    });
    expect(result).toEqual({ persisted: true });
    expect(publishCalls).toEqual([
      {
        sessionId: 'session-1',
        messageId: MESSAGE_ID,
        rollRequests: [{ type: 'check', formula: '1d20', purpose: 'Search the room' }],
      },
    ]);
  });

  test('a skipped fallback pushes nothing', async () => {
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: explorationEnvelope(),
    });
    expect(result).toEqual({ persisted: false });
    expect(publishCalls).toHaveLength(0);
  });

  test('a failed write pushes nothing', async () => {
    addMessageImpl = async () => {
      throw new Error('Session not found');
    };
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: rollEnvelope(),
    });
    expect(result).toEqual({ persisted: false });
    expect(publishCalls).toHaveLength(0);
  });

  test('a failed push does not flip a persisted row, and is logged at warn', async () => {
    publishImpl = () => {
      throw new Error('socket closed');
    };
    const result = await persistFallbackDmReply({
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      envelope: rollEnvelope(),
    });
    expect(result).toEqual({ persisted: true });
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'DM_REPLY_FALLBACK_PUSH_FAILED',
        sessionId: 'session-1',
      }),
    ]);
  });
});

// #1416: the durable reply record (transitions, seating publish, ready-state watchdog).
function memoryStore(
  seed: DmReplyRecord[] = [],
): DmReplyRecordStore & { rows: Map<string, DmReplyRecord> } {
  const rows = new Map(seed.map((record) => [record.id, { ...record }]));
  return {
    rows,
    async read(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async insertHeld(record) {
      if (!rows.has(record.id))
        rows.set(record.id, { ...record, state: 'held', createdAt: new Date() });
    },
    async transition(id, to): Promise<DmReplyTransitionResult> {
      const row = rows.get(id);
      if (!row) return { ok: false, reason: 'no_record' };
      if (!canTransitionDmReply(row.state, to)) {
        return { ok: false, reason: 'illegal_from', state: row.state };
      }
      rows.set(id, { ...row, state: to });
      return { ok: true, state: to };
    },
  };
}

const ID = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const USER = 'user_test';
const TEXT = 'The goblins leap from the rocks. Roll initiative.\n\nA. Fight\nB. Flee';

/** Writes rows in a Map keyed by id, so an id written twice is still one row. */
function rowWriter() {
  const rows = new Map<string, string>();
  const writer = async (record: DmReplyRecord) => {
    rows.set(record.id, record.text);
  };
  return { rows, writer };
}

describe('#1416 transition table', () => {
  test('allows only the listed moves', () => {
    const allowed: Array<[DmReplyRecordState, DmReplyRecordState]> = [
      ['held', 'ready'],
      ['held', 'cancelled'],
      ['ready', 'ready'],
      ['ready', 'persisted'],
    ];
    for (const [from, to] of allowed) expect(canTransitionDmReply(from, to)).toBe(true);
    expect(canTransitionDmReply('held', 'persisted')).toBe(false);
    expect(canTransitionDmReply('ready', 'cancelled')).toBe(false);
    expect(canTransitionDmReply('persisted', 'ready')).toBe(false);
    expect(canTransitionDmReply('cancelled', 'ready')).toBe(false);
    expect(canTransitionDmReply('ready', 'cancelled')).toBe(false);
  });
});

describe('#1416 seating publish', () => {
  test('held → ready → persisted, exactly one row by reserved id', async () => {
    const store = memoryStore([
      {
        id: ID,
        sessionId: SESSION,
        userId: USER,
        state: 'held',
        text: TEXT,
        envelope: null,
        createdAt: new Date(0),
      },
    ]);
    const { rows, writer } = rowWriter();
    const outcome = await publishHeldReplyAtSeating(
      { sessionId: SESSION, userId: USER, messageId: ID, text: TEXT },
      store,
      writer,
    );
    expect(outcome).toBe('persisted');
    expect(store.rows.get(ID)?.state).toBe('persisted');
    expect(rows.size).toBe(1);
    expect(rows.get(ID)).toBe(TEXT);
  });

  test('creates the record when the held write never reached the store', async () => {
    const store = memoryStore();
    const { rows, writer } = rowWriter();
    const outcome = await publishHeldReplyAtSeating(
      { sessionId: SESSION, userId: USER, messageId: ID, text: TEXT },
      store,
      writer,
    );
    expect(outcome).toBe('persisted');
    expect(store.rows.get(ID)?.state).toBe('persisted');
    expect(rows.size).toBe(1);
  });

  test('a fabricated outcome cancels the held reply and writes nothing', async () => {
    const fabricated = 'The goblin hits you for 9 damage and you collapse.';
    const store = memoryStore([
      {
        id: ID,
        sessionId: SESSION,
        userId: USER,
        state: 'held',
        text: fabricated,
        envelope: null,
        createdAt: new Date(0),
      },
    ]);
    const { rows, writer } = rowWriter();
    const outcome = await publishHeldReplyAtSeating(
      { sessionId: SESSION, userId: USER, messageId: ID, text: fabricated },
      store,
      writer,
    );
    expect(outcome).toBe('cancelled');
    expect(store.rows.get(ID)?.state).toBe('cancelled');
    expect(rows.size).toBe(0);
  });

  test('a publish that fails leaves the record ready, and a retry writes the same row', async () => {
    const store = memoryStore([
      {
        id: ID,
        sessionId: SESSION,
        userId: USER,
        state: 'held',
        text: TEXT,
        envelope: null,
        createdAt: new Date(0),
      },
    ]);
    const { rows, writer } = rowWriter();
    let failNext = true;
    const flaky = async (record: DmReplyRecord) => {
      if (failNext) {
        failNext = false;
        throw new Error('write failed');
      }
      await writer(record);
    };
    const first = await publishHeldReplyAtSeating(
      { sessionId: SESSION, userId: USER, messageId: ID, text: TEXT },
      store,
      flaky,
    );
    expect(first).toBe('retry');
    expect(store.rows.get(ID)?.state).toBe('ready');

    const current = await store.read(ID);
    const second = await publishReadyDmReply(current!, store, flaky);
    expect(second).toBe('persisted');
    expect(store.rows.get(ID)?.state).toBe('persisted');
    expect(rows.size).toBe(1);
  });

  test('a second seating for a persisted reply is idempotent', async () => {
    const store = memoryStore([
      {
        id: ID,
        sessionId: SESSION,
        userId: USER,
        state: 'persisted',
        text: TEXT,
        envelope: null,
        createdAt: new Date(0),
      },
    ]);
    const { rows, writer } = rowWriter();
    const outcome = await publishHeldReplyAtSeating(
      { sessionId: SESSION, userId: USER, messageId: ID, text: TEXT },
      store,
      writer,
    );
    expect(outcome).toBe('persisted');
    expect(rows.size).toBe(0);
  });
});

describe('#1416 watchdog on a ready record', () => {
  test('publishes a ready record with no live encounter and no in-memory envelope', async () => {
    const store = memoryStore([
      {
        id: ID,
        sessionId: SESSION,
        userId: USER,
        state: 'ready',
        text: TEXT,
        envelope: null,
        createdAt: new Date(0),
      },
    ]);
    const { rows, writer } = rowWriter();
    await scheduleDmReplyWatchdog({
      sessionId: SESSION,
      messageId: ID,
      reason: 'roll_requests',
      generatedAt: new Date(),
      userId: USER,
      delayMs: 0,
      hasDmRow: async () => false,
      replyRecords: store,
      writeReplyRow: writer,
    });
    expect(rows.get(ID)).toBe(TEXT);
    expect(store.rows.get(ID)?.state).toBe('persisted');
  });

  test('leaves a held record alone: the player has not confirmed the fight', async () => {
    const store = memoryStore([
      {
        id: ID,
        sessionId: SESSION,
        userId: USER,
        state: 'held',
        text: TEXT,
        envelope: null,
        createdAt: new Date(0),
      },
    ]);
    const { rows, writer } = rowWriter();
    await scheduleDmReplyWatchdog({
      sessionId: SESSION,
      messageId: ID,
      reason: 'roll_requests',
      generatedAt: new Date(),
      userId: USER,
      delayMs: 0,
      hasDmRow: async () => false,
      replyRecords: store,
      writeReplyRow: writer,
    });
    expect(rows.size).toBe(0);
    expect(store.rows.get(ID)?.state).toBe('held');
  });

  test('a row that already exists settles a ready record as persisted', async () => {
    const store = memoryStore([
      {
        id: ID,
        sessionId: SESSION,
        userId: USER,
        state: 'ready',
        text: TEXT,
        envelope: null,
        createdAt: new Date(0),
      },
    ]);
    const { rows, writer } = rowWriter();
    await scheduleDmReplyWatchdog({
      sessionId: SESSION,
      messageId: ID,
      reason: 'roll_requests',
      generatedAt: new Date(),
      userId: USER,
      delayMs: 0,
      hasDmRow: async () => true,
      replyRecords: store,
      writeReplyRow: writer,
    });
    expect(rows.size).toBe(0);
    expect(store.rows.get(ID)?.state).toBe('persisted');
  });
});

// #1416 review: a failed record lookup fails open to the legacy fallback rather than dropping it.
describe('#1416 watchdog record lookup failure', () => {
  test('still runs the legacy fallback when the record read throws', async () => {
    const failingStore = {
      read: async () => {
        throw new Error('record store unavailable');
      },
      insertHeld: async () => {},
      transition: async () => ({ ok: false as const, reason: 'no_record' as const }),
    };
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: '66666666-7777-4888-8999-000000000416',
      reason: 'roll_requests',
      generatedAt: new Date(),
      userId: 'user-1',
      envelope: {
        text: 'The door creaks open.',
        roll_requests: [{ type: 'check', formula: '1d20', purpose: 'Listen at the door', dc: 10 }],
        combat_transition: 'none',
      },
      delayMs: 0,
      hasDmRow: async () => false,
      replyRecords: failingStore,
    });
    expect(addMessageCalls).toHaveLength(1);
    expect(warnings.some((w) => w['msg'] === 'DM_REPLY_RECORD_LOOKUP_FAILED')).toBe(true);
  });
});

// #1416 FIX: held records are decided at the watchdog by the fight, the expiry and the gates.
describe('#1416 held reply verdicts at the watchdog', () => {
  const heldRecord = (overrides: Partial<DmReplyRecord> = {}): DmReplyRecord => ({
    id: ID,
    sessionId: SESSION,
    userId: USER,
    state: 'held',
    text: TEXT,
    envelope: {
      text: TEXT,
      roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
    },
    createdAt: new Date(0),
    ...overrides,
  });
  const noFight = {
    confirmedSince: async (_sessionId: string, _userId: string, _since: Date) => false,
    pendingEntryExpired: async (_sessionId: string, _pending: Record<string, unknown>) => false,
    declinedActorKeys: async (_sessionId: string): Promise<string[]> => [],
  };
  const run = (
    store: ReturnType<typeof memoryStore>,
    deps: Partial<typeof noFight>,
    writer: (record: DmReplyRecord) => Promise<void>,
    userId: string | null = USER,
  ) =>
    scheduleDmReplyWatchdog({
      sessionId: SESSION,
      messageId: ID,
      reason: 'roll_requests',
      generatedAt: new Date(),
      userId: userId ?? undefined,
      delayMs: 0,
      hasDmRow: async () => false,
      replyRecords: store,
      writeReplyRow: writer,
      heldReplyDeps: { ...noFight, ...deps },
    });

  test('a confirmed fight publishes the held reply, timestamped at generation', async () => {
    const store = memoryStore([heldRecord()]);
    const written: DmReplyRecord[] = [];
    await run(store, { confirmedSince: async () => true }, async (r) => {
      written.push(r);
    });
    expect(written).toHaveLength(1);
    expect(written[0]?.createdAt.getTime()).toBe(0);
    expect(store.rows.get(ID)?.state).toBe('persisted');
  });

  test('an expired pending entry publishes the held reply', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    await run(store, { pendingEntryExpired: async () => true }, writer);
    expect(rows.get(ID)).toBe(TEXT);
    expect(store.rows.get(ID)?.state).toBe('persisted');
  });

  test('a declined fight cancels the held reply and publishes nothing', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    await run(
      store,
      {
        confirmedSince: async () => true,
        declinedActorKeys: async () => ['head chef balthazar'],
      },
      writer,
    );
    expect(rows.size).toBe(0);
    expect(store.rows.get(ID)?.state).toBe('cancelled');
  });

  test('a fabricated outcome cancels the held reply even when the fight is confirmed', async () => {
    const fabricated = 'The goblin hits you for 9 damage and you collapse.';
    const store = memoryStore([heldRecord({ text: fabricated })]);
    const { rows, writer } = rowWriter();
    await run(store, { confirmedSince: async () => true }, writer);
    expect(rows.size).toBe(0);
    expect(store.rows.get(ID)?.state).toBe('cancelled');
  });

  test('with no fight and no expiry the held reply waits, and the legacy fallback stays off', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    await run(store, {}, writer);
    expect(rows.size).toBe(0);
    expect(store.rows.get(ID)?.state).toBe('held');
    expect(addMessageCalls).toHaveLength(0);
  });

  test('without a user the fight cannot be checked, so the reply waits', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    await run(store, { confirmedSince: async () => true }, writer, null);
    expect(rows.size).toBe(0);
    expect(store.rows.get(ID)?.state).toBe('held');
  });

  test('a cancelled record is never resurrected by the legacy fallback', async () => {
    const store = memoryStore([heldRecord({ state: 'cancelled' })]);
    const { rows, writer } = rowWriter();
    await run(store, { confirmedSince: async () => true }, writer);
    expect(rows.size).toBe(0);
    expect(addMessageCalls).toHaveLength(0);
  });
});

// #1444: a held record that nothing decided is settled when its session loads.
describe('#1444 expireStaleHeldReplies', () => {
  const NOW = new Date('2026-11-12T12:00:00.000Z');
  const heldRecord = (overrides: Partial<DmReplyRecord> = {}): DmReplyRecord => ({
    id: ID,
    sessionId: SESSION,
    userId: USER,
    state: 'held',
    text: TEXT,
    envelope: {
      text: TEXT,
      roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
    },
    createdAt: new Date(NOW.getTime() - DM_REPLY_RECORD_EXPIRY_MS - 1000),
    ...overrides,
  });
  const noFight = {
    confirmedSince: async (_sessionId: string, _userId: string, _since: Date) => false,
    pendingEntryExpired: async (_sessionId: string, _pending: Record<string, unknown>) => false,
    declinedActorKeys: async (_sessionId: string): Promise<string[]> => [],
  };
  const expiryLines = (): Record<string, unknown>[] =>
    warnings.filter((line) => line.msg === 'DM_REPLY_RECORD_EXPIRED');

  /** Runs the sweep over an in-memory store; `listed` is what the owner-scoped listing returns. */
  function sweep(
    store: ReturnType<typeof memoryStore>,
    listed: DmReplyRecord[],
    options: {
      deps?: Partial<typeof noFight>;
      writeRow?: (record: DmReplyRecord) => Promise<void>;
      userId?: string;
      scopes?: { sessionId: string; userId: string; before: Date }[];
    } = {},
  ): Promise<number> {
    return expireStaleHeldReplies(
      { sessionId: SESSION, userId: options.userId ?? USER, now: NOW },
      {
        store,
        heldReplyDeps: { ...noFight, ...options.deps },
        writeRow: options.writeRow ?? (async () => {}),
        listStale: async (scope) => {
          options.scopes?.push(scope);
          return listed;
        },
        // Mirrors the SQL guard: move only a row that is still `held`, check and set in one step.
        moveHeld: async (id, to) => {
          const row = store.rows.get(id);
          if (!row || row.state !== 'held') return false;
          store.rows.set(id, { ...row, state: to });
          return true;
        },
      },
    );
  }

  test('the cutoff is one named constant, 30 minutes, and records older than it are stale', async () => {
    expect(DM_REPLY_RECORD_EXPIRY_MS).toBe(30 * 60_000);
    const scopes: { sessionId: string; userId: string; before: Date }[] = [];
    await sweep(memoryStore(), [], { scopes });
    expect(scopes).toEqual([
      {
        sessionId: SESSION,
        userId: USER,
        before: new Date(NOW.getTime() - DM_REPLY_RECORD_EXPIRY_MS),
      },
    ]);
  });

  test('nothing stale means nothing moves and nothing is logged', async () => {
    const store = memoryStore([heldRecord()]);
    expect(await sweep(store, [])).toBe(0);
    expect(store.rows.get(ID)?.state).toBe('held');
    expect(warnings).toHaveLength(0);
  });

  test('an undecided stale record is cancelled, and the log names the record id only', async () => {
    const store = memoryStore([heldRecord()]);
    expect(await sweep(store, [heldRecord()])).toBe(1);
    expect(store.rows.get(ID)?.state).toBe('cancelled');
    expect(expiryLines()).toEqual([{ msg: 'DM_REPLY_RECORD_EXPIRED', recordId: ID }]);
  });

  test('a stale record whose fight was confirmed is published at load, timestamped at generation', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    const written: DmReplyRecord[] = [];
    expect(
      await sweep(store, [heldRecord()], {
        deps: { confirmedSince: async () => true },
        writeRow: async (record) => {
          written.push(record);
          await writer(record);
        },
      }),
    ).toBe(1);
    expect(store.rows.get(ID)?.state).toBe('persisted');
    expect(rows.get(ID)).toBe(TEXT);
    expect(written[0]?.createdAt.getTime()).toBe(heldRecord().createdAt.getTime());
    expect(expiryLines()).toHaveLength(0);
  });

  test('a stale record whose pending entry expired is published at load', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    await sweep(store, [heldRecord()], {
      deps: { pendingEntryExpired: async () => true },
      writeRow: writer,
    });
    expect(store.rows.get(ID)?.state).toBe('persisted');
    expect(rows.get(ID)).toBe(TEXT);
  });

  test('a cleared pending entry leaves the record undecidable, so it is cancelled as expired', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    await sweep(store, [heldRecord()], {
      deps: { pendingEntryExpired: async () => false },
      writeRow: writer,
    });
    expect(store.rows.get(ID)?.state).toBe('cancelled');
    expect(rows.size).toBe(0);
    expect(expiryLines()).toHaveLength(1);
  });

  test('a declined fight cancels the stale record, with the decline reason and no expiry line', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    await sweep(store, [heldRecord()], {
      deps: {
        confirmedSince: async () => true,
        declinedActorKeys: async () => ['head chef balthazar'],
      },
      writeRow: writer,
    });
    expect(store.rows.get(ID)?.state).toBe('cancelled');
    expect(rows.size).toBe(0);
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'DM_REPLY_RECORD_CANCELLED',
        recordId: ID,
        reason: 'declined',
        source: 'session_load',
      }),
    ]);
  });

  test('a stale claim of harm nobody ruled on cancels the record, even with a confirmed fight', async () => {
    const fabricated = 'The goblin hits you for 9 damage and you collapse.';
    const store = memoryStore([heldRecord({ text: fabricated })]);
    const { rows, writer } = rowWriter();
    await sweep(store, [heldRecord({ text: fabricated })], {
      deps: { confirmedSince: async () => true },
      writeRow: writer,
    });
    expect(store.rows.get(ID)?.state).toBe('cancelled');
    expect(rows.size).toBe(0);
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'DM_REPLY_RECORD_CANCELLED',
        reason: 'unverified_harm_claim',
      }),
    ]);
  });

  test('two concurrent loads settle one record once: one cancel, one log line, no second write', async () => {
    const store = memoryStore([heldRecord()]);
    const { rows, writer } = rowWriter();
    let writes = 0;
    const counted = async (record: DmReplyRecord): Promise<void> => {
      writes += 1;
      await writer(record);
    };
    const results = await Promise.all([
      sweep(store, [heldRecord()], {
        writeRow: counted,
        deps: { confirmedSince: async () => true },
      }),
      sweep(store, [heldRecord()], {
        writeRow: counted,
        deps: { confirmedSince: async () => true },
      }),
    ]);
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(writes).toBe(1);
    expect(rows.get(ID)).toBe(TEXT);
    expect(store.rows.get(ID)?.state).toBe('persisted');
  });

  test('two concurrent loads that both find no fight cancel once and log once', async () => {
    const store = memoryStore([heldRecord()]);
    const results = await Promise.all([sweep(store, [heldRecord()]), sweep(store, [heldRecord()])]);
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(expiryLines()).toHaveLength(1);
  });

  test('the owner scope reaches both the listing and every move', async () => {
    const store = memoryStore([heldRecord()]);
    const scopes: { sessionId: string; userId: string; before: Date }[] = [];
    const moveScopes: { sessionId: string; userId: string }[] = [];
    await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        store,
        heldReplyDeps: noFight,
        writeRow: async () => {},
        listStale: async (scope) => {
          scopes.push(scope);
          return [heldRecord()];
        },
        moveHeld: async (id, to, scope) => {
          moveScopes.push(scope);
          return (await store.transition(id, to)).ok;
        },
      },
    );
    expect(scopes[0]?.userId).toBe(USER);
    expect(moveScopes).toEqual([expect.objectContaining({ sessionId: SESSION, userId: USER })]);
  });

  test('a failing listing is logged and reported as nothing settled, never thrown', async () => {
    const result = await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        listStale: async () => {
          throw new Error('connection reset');
        },
      },
    );
    expect(result).toBe(0);
    expect(warnings).toEqual([
      expect.objectContaining({ msg: 'DM_REPLY_EXPIRY_FAILED', error: 'connection reset' }),
    ]);
  });
});
