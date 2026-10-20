/* eslint-disable max-lines -- the boundary, the written text, the never-throw contract and the watchdog. */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// #2218: the server keeps the DM reply it generated. These cover the boundary (which turns the
// server may write), the text it writes, the never-throw contract, and the watchdog line.

type AddMessageCall = { data: Record<string, unknown>; userId: string };
let addMessageCalls: AddMessageCall[] = [];
let addMessageImpl: () => Promise<unknown> = async () => ({ id: 'row' });
let warnings: Record<string, unknown>[] = [];
let errors: Record<string, unknown>[] = [];

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

const {
  dmReplySkipReason,
  persistFallbackDmReply,
  persistGeneratedDmReply,
  provisionalDmText,
  scheduleDmReplyWatchdog,
} = await import('../dm-reply-persistence.js');

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
});
