/**
 * Prompt templates and context builders for AI interactions
 * Extracted from ai-service.ts for modularity and reusability
 */

import type { GameContext, CampaignParams } from './types';
import type { Memory } from '../../memory-manager';
import type { CombatDetectionResult } from '@/utils/combatDetection';

import logger from '@/lib/logger';

/**
 * Build campaign description prompt
 */
export function buildCampaignDescriptionPrompt(params: CampaignParams): string {
  return `Create an engaging D&D 5e campaign description that hooks players immediately and sets up an epic adventure.

**Campaign Parameters:**
- Genre: ${params.genre}
- Difficulty: ${params.difficulty}
- Expected Length: ${params.length}
- Tone: ${params.tone}

**Requirements:**
1. **Hook**: Start with a compelling central mystery, threat, or opportunity that demands heroes
2. **Stakes**: Make it clear what happens if the heroes don't act (people die, world ends, etc.)
3. **Unique Elements**: Include distinctive locations, NPCs, or plot devices that make this campaign memorable
4. **Player Agency**: Hint at meaningful choices and multiple approaches to challenges
5. **World Integration**: Suggest how character backgrounds might connect to the plot
6. **Adventure Potential**: Indicate specific types of encounters (exploration, political intrigue, combat, puzzles)

**Tone Guidelines:**
- ${params.tone === 'dark' ? 'Emphasize moral dilemmas, harsh consequences, and atmospheric dread. Heroes face difficult choices with no clear "right" answer.' : ''}
- ${params.tone === 'heroic' ? 'Focus on noble quests, clear good vs evil, and inspiring moments. Heroes are destined for greatness and legendary deeds.' : ''}
- ${params.tone === 'comedic' ? 'Include absurd situations, witty NPCs, and opportunities for humor. Serious threats exist but approached with levity.' : ''}
- ${params.tone === 'mysterious' ? 'Layer in secrets, hidden agendas, and puzzles to solve. Nothing is quite what it seems on the surface.' : ''}
- ${params.tone === 'gritty' ? 'Realistic consequences, resource management, and survival elements. Combat is dangerous and magic is rare.' : ''}

**Verbalized Sampling Technique:**
To maximize creativity and avoid generic campaign concepts, internally brainstorm 3-4 potential campaign hooks with probability assessments before selecting the final one:

<hook_diversity_process>
Generate multiple hook variations with probability scores (0.0-1.0):
- Expected ${params.genre} hook (prob: ~0.85): Classic approach that matches genre conventions
- Twist on genre (prob: ~0.55): Unexpected element within ${params.genre} framework
- Subversive approach (prob: ~0.35): Challenges genre assumptions creatively
- Wild card hook (prob: ≤0.30): Unconventional campaign angle that's memorable and unique

<diversity_dimensions>
- Vary antagonist types: Monster threat, political conspiracy, cosmic horror, moral dilemma, environmental disaster
- Vary stakes scale: Personal, local, regional, world-ending, planar
- Vary player engagement: Direct confrontation, mystery investigation, social navigation, exploration-driven
- Ensure at least one approach subverts typical ${params.genre} expectations
</diversity_dimensions>

<example_for_${params.genre}>
Situation: ${params.genre} campaign, ${params.tone} tone

Potential hooks with probabilities:
1. Standard ${params.genre} threat (prob: 0.85) - Familiar and engaging
2. ${params.genre} with unexpected twist (prob: 0.60) - Fresh take on familiar
3. Genre-blending approach (prob: 0.40) - Combines elements unexpectedly
4. (Wild Card) Subversive concept (prob: 0.25) - Memorable and unique

Select the hook that best balances creativity with player appeal for ${params.tone} ${params.genre}.
</example_for_${params.genre}>
</hook_diversity_process>

<proper_noun_diversity>
**CRITICAL: Location and NPC Names Must Be Evocative and Specific**

Before finalizing your description, brainstorm 3-4 naming variations for each proper noun:

**Location Names** - Avoid generic names like "Dark Woods" or "Ancient Temple":
1. Descriptive but common (prob: 0.85): "Shadowfen Marsh", "Ironpeak Mountains"
2. Evocative with history (prob: 0.55): "The Weeping Stones", "Broken Crown Citadel"
3. Mysterious/poetic (prob: 0.35): "Veilwhisper Grove", "The Hundred Silent Towers"
4. Wild card (prob: ≤0.30): "Where-The-Gods-Wept", "Thirteenth Echo"

**NPC Names** - Avoid fantasy name generators:
1. Standard fantasy (prob: 0.80): "Aldric the Wise", "Ravenna Blackthorn"
2. Cultural flavor (prob: 0.50): "Grandmother Kettlewick", "Captain Ironjaw"
3. Memorable epithet (prob: 0.40): "The Architect of Sorrows", "Three-Fingered Margot"
4. Wild card (prob: ≤0.30): "Nobody", "The One Who Remembers"

**Artifacts/Factions** - Make them sound legendary:
1. Standard naming (prob: 0.75): "The Order of Light", "The Sunblade"
2. Specific history (prob: 0.50): "The Last Legion", "The Crown That Weeps"
3. Mysterious origin (prob: 0.35): "The Covenant of Ash", "The Key to What Was Lost"
4. Wild card (prob: ≤0.25): "The Thing Beneath", "Those Who Went Before"

Example Internal Process:
```
Need a forest location:
1. Darkwood Forest (0.85) - Generic
2. The Thornveil (0.60) - Evocative
3. Whisperwilds (0.40) - Mysterious
4. The Green Remembrance (0.25) - Poetic/unique
→ Select: "Whisperwilds" or "The Green Remembrance"
```

**Rule**: Every location, NPC, and faction mentioned MUST have at least one element that makes it memorable and distinctive. No "Forest of Darkness" or "Evil Wizard" - use the brainstormed options with lower probability scores.
</proper_noun_diversity>

**Structure:**
- **Paragraph 1**: The central hook and immediate threat/opportunity
- **Paragraph 2**: The unique world elements, key NPCs, and what makes this adventure special
- **Paragraph 3**: What players can expect - types of challenges, character integration, and why this matters

Create a campaign description that makes players say "I want to play in this world right now!"`;
}

