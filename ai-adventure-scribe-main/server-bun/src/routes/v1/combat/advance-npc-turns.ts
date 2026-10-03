import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './helpers.js';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { CombatEncounterService } from '../../../services/combat/combat-encounter-service.js';
import { advanceNpcTurns } from '../../../services/combat/npc-turn-runner.js';

const sessionIdParams = t.Object({
  sessionId: t.String({ minLength: 1, maxLength: 255 }),
});

const advanceNpcTurnsBody = t.Object({
  expectedCurrentParticipantId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
});

export const advanceNpcTurnRoutes = new Elysia().post(
  '/sessions/:sessionId/advance-npc-turns',
  async ({ request, params, body, set }) => {
    const { user, error } = await authenticateRequest(request);
    if (error || !user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    const access = await verifySessionOwnership(params.sessionId, user.userId);
    if (!access.success) {
      set.status = access.error!.status;
      return { error: access.error!.message };
    }

    const encounter = await CombatEncounterService.getActiveEncounter(
      params.sessionId,
      user.userId,
    );
    if (!encounter) {
      // #2517: no active encounter may mean the last one ended in defeat. Say
      // why it ended so the client can show the death screen from the combat
      // resolution itself instead of waiting for a refused DM generate. The
      // lookup is best-effort: failing it must not break this response.
      let endedReason: string | null = null;
      try {
        const concluded = await CombatEncounterService.getLatestConcludedEncounter(
          params.sessionId,
          user.userId,
        );
        endedReason = concluded?.endedReason ?? null;
      } catch {
        endedReason = null;
      }
      return {
        results: [],
        currentParticipant: null,
        combatEnded: true,
        endedReason,
        iterationCount: 0,
        iterationCap: 0,
        capReached: false,
        transcriptLines: [],
      };
    }

    const state = await CombatEncounterService.getCombatState(encounter.id, user.userId);
    if (
      body.expectedCurrentParticipantId &&
      body.expectedCurrentParticipantId !== state.currentParticipant?.id
    ) {
      set.status = 409;
      return {
        reason: 'turn_holder_mismatch',
        currentParticipantId: state.currentParticipant?.id ?? null,
      };
    }

    try {
      const advanced = await advanceNpcTurns(encounter.id, user.userId);
      if (!advanced.combatEnded) return advanced;
      // #2517: name the ending on the wire. `combatEnded` alone cannot tell a
      // victory from a party defeat, and only the defeat is terminal.
      let endedReason: string | null = null;
      try {
        const concluded = await CombatEncounterService.getLatestConcludedEncounter(
          params.sessionId,
          user.userId,
        );
        endedReason = concluded?.endedReason ?? null;
      } catch {
        endedReason = null;
      }
      return { ...advanced, endedReason };
    } catch (cause) {
      if (cause instanceof AppError) {
        set.status = cause.statusCode;
        return { error: cause.statusCode >= 500 ? 'NPC turns could not advance' : cause.message };
      }
      set.status = 500;
      return { error: 'NPC turns could not advance' };
    }
  },
  { params: sessionIdParams, body: advanceNpcTurnsBody },
);
