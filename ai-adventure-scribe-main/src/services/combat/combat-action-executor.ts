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

export async function executeStructuredCombatAction(
  encounterId: string,
  action: StructuredCombatAction,
): Promise<ResolvedTargetDamage[]> {
  const token = window.localStorage.getItem('workos_access_token');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const statusResponse = await fetch(`${API_BASE_URL}/v1/combat/${encodeURIComponent(encounterId)}/status`, { headers });
  if (!statusResponse.ok) throw new Error(`Combat state unavailable (${statusResponse.status})`);
  const expectedVersion = Number((await statusResponse.json()).encounter?.version ?? 1);
  let path: string;
  let body: Record<string, unknown>;

  if (action.action_type === 'attack' && action.target_ids[0]) {
    path = 'attack';
    body = {
      attackerId: action.actor_id, targetId: action.target_ids[0],
      weaponId: action.weapon_id || undefined, attackType: 'melee', expectedVersion,
    };
  } else if (action.action_type === 'cast_spell' && action.spell_id) {
    path = 'spell-attack';
    body = {
      casterId: action.actor_id, targetIds: action.target_ids,
      spellId: action.spell_id, spellName: action.spell_id, slotLevel: action.slot_level || undefined, expectedVersion,
    };
  } else {
    return [];
  }

  const response = await fetch(`${API_BASE_URL}/v1/combat/${encodeURIComponent(encounterId)}/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Combat action rejected (${response.status})`);
  const result = await response.json();
  const outcomes = path === 'attack' ? [result] : result.results || [];
  return outcomes.map((outcome: any, index: number) => ({
    participantId: action.target_ids[index] || action.target_ids[0],
    newHp: outcome.targetNewHp,
    damageType: outcome.damageType,
    hit: outcome.hit,
    finalDamage: outcome.finalDamage,
    isCritical: outcome.isCritical,
  }));
}