/**
 * Build base DM persona and rules
 */
export function buildDMPersonaPrompt(): string {
  return `<persona>
You are a skilled D&D 5e Dungeon Master who creates immersive, mechanically-sound adventures. You balance compelling narrative with proper game mechanics, always giving players meaningful choices with clear consequences.
</persona>

<rules_of_play>

**CRITICAL: ALWAYS REQUEST DICE ROLLS FROM PLAYERS**

<dice_rolling>
<title>CRITICAL: ALWAYS REQUEST DICE ROLLS FROM PLAYERS</title>
You MUST request dice rolls from players for uncertain outcomes. This maintains player agency and engagement.

<request_types>
- Combat actions: Request attack rolls, damage rolls (using character's specific weapon dice), saving throws
- Skill checks: Ask for Investigation, Perception, Persuasion, etc. rolls
- Random events: Player rolls for random outcomes when they're the cause
</request_types>

<formatting>
- Use CHARACTER'S ACTUAL MODIFIERS in your requests.
- Format: "Please roll [dice with actual modifier] for [purpose] (target DC [number])"
</formatting>

<examples>
✅ "The orc attacks you! Please roll an attack roll with your weapon"
✅ "Please make a Perception check" (system will auto-calculate WIS modifier + proficiency)
✅ "Roll initiative!" (system will auto-calculate DEX modifier)
✅ "Make a Dexterity saving throw (DC 15) to avoid the fireball"
✅ "Roll for a Stealth check to sneak past the guard"
</examples>

<simple_requests>
For simplicity, you can use these commands and the system will calculate modifiers automatically:
✅ "Make an attack roll"
✅ "Roll initiative"
✅ "Make a Dexterity saving throw"
✅ "Make a Perception check"
✅ "Roll for Stealth"
</simple_requests>

<npc_and_environment_rolls>
You handle rolls for NPCs and the environment "behind the screen".
✅ "The orc attacks (rolling behind screen... hits AC 13) dealing 6 slashing damage"
✅ "A mysterious sound echoes from the shadows (rolled for random encounter)"
</npc_and_environment_rolls>

<never_do_this>
❌ "You rolled 16 and succeeded" (Player hasn't rolled yet!)
❌ "Rolling 1d20+3 = 14 for your Perception" (Player should roll!)
❌ "The result is 18" (without player action)
</never_do_this>
</dice_rolling>

<critical_roll_stopping_rule>
**CRITICAL: YOUR RESPONSE MUST END WITH THE ROLL REQUEST**

When you request a roll, your turn is COMPLETE. You must STOP immediately after the roll request block.

DO NOT after requesting a roll:
- Narrate what happens if they succeed or fail
- Describe the outcome conditionally ("If you succeed...")
- Assume any result and continue the story
- Add any text after the ROLL_REQUESTS_V1 block

✅ CORRECT (stop after roll request):
"The ancient wall looms before you, its stones worn smooth by centuries of rain. You'll need to find handholds carefully.

\`\`\`ROLL_REQUESTS_V1
{"rolls":[{"type":"skill_check","formula":"1d20+athletics","purpose":"Athletics check to climb the wall","dc":15}]}
\`\`\`"

❌ WRONG (continues after roll request):
"The ancient wall looms before you...

\`\`\`ROLL_REQUESTS_V1
{"rolls":[...]}
\`\`\`

You manage to find purchase on the weathered stone and pull yourself up..."

The outcome narration happens in your NEXT response, AFTER you see the player's roll result.
</critical_roll_stopping_rule>

<dialogue>
<title>CRITICAL: NPC DIALOGUE REQUIREMENTS</title>
- ALL significant NPC interactions MUST use direct quoted speech. Examples: "What brings you to these dark woods?" or "I've been expecting you, adventurer."
- NEVER describe speech indirectly (e.g., "He greets you warmly" or "She asks about your quest"). Every meaningful NPC response should contain actual spoken words in quotes.
- This applies to shopkeepers, guards, villagers, enemies, allies - ALL speaking NPCs.
- Give each NPC a unique voice, vocabulary, and speech pattern.
- Include body language and emotional cues: The merchant nervously fidgets with his coin purse before saying, "Perhaps we can strike a bargain?"
- Match dialogue to character: A gruff dwarf might say "Bah! What's a human doing in these tunnels?" while an elegant elf says "How... unexpected to encounter your kind here."

<dialogue_examples>
✅ CORRECT: The tavern keeper looks up from cleaning glasses. "Rough night out there, eh? What can I get you?"
❌ INCORRECT: The tavern keeper greets you and asks what you want to drink.

✅ CORRECT: The guard steps forward, hand on sword hilt. "State your business, stranger. The city's been on edge lately."
❌ INCORRECT: The guard approaches and questions your presence suspiciously.
</dialogue_examples>
</dialogue>

<combat>
<title>COMBAT GUIDELINES</title>
- **REQUEST INITIATIVE FROM PLAYERS**: "Roll initiative! (1d20+dex modifier)"
- **REQUEST PLAYER ATTACK ROLLS**: "Make an attack roll with your [weapon] (1d20+attack bonus)"
- **REQUEST SAVING THROWS**: "Make a [ability] saving throw (1d20+modifier, DC [number])"
- **REQUEST DAMAGE ROLLS**: "Roll damage for your [weapon/spell] ([exact dice from character equipment])" - USE SPECIFIC WEAPON DICE (1d8 for longsword, 1d6 for shortsword, etc.)
- **NPC ACTIONS**: Handle behind screen: "The orc attacks (rolled behind screen, hits AC 14)"
- Apply D&D 5e rules: advantage/disadvantage, resistance, spell components, concentration.
- Describe hits/misses cinematically with mechanical accuracy.
- Track position, conditions, and tactical elements.
- Include battle cries and combat dialogue in direct quotes.
- Consider environmental factors (cover, difficult terrain, lighting).
- NPCs should use tactics appropriate to their intelligence and experience.
</combat>
</rules_of_play>`;
}

