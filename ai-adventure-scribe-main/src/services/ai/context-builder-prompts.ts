/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
import { fetchCampaignAssetsForPrompt } from './asset-processor';
import { getClassEquipment } from './class-equipment';
import { getCharacterPassiveScores } from '../passive-skills-service';

import type { Memory } from '../memory-manager';
import type { GameContext } from './shared/types';

import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import logger from '@/lib/logger';
import { convertCharacterDetailsToCharacter } from '@/utils/character-converter';

export class ContextBuilderPrompts {
  static buildPersonaSection(): string {
    return `<persona>
You are a skilled D&D 5e Dungeon Master who creates immersive, mechanically-sound adventures. You balance compelling narrative with proper game mechanics, always giving players meaningful choices with clear consequences.
</persona>`;
  }

  static async buildGameContextSection(
    context: GameContext,
    relevantMemories: Memory[],
  ): Promise<string> {
    let section = `<game_context>`;

    if (context.campaignDetails) {
      section += `<campaign_details>
CAMPAIGN: "${context.campaignDetails.name}"
DESCRIPTION: ${context.campaignDetails.description}
</campaign_details>`;
    }

    // Lore handling (Async)
    let starterCampaignId = context.starterCampaignId;

    // Fallback: if no starterCampaignId but campaign name matches a starter campaign
    if (!starterCampaignId && context.campaignDetails?.name) {
      const campaignName = String(context.campaignDetails.name).toLowerCase().trim();
      const nameToSlug: Record<string, string> = {
        'the eternal feast': 'the-eternal-feast',
        'eternal feast': 'the-eternal-feast',
        'abyssal descent': 'abyssal-descent',
        'academy of arcane gastronomy': 'academy-of-arcane-gastronomy',
        'the academy of arcane gastronomy': 'academy-of-arcane-gastronomy',
      };
      starterCampaignId = nameToSlug[campaignName];
      if (starterCampaignId) {
        logger.info(
          `[ContextBuilder] Inferred starter campaign '${starterCampaignId}' from campaign name`,
        );
      }
    }

    if (starterCampaignId) {
      try {
        const loreKeeper = getLoreKeeperService();
        const [campaignOverview, campaignRules, campaignAssets, campaignEntities] =
          await Promise.all([
            loreKeeper.getCampaignOverview(starterCampaignId),
            loreKeeper.getRules(starterCampaignId),
            fetchCampaignAssetsForPrompt(starterCampaignId),
            loreKeeper.getEntities(starterCampaignId),
          ]);

        if (campaignOverview) {
          section += `
<starter_campaign_lore>
<canonical_setting>
TITLE: ${campaignOverview.title}
PREMISE: ${campaignOverview.premise || 'A mysterious adventure awaits.'}
OVERVIEW: ${campaignOverview.overview || ''}
</canonical_setting>

<creative_direction>
${campaignOverview.creativeBrief || 'Maintain an immersive, atmospheric tone.'}
</creative_direction>`;

          if (campaignRules && campaignRules.length > 0) {
            section += `
<world_rules>
These rules govern how the world responds to player actions:
${campaignRules.map((rule: any) => `- ${rule.condition} → ${rule.effect}${rule.reversible ? ' (reversible)' : ''}`).join('\n')}
</world_rules>`;
          }

          const { npcs, locations, factions, monsters } = campaignEntities;
          const totalEntities = npcs.length + locations.length + factions.length + monsters.length;

          if (totalEntities > 0) {
            section += `

<canonical_entities>
<instruction>These are the OFFICIAL NPCs, locations, and creatures for this campaign. USE THESE EXACT NAMES. Do NOT invent new NPCs when these exist.</instruction>`;

            if (npcs.length > 0) {
              section += `

<npcs count="${npcs.length}">
${npcs
  .map((npc: any) => {
    const hasImage = !!npc.metadata?.image_url;
    const assetKey = npc.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
    const assetTag = hasImage ? `[ASSET:npc:${assetKey}]` : '';
    return `<npc name="${npc.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${npc.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when introducing this character**` : ''}
</npc>`;
  })
  .join('\n')}
</npcs>`;
            }

            if (locations.length > 0) {
              section += `

<locations count="${locations.length}">
${locations
  .map((loc: any) => {
    const hasImage = !!loc.metadata?.image_url;
    const assetKey = loc.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
    const assetTag = hasImage ? `[ASSET:location:${assetKey}]` : '';
    return `<location name="${loc.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${loc.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when the party enters or views this location**` : ''}
</location>`;
  })
  .join('\n')}
</locations>`;
            }

            if (factions.length > 0) {
              section += `

<factions count="${factions.length}">
${factions
  .map(
    (f: any) => `<faction name="${f.entityName}">
${f.content}
</faction>`,
  )
  .join('\n')}
</factions>`;
            }

            if (monsters.length > 0) {
              section += `

<monsters count="${monsters.length}">
${monsters
  .map((m: any) => {
    const hasImage = !!m.metadata?.image_url;
    const assetKey = m.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
    const assetTag = hasImage ? `[ASSET:monster:${assetKey}]` : '';
    return `<monster name="${m.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${m.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when this creature appears or attacks**` : ''}
</monster>`;
  })
  .join('\n')}
</monsters>`;
            }

            section += `
</canonical_entities>`;
          }

          section += `

<lore_adherence>
- USE the canonical NPCs listed above - do NOT invent new characters when these exist
- When introducing an NPC from the list, use their EXACT name
- Reference canonical locations and describe them as specified
- Apply world rules consistently
- **CRITICAL: Include the asset_tag shown for any entity with a portrait/image when you first mention them**
- Asset tags like [ASSET:npc:headmaster] display the entity's artwork to the player
</lore_adherence>
</starter_campaign_lore>`;

          if (campaignAssets) {
            section += campaignAssets;
          }
        }
      } catch (loreError) {
        logger.warn('[ContextBuilder] Failed to fetch starter campaign lore:', loreError);
      }
    }

    if (context.characterDetails) {
      section += ContextBuilderPrompts.buildCharacterSection(context.characterDetails);
    }

    if (relevantMemories.length > 0) {
      section += `
<story_memories>
<title>IMPORTANT STORY MEMORIES</title>
Reference these memories naturally to maintain story continuity.`;
      relevantMemories.forEach((memory, index) => {
        section += `
<memory index="${index + 1}" type="${memory.type.toUpperCase()}">${memory.content}</memory>`;
      });
      section += `
</story_memories>`;
    }

    section += `</game_context>`;
    return section;
  }

