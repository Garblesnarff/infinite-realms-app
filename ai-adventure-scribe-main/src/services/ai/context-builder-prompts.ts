/* eslint-disable @typescript-eslint/no-explicit-any */
import { GameContextPrompts } from './prompts/game-context-prompts';
import { buildOpeningScenePrompt } from './shared/prompts';

import type { Memory } from '../memory-manager';
import type { GameContext } from './shared/types';

export class ContextBuilderPrompts {
  static buildPersonaSection(): string {
    return `<persona>
You are a skilled D&D 5e Dungeon Master who creates immersive, mechanically-sound adventures. You balance compelling narrative with proper game mechanics, always giving players meaningful choices with clear consequences.
</persona>`;
  }

  static async buildGameContextSection(
    context: GameContext,
    relevantMemories: Memory[],
    loreSection?: string,
  ): Promise<string> {
    return GameContextPrompts.buildGameContextSection(context, relevantMemories, loreSection);
  }

  static buildCharacterSection(char: Record<string, any>): Promise<string> {
    return GameContextPrompts.buildCharacterSection(char);
  }

  /**
   * Renders the "Previously On" recap (fetched via chronicles.getPreviouslyOn) as a
   * clearly-labeled block near the top of the opening prompt, with an instruction that
   * the DM must open with continuity from it. Only called when a recap is present.
   */
  static buildPreviousSessionRecapSection(recap: string): string {
    return `
<previous_session_recap>
${recap}

The DM MUST open this scene with narrative continuity from this recap — pick up where the story left off instead of starting the session blind to what came before.
</previous_session_recap>`;
  }

  static buildOpeningSceneSection(): string {
    return buildOpeningScenePrompt();
  }

  static buildVoiceOptimizationSection(): string {
    return `
<voice_optimization>
Your response will be synthesized into voice.
Emit one narration_segments entry per speaker change. Never put two speakers in one segment.
- Prose/narration: type "dm", character null (speaker = narrator), voice_category "narrator"
- Quoted NPC dialogue: type "character", character = that NPC's name, voice_category from the closed enum
A reply with narration AND an NPC quote MUST be at least two segments with distinct speakers.
voice_category must be one of: narrator, hero_male, hero_female, villain_male, villain_female, monster, goblin, merchant, guard, innkeeper, elder, child.
Use narrator for DM narration and unknown speakers. Do not invent free-text voice traits.
</voice_optimization>`;
  }

  static buildOpeningResponseStructureSection(): string {
    return `<opening_response_structure>
<title>OPENING RESPONSE CONTRACT</title>

**Return ONLY these two sections, in this exact order:**
1. **Narrative**: 3-4 paragraphs with a complete opening scene
2. **options JSON field**: populate with 3-5 player-facing choices (default to exactly 3 unless a 4th or 5th option is clearly distinct and useful)

<opening_rules>
- Do NOT include \`\`\`ROLL_REQUESTS_V1
- Do NOT include VISUAL PROMPT or code fences
- Do NOT end with a prose question like "What do you do?" before populating the options field
- Populate the \`options\` JSON field; each element must use the \`A. **Bold Action**, description\` format
- Keep player-facing choices out of the narrative \`text\` field
- If you include an [ASSET:type:key] tag, it MUST be immediately followed by the visible entity name
</opening_rules>

</opening_response_structure>`;
  }

