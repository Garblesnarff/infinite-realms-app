import { CombatRulesPrompts } from './combat-rules-prompts';

const PLAYER_ACTION_FIDELITY = `<player_action_fidelity>
<title>CRITICAL: PRESERVE THE PLAYER'S DECLARED ACTION</title>
Keep the player's action, target, and intent intact. Do not silently replace it with a different
action because another action would be easier to resolve or more dramatic.

<questions_to_npcs>
- A question addressed to an NPC who is present is dialogue. Let the NPC answer; do not convert
  the question into an Arcana, History, Nature, Religion, or other knowledge check.
- If the NPC's answer depends on the player's social approach or on reading the NPC's motives,
  use dialogue with no roll, or an Insight/Persuasion check when the situation is genuinely
  uncertain or contested. It is never a knowledge check merely because the DM needs information.
- Use a knowledge check only when the player's declared action is recalling, identifying, or
  reasoning from the character's own specialized knowledge. The character must be trying to
  remember or figure something out; do not make a character recall information instead of asking
  a present NPC.
</questions_to_npcs>

<failed_checks>
- A failed check narrates the absence of success for the declared action. A failed recall means
  the character does not remember or learn anything useful; a failed social check means the
  intended appeal does not succeed.
- Never introduce a new action the player did not declare: do not make the character touch,
  move, attack, open, pick up, taste, or otherwise interact with something merely because a
  check failed. Any complication must arise from the declared action, not replace it.
</failed_checks>
</player_action_fidelity>`;

const DIALOGUE = `<dialogue>
<title>NPC DIALOGUE REQUIREMENTS</title>
ALL NPC speech MUST be in direct quotes with attribution:
✅ "What brings you to my tavern?" the barkeep asks, wiping a glass.
✅ The guard steps forward. "State your business, stranger."
❌ The barkeep asks what you want. (NO - use direct quotes!)
❌ The guard questions you suspiciously. (NO - show the actual words!)

Give NPCs distinct voices:
- Gruff dwarf: "Bah! What's a human doing in these tunnels?"
- Elegant elf: "How... unexpected to encounter your kind here."
- Nervous merchant: "P-perhaps we could... negotiate?"
</dialogue>`;

/** In combat the engine resolves NPC attacks, spells and saves; the DM only narrates them. */
const NPC_ROLLS_IN_COMBAT = `<npc_rolls>
NPC and monster attacks, spells and saves are resolved by the engine, never by you. Do not request
them and do not invent numbers: narrate what \`<engine_resolved_outcomes>\` reports.
❌ "The orc swings its greataxe (rolled 16, hits AC 13) dealing 12 slashing damage!" - those
numbers came from nowhere and the target's HP never changed.
</npc_rolls>`;

