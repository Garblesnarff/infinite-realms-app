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

**PLAYER-FACING HIT POINT RULE:** Any HP values in this private combat context are engine/UI state.
Never repeat numeric HP, maximum HP, remaining HP, healing amounts, or hit-point totals in narration
or dialogue. Describe condition only as unharmed, wounded, bloodied, or near death.`;

    combatText += `

**COMBAT RESPONSE REQUIREMENTS:**
When combat is detected, you MUST:
1. **DECLARE** every attack - the player's and every enemy's - as a \`"type": "attack"\` entry in
   \`roll_requests\`, naming attacker and target by their tactical digest ids in \`purpose\`
   (\`combat_actions\` with \`actor_id\`/\`target_ids\` is accepted for the same attack). The engine
   rolls it, applies the damage, and reports back.
2. **NEVER** leave an attack undeclared. A swing that exists only in your narration is a swing
   the engine never rolled and the target never felt.
3. **DESCRIBE** actions cinematically while maintaining mechanical accuracy
4. **ENFORCE** turn order (player turn, then all NPCs, then player again)
`;

    return combatText;
  }

  /**
   * Combat-only. Attacks are declared, not choreographed: the engine paths the attacker into
   * reach and resolves the result. Asking the model to volunteer the geometry is what this
   * section used to do, and across a thirty-turn encounter it produced zero moves.
   *
   * INTENTIONAL: the worked example is written in the `roll_requests` dialect, matching
   * COMBAT_ROLL_REQUIREMENTS_TEMPLATE. This section previously demanded `combat_actions` and
   * forbade `roll_requests` outright, which is the contradiction run 8 was fighting and the
   * purge run 9 paid for. One teaching, one example, one channel taught as primary.
   */
  static buildSpatialTurnContractSection(): string {
    return `
<spatial_turn_contract> <!-- INTENTIONAL_ELICITATION_DIALECT -->
<title>MANDATORY: DECLARE ATTACKS, DO NOT CHOREOGRAPH OR RESOLVE THEM</title>
While combat is active, every attack is declared as an intent: who acts, what they do, and whom they
do it to. You do NOT need to work out whether the attacker can reach its target. The engine reads
the tactical digest, walks the attacker as far toward its target as its movement allows, and
resolves the attack from where it ends up.

- Declare an attack as a \`roll_requests\` entry with \`"type": "attack"\` whose \`purpose\` names the
  attacker and the target by their digest ids. \`combat_actions\` is accepted for the same attack if
  you prefer explicit id fields; both reach the engine identically.
- \`roll_requests\` also carries the saving throws and ability checks the fiction demands. Those you
  stop on; attacks you do not - the engine rolls the attack and hands you the result next turn.
- \`map_actions\` moves are for repositioning that is not part of an attack: retreating, taking cover,
  circling to a better angle. Approach before a strike is the engine's job, not yours.
- Every id you write must be copied verbatim from the tactical digest. The digest's leading token on
  each line is that entity's id, and no other spelling of it exists. With three roaches on the
  board, "the Shadow Roach" names none of them: write \`shadow-roach-2\`.
- The engine reports back what actually happened in \`<engine_resolved_outcomes>\`. Narrate that,
  never the strike you hoped for, and never a hit or a damage number you chose yourself.

Worked example - three roaches converge on the party's front line. Digest:
\`the-seeker|The Seeker@1,1 mv30/30 vs[shadow-roach-1:25ft/LoS/c0/range,shadow-roach-2:45ft/LoS/c0/range]\`
\`shadow-roach-1|Shadow Roach@6,5 mv30/30 vs[the-seeker:25ft/LoS/c0/range]\`
\`shadow-roach-2|Shadow Roach@10,9 mv30/30 vs[the-seeker:45ft/LoS/c0/range]\`
On the roaches' turns you narrate the lunge and declare both attacks:
\`roll_requests\`: \`[{"type":"attack","formula":"1d20","purpose":"shadow-roach-1 attacks the-seeker","dc":null,"ac":null,"advantage":false,"disadvantage":false},{"type":"attack","formula":"1d20","purpose":"shadow-roach-2 attacks the-seeker","dc":null,"ac":null,"advantage":false,"disadvantage":false}]\`
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
