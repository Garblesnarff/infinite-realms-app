import type { QuestRequest } from './quest-generator';
import type { WorldBuildingContext, WorldBuildingTrigger } from './types';

export class WorldBuildingAnalyzer {
  /**
   * Analyze if the current context needs world building
   */
  static async analyzeBuildingNeeds(context: WorldBuildingContext): Promise<WorldBuildingTrigger> {
    const { playerAction, recentMemories = [] } = context;
    const actionLower = playerAction.toLowerCase();

    let confidence = 0;
    const suggestions: WorldBuildingTrigger['suggestions'] = {};

    // Check for location building triggers
    const locationTriggers = [
      'go to',
      'enter',
      'travel to',
      'visit',
      'explore',
      'find',
      'search for',
    ];
    if (locationTriggers.some((trigger) => actionLower.includes(trigger))) {
      confidence += 0.3;
      suggestions.locations = ['contextual location based on player action'];
    }

    // Check for NPC building triggers
    const npcTriggers = [
      'talk to',
      'speak with',
      'meet',
      'find someone',
      'ask',
      'hire',
      'buy from',
    ];
    if (npcTriggers.some((trigger) => actionLower.includes(trigger))) {
      confidence += 0.3;
      suggestions.npcs = ['contextual NPC based on player need'];
    }

    // Check for quest building triggers
    const questTriggers = ['help', 'quest', 'mission', 'task', 'job', 'problem', 'trouble'];
    if (questTriggers.some((trigger) => actionLower.includes(trigger))) {
      confidence += 0.3;
      suggestions.quests = ['quest based on current situation'];
    }

    // Check memories for world building opportunities
    const memoryBasedOpportunities = recentMemories.filter(
      (memory) =>
        memory.type === 'quest' ||
        memory.type === 'npc' ||
        memory.type === 'location' ||
        memory.content.includes('mysterious') ||
        memory.content.includes('unresolved'),
    );

    if (memoryBasedOpportunities.length > 0) {
      confidence += 0.2;
    }

    // Determine trigger type
    let type: WorldBuildingTrigger['type'] = 'player_action';
    if (memoryBasedOpportunities.length > 2) type = 'memory_based';
    if (confidence < 0.2) type = 'random_event';

    return {
      type,
      confidence: Math.min(confidence, 1.0),
      suggestions,
    };
  }

  /**
   * Infer quest type from player action
   */
  static inferQuestTypeFromAction(action: string): QuestRequest['type'] {
    const actionLower = action.toLowerCase();

    if (actionLower.includes('investigate') || actionLower.includes('mystery')) {
      return 'investigation';
    }
    if (
      actionLower.includes('talk') ||
      actionLower.includes('negotiate') ||
      actionLower.includes('convince')
    ) {
      return 'social';
    }
    if (
      actionLower.includes('find') ||
      actionLower.includes('get') ||
      actionLower.includes('bring')
    ) {
      return 'fetch';
    }
    if (
      actionLower.includes('kill') ||
      actionLower.includes('defeat') ||
      actionLower.includes('fight')
    ) {
      return 'kill';
    }
    if (
      actionLower.includes('escort') ||
      actionLower.includes('protect') ||
      actionLower.includes('guard')
    ) {
      return 'escort';
    }
    if (
      actionLower.includes('explore') ||
      actionLower.includes('discover') ||
      actionLower.includes('map')
    ) {
      return 'exploration';
    }

    return 'side'; // Default
  }
}
