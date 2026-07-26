import { mapToAscii } from './serialize.js';
import { buildTacticalDigest } from './tactical-context.js';

import type { TacticalMap } from './types.js';

export const TACTICAL_INSTRUCTIONS = `TACTICAL AUTHORITY: Spatial facts may only come from the tactical digest, never estimates. Before narrating an attack, consult its pair's distance, LoS, and cover. AoE actions must name an origin cell and accept the engine target list, including friendly fire. Narrate invalid moves as the world's rules, never as an error. Weave cell decoration values into the narration when present. Attacks are declared in combat_actions with an actor_id and target_ids, never as roll_requests and never with a map_actions move to close the distance first: the engine walks the attacker into reach and resolves the attack from where it lands. Use map_actions only for repositioning that is not part of an attack. Every entityId, actor_id, and target_ids value must be copied verbatim from the digest: the leading token on each digest line is that entity's only id.`;

export function buildTacticalPrompt(map: TacticalMap, activeEntityId?: string): string {
  const prompt = `${mapToAscii(map)}\nTACTICAL DIGEST\n${buildTacticalDigest(map, activeEntityId)}\n${TACTICAL_INSTRUCTIONS}`;
  // Medium generated maps are deliberately bounded; this prevents prompt growth regressions.
  if (map.width <= 20 && map.height <= 20 && prompt.split(/\s+/).length > 500)
    throw new Error('Tactical context exceeds 500 token budget');
  return prompt;
}
