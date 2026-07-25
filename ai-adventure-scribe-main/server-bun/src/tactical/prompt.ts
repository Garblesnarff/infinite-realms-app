import { mapToAscii } from './serialize.js';
import { buildTacticalDigest } from './tactical-context.js';

import type { TacticalMap } from './types.js';

export const TACTICAL_INSTRUCTIONS = `TACTICAL AUTHORITY: Spatial facts may only come from the tactical digest, never estimates. Before narrating an attack, consult its pair's distance, LoS, and cover. AoE actions must name an origin cell and accept the engine target list, including friendly fire. Narrate invalid moves as the world's rules, never as an error. Weave cell decoration values into the narration when present. Attacks must be legal from the actor's current cell: when a melee target is beyond 5ft, emit a map_actions move within movementRemaining first; monsters move on their turns via map_actions too. Every entityId, actor_id, and target_ids value must be copied verbatim from the digest: the leading token on each digest line is that entity's only id.`;

export function buildTacticalPrompt(map: TacticalMap, activeEntityId?: string): string {
  const prompt = `${mapToAscii(map)}\nTACTICAL DIGEST\n${buildTacticalDigest(map, activeEntityId)}\n${TACTICAL_INSTRUCTIONS}`;
  // Medium generated maps are deliberately bounded; this prevents prompt growth regressions.
  if (map.width <= 20 && map.height <= 20 && prompt.split(/\s+/).length > 500)
    throw new Error('Tactical context exceeds 500 token budget');
  return prompt;
}
