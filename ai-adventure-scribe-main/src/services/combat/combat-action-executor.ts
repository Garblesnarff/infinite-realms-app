/* eslint-disable max-lines -- one client seam owns authoritative intents and their DM adapter. */
import {
  combatBoundaryFromResult,
  type StructuredCombatActionExecution,
} from './combat-action-boundary';
import { reportCombatIntentFailure } from './combat-intent-failure';

export {
  combatBoundaryFromResult,
  type CombatActionBoundary,
  type StructuredCombatActionExecution,
} from './combat-action-boundary';

import type { CombatActionOrigin } from './combat-action-origin';
import type { DamageType } from '@/types/combat';

import { logServerRequestId } from '@/infrastructure/api/request-id-log';
import { getAuthHeaders } from '@/services/auth/TokenService';
import { playerCombatSpellLabel } from '@/services/combat/player-combat-spell';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export interface StructuredCombatAction {
  actor_id: string;
  action_type:
    | 'attack'
    | 'move'
    | 'cast_spell'
    | 'dash'
    | 'disengage'
    | 'dodge'
    | 'help'
    | 'hide'
    | 'ready'
    | 'use_object';
  target_ids: string[];
  weapon_id: string | null;
  spell_id: string | null;
  slot_level: number | null;
  movement_feet: number;
  x?: number;
  y?: number;
}

export interface ResolvedTargetDamage {
  participantId: string;
  newHp?: number;
  damageType?: DamageType;
  hit?: boolean;
  finalDamage?: number;
  isCritical?: boolean;
}

type RawCombatOutcome = {
  targetNewHp?: number;
  damageType?: DamageType;
  hit?: boolean;
  finalDamage?: number;
  isCritical?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export type ClientCombatIntent =
  | {
      type: 'attack';
      actorId: string;
      targetId: string;
      weaponId?: string;
      expectedVersion?: number;
      advantage?: boolean;
      disadvantage?: boolean;
      /** The player's own attack die, when the dice popup rolled it. Absent = engine rolls. */
      d20?: number;
    }
  | {
      type: 'spell';
      actorId: string;
      targetIds: string[];
      spellId?: string;
      spellName: string;
      slotLevel?: number | null;
      expectedVersion?: number;
      /** Player's attack-roll die from the spell popup. Absent for saves and auto-hit. */
      d20?: number;
    }
  | { type: 'dash' | 'dodge' | 'disengage'; actorId: string; expectedVersion?: number }
  | { type: 'end_turn'; actorId: string }
  | { type: 'move'; actorId: string; x: number; y: number };

/**
 * The intent types the route's player variant requires `expectedVersion` on. Keyed by type,
 * never by key presence: an object literal that simply omits the optional field has no
 * `expectedVersion` key at all, so the old `'expectedVersion' in intent` guard was false for
 * every caller that constructed an intent without one — which was all of them. That silence is
 * how run 10 sent three versionless attacks straight into the route's union.
 */
const INTENT_TYPES_REQUIRING_VERSION = new Set(['attack', 'spell', 'dash', 'dodge', 'disengage']);

type VersionedClientIntent = Extract<ClientCombatIntent, { expectedVersion?: number }>;

const requiresExpectedVersion = (intent: ClientCombatIntent): intent is VersionedClientIntent =>
  INTENT_TYPES_REQUIRING_VERSION.has(intent.type);

/** What the intent route attaches to a client-fixable refusal (server `AppError.details`). */
export interface CombatRefusalDetails {
  role?: 'actor' | 'target';
  intentType?: string;
  roster?: string;
  resource?: string;
  id?: string;
  reason?: string;
  stage?: string;
  dialect?: string;
  variant?: string;
  detail?: string;
  missing?: string[];
  currentParticipantId?: string | null;
  currentParticipantSlug?: string | null;
}

/**
 * A refusal the engine issued on purpose, carrying enough for the caller to fix it.
 *
 * The route answers an out-of-turn actor 422 and an unresolvable reference 404-with-roster
 * (#1700), but the client used to flatten both into `new Error(payload.error)` — dropping the
 * status and the roster on the floor. So the one thing that could have told the DM what it got
 * wrong reached the browser and was discarded one line before it could be used, and the player
 * saw "Actor is not the current-turn participant" as a raw error instead.
 */
export class CombatIntentRefusedError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: CombatRefusalDetails,
  ) {
    super(message);
    this.name = 'CombatIntentRefusedError';
  }

  /** A refusal the DM can plausibly correct by re-choosing an actor or target. */
  get isRepairable(): boolean {
    return this.status === 422 || this.status === 404;
  }
}