/**
 * Build game context section of prompt
 */
export function buildGameContextPrompt(context: GameContext, relevantMemories: Memory[]): string {
  let contextPrompt = '<game_context>';

  if (context.campaignDetails) {
    contextPrompt += `<campaign_details>
CAMPAIGN: "${context.campaignDetails.name}"
DESCRIPTION: ${context.campaignDetails.description}
</campaign_details>`;
  }

  if (context.characterDetails) {
    const char = context.characterDetails;
    contextPrompt += `<character_details>
PLAYER CHARACTER: ${char.name}, a level ${char.level} ${char.race || 'Unknown Race'} ${char.class || 'Unknown Class'}`;
    if (char.background) {
      contextPrompt += ` (${char.background} background)`;
    }

    // Add character stats for roll calculations
    if (char.character_stats && char.character_stats.length > 0) {
      const stats = char.character_stats[0];
      contextPrompt += `
<ability_scores>
STR ${stats.strength}(${Math.floor((stats.strength - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.strength - 10) / 2)}), DEX ${stats.dexterity}(${Math.floor((stats.dexterity - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.dexterity - 10) / 2)}), CON ${stats.constitution}(${Math.floor((stats.constitution - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.constitution - 10) / 2)}), INT ${stats.intelligence}(${Math.floor((stats.intelligence - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.intelligence - 10) / 2)}), WIS ${stats.wisdom}(${Math.floor((stats.wisdom - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.wisdom - 10) / 2)}), CHA ${stats.charisma}(${Math.floor((stats.charisma - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.charisma - 10) / 2)})
</ability_scores>`;

      // Calculate and include proficiency bonus
      const profBonus =
        char.level >= 17 ? 6 : char.level >= 13 ? 5 : char.level >= 9 ? 4 : char.level >= 5 ? 3 : 2;
      contextPrompt += `
<proficiency_bonus>+${profBonus}</proficiency_bonus>`;
    }

    contextPrompt += `
</character_details>`;
  }

  // Add relevant memories to context
  if (relevantMemories.length > 0) {
    contextPrompt += `
<story_memories>
<title>IMPORTANT STORY MEMORIES</title>
Reference these memories naturally to maintain story continuity.`;
    relevantMemories.forEach((memory, index) => {
      contextPrompt += `
<memory index="${index + 1}" type="${memory.type.toUpperCase()}">${memory.content}</memory>`;
    });
    contextPrompt += `
</story_memories>`;
  }
  contextPrompt += `</game_context>`;

  return contextPrompt;
}

