import type { DamageType } from '@/types/combat';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export interface StructuredCombatAction {
  actor_id: string;
  action_type: 'attack' | 'cast_spell' | 'dash' | 'disengage' | 'dodge' | 'help' | 'hide' | 'ready' | 'use_object';
  target_ids: string[];
  weapon_id: string | null;
  spell_id: string | null;
  slot_level: number | null;
  movement_feet: number;
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

export type ClientCombatIntent =
  | { type: 'attack'; actorId: string; targetId: string; weaponId?: string; expectedVersion?: number; advantage?: boolean; disadvantage?: boolean }
  | { type: 'spell'; actorId: string; targetIds: string[]; spellId?: string; spellName: string; slotLevel?: number; expectedVersion?: number }
  | { type: 'dash' | 'dodge' | 'disengage'; actorId: string; expectedVersion?: number }
  | { type: 'end_turn'; actorId: string }
  | { type: 'move'; actorId: string; x: number; y: number };

export async function executeAuthoritativeCombatIntent(
  encounterId: string,
  intent: ClientCombatIntent,
  source: 'player' | 'dm' = 'player',
  dmStartedAt?: number,
): Promise<unknown> {
  const token = window.localStorage.getItem('workos_access_token');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let authoritativeIntent = intent;
  if ('expectedVersion' in intent && intent.expectedVersion === undefined) {
    const statusResponse = await fetch(`${API_BASE_URL}/v1/combat/${encodeURIComponent(encounterId)}/status`, { headers });
    if (!statusResponse.ok) throw new Error(`Combat state unavailable (${statusResponse.status})`);
    authoritativeIntent = { ...intent, expectedVersion: Number((await statusResponse.json()).encounter?.version ?? 1) };
  }
  const response = await fetch(`${API_BASE_URL}/v1/combat/${encodeURIComponent(encounterId)}/intent`, {
    method: 'POST', headers,
    body: JSON.stringify({ intent: authoritativeIntent, source, dmStartedAt }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || `Combat action rejected (${response.status})`));
  return payload.result;
}

export async function executeStructuredCombatAction(
  encounterId: string,
  action: StructuredCombatAction,
): Promise<ResolvedTargetDamage[]> {
  const dmStartedAt = Date.now();
  let result: unknown;
  if (action.action_type === 'attack' && action.target_ids[0]) {
    result = await executeAuthoritativeCombatIntent(encounterId, {
      type: 'attack', actorId: action.actor_id, targetId: action.target_ids[0],
      weaponId: action.weapon_id || undefined,
    }, 'dm', dmStartedAt);
  } else if (action.action_type === 'cast_spell' && action.spell_id) {
    result = await executeAuthoritativeCombatIntent(encounterId, {
      type: 'spell', actorId: action.actor_id, targetIds: action.target_ids,
      spellId: action.spell_id, spellName: action.spell_id, slotLevel: action.slot_level || undefined,
    }, 'dm', dmStartedAt);
  } else if (['dash', 'dodge', 'disengage'].includes(action.action_type)) {
    await executeAuthoritativeCombatIntent(encounterId, {
      type: action.action_type as 'dash' | 'dodge' | 'disengage', actorId: action.actor_id,
    }, 'dm', dmStartedAt);
    return [];
  } else {
    return [];
  }
  const outcomes: RawCombatOutcome[] = action.action_type === 'attack'
    ? [result as RawCombatOutcome]
    : ((result as { results?: RawCombatOutcome[] }).results ?? []);
  return outcomes.map((outcome, index) => ({
    participantId: action.target_ids[index] || action.target_ids[0],
    newHp: outcome.targetNewHp,
    damageType: outcome.damageType,
    hit: outcome.hit,
    finalDamage: outcome.finalDamage,
    isCritical: outcome.isCritical,
  }));
}