/**
 * `source` is the body's dialect and says `dm` for the player's own casts; `origin` says who
 * produced the action, and the server refuses a player action no player input made (#2305).
 */
export async function executeAuthoritativeCombatIntent(
  encounterId: string,
  intent: ClientCombatIntent,
  source: 'player' | 'dm' = 'player',
  dmStartedAt?: number,
  origin?: CombatActionOrigin,
): Promise<unknown> {
  try {
    const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
    let authoritativeIntent = intent;
    // DM-sourced intents skip the read: the server dispatch is the authoritative sequencer and
    // fills the version itself. Player-sourced ones must still say which version they read.
    if (
      source !== 'dm' &&
      requiresExpectedVersion(intent) &&
      intent.expectedVersion === undefined
    ) {
      const statusResponse = await fetch(
        `${API_BASE_URL}/v1/combat/${encodeURIComponent(encounterId)}/status`,
        { headers },
      );
      logServerRequestId('/v1/combat', statusResponse);
      if (!statusResponse.ok)
        throw new Error(`Combat state unavailable (${statusResponse.status})`);
      authoritativeIntent = {
        ...intent,
        expectedVersion: Number((await statusResponse.json()).encounter?.version ?? 1),
      };
    }
    const response = await fetch(
      `${API_BASE_URL}/v1/combat/${encodeURIComponent(encounterId)}/intent`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          intent: authoritativeIntent,
          source,
          dmStartedAt,
          ...(origin ? { origin } : {}),
        }),
      },
    );
    logServerRequestId('/v1/combat', response);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const payloadRecord = isRecord(payload) ? payload : {};
      const rawDetails = isRecord(payloadRecord.details) ? payloadRecord.details : {};
      const stage =
        typeof payloadRecord.stage === 'string'
          ? payloadRecord.stage
          : typeof rawDetails.stage === 'string'
            ? rawDetails.stage
            : undefined;
      const reason =
        typeof payloadRecord.reason === 'string'
          ? payloadRecord.reason
          : typeof rawDetails.reason === 'string'
            ? rawDetails.reason
            : stage === 'intent_schema'
              ? 'COMBAT_INTENT_SCHEMA_REJECTED'
              : undefined;
      const details: CombatRefusalDetails = {
        ...(rawDetails as CombatRefusalDetails),
        ...(stage ? { stage } : {}),
        ...(reason ? { reason } : {}),
        ...(typeof payloadRecord.dialect === 'string' ? { dialect: payloadRecord.dialect } : {}),
        ...(typeof payloadRecord.variant === 'string' ? { variant: payloadRecord.variant } : {}),
        ...(typeof payloadRecord.detail === 'string' ? { detail: payloadRecord.detail } : {}),
        ...(Array.isArray(payloadRecord.missing)
          ? {
              missing: payloadRecord.missing.filter(
                (field): field is string => typeof field === 'string',
              ),
            }
          : {}),
      };
      throw new CombatIntentRefusedError(
        String(payloadRecord.error || `Combat action rejected (${response.status})`),
        response.status,
        Object.keys(details).length > 0 ? details : undefined,
      );
    }
    return payload.result;
  } catch (error) {
    // Repairable DM refusals are handled by the structured combat loop. Surface player-owned
    // failures and non-repairable DM failures, which otherwise become a vague message upstream.
    if (
      source === 'player' ||
      !(error instanceof CombatIntentRefusedError) ||
      !error.isRepairable
    ) {
      reportCombatIntentFailure(encounterId, error);
    }
    throw error;
  }
}

