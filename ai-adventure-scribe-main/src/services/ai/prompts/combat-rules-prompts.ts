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
   * Combat-only. Attacks are declared, not choreographed: the engine paths the attacker into
   * reach and resolves the result. Asking the model to volunteer the geometry is what this
   * section used to do, and across a thirty-turn encounter it produced zero moves.
   */
  static buildSpatialTurnContractSection(): string {
    return `
<spatial_turn_contract>
<title>MANDATORY: DECLARE COMBAT ACTIONS, DO NOT CHOREOGRAPH THEM</title>
While combat is active, every attack and every deliberate move is declared in \`combat_actions\` as
an intent: who acts, what they do, and whom they do it to. You do NOT need to work out whether the
attacker can reach its target. The engine reads the tactical digest, walks the attacker as far
toward its target as its movement allows, and resolves the attack from where it ends up.

- \`roll_requests\` during combat is ONLY for saving throws and ability checks the fiction demands.
  Do NOT put attacks in \`roll_requests\`; an attack there has no actor, no target, and no authority.
- \`map_actions\` moves are for repositioning that is not part of an attack: retreating, taking cover,
  circling to a better angle. Approach before a strike is the engine's job, not yours.
- Every \`actor_id\` and \`target_ids\` value must be copied verbatim from the tactical digest. The
  digest's leading token on each line is that entity's id, and no other spelling of it exists. With
  three roaches on the board, "the Shadow Roach" names none of them: write \`shadow-roach-2\`.
- The engine reports back what actually happened in \`<engine_resolved_outcomes>\`. Narrate that,
  never the strike you hoped for.

Worked example - three roaches converge on the party's front line. Digest:
\`the-seeker|The Seeker@1,1 mv30/30 vs[shadow-roach-1:25ft/LoS/c0/range,shadow-roach-2:45ft/LoS/c0/range]\`
\`shadow-roach-1|Shadow Roach@6,5 mv30/30 vs[the-seeker:25ft/LoS/c0/range]\`
\`shadow-roach-2|Shadow Roach@10,9 mv30/30 vs[the-seeker:45ft/LoS/c0/range]\`
On the roaches' turns you declare both attacks and nothing else:
\`combat_actions\`: \`[{"actor_id":"shadow-roach-1","action_type":"attack","target_ids":["the-seeker"],"weapon_id":null,"spell_id":null,"slot_level":null,"movement_feet":0},{"actor_id":"shadow-roach-2","action_type":"attack","target_ids":["the-seeker"],"weapon_id":null,"spell_id":null,"slot_level":null,"movement_feet":0}]\`
The engine resolves them differently, and tells you so next turn:
- shadow-roach-1 was 25ft away with 30ft of movement: it closes to 5ft and its bite is rolled.
- shadow-roach-2 was 45ft away: it moves its full 30ft, ends 15ft short, and its action becomes
  movement. You will be told "Shadow Roach moved 30ft, is now 15ft from The Seeker, and could not
  reach it". Narrate a roach still scrabbling closer - NOT a bite that never happened.
</spatial_turn_contract>`;
  }

  static buildCombatRollRequirementsSection(): string {
    return COMBAT_ROLL_REQUIREMENTS_TEMPLATE;
  }
}
