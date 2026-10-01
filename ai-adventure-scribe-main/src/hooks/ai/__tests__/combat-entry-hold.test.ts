/**
 * #2341 — the popup opens before the DM is called.
 *
 * `userDataApi` is real here and only `fetch` is stubbed, so the assertion is on the exact body
 * the client puts on the wire. The server test posts the same fixture through the real route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
  declaredAttackCheckBody,
  pickedTargetCheckBody,
  untargetedSpellCheckBody,
} from '../../../../shared/test-fixtures/declared-attack-hold';
import {
  declinedAttackLabel,
  heldEntryResult,
  holdCombatEntryBeforeDm,
  recentNarrationFrom,
} from '../combat-entry-hold';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer access-token' })),
  loadCachedSession: vi.fn(() => ({ access_token: 'access-token' })),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  requestCombatEntryConfirmation: vi.fn(),
  requestCombatEntryAnswer: vi.fn(),
}));

import logger from '@/lib/logger';
import {
  requestCombatEntryAnswer,
  requestCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';

const pending = {
  trigger: 'player_intent' as const,
  detail: 'player declared an attack on Valerius',
  combatants: [{ name: 'Valerius', count: 1 }],
  sceneSpec: { sessionId: DECLARED_ATTACK_SESSION_ID },
  sceneSpecSynthesized: true,
  declaredAttack: {
    verb: 'cast Chill Touch',
    actorName: 'Valerius',
    attackSource: 'spell' as const,
    spellId: 'chill-touch',
    spellName: 'Chill Touch',
  },
};

const jsonResponse = (body: unknown, ok = true, status = 200, requestId?: string): Response =>
  ({
    ok,
    status,
    json: async () => body,
    headers: { get: (name: string) => (name === 'x-request-id' ? (requestId ?? null) : null) },
  }) as unknown as Response;

describe('holdCombatEntryBeforeDm', () => {
  const fetchMock = vi.fn();
  const hold = () =>
    holdCombatEntryBeforeDm({
      sessionId: DECLARED_ATTACK_SESSION_ID,
      message: declaredAttackCheckBody.playerInput,
      characterRecord: declaredAttackCharacter,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ pending }));
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(true);
  });

  it('sends the shared wire body to the declared-attack route, and asks the player with the result', async () => {
    await hold();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://localhost:8888/v1/combat/sessions/${DECLARED_ATTACK_SESSION_ID}/declared-attack`,
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(declaredAttackCheckBody);
    expect(requestCombatEntryConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorLabel: 'The Scholar',
        combatantLabels: ['Valerius'],
        declaredTargets: ['Valerius'],
        initiativeModifier: 1,
      }),
    );
  });

  it('does not answer until the player has chosen', async () => {
    let choose: (confirmed: boolean) => void = () => {};
    vi.mocked(requestCombatEntryConfirmation).mockReturnValue(
      new Promise<boolean>((resolve) => {
        choose = resolve;
      }),
    );
    let settled = false;
    const held = hold().then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(requestCombatEntryConfirmation).toHaveBeenCalled());
    await Promise.resolve();
    expect(settled).toBe(false);

    choose(true);
    await expect(held).resolves.toEqual({ pending, decision: 'confirmed' });
  });

  it('reports a decline', async () => {
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(false);
    await expect(hold()).resolves.toEqual({
      decision: 'declined',
      label: 'the spell Chill Touch against Valerius',
    });
  });

  it('reports that nothing was asked when no popup host is mounted', async () => {
    vi.mocked(requestCombatEntryConfirmation).mockRejectedValue(new Error('no host'));
    await expect(hold()).resolves.toEqual({ pending, decision: 'unavailable' });
  });

  it('holds nothing when the server finds no declared attack', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pending: null }));
    await expect(hold()).resolves.toBeNull();
    expect(requestCombatEntryConfirmation).not.toHaveBeenCalled();
  });

  it('falls back to asking the DM when the check is refused or fails, and says so with the request id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, false, 500, 'req-refused'));
    await expect(hold()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_HOLD_FALLBACK', {
      sessionId: DECLARED_ATTACK_SESSION_ID,
      reason: 'refused',
      status: 500,
      requestId: 'req-refused',
    });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(hold()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_HOLD_FALLBACK', {
      sessionId: DECLARED_ATTACK_SESSION_ID,
      reason: 'failed',
      requestId: null,
      error: 'offline',
    });
    expect(requestCombatEntryConfirmation).not.toHaveBeenCalled();
  });

  it('does not call the route for a message no attack verb could match', async () => {
    await expect(
      holdCombatEntryBeforeDm({
        sessionId: DECLARED_ATTACK_SESSION_ID,
        message: 'I study the fold and make an Arcana check.',
        characterRecord: declaredAttackCharacter,
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not check an empty message or a character with no name', async () => {
    await expect(
      holdCombatEntryBeforeDm({
        sessionId: DECLARED_ATTACK_SESSION_ID,
        message: '   ',
        characterRecord: declaredAttackCharacter,
      }),
    ).resolves.toBeNull();
    await expect(
      holdCombatEntryBeforeDm({
        sessionId: DECLARED_ATTACK_SESSION_ID,
        message: declaredAttackCheckBody.playerInput,
        characterRecord: {},
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the held turn', () => {
  it('has the entry handoff and no prose for the DM to have narrated', () => {
    expect(heldEntryResult(pending)).toMatchObject({
      text: '',
      combat_transition: 'none',
      combat_entry_pending: pending,
      roll_requests: [],
      combat_actions: [],
    });
  });

  it('words what the player named for the DM note', () => {
    expect(declinedAttackLabel(pending)).toBe('the spell Chill Touch against Valerius');
    expect(
      declinedAttackLabel({
        ...pending,
        declaredAttack: { verb: 'punch', actorName: 'Valerius' },
      }),
    ).toBe('an attack against Valerius');
  });
});

describe('an attack spell with no creature named ("I cast Fire Bolt at him")', () => {
  const fetchMock = vi.fn();
  const choice = { spellName: 'Fire Bolt', candidates: ['Valerius', 'Professor Darkwater'] };
  const holdUntargeted = () =>
    holdCombatEntryBeforeDm({
      sessionId: DECLARED_ATTACK_SESSION_ID,
      message: untargetedSpellCheckBody.playerInput,
      characterRecord: declaredAttackCharacter,
      recentNarration: untargetedSpellCheckBody.recentNarration,
    });
  const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ pending: null, targetChoice: choice }));
  });

  it('asks which creature, sending the narration, and seats on the creature the player picks', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ pending }));
    vi.mocked(requestCombatEntryAnswer).mockResolvedValue({ confirmed: true, target: 'Valerius' });

    await expect(holdUntargeted()).resolves.toEqual({ pending, decision: 'confirmed' });

    expect(requestCombatEntryAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        targetChoices: choice.candidates,
        spellLabel: 'Fire Bolt',
        actorLabel: 'The Scholar',
      }),
    );
    // Picking is the Strike: no second card, and the server is asked once more with the name.
    expect(requestCombatEntryConfirmation).not.toHaveBeenCalled();
    expect(bodies()).toEqual([untargetedSpellCheckBody, pickedTargetCheckBody]);
  });

  it('holds the DM back and tells it nothing happened when the player does something else', async () => {
    vi.mocked(requestCombatEntryAnswer).mockResolvedValue({ confirmed: false });

    await expect(holdUntargeted()).resolves.toEqual({
      decision: 'declined',
      label: 'the spell Fire Bolt',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back, logged, when no popup host is mounted or the pick cannot be resolved', async () => {
    vi.mocked(requestCombatEntryAnswer).mockRejectedValueOnce(new Error('no host'));
    await expect(holdUntargeted()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'COMBAT_ENTRY_HOLD_FALLBACK',
      expect.objectContaining({ reason: 'no_popup_host' }),
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ pending: null, targetChoice: choice }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ pending: null }));
    vi.mocked(requestCombatEntryAnswer).mockResolvedValue({ confirmed: true, target: 'Valerius' });
    await expect(holdUntargeted()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'COMBAT_ENTRY_HOLD_FALLBACK',
      expect.objectContaining({ reason: 'picked_target_unresolved' }),
    );
  });

  it('takes the narration from the last DM message, bounded', () => {
    expect(
      recentNarrationFrom([
        { sender: 'dm', text: 'first' },
        { sender: 'player', text: 'I look' },
        { sender: 'dm', text: 'x'.repeat(5000) },
        { sender: 'player', text: 'I cast Fire Bolt at him' },
      ]),
    ).toHaveLength(4000);
    expect(recentNarrationFrom([{ sender: 'player', text: 'hello' }])).toBeUndefined();
  });

  it('leaves the option menu out: "Consult the iron spike" is not a creature in the scene (#2445)', () => {
    // Run 18's last DM message had this shape: scene text, then lettered options in bold.
    const dmMessage =
      'Captain Sarah Reeves grips the rail. "What we will find is failure," she says.\n\n' +
      'a. **Ask Professor Darkwater**, about the journal page.\n' +
      'b. **Descend the shaft**, rung by rung.\n' +
      'c. **Consult the iron spike**, driven into the wall.';
    const narration = recentNarrationFrom([
      { sender: 'dm', text: dmMessage },
      { sender: 'player', text: 'I cast Chill Touch.' },
    ]);

    expect(narration).toContain('Captain Sarah Reeves');
    expect(narration).not.toMatch(/iron spike|Ask Professor Darkwater/);
  });

  it.each([
    [
      'bold letter',
      '**A.** **Ask Professor Darkwater**, about it.\n**D.** **Consult the iron spike**, now.',
    ],
    [
      'letter inside the bold',
      '**A. Ask Professor Darkwater**, about it.\n**D. Consult the iron spike**, now.',
    ],
    [
      'four options',
      'A. **Ask Professor Darkwater**, a.\nB. **Go**, b.\nC. **Wait**, c.\nD. **Consult the iron spike**, d.',
    ],
    ['numbered', '1. **Ask Professor Darkwater**, about it.\n2. **Consult the iron spike**, now.'],
  ])('leaves out an option menu written as: %s', (_format, menu) => {
    const narration = recentNarrationFrom([
      { sender: 'dm', text: `Captain Sarah Reeves grips the rail.\n\n${menu}` },
    ]);

    expect(narration).toBe('Captain Sarah Reeves grips the rail.');
  });
});