export async function executeStructuredCombatActionWithBoundary(
  encounterId: string,
  action: StructuredCombatAction,
  /** The natural d20 the player rolled for this action, when they rolled one. */
  providedD20?: number,
  /** Who produced the action; the server refuses a player action that no player input made. */
  origin?: CombatActionOrigin,
): Promise<StructuredCombatActionExecution> {
  const dmStartedAt = Date.now();
  let result: unknown;
  if (action.action_type === 'attack' && action.target_ids[0]) {
    result = await executeAuthoritativeCombatIntent(
      encounterId,
      {
        type: 'attack',
        actorId: action.actor_id,
        targetId: action.target_ids[0],
        weaponId: action.weapon_id || undefined,
        d20: providedD20,
      },
      'dm',
      dmStartedAt,
      origin,
    );
  } else if (action.action_type === 'cast_spell') {
    const spellName = playerCombatSpellLabel(action.spell_id, action.spell_id);
    result = await executeAuthoritativeCombatIntent(
      encounterId,
      {
        type: 'spell',
        actorId: action.actor_id,
        targetIds: action.target_ids,
        ...(action.spell_id ? { spellId: action.spell_id } : {}),
        spellName,
        ...(typeof action.slot_level === 'number' && action.slot_level >= 1
          ? { slotLevel: action.slot_level }
          : {}),
        d20: providedD20,
      },
      'dm',
      dmStartedAt,
      origin,
    );
  } else if (['dash', 'dodge', 'disengage'].includes(action.action_type)) {
    result = await executeAuthoritativeCombatIntent(
      encounterId,
      {
        type: action.action_type as 'dash' | 'dodge' | 'disengage',
        actorId: action.actor_id,
      },
      'dm',
      dmStartedAt,
      origin,
    );
  } else if (
    action.action_type === 'move' &&
    typeof action.x === 'number' &&
    typeof action.y === 'number'
  ) {
    result = await executeAuthoritativeCombatIntent(
      encounterId,
      { type: 'move', actorId: action.actor_id, x: action.x, y: action.y },
      'dm',
      dmStartedAt,
      origin,
    );
  } else {
    return { outcomes: [], boundary: null };
  }
  const boundary = combatBoundaryFromResult(result);
  // A post-conclusion no-op has no engine outcome. In particular, do not turn the marker into a
  // fabricated empty-damage result for the narration pass.
  if (boundary === 'encounter_already_concluded') return { outcomes: [], boundary };
  const movementOnly = isRecord(result) && result.resolvedAs === 'movement_only';
  const outcomes: RawCombatOutcome[] = movementOnly
    ? []
    : action.action_type === 'attack'
      ? [result as RawCombatOutcome]
      : ((result as { results?: RawCombatOutcome[] }).results ?? []);
  return {
    outcomes: outcomes.map((outcome, index) => ({
      participantId: action.target_ids[index] || action.target_ids[0],
      newHp: outcome.targetNewHp,
      damageType: outcome.damageType,
      hit: outcome.hit,
      finalDamage: outcome.finalDamage,
      isCritical: outcome.isCritical,
    })),
    result,
    boundary,
  };
}

/** Backward-compatible outcome-only bridge for callers that do not own a DM action batch. */
export async function executeStructuredCombatAction(
  encounterId: string,
  action: StructuredCombatAction,
  providedD20?: number,
): Promise<ResolvedTargetDamage[]> {
  return (await executeStructuredCombatActionWithBoundary(encounterId, action, providedD20))
    .outcomes;
}