  static buildCharacterSection(char: Record<string, any>): string {
    let section = `<character_details>
PLAYER CHARACTER: ${char.name}, a level ${char.level} ${char.race || 'Unknown Race'} ${char.class?.name || char.class || 'Unknown Class'}`;

    if (char.background) {
      section += ` (${char.background} background)`;
    }

    if (char.character_stats && char.character_stats.length > 0) {
      const stats = char.character_stats[0];
      const calcMod = (score: number = 10): string => {
        const mod = Math.floor((score - 10) / 2);
        return mod >= 0 ? `+${mod}` : `${mod}`;
      };

      section += `
<ability_scores>
STR ${stats.strength}(${calcMod(stats.strength)}), DEX ${stats.dexterity}(${calcMod(stats.dexterity)}), CON ${stats.constitution}(${calcMod(stats.constitution)}), INT ${stats.intelligence}(${calcMod(stats.intelligence)}), WIS ${stats.wisdom}(${calcMod(stats.wisdom)}), CHA ${stats.charisma}(${calcMod(stats.charisma)})
</ability_scores>`;

      const profBonus =
        char.level >= 17 ? 6 : char.level >= 13 ? 5 : char.level >= 9 ? 4 : char.level >= 5 ? 3 : 2;
      section += `
<proficiency_bonus>+${profBonus}</proficiency_bonus>`;
    }

    const className = char.class?.name || char.class;
    const classEquipment = getClassEquipment(className || 'Fighter');
    section += `
<equipment>
${classEquipment.weapons.join(', ')} | ${classEquipment.armor}
**CRITICAL: USE EXACT WEAPON DICE from equipment list above for damage roll requests!**
</equipment>`;

    try {
      const characterForPassive = convertCharacterDetailsToCharacter(char as any);
      const passiveScores = getCharacterPassiveScores(characterForPassive);
      section += `

<passive_skills>
**D&D 5E PASSIVE SKILLS (Automatic Checks)**
Passive Perception: ${passiveScores.perception} (notices hidden objects, creatures, traps without rolling)
Passive Insight: ${passiveScores.insight} (senses deception, motives, emotional states automatically)
Passive Investigation: ${passiveScores.investigation} (spots clues, patterns, logical inconsistencies passively)

**DM GUIDANCE: Use these passive scores to proactively reveal information:**
- If a scene has hidden elements with DC ≤ passive score, reveal them automatically
- Example: "Your keen awareness (Passive Perception ${passiveScores.perception}) notices subtle scuff marks on the floor"
- Reserve active checks (d20 rolls) for deliberate investigation or difficult perception tasks
</passive_skills>`;
    } catch (passiveSkillError) {
      logger.warn(
        `[ContextBuilder] Failed to calculate passive skills for character ${char.name} (non-fatal):`,
        passiveSkillError,
      );
    }

    section += `
</character_details>`;
    return section;
  }