  /**
   * `inCombat` is the variant sent while an encounter is active: the engine resolves attacks,
   * spells and saves there and the client drops every DM roll_request (#2385), so it teaches none
   * (#2400). The default is the out-of-combat prompt, unchanged.
   */
  static buildResponseStructureSection({ inCombat = false }: { inCombat?: boolean } = {}): string {
    const responseOrder = `1. **Narrative** (1-3 paragraphs): Consequences, new information, NPC dialogue, environmental details
2. **roll_requests field** (if a dice roll is needed): populate it based on the narrative you just wrote - it is a JSON array field, not text in the narrative
3. **options JSON field**: populate it with player-facing choices in the required format
4. **VISUAL PROMPT** (optional): Single line for image generation`;

    const responseOrderInCombat = `1. **Narrative** (1-3 paragraphs): Consequences, new information, NPC dialogue, environmental details
2. **combat_actions field**: declare the current player's attack there; \`roll_requests\` stays an empty array
3. **options JSON field**: populate it with player-facing choices in the required format
4. **VISUAL PROMPT** (optional): Single line for image generation`;

    const combatDeclarationFormat = `<combat_declaration_format>
<title>MANDATORY: DECLARE, DO NOT ROLL</title>
While combat is active the engine resolves attacks, spells and saves. Do not request rolls: leave
\`roll_requests\` as an empty array \`[]\`. Declare the current player's attack in the \`combat_actions\`
array field of your JSON response (see <combat_roll_requirements>); the engine rolls it and reports
back in \`<engine_resolved_outcomes>\` on your next turn.
**Do NOT narrate the outcome of a declared attack in \`text\` - set it up and stop; narrate what the engine reports next turn.**
</combat_declaration_format>`;

    const diceFormat = `<dice_roll_format>
<title>MANDATORY: DICE ROLL FORMAT</title>
When the player's action has an uncertain outcome (skill checks, saves, ability checks),
you MUST add an entry to the \`roll_requests\` array field of your JSON response. This is a
STRUCTURED FIELD, not text - DO NOT just say "roll for X" in prose, and do NOT write a code
block or marker inside \`text\`. The game engine reads \`roll_requests\` directly to show the dice UI.

\`roll_requests\`: \`[{"type":"check","formula":"1d20+dex","purpose":"Stealth check to sneak past guards","dc":14,"ac":null,"advantage":false,"disadvantage":false}]\`

Valid roll types: "check", "save", "attack", "damage", "initiative" (use "check" for all
ability/skill checks - do not invent other type strings). "attack" declares an attack, both at the
start of a fight and on every turn during one; while combat is active the engine resolves it from
here rather than the player rolling it. See <combat_roll_requirements>.
**If you leave \`roll_requests\` empty for an uncertain action, the player CANNOT roll dice and the game stalls!**
**Do NOT narrate the outcome of an action in \`text\` while also populating \`roll_requests\` for that same action - request the roll and stop; narrate the result next turn.**
</dice_roll_format>`;

    // #218 step 2: the server adds this to the sheet, once per player message, out of combat.
    const xpAwardField = `<xp_award_field>
<title>STORY XP</title>
When the player's character overcomes a challenge in the story (solves a puzzle, wins over an NPC,
completes a quest goal, succeeds at a check that matters), set the \`xp_award\` JSON field to
\`{"amount": <whole number of XP>, "reason": "<short reason>"}\`, sized by D&D 5e guidance for the
character's level. Otherwise set it to \`null\`. The game adds it to the character sheet; do not
state an XP gain in \`text\` without setting the field.
</xp_award_field>

`;

    const principlesRules = inCombat
      ? `- Use D&D 5e mechanics when appropriate. The engine resolves attacks, spells and saves during
  combat: declare the player's attack in \`combat_actions\` and do not request rolls.`
      : `- Use D&D 5e mechanics when appropriate (ask for ability checks and saving throws; declare
  attacks as \`"type": "attack"\` roll requests, which the engine resolves during active combat).`;

    return `<response_structure>
<title>DM RESPONSE GUIDELINES</title>
<core_principles>
- Respond to the player's action with clear consequences and vivid descriptions.
${principlesRules}
- Include sensory details and environmental context.
- Track narrative threads and callback to previous events from memories.
- Give NPCs distinct voices and personalities.
</core_principles>

<response_order>
**Your response MUST follow this exact order:**
${inCombat ? responseOrderInCombat : responseOrder}
</response_order>

${inCombat ? combatDeclarationFormat : diceFormat}

<options_field>
<title>ACTION OPTIONS FORMATTING</title>

Populate the \`options\` JSON field with 2-3 player-facing choices when appropriate. Each element
must use the \`A. **Bold Action**, description\` format. Keep options out of the narrative \`text\`
field. Use an empty array when resolving a specific combat action${inCombat ? '' : ' or roll request'} and no player
choice is appropriate.
</options_field>

${inCombat ? '' : xpAwardField}<visual_prompt_rule>
**OPTIONAL** - At the very end, if the scene would benefit from an illustration:
VISUAL PROMPT: <short art prompt focusing on key visual elements>
</visual_prompt_rule>

<final_prompt>
Keep responses engaging, 1-3 paragraphs, and always end with a clear prompt for player action or decision.
</final_prompt>
</response_structure>`;
  }

  static buildOpeningFinalRemindersSection(): string {
    return `
<opening_final_reminders>
<title>OPENING REMINDERS</title>

**THIS IS THE FIRST MESSAGE OF A NEW SESSION.**

- Do NOT request a roll
- Do NOT output metadata blocks
- Populate the \`options\` JSON field with 3-5 choices; each element must use the \`A. **Bold Action**, description\` format
- The response should feel complete before populating the options field
- After every [ASSET:type:key] tag, write the visible entity name immediately
</opening_final_reminders>`;
  }

  /** `inCombat`: see buildResponseStructureSection. The default is the out-of-combat prompt. */
  static buildFinalRemindersSection({ inCombat = false }: { inCombat?: boolean } = {}): string {
    const reminderBlockInCombat = `**RESPONSE ORDER: Narrative (text) → combat_actions field → \`options\` field → VISUAL PROMPT (optional)**

**THE ENGINE RESOLVES ATTACKS, SPELLS AND SAVES. DO NOT REQUEST ROLLS:** leave \`roll_requests\` as \`[]\`.
**EVERY COMBAT ATTACK MUST BE DECLARED** in \`combat_actions\` naming attacker and target; the
engine resolves it. An attack you only narrate never happens.

**OPTIONS**: Populate the \`options\` JSON field; each element must use the \`A. **Bold Action**, description\` format. Keep options out of the \`text\` field.`;

    const reminderBlock = `**RESPONSE ORDER: Narrative (text) → roll_requests field → \`options\` field → VISUAL PROMPT (optional)**

**DICE ROLLS ARE MANDATORY** for uncertain actions (skill checks, saves, ability checks).
**EVERY COMBAT ATTACK MUST BE DECLARED** as a \`"type": "attack"\` entry naming attacker and target;
the engine resolves it. An attack you only narrate never happens.
Populate the \`roll_requests\` JSON array field - it is a structured field, NOT a code block or
text marker inside \`text\`. Without it, the dice UI breaks and the player cannot proceed!

**OPTIONS**: Populate the \`options\` JSON field; each element must use the \`A. **Bold Action**, description\` format. Keep options out of the \`text\` field.`;

    return `
<final_reminders>
<title>CRITICAL REMINDERS</title>

${inCombat ? reminderBlockInCombat : reminderBlock}

Stay in character and follow D&D 5e rules.
</final_reminders>`;
  }
}
