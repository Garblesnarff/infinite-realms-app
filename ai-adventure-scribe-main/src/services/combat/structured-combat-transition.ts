import type { DMResponse } from '../../../server-bun/src/services/dm/dm-response-schema';
import type { SceneSpec } from '../../../server-bun/src/tactical/types';

import { userDataApi, type StructuredCombatStartPayload } from '@/services/user-data-api';

type StructuredCombatResponse = Pick<DMResponse, 'combat_transition' | 'scene_spec' | 'combatants'>;

const numeric = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const dexterityModifier = (character: Record<string, unknown>): number => {
  const scores = (character.abilityScores || character.ability_scores) as
    | Record<string, unknown>
    | undefined;
  const dexterity = scores?.dexterity;
  if (dexterity && typeof dexterity === 'object') {
    return numeric((dexterity as { modifier?: unknown }).modifier);
  }
  return 0;
};

export function buildStructuredCombatStartPayload(
  character: Record<string, unknown>,
  response: StructuredCombatResponse,
): StructuredCombatStartPayload | null {
  if (response.combat_transition !== 'start' || !response.scene_spec) return null;
  const characterId = typeof character.id === 'string' ? character.id : null;
  const hpCurrent = numeric(character.currentHitPoints ?? character.current_hit_points, 0);
  const hpMax = numeric(character.maxHitPoints ?? character.max_hit_points, 0);
  const participants: StructuredCombatStartPayload['participants'] = [
    {
      encounterId: '',
      characterId,
      name: typeof character.name === 'string' ? character.name : 'Player',
      initiativeModifier: dexterityModifier(character),
      ...(hpCurrent > 0 ? { hpCurrent } : {}),
      ...(hpMax > 0 ? { hpMax } : {}),
    },
  ];

  for (const combatant of response.combatants || []) {
    const count = Math.max(1, Math.floor(numeric(combatant.count, 1)));
    for (let index = 0; index < count; index += 1) {
      participants.push({
        encounterId: '',
        name: count === 1 ? combatant.name : `${combatant.name} ${index + 1}`,
        initiativeModifier: 0,
      });
    }
  }

  return { participants, sceneSpec: response.scene_spec as unknown as SceneSpec };
}

export async function startStructuredCombatTransition(
  sessionId: string,
  character: Record<string, unknown>,
  response: StructuredCombatResponse,
): Promise<Response | null> {
  const payload = buildStructuredCombatStartPayload(character, response);
  return payload ? userDataApi.startStructuredCombat(sessionId, payload) : null;
}
