import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runDeclaredCombatCheck } from '../combat-check-client';

import logger from '@/lib/logger';
import {
  CombatIntentRefusedError,
  executeAuthoritativeCombatIntent,
} from '@/services/combat/combat-action-executor';
import { requestPlayerCheckRoll } from '@/services/combat/player-roll-bridge';

/**
 * The target of "grapple it" / "talk it down" is the one hostile on the board. The roster the
 * client holds has the player on it too (participant_type 'player'), so a resolver that counts the
 * whole roster sees two creatures and never resolves a pronoun (#2420).
 */

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeAuthoritativeCombatIntent: vi.fn(),
}));
vi.mock('@/services/combat/player-roll-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestPlayerCheckRoll: vi.fn(),
}));

const PLAYER = { id: 'p1', name: 'The Apprentice', participantType: 'player' };
const GOBLIN = { id: 'g1', name: 'Goblin', participantType: 'monster' };
const OGRE = { id: 'o1', name: 'Ogre', participantType: 'monster' };

const run = (message: string, participants: Array<Record<string, unknown>>) =>
  runDeclaredCombatCheck(message, {
    encounterId: 'encounter-1',
    actorId: PLAYER.id,
    actorLabel: PLAYER.name,
    participants: participants as never,
    checkModifier: 3,
    origin: 'typed',
  });

describe('which creature a check sentence names (#2420)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestPlayerCheckRoll).mockResolvedValue({ d20: 12 });
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({ engineLine: 'ok' });
  });

  it('"grapple it" with the player and one goblin posts a grapple on the goblin', async () => {
    const outcome = await run('grapple it', [PLAYER, GOBLIN]);

    expect(outcome.declared).toBe(true);
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      'encounter-1',
      { type: 'check', actorId: PLAYER.id, checkKind: 'grapple', targetId: GOBLIN.id, d20: 12 },
      'dm',
      undefined,
      'typed',
    );
  });

  it('"talk it down" with the player and one goblin posts a parley on the goblin', async () => {
    await run('talk it down', [PLAYER, GOBLIN]);

    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      'encounter-1',
      expect.objectContaining({ checkKind: 'parley', targetId: GOBLIN.id }),
      'dm',
      undefined,
      'typed',
    );
  });

  it('with two hostiles "grapple it" is ambiguous: nothing is rolled or posted, and it is logged', async () => {
    const outcome = await run('grapple it', [PLAYER, GOBLIN, OGRE]);

    expect(outcome).toEqual({ declared: false, reason: 'no_target_actor' });
    expect(requestPlayerCheckRoll).not.toHaveBeenCalled();
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[CombatCheck] mid-combat check not resolved',
      expect.objectContaining({ reason: 'no_target_actor' }),
    );
  });

  it('a hostile that is already down is not a candidate', async () => {
    await run('grapple it', [PLAYER, { ...GOBLIN, currentHitPoints: 0 }, OGRE]);

    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      'encounter-1',
      expect.objectContaining({ checkKind: 'grapple', targetId: OGRE.id }),
      'dm',
      undefined,
      'typed',
    );
  });

  it('"break free" names no target: with two hostiles it still posts an escape', async () => {
    await run('break free of the grapple', [PLAYER, GOBLIN, OGRE]);

    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      'encounter-1',
      { type: 'check', actorId: PLAYER.id, checkKind: 'escape', d20: 12 },
      'dm',
      undefined,
      'typed',
    );
  });

  it('an engine refusal comes back as the reason, not as a thrown turn', async () => {
    vi.mocked(executeAuthoritativeCombatIntent).mockRejectedValue(
      new CombatIntentRefusedError('The Apprentice (medium) cannot shove Ogre (huge).', 422, {
        reason: 'check_target_too_large',
      }),
    );

    const outcome = await run('shove the goblin', [PLAYER, GOBLIN]);

    expect(outcome).toEqual({
      declared: true,
      reason: 'refused',
      message: 'The Apprentice (medium) cannot shove Ogre (huge).',
    });
  });

  it('a failure that is not a refusal still throws', async () => {
    vi.mocked(executeAuthoritativeCombatIntent).mockRejectedValue(new Error('network down'));

    await expect(run('shove the goblin', [PLAYER, GOBLIN])).rejects.toThrow('network down');
  });
});
