/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { AIService } from '@/services/ai-service';
import {
  CombatIntentRefusedError,
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';

/**
 * #975 (strategist check): a refused Second Wind / Action Surge otherwise
 * exists only inside the DM reply text, and the in-combat reply is not
 * persisted (the server's DM-reply write skips client_in_combat turns), so a
 * player who reloads sees nothing and nothing on screen says the feature was
 * refused until engine lines for something else arrive. The handler now also
 * lands the refusal as a persisted system line (a localNotice with
 * persist: true).
 *
 * The handler and the resolution step are real. Mocked: the DM, the network
 * edge, and the intent executor — whose refusal is the real error class with
 * the server's own refusal wording for a spent feature.
 */

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeStructuredCombatActionWithBoundary: vi.fn(),
  executeAuthoritativeCombatIntent: vi.fn(),
}));
vi.mock('@/services/combat/combat-repair', () => ({
  repairRefusedCombatAction: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
  },
}));

const PLAYER = {
  id: 'p1',
  name: 'Ghorza Ironfist',
  participantType: 'player',
  characterId: 'char-1',
  turnOrder: 0,
};
const GOBLIN = { id: 'g1', name: 'Goblin', participantType: 'monster', turnOrder: 1 };
const ENCOUNTER = {
  id: 'encounter-1',
  phase: 'active',
  participants: [PLAYER, GOBLIN],
  currentRound: 1,
  currentTurnParticipantId: PLAYER.id,
};

const featureAction = (actionType: string) => ({
  actor_id: PLAYER.id,
  action_type: actionType,
  target_ids: [],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
});

/** The envelope `processDMResponse` produces on every reply. */
const PROD_RESULT = {
  combat_actions: [],
  roll_requests: [],
  combat_transition: 'none',
  map_actions: [],
  handout_actions: [],
};

const invoke = (playerMessage: string, actionType: string) =>
  handleDmActionsAndTransitions({
    sessionId: 'session-1',
    characterRecord: { id: 'char-1' },
    activeEncounter: ENCOUNTER,
    isInCombat: true,
    refreshCombatState: vi.fn().mockResolvedValue(ENCOUNTER),
    aiContext: { gameState: {} },
    conversationHistory: [],
    playerMessage,
    playerInputOrigin: 'typed',
    result: {
      ...PROD_RESULT,
      text: 'You dig deep for another effort.',
      combat_actions: [featureAction(actionType)],
    },
  } as any);

describe('a refused fighter feature lands as a persisted system line (#975)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'The goblin circles, waiting.',
    } as never);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({} as never);
    vi.mocked(userDataApi.endTacticalMap).mockResolvedValue({ ok: true } as never);
  });

  it.each([
    [
      'second_wind',
      'I use Second Wind to catch my breath',
      'Second Wind has no uses remaining — it recharges on a short rest',
      '⚙️ Engine: Second Wind was not resolved: Second Wind has no uses remaining — it recharges on a short rest.',
    ],
    [
      'action_surge',
      'I use Action Surge to take an extra action this turn',
      'Action Surge has no uses remaining — it recharges on a short rest',
      '⚙️ Engine: Action Surge was not resolved: Action Surge has no uses remaining — it recharges on a short rest.',
    ],
  ])(
    '%s refused: the refusal is a persisted system line, not only reply text',
    async (actionType, message, refusalText, expectedLine) => {
      vi.mocked(executeStructuredCombatActionWithBoundary).mockRejectedValue(
        new CombatIntentRefusedError(refusalText, 422, {}),
      );

      const outcome = await invoke(message, actionType);

      expect(outcome.localNotices).toContainEqual({ text: expectedLine, persist: true });
    },
  );

  it('a refused non-feature action gets no fighter-feature system line', async () => {
    vi.mocked(executeStructuredCombatActionWithBoundary).mockRejectedValue(
      new CombatIntentRefusedError('the goblin is out of reach', 422, {}),
    );

    const outcome = await invoke('I dodge', 'dodge');

    const engineLines = (outcome.localNotices ?? []).filter((notice) =>
      notice.text.startsWith('⚙️ Engine:'),
    );
    expect(engineLines).toEqual([]);
  });
});