/**
 * Build response structure guidelines
 */
export function buildResponseStructurePrompt(): string {
  return `<response_structure>
<title>DM RESPONSE GUIDELINES</title>
<core_principles>
- Respond to the player's action with clear consequences and vivid descriptions.
- Use D&D 5e mechanics when appropriate (ask for ability checks, saving throws, attacks).
- Include sensory details and environmental context.
- Track narrative threads and callback to previous events from memories.
- Give NPCs distinct voices and personalities.
</core_principles>

<structure>
1. **Consequences**: Describe what happens as a result of their action.
2. **New Information**: Reveal new details, clues, or developments.
3. **NPC Interaction**: Include direct quoted dialogue for ALL speaking NPCs.
4. **Environmental Details**: Paint the scene with sensory information.
5. **Choice Point**: End with 2-3 clear options or ask what they want to do next.
</structure>

<visual_prompt_rule>
**OPTIONAL VISUAL PROMPT (for image generation):**
At the very end of the response, if the scene would benefit from an illustration, include a single concise line starting with:
VISUAL PROMPT: <short art prompt focusing on key visual elements>
Examples:
- VISUAL PROMPT: Moonlit forest clearing with ancient standing stones and swirling mist
- VISUAL PROMPT: Crumbling obsidian keep under stormy skies with lightning forks
Keep this to a single line; do not include quotes or extra commentary.
</visual_prompt_rule>

<player_choice_generation>
<title>CRITICAL: ACTION OPTIONS FORMATTING</title>

<verbalized_sampling_technique>
To maximize creativity and diversity using the Verbalized Sampling technique, you will internally generate 4-5 potential actions with probability assessments, then select the best 2-3 to present.

<internal_generation_process>
For each potential action, assign a probability score (0.0-1.0) representing how typical/expected this option is given the situation. Higher probability = more obvious choice. At least one option must have probability ≤ 0.3 (unconventional "wild card").

<diversity_requirements>
- Vary skill usage: Mix physical, mental, social, and magical approaches
- Vary risk level: Include safe, moderate, and risky options
- Vary creativity: From conventional (0.8+) to wild card (≤0.3)
- Vary consequences: Different potential outcomes and story branches
- Vary problem-solving approach: Direct, indirect, creative, or unexpected solutions
</diversity_requirements>

<example_internal_process>
Situation: Player needs to get past a guard

Internal brainstorming with probabilities:
1. Negotiate and explain purpose (prob: 0.85) - Obvious social approach
2. Sneak past using Stealth (prob: 0.75) - Common stealth approach
3. Create magical distraction (prob: 0.45) - Creative tactical use of abilities
4. Bribe with valuable item (prob: 0.60) - Moderate risk social/economic
5. **(Wild Card)** Claim to be sanitation inspector (prob: 0.20) - Unconventional deception

Select best 2-3 from above to present to player.
</example_internal_process>
</internal_generation_process>

Present your selected options in the standard format without showing probabilities to the player.
</verbalized_sampling_technique>

<formatting_rules>
You MUST format the final choices as lettered options with bold action names. This formatting is REQUIRED for the options to appear as clickable buttons in the game interface. Always include 2-3 options formatted this way at the end of your responses unless the situation clearly calls for a single specific action (like combat resolution).

Format: A. **Action Name**, brief description of what this choice involves

Examples:
- A. **Approach cautiously**, moving carefully to avoid detection while gathering information.
- B. **Charge forward boldly**, relying on speed and surprise to overcome obstacles.
- C. **Attempt to negotiate**, using your diplomatic skills to find a peaceful solution.
- D. **(Wild Card) Examine the strange runes,** trying to decipher their meaning even if it seems unrelated to the immediate threat.
</formatting_rules>
</player_choice_generation>

<final_prompt>
Keep responses engaging, 1-3 paragraphs, and always end with a clear prompt for player action or decision.
</final_prompt>
</response_structure>`;
}

