import type { Memory } from '../../../memory-manager';
import type { GameContext } from '../types';

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