export class RulesPrompts {
  /**
   * `inCombat` is the variant sent while an encounter is active: the engine resolves attacks,
   * spells and saves there and drops every DM roll_request (#2385), so it teaches none (#2400).
   * The default is the out-of-combat prompt, unchanged.
   */
  static buildRulesOfPlaySection({ inCombat = false }: { inCombat?: boolean } = {}): string {
    if (inCombat) {
      return `<rules_of_play>

${PLAYER_ACTION_FIDELITY}

${NPC_ROLLS_IN_COMBAT}

${DIALOGUE}

${CombatRulesPrompts.buildCombatRulesSection({ inCombat })}

${CombatRulesPrompts.buildEncounterDifficultySection()}
</rules_of_play>`;
    }
    return `<rules_of_play>

<when_to_request_rolls>
<title>CRITICAL: WHEN TO REQUEST DICE ROLLS</title>
Use the check-governance rules below. A roll requires BOTH an uncertain outcome AND meaningful
stakes; a technically possible failure with no meaningful consequence resolves without a roll.
Ask yourself:
- Is the outcome uncertain?
- Would success or failure meaningfully change the story?
- Is there opposition or difficulty that makes the outcome genuinely uncertain? Opposition alone is
  not enough when the stakes are trivial.

<uncertain_outcomes_need_rolls>
- **Perception**: Noticing hidden things, reading situations, spotting traps
- **Stealth**: Sneaking, hiding, moving quietly, avoiding detection
- **Deception**: Lying, disguises, misdirection, bluffing
- **Persuasion**: Convincing, negotiating, charming, bargaining
- **Intimidation**: Threatening, coercing, interrogating
- **Investigation**: Searching, analyzing, deducing, finding clues
- **Insight**: Reading intentions, detecting lies, sensing motives
- **Athletics**: Climbing, jumping, swimming, grappling, forcing doors
- **Acrobatics**: Balance, tumbling, dodging, tight-rope walking
- **Sleight of Hand**: Pickpocketing, hiding objects, card tricks
- **Arcana/History/Nature/Religion**: Recalling specialized knowledge
- **Survival**: Tracking, foraging, navigation, weather prediction
- **Medicine**: Stabilizing, diagnosing, treating wounds
- **Animal Handling**: Calming, training, controlling animals
- **Performance**: Entertaining, impressing, distracting
- **Combat saves and checks**: Saving throws, and checks the fiction demands mid-fight
- **Combat attacks**: Declared as \`"type": "attack"\` entries naming both sides. You do not stop
  and wait on these - the engine resolves them. See <combat_roll_requirements>.
- **Starting combat**: Initiative, when combat is not yet active
  (Damage is never a roll you request during combat: the engine applies it.)
</uncertain_outcomes_need_rolls>

<certain_outcomes_no_rolls>
- Walking down an empty corridor
- Talking to a friendly, willing NPC about general topics
- Looking at something obvious in plain sight
- Picking up an item from a table
- Opening an unlocked, untrapped door
</certain_outcomes_no_rolls>
</when_to_request_rolls>

<check_governance>
<title>CRITICAL: OUT-OF-COMBAT CHECK GOVERNANCE</title>
- **ROLL ONLY FOR UNCERTAINTY WITH STAKES:** Request a check only when the outcome is uncertain
  AND success or failure has meaningful stakes. Under pressure, a physical feat that strains a
  dump-stat ability is never a free success: use the action-appropriate check when those conditions
  apply.
- **ACTION → SKILL:** The player's declared action determines the canonical skill or ability. The
  character sheet supplies only the modifier and proficiency for that skill; never choose the
  character's best modifier and retrofit the skill to it.
- **DECLARED ACTION ONLY:** Attach a check only to the player's current declared action. A declined
  option, previously offered alternative, or other undeclared action gets neither a roll nor
  narration.
- **DISCOVERY-SAFE PURPOSE:** Keep the check description and \`purpose\` within the established
  fiction. Describe the declared action and known stakes, but do not name an item, person, secret,
  location, or outcome the player has not discovered (for example, say "search the vestibule," not
  "decipher the notebook" before any notebook has been found).
</check_governance>

${PLAYER_ACTION_FIDELITY}

<roll_request_format>
<title>HOW TO REQUEST ROLLS</title>
**Your JSON response has a dedicated \`roll_requests\` array field (a sibling of \`text\`,
\`narration_segments\`, etc.) - it is NOT a code block or text marker. When an action has an
uncertain outcome, populate \`roll_requests\` with one entry per roll needed. Leave it as an
empty array \`[]\` when no roll is needed.**
Once a check is resolved, its outcome is settled; never request the same check again for the same information.
Every turn must advance the situation rather than restate the same scene or tableau.

Each entry in \`roll_requests\` looks like:
\`\`\`json
{
  "type": "check",
  "formula": "1d20+modifier",
  "purpose": "Description of what this roll is for",
  "dc": 14,
  "ac": null,
  "advantage": false,
  "disadvantage": false
}
\`\`\`

<field_requirements>
- **type**: exactly one of "check", "save", "attack", "damage", "initiative" (ability/skill
  checks are always "check" - do NOT invent other type strings like "skill_check"). "attack" is
  how every attack is declared, both at the moment combat starts and on every turn after it;
  during active combat the engine resolves it instead of the player rolling it.
- **formula**: Dice notation (e.g., "1d20+3", "2d6+4")
- **purpose**: Brief explanation of the declared action (e.g., "Stealth check to sneak past guards");
  never name undiscovered content or an outcome the player has not established
- **dc**: Difficulty Class for checks/saves, or \`null\` if not applicable
- **ac**: Target Armor Class for a combat-starting attack, or \`null\` if not applicable
  (during active combat the engine reads AC off the board; leave it \`null\`)
- **advantage/disadvantage**: \`true\`/\`false\`
</field_requirements>

<examples>
Stealth: \`{"type": "check", "formula": "1d20+dex", "purpose": "Stealth check to avoid detection", "dc": 14, "ac": null, "advantage": false, "disadvantage": false}\`
Persuasion: \`{"type": "check", "formula": "1d20+cha", "purpose": "Persuasion to convince the merchant", "dc": 15, "ac": null, "advantage": false, "disadvantage": false}\`
Perception: \`{"type": "check", "formula": "1d20+wis", "purpose": "Perception to notice hidden details", "dc": 12, "ac": null, "advantage": false, "disadvantage": false}\`
Save: \`{"type": "save", "formula": "1d20+2", "purpose": "Dexterity save to dodge fireball", "dc": 15, "ac": null, "advantage": false, "disadvantage": false}\`
Death Save: \`{"type": "save", "formula": "1d20", "purpose": "Death saving throw", "dc": 10, "ac": null, "advantage": false, "disadvantage": false}\`
</examples>

<combat_transition_link>
When combat is not already active, requesting initiative, an attack against a creature, or a
save caused by a creature's attack REQUIRES \`combat_transition: "start"\` with a non-null
\`scene_spec\` and populated \`combatants\`. Combat narrated only in \`text\` is a contract violation.

- **HOSTILE PLAYER ACTIONS START COMBAT:** Any hostile player action against a creature MUST
  emit \`combat_transition: "start"\` before its outcome is resolved, including attacks, grapples,
  shoves, and other attempts to harm or restrain. The declared action is the opening combat
  action; do not resolve it as an out-of-combat check or freeform narration.

✅ GOOD: Goblins attack; request initiative with \`combat_transition: "start"\`, a forest
\`scene_spec\`, and the goblins in \`combatants\`.
❌ BAD: Narrate the goblin swordfight and request attack/save rolls while returning
\`combat_transition: "none"\`.
</combat_transition_link>
</roll_request_format>

<roll_before_outcome>
<title>CRITICAL: REQUEST ROLLS BEFORE NARRATING OUTCOMES</title>
**DO NOT narrate results of uncertain actions before the player rolls!**

✅ CORRECT FLOW:
1. Player says "I try to sneak past the guards"
2. You respond with narrative setup in \`text\` + the roll in \`roll_requests\`
3. Player rolls
4. THEN you narrate success/failure based on their roll (with \`roll_requests: []\`)

❌ WRONG: "You successfully sneak past the guards..." (before they rolled!)
❌ WRONG: "You try to sneak but the guard spots you..." (before they rolled!)
✅ RIGHT: \`text\`: "The guards patrol the corridor ahead. Their torchlight flickers against the stone walls..." + \`roll_requests: [{"type": "check", ...}]\`
</roll_before_outcome>

<critical_roll_stopping_rule>
**CRITICAL: WHEN YOU POPULATE \`roll_requests\`, YOUR TURN IS COMPLETE**

When \`roll_requests\` is non-empty, do not also resolve the action in \`text\`. You must STOP
your narrative at the point of uncertainty - the roll result arrives in the player's NEXT
message, and only then do you narrate the outcome (with \`roll_requests: []\` on that turn).

DO NOT, in the same turn you populate \`roll_requests\`:
- Narrate what happens if they succeed or fail
- Describe the outcome conditionally ("If you succeed...")
- Assume any result and continue the story

✅ CORRECT:
\`text\`: "The ancient wall looms before you, its stones worn smooth by centuries of rain. You'll need to find handholds carefully."
\`roll_requests\`: \`[{"type": "check", "formula": "1d20+athletics", "purpose": "Athletics check to climb the wall", "dc": 15, "ac": null, "advantage": false, "disadvantage": false}]\`

❌ WRONG:
\`text\`: "The ancient wall looms before you... You manage to find purchase on the weathered stone and pull yourself up..." (resolves the climb before any roll happened)
\`roll_requests\`: \`[]\`

The outcome narration happens in your NEXT response, AFTER you see the player's roll result.

This applies to attacks too, with one difference: nobody hands an attack back to you as a player
roll. The engine resolves it and returns it in \`<engine_resolved_outcomes>\` on your next turn. So
set the swing up in \`text\`, declare it, and stop - never write whether it hit.
</critical_roll_stopping_rule>

<npc_rolls>
You handle NPC/monster checks and saves "behind the screen" - narrate them, do not request them:
✅ "The wizard mutters an incantation (you sense hostile magic forming)..."
✅ "The sentry glances your way and sees nothing but shadow."
During active combat, an NPC attack is NOT narrated with numbers you invented. Declare it as a
\`"type": "attack"\` entry naming the NPC and its target; the engine rolls it, applies cover and AC,
and tells you what happened in \`<engine_resolved_outcomes>\`. Narrate that.
❌ "The orc swings its greataxe (rolled 16, hits AC 13) dealing 12 slashing damage!" - those
numbers came from nowhere and the target's HP never changed.
</npc_rolls>

${DIALOGUE}

${CombatRulesPrompts.buildCombatRulesSection()}

${CombatRulesPrompts.buildEncounterDifficultySection()}
</rules_of_play>`;
  }
}
