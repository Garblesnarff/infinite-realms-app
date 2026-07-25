import {
  COMBAT_RULES_TEMPLATE,
  ENCOUNTER_DIFFICULTY_TEMPLATE,
  COMBAT_ROLL_REQUIREMENTS_TEMPLATE,
} from './combat-rules-templates';

import type {
  CombatDetectionResult,
  DetectedEnemy,
  DetectedCombatAction,
} from '@/utils/combatDetection';

export class CombatRulesPrompts {
  static buildCombatRulesSection(): string {
    return COMBAT_RULES_TEMPLATE;
  }

  static buildEncounterDifficultySection(): string {
    return ENCOUNTER_DIFFICULTY_TEMPLATE;
  }

  static formatCombatContext(combatDetection: CombatDetectionResult): string {
    if (!combatDetection.isCombat) return '';

    let combatText = `\n\nCOMBAT CONTEXT DETECTED:
Combat Type: ${combatDetection.combatType}
Confidence: ${Math.round(combatDetection.confidence * 100)}%
Should Start Combat: ${combatDetection.shouldStartCombat ? 'YES' : 'NO'}
Should End Combat: ${combatDetection.shouldEndCombat ? 'YES' : 'NO'}`;

    if (combatDetection.enemies && combatDetection.enemies.length > 0) {
      combatText += `

DETECTED ENEMIES:`;
      combatDetection.enemies.forEach((enemy: DetectedEnemy) => {
        combatText += `
- ${enemy.name} (${enemy.type}, CR ${enemy.estimatedCR})
  HP: ${enemy.suggestedHP}, AC: ${enemy.suggestedAC}
  Description: ${enemy.description}`;
      });
    }

    if (combatDetection.combatActions && combatDetection.combatActions.length > 0) {
      combatText += `

DETECTED COMBAT ACTIONS:`;
      combatDetection.combatActions.forEach((action: DetectedCombatAction) => {
        combatText += `
- ${action.actor} performs ${action.action}${action.target ? ` against ${action.target}` : ''}${action.weapon ? ` with ${action.weapon}` : ''}
  Roll Type: ${action.rollType}, Needs Roll: ${action.rollNeeded ? 'YES' : 'NO'}`;
      });
    }

    combatText += `

**COMBAT RESPONSE REQUIREMENTS:**
When combat is detected, you MUST:
1. **REQUEST** dice rolls for player actions via the \`roll_requests\` array field (DO NOT roll for the player)
2. **AUTO-EXECUTE** NPC/enemy actions and narrate them behind the screen (do not put NPC rolls in \`roll_requests\`, which is player-facing only)
3. **DESCRIBE** actions cinematically while maintaining mechanical accuracy
4. **ENFORCE** turn order (player turn, then all NPCs, then player again)
`;

    return combatText;
  }

  /**
   * Combat-only. The tactical digest is the single source of geometry, and the server
   * rejects an attack the board does not allow, so this section states the same contract
   * the validator enforces.
   */
  static buildSpatialTurnContractSection(): string {
    return `
<spatial_turn_contract>
<title>MANDATORY: SPATIAL COHERENCE ON EVERY COMBAT TURN</title>
Every combatant's turn must match the tactical digest: a melee attack requires the attacker within
5ft of its target, so when the digest shows more distance you MUST emit a \`map_actions\` move that
closes the gap (never more than that entity's movementRemaining) before or instead of attacking.
Ranged attacks and spells require line of sight in the digest and take the listed cover into account,
and monsters move on their own turns through \`map_actions\` too - prose movement changes nothing.

Every \`entityId\`, \`actor_id\`, and \`target_ids\` value must be copied verbatim from the tactical digest:
the digest's leading token for each line is that entity's id, and no other spelling of it exists.

Worked example - digest lines \`the-seeker|The Seeker@1,1 mv30/30 vs[shadow-roach-1:55ft/LoS/c0/range]\`
and \`shadow-roach-1|Shadow Roach@12,10 mv30/30 vs[the-seeker:55ft/LoS/c0/range]\`, Shadow Roach's turn
(move 25ft to close, then attack in the same turn):
\`map_actions\`: \`[{"action":"move","entityId":"shadow-roach-1","x":7,"y":6,"changes":null}]\`
\`combat_actions\`: \`[{"actor_id":"shadow-roach-1","action_type":"attack","target_ids":["the-seeker"],"weapon_id":null,"spell_id":null,"slot_level":null,"movement_feet":25}]\`
</spatial_turn_contract>`;
  }

  static buildCombatRollRequirementsSection(): string {
    return COMBAT_ROLL_REQUIREMENTS_TEMPLATE;
  }
}