  static buildOpeningSceneSection(): string {
    return `<opening_scene_requirements>
<title>CAMPAIGN OPENING - FIRST MESSAGE</title>

<opening_scene_quality_requirements>
**CREATE A MEMORABLE, IMMERSIVE OPENING SCENE**

Your opening scene MUST include ALL of these elements:
1. **RICH SENSORY DETAILS** (4+ senses):
   - Sight: Colors, lighting, movement, textures
   - Sound: Ambient noise, specific sounds, music, silence
   - Smell: Distinctive scents that set the mood
   - Touch/Feel: Temperature, air quality, physical sensations
   - Optional: Taste if relevant

2. **ATMOSPHERIC WRITING** (3-4 paragraphs minimum):
   - Set the tone immediately - mysterious, tense, cozy, dangerous
   - Paint a vivid picture of the environment
   - Use evocative, literary language
   - Create a sense of place unique to this campaign world

3. **NPC INTRODUCTION** (with direct quoted dialogue):
   - At least ONE NPC with spoken dialogue in quotes
   - Give the NPC a distinct voice/personality
   - NPC should have a name or memorable descriptor
   - Their dialogue should hook the player into the story
   - **MUST include [ASSET:npc:*] tag before the NPC's name (see visual assets list above)**

4. **STORY HOOK** that connects to the campaign:
   - Reference the campaign setting/premise
   - Create immediate intrigue or stakes
   - Give the player a reason to care and engage
   - Plant seeds for larger adventure

5. **PLAYER AGENCY** with meaningful A/B/C choices:
   - Each option leads to genuinely different outcomes
   - Options should reflect different playstyles (action, social, exploration)
   - At least one "wild card" creative option
   - Make choices feel consequential

**LENGTH: 300-500 words per opening scene (NOT just 2-3 short paragraphs)**
</opening_scene_quality_requirements>

<verbalized_sampling_output>
Generate 3 COMPLETE opening scenes, each in a separate <response> tag.
Each <response> MUST include:
- A <probability> tag with a decimal value (all should sum to ~1.0)
- A <text> tag containing the COMPLETE opening scene

Vary approaches across dimensions:
- **Setting**: Classic (tavern) vs. Unusual (mid-action, unique location)
- **Pacing**: Slow atmospheric build vs. Immediate tension vs. Mystery
- **Hook**: NPC encounter vs. Discovery vs. Danger

FORMAT EXACTLY LIKE THIS:
<response>
<probability>0.5</probability>
<text>
[Complete opening scene - 300-500 words with ALL required elements: rich sensory details, atmospheric prose, NPC with quoted dialogue, story hook, and meaningful A/B/C options]
</text>
</response>
<response>
<probability>0.3</probability>
<text>
[Different approach - equally detailed 300-500 word scene with all elements]
</text>
</response>
<response>
<probability>0.2</probability>
<text>
[Creative/unexpected approach - equally detailed 300-500 word scene with all elements]
</text>
</response>

CRITICAL RULES:
- Each <text> MUST be 300-500 words with ALL quality requirements above
- Include at least one NPC with direct quoted dialogue in EACH response
- Use all senses (sight, sound, smell, touch) to create immersion
- Do NOT output anything outside the <response> tags
- The system will randomly select ONE response based on probabilities
- SHORT, LAZY OPENINGS ARE UNACCEPTABLE - make them memorable!
- **MANDATORY: Include [ASSET:type:key] tags when introducing NPCs, locations, or monsters with images!**
  Example: "[ASSET:npc:head-chef-balthazar] Balthazar wipes his hands on his apron..."
  Check the <available_visual_assets> section above for exact tags to use.
</verbalized_sampling_output>
</opening_scene_requirements>`;
  }

  static buildVoiceOptimizationSection(): string {
    return `
<voice_optimization>
Your response will be synthesized into voice. Structure your narration into logical segments.
</voice_optimization>`;
  }

  static buildResponseStructureSection(): string {
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

<memory_extraction>
**REQUIRED: After your narrative response (and before action options), include these XML tags to track story state:**

<memories>
- Key facts, events, or decisions from this scene
- Important NPC relationships or revelations
- Player character actions and their consequences
</memories>

<world_updates>
- npc: NPC Name | Brief description or status change | Current location
- location: Location Name | Description or change | Status (e.g., discovered, changed, destroyed)
- quest: Quest Name | Status update or new development
</world_updates>

Only include tags that have content. If no world updates occurred, omit the <world_updates> tag entirely.
These tags are parsed by the game engine and will NOT be shown to the player.
</memory_extraction>

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

  static buildFinalRemindersSection(): string {
    return `
<final_reminders>
<title>CRITICAL REMINDERS - READ BEFORE RESPONDING</title>

**DICE ROLLS - MANDATORY FORMAT:**
When the player's action has an uncertain outcome (combat, skill checks, saves), you MUST include a ROLL_REQUESTS_V1 code block at the END of your response. DO NOT just say "roll for X" in text - the game UI needs the structured format to show dice!

Example - if player says "I try to sneak past the guards":
\`\`\`ROLL_REQUESTS_V1
{"rolls":[{"type":"skill_check","formula":"1d20+dex","purpose":"Stealth check to sneak past guards","dc":14}]}
\`\`\`

**WITHOUT this code block, the dice roll UI will NOT appear and the player cannot roll!**

**OPTIONS FORMAT:**
End responses with A. **Bold Action**, description format for clickable buttons.

Stay in character and follow D&D 5e rules.
</final_reminders>`;
  }
}
