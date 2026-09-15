import { Elysia, t } from 'elysia';

import { authenticateRequest as defaultAuthenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { combatEntryGateDeps as defaultCombatEntryGateDeps } from '../../../services/combat/combat-entry-gate-deps.js';
import {
  seatCombatEntry as defaultSeatCombatEntry,
  type CombatEntryGateDeps,
  type CombatEntryPlayer,
  type DerivedCombatant,
  type SeatedCombatEntryOutcome,
} from '../../../services/combat/combat-entry-gate.js';
import { buildInitiativeOrder as defaultBuildInitiativeOrder } from '../../../services/combat/initiative-order.js';
import { sanitizeSceneSpec as defaultSanitizeSceneSpec } from '../../../services/combat/scene-spec-sanitizer.js';

const sessionIdParams = t.Object({
  sessionId: t.String({ minLength: 1, maxLength: 255 }),
});

const enterBody = t.Object({
  combatants: t.Array(
    t.Object({
      name: t.String({ minLength: 1, maxLength: 200 }),
      monsterId: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 120 }))),
      count: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }),
    { maxItems: 100 },
  ),
  sceneSpec: t.Unknown(),
  player: t.Object({
    characterId: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
    name: t.String({ minLength: 1, maxLength: 200 }),
    initiativeModifier: t.Number({ minimum: -100, maximum: 100 }),
    hpCurrent: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100_000 }))),
    hpMax: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100_000 }))),
  }),
  declaredAttack: t.Optional(
    t.Object({
      verb: t.String({ minLength: 1, maxLength: 80 }),
      actorName: t.String({ minLength: 1, maxLength: 200 }),
      actorSlug: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      monsterId: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
      attackSource: t.Optional(
        t.Union([t.Literal('unarmed'), t.Literal('weapon'), t.Literal('spell')]),
      ),
      weaponName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      spellId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      spellName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
    }),
  ),
  playerInitiativeRoll: t.Optional(t.Integer({ minimum: 1, maximum: 20 })),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPostgresUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function mapEntryError(
  set: { status?: number | string },
  error: unknown,
): { error: string; details?: unknown } {
  if (isPostgresUniqueViolation(error)) {
    set.status = 409;
    return { error: 'Combat entry is no longer available' };
  }
  if (error instanceof AppError) {
    set.status = error.statusCode;
    return {
      error: error.statusCode === 404 ? 'Session not found' : error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  set.status = 500;
  return { error: 'Failed to enter combat' };
}

export interface CombatEntryRouteOptions {
  authenticateRequest?: typeof defaultAuthenticateRequest;
  combatEntryGateDeps?: CombatEntryGateDeps;
  seatCombatEntry?: typeof defaultSeatCombatEntry;
  sanitizeSceneSpec?: typeof defaultSanitizeSceneSpec;
  buildInitiativeOrder?: typeof defaultBuildInitiativeOrder;
}

export function createCombatEntryRoutes({
  authenticateRequest = defaultAuthenticateRequest,
  combatEntryGateDeps = defaultCombatEntryGateDeps,
  seatCombatEntry = defaultSeatCombatEntry,
  sanitizeSceneSpec = defaultSanitizeSceneSpec,
  buildInitiativeOrder = defaultBuildInitiativeOrder,
}: CombatEntryRouteOptions = {}) {
  return new Elysia().post(
    '/sessions/:sessionId/enter',
    async ({ request, params, body, set }) => {
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      if (!UUID_PATTERN.test(params.sessionId)) {
        set.status = 422;
        return { error: 'Invalid session id', detail: 'sessionId must be a uuid' };
      }

      const sanitized = sanitizeSceneSpec(body.sceneSpec, params.sessionId);
      if (!sanitized.ok) {
        set.status = 422;
        return { error: 'Invalid combat entry payload', detail: sanitized.detail };
      }

      const combatants: DerivedCombatant[] = body.combatants.map((combatant) => ({
        name: combatant.name.trim(),
        ...(combatant.monsterId ? { monsterId: combatant.monsterId } : {}),
        count: combatant.count ?? 1,
      }));
      const player: CombatEntryPlayer = {
        characterId: body.player.characterId ?? null,
        name: body.player.name.trim(),
        initiativeModifier: body.player.initiativeModifier,
        ...(body.player.hpCurrent != null ? { hpCurrent: body.player.hpCurrent } : {}),
        ...(body.player.hpMax != null ? { hpMax: body.player.hpMax } : {}),
      };

      try {
        const outcome = await seatCombatEntry(
          {
            sessionId: params.sessionId,
            userId: user.userId,
            player,
            combatants,
            sceneSpec: sanitized.sceneSpec,
            playerInitiativeRoll: body.playerInitiativeRoll,
            declaredAttack: body.declaredAttack,
          },
          combatEntryGateDeps,
        );
        if (!outcome) {
          set.status = 409;
          return { error: 'Combat entry is no longer available' };
        }

        set.status = 201;
        return enterResponse(outcome, buildInitiativeOrder);
      } catch (error) {
        return mapEntryError(set, error);
      }
    },
    { params: sessionIdParams, body: enterBody },
  );
}

function enterResponse(
  outcome: SeatedCombatEntryOutcome,
  buildInitiativeOrder: typeof defaultBuildInitiativeOrder,
) {
  const combatState = outcome.combatState;
  return {
    ...combatState,
    initiativeOrder: buildInitiativeOrder(
      combatState as Parameters<typeof buildInitiativeOrder>[0],
    ),
    seatingTranscript: outcome.seatingTranscript,
    ...(outcome.firstAction ? { first_action: outcome.firstAction } : {}),
  };
}

export const entryRoutes = createCombatEntryRoutes();