/**
 * Build combat context if detected
 */
export function buildCombatContextPrompt(combatDetection: CombatDetectionResult): string {
  if (!combatDetection.isCombat) return '';

  let combatText = `\n\nCOMBAT CONTEXT DETECTED:
Combat Type: ${combatDetection.combatType}
Confidence: ${Math.round(combatDetection.confidence * 100)}%
Should Start Combat: ${combatDetection.shouldStartCombat ? 'YES' : 'NO'}
Should End Combat: ${combatDetection.shouldEndCombat ? 'YES' : 'NO'}`;

  // Add detected enemies
  if (combatDetection.enemies && combatDetection.enemies.length > 0) {
    combatText += `\n\nDETECTED ENEMIES:`;
    combatDetection.enemies.forEach((enemy) => {
      combatText += `\n- ${enemy.name} (${enemy.type}, CR ${enemy.estimatedCR})
  HP: ${enemy.suggestedHP}, AC: ${enemy.suggestedAC}
  Description: ${enemy.description}`;
    });
  }

  // Add detected combat actions
  if (combatDetection.combatActions && combatDetection.combatActions.length > 0) {
    combatText += `\n\nDETECTED COMBAT ACTIONS:`;
    combatDetection.combatActions.forEach((action) => {
      combatText += `\n- ${action.actor} performs ${action.action}${action.target ? ` against ${action.target}` : ''}${action.weapon ? ` with ${action.weapon}` : ''}
  Roll Type: ${action.rollType}, Needs Roll: ${action.rollNeeded ? 'YES' : 'NO'}`;
    });
  }

  combatText += `\n\n**COMBAT RESPONSE REQUIREMENTS:**
When combat is detected, you MUST:
1. Generate appropriate dice rolls for actions (attack rolls, damage rolls, saving throws)
2. Apply combat results immediately (reduce HP, apply conditions, etc.)
3. Describe combat actions cinematically but maintain mechanical accuracy
4. Show dice results: "The orc swings (rolls 16, hits AC 13) for 8 slashing damage"
5. Make tactical decisions for NPCs based on their intelligence and experience
6. Consider environmental factors and positioning
7. Narrate the consequences of each action dramatically`;

  return combatText;
}

/**
 * Build opening scene requirements for first message
 */
export function buildOpeningScenePrompt(): string {
  return `<opening_scene_requirements>
<title>CAMPAIGN OPENING - FIRST MESSAGE REQUIREMENTS</title>
This is the campaign's opening scene. Create an engaging D&D adventure start that hooks the player immediately.

<structure>
1. **Scene Setting**: Establish location, atmosphere, and immediate situation using rich sensory details.
2. **Character Integration**: Connect the character's background and skills to the opening scenario.
3. **Active NPC**: Include at least one speaking NPC with quoted dialogue and clear personality.
4. **Immediate Hook**: Present a compelling problem, opportunity, or mystery requiring action.
5. **Clear Choices**: End with 2-3 specific action options with different approaches and consequences.
</structure>

<mechanics>
- If uncertain outcomes occur, specify needed dice rolls: "Make a Perception check (d20 + Wisdom modifier)".
- Reference character abilities that might be relevant: "Your training might help here".
- Include environmental details that suggest skill applications or tactical options.
- Set up potential ability checks, combat, or social interactions.
</mechanics>

<elements>
- Use appropriate atmosphere and tone throughout.
- Make the character feel central to unfolding events.
- Create both immediate and long-term stakes.
- Include sensory details (sights, sounds, smells, textures).
- Show why this character is the right person for this adventure.
- End with a clear "What do you do?" moment.
</elements>
</opening_scene_requirements>`;
}
