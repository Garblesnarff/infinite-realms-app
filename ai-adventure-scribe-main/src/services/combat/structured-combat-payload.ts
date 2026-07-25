import type { DMResponse } from '../../../server-bun/src/services/dm/dm-response-schema';
import type { SceneSpec } from '../../../server-bun/src/tactical/types';
/**
 * Request body for `POST /v1/combat/sessions/:sessionId/start`.
 *
 * Declared here rather than alongside the API client so this module stays free of frontend
 * imports: server-side HTTP tests build their payloads with the same builder the browser uses.
 */
export type StructuredCombatStartPayload = {
  participants: Array<{
    encounterId: string;
    characterId?: string | null;
    npcId?: string | null;
    /** SRD catalog id (e.g. `srd:bandit`); the server resolves the stat block from it. */
    monsterId?: string;
    name: string;
    initiativeModifier: number;
    hpCurrent?: number | null;
    hpMax?: number | null;
  }>;
  sceneSpec: unknown;
};

/**
 * Pure translation from a structured DM response into the combat-start request body.
 *
 * Deliberately free of any API-client import so both the browser bridge and server-side
 * HTTP tests can build the exact same payload from a captured DM envelope.
 */
export type StructuredCombatResponse = Pick<
  DMResponse,
  'combat_transition' | 'scene_spec' | 'combatants'
>;

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
    // The SRD id is what lets the server resolve a real stat block instead of a 10/10/30
    // placeholder. Dropping it here was silently reducing every DM-authored enemy to filler.
    const monsterId = typeof combatant.monster_id === 'string' && combatant.monster_id.trim()
      ? combatant.monster_id.trim()
      : undefined;
    for (let index = 0; index < count; index += 1) {
      participants.push({
        encounterId: '',
        name: count === 1 ? combatant.name : `${combatant.name} ${index + 1}`,
        initiativeModifier: 0,
        ...(monsterId ? { monsterId } : {}),
      });
    }
  }

  return { participants, sceneSpec: response.scene_spec as unknown as SceneSpec };
}
