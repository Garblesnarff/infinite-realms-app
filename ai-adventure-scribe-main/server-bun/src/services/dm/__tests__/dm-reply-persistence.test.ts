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

const { dmReplySkipReason, persistGeneratedDmReply, provisionalDmText, scheduleDmReplyWatchdog } =
  await import('../dm-reply-persistence.js');

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
  test('logs DM_REPLY_UNPERSISTED when no dm row followed the generation', async () => {
    const generatedAt = new Date('2026-08-26T09:53:49.900Z');
    let checked = null as { sessionId: string; since: Date } | null;

    await scheduleDmReplyWatchdog({
      sessionId: '175d1a5c-0000-4000-8000-000000000000',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      generatedAt,
      delayMs: 5,
      hasDmRowSince: async (sessionId, since) => {
        checked = { sessionId, since };
        return false;
      },
    });

    expect(checked).toEqual({
      sessionId: '175d1a5c-0000-4000-8000-000000000000',
      since: generatedAt,
    });
    expect(warnings).toEqual([
      {
        msg: 'DM_REPLY_UNPERSISTED',
        sessionId: '175d1a5c-0000-4000-8000-000000000000',
        messageId: MESSAGE_ID,
        reason: 'roll_requests',
        waitedMs: 5,
      },
    ]);
  });

  test('stays quiet when the client saved the reply', async () => {
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'client_in_combat',
      generatedAt: new Date(),
      delayMs: 5,
      hasDmRowSince: async () => true,
    });

    expect(warnings).toEqual([]);
  });

  test('a failing check is reported, not thrown', async () => {
    await scheduleDmReplyWatchdog({
      sessionId: 'session-1',
      messageId: MESSAGE_ID,
      reason: 'roll_requests',
      generatedAt: new Date(),
      delayMs: 5,
      hasDmRowSince: async () => {
        throw new Error('connection reset');
      },
    });

    expect(warnings).toEqual([
      expect.objectContaining({ msg: 'DM_REPLY_WATCHDOG_FAILED', sessionId: 'session-1' }),
    ]);
  });
});
