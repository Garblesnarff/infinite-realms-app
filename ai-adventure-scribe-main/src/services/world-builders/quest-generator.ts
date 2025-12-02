import { getGeminiApiManager, type GeminiApiManager } from '@/infrastructure/ai';
import { MemoryManager } from '../memory-manager';
import type { Memory } from '@/types/memory';

import { GEMINI_TEXT_MODEL } from '@/config/ai';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { getAveragePartyLevel } from '@/utils/character-level-utils';

export interface QuestRequest {
  type:
    | 'main'
    | 'side'
    | 'personal'
    | 'fetch'
    | 'kill'
    | 'escort'
    | 'investigation'
    | 'social'
    | 'exploration';
  difficulty: 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly';
  urgency: 'immediate' | 'soon' | 'whenever' | 'background';
  scope: 'single-session' | 'multi-session' | 'campaign-arc';
  giver?: string; // NPC name or ID
  location?: string; // Where the quest takes place
  context: {
    campaignId: string;
    sessionId?: string;
    characterId: string;
    genre: string;
    playerLevel?: number;
    currentStory?: string;
    recentMemories?: Memory[];
    partySize?: number;
  };
}

export interface GeneratedQuest {
  id?: string;

  // Core Quest Info
  title: string;
  description: string;
  type: string;
  difficulty: string;
  estimatedTime: string;

  // Quest Structure
  objective: {
    primary: string;
    secondary: string[];
    hidden: string[];
  };

  // Quest Progression
  stages: QuestStage[];

  // Rewards & Consequences
  rewards: {
    experience: number;
    gold: number;
    items: string[];
    reputation: string[];
    storyImpact: string[];
  };

  consequences: {
    success: string[];
    failure: string[];
    partialSuccess: string[];
  };

  // Story Integration
  lore: string;
  backstory: string;
  connections: {
    npcs: string[];
    locations: string[];
    otherQuests: string[];
    factions: string[];
  };

  // Gameplay Elements
  challenges: {
    combat: string[];
    social: string[];
    exploration: string[];
    puzzles: string[];
  };

  // Narrative Hooks
  hooks: {
    initial: string[];
    ongoing: string[];
    twists: string[];
  };

  // Metadata
  metadata: {
    createdAt: Date;
    campaignId: string;
    sessionId?: string;
    characterId: string;
    giver?: string;
    urgency: string;
    scope: string;
    narrativeWeight: number;
    storyArc?: string;
  };
}

export interface QuestStage {
  id: number;
  title: string;
  description: string;
  objectives: string[];
  location: string;
  challenges: string[];
  npcsInvolved: string[];
  rewards?: {
    experience?: number;
    gold?: number;
    items?: string[];
  };
  consequences: string[];
  nextStages: number[];
  isOptional: boolean;
}

export class QuestGenerator {
  private static getGeminiManager(): GeminiApiManager {
    return getGeminiApiManager();
  }

  /**
   * Generate a detailed quest using AI
   */
  static async generateQuest(request: QuestRequest): Promise<GeneratedQuest> {
    try {
      const geminiManager = this.getGeminiManager();

      const result = await geminiManager.executeWithRotation(async (genAI) => {
        const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

        const prompt = await this.buildQuestPrompt(request);

        const response = await model.generateContent(prompt);
        const text = await response.response.text();

        try {
          // Extract JSON from the response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in quest generation response');
          }

          const questData = JSON.parse(jsonMatch[0]);

          // Add metadata
          const quest: GeneratedQuest = {
            ...questData,
            id: undefined, // Will be set when saved
            metadata: {
              createdAt: new Date(),
              campaignId: request.context.campaignId,
              sessionId: request.context.sessionId,
              characterId: request.context.characterId,
              giver: request.giver,
              urgency: request.urgency,
              scope: request.scope,
              narrativeWeight: this.calculateNarrativeWeight(questData, request),
              storyArc: request.context.currentStory,
            },
          };

          return quest;
        } catch (parseError) {
          logger.error('Failed to parse quest JSON:', parseError);
          throw new Error('Failed to generate quest: Invalid response format');
        }
      });

      logger.info(`⚔️ Generated quest: ${result.title} (${result.type})`);
      return result;
    } catch (error) {
      logger.error('Quest generation failed:', error);
      throw new Error(
        `Failed to generate quest: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Build the prompt for quest generation
   */
  private static async buildQuestPrompt(request: QuestRequest): Promise<string> {
    const { type, difficulty, urgency, scope, giver, location, context } = request;

    // Get relevant memories for context
    let memoryContext = '';
    if (context.sessionId && context.recentMemories) {
      const memories = context.recentMemories.slice(0, 5);
      if (memories.length > 0) {
        memoryContext = `<recent_memories>\n${memories.map((m) => `  <memory>${m.content}</memory>`).join('\n')}\n</recent_memories>`;
      }
    }

    return `<task>
  <description>You are a master quest designer creating a ${type} quest for a ${context.genre} D&D campaign.</description>
</task>

<requirements>
  <quest_type>${type}</quest_type>
  <difficulty>${difficulty}</difficulty>
  <character_level>${context.playerLevel || 1}</character_level>
  <urgency>${urgency}</urgency>
  <scope>${scope}</scope>
  <party_size>${context.partySize || 1}</party_size>
  <genre>${context.genre}</genre>
</requirements>

<context>
  ${giver ? `<quest_giver>${giver}</quest_giver>` : ''}
  ${location ? `<primary_location>${location}</primary_location>` : ''}
  ${context.currentStory ? `<current_story>${context.currentStory}</current_story>` : ''}
  ${memoryContext}
</context>

<verbalized_sampling_technique>
  <instruction>Before generating the final quest, internally brainstorm 4-5 distinct quest hook approaches with probability scores (0.0-1.0) representing how typical each approach is for ${type} quests</instruction>

  <quest_hook_diversity_dimensions>
    <structure_approach>
      - Standard ${type} quest structure (prob: 0.80) - Familiar and reliable
      - Twist on standard structure (prob: 0.55) - Expected type with unexpected element
      - Moral dilemma approach (prob: 0.40) - Multiple valid solutions with trade-offs
      - Wild card structure (prob: ≤0.30) - Unconventional quest design
    </structure_approach>

    <narrative_dimensions>
      Vary across these axes:
      - Stakes scale: Personal → Community → Regional → World-ending → Planar
      - NPC motivations: Simple → Complex → Hidden agendas → Contradictory
      - Player agency: Linear path → Multiple approaches → Open-ended → Player-driven
      - Twist potential: Straightforward → One twist → Layered mysteries → Reality-questioning
      - Moral clarity: Clear good/evil → Shades of gray → No right answer → Player-defined
    </narrative_dimensions>

    <engagement_factors>
      - Emotional hook: What makes players care beyond rewards?
      - Unique mechanic: What makes this quest mechanically interesting?
      - Story integration: How does this connect to larger campaign?
      - Replay value: Would different approaches yield different experiences?
    </engagement_factors>
  </quest_hook_diversity_dimensions>

  <example_process_for_${type}_quest>
    Internal brainstorming for ${difficulty} difficulty ${type} quest:

    Quest hook variations with probabilities:
    1. Standard ${type} quest (prob: 0.80) - Retrieve/defeat/escort with clear objective
    2. ${type} with ethical dilemma (prob: 0.55) - Success requires difficult moral choice
    3. ${type} with faction conflict (prob: 0.45) - Multiple stakeholders with competing interests
    4. ${type} with reality twist (prob: 0.35) - Things aren't what they seem
    5. (Wild Card) ${type} that subverts player expectations (prob: ≤0.30) - Unconventional approach

    Select the hook that:
    - Best fits ${urgency} urgency and ${scope} scope
    - Provides meaningful player choices
    - Creates memorable moments
    - Balances challenge with achievability for level ${context.playerLevel || 1}
    - Integrates naturally with current story context
  </example_process_for_${type}_quest>

  <selection_criteria>
    Choose the quest concept that maximizes:
    - Player engagement (interesting throughout, not just at end)
    - Story integration (connects to campaign themes/NPCs/locations)
    - Replay diversity (different approaches possible)
    - Consequence weight (player choices matter)
    - Memorable moments (creates stories players will retell)
    - Challenge appropriate to ${difficulty} for party of ${context.partySize || 1}
  </selection_criteria>
</verbalized_sampling_technique>

<output_format>
  <instruction>Generate a quest in this EXACT JSON format:</instruction>
  <json_structure>
{
  "title": "Compelling Quest Title",
  "description": "2-3 paragraph quest overview with hooks",
  "type": "${type}",
  "difficulty": "${difficulty}",
  "estimatedTime": "1 session/2-3 sessions/ongoing",
  
  "objective": {
    "primary": "Main quest goal",
    "secondary": ["Optional objectives"],
    "hidden": ["Secret objectives players might discover"]
  },
  
  "stages": [
    {
      "id": 1,
      "title": "Stage Name",
      "description": "What happens in this stage",
      "objectives": ["Specific goals for this stage"],
      "location": "Where this takes place",
      "challenges": ["Obstacles to overcome"],
      "npcsInvolved": ["NPCs in this stage"],
      "rewards": {
        "experience": 100,
        "gold": 50,
        "items": ["Reward items"]
      },
      "consequences": ["What happens after this stage"],
      "nextStages": [2],
      "isOptional": false
    }
  ],
  
  "rewards": {
    "experience": 500,
    "gold": 200,
    "items": ["Magic items", "Useful items"],
    "reputation": ["Faction gains", "Social improvements"],
    "storyImpact": ["How completing this changes the world"]
  },
  
  "consequences": {
    "success": ["What happens if quest succeeds"],
    "failure": ["What happens if quest fails"],
    "partialSuccess": ["Mixed outcomes"]
  },
  
  "lore": "Historical/mythological background of the quest",
  "backstory": "How this quest came to be",
  
  "connections": {
    "npcs": ["Important NPCs involved"],
    "locations": ["Key locations"],
    "otherQuests": ["Related quest possibilities"],
    "factions": ["Organizations involved"]
  },
  
  "challenges": {
    "combat": ["Fight encounters"],
    "social": ["Social challenges/negotiations"],
    "exploration": ["Investigation/discovery challenges"],
    "puzzles": ["Mental challenges/riddles"]
  },
  
  "hooks": {
    "initial": ["How to start the quest"],
    "ongoing": ["Ways to maintain interest"],
    "twists": ["Potential plot twists"]
  }
}
  </json_structure>
</output_format>

<guidelines>
  <guideline>Create ${scope} content appropriate for ${difficulty} difficulty</guideline>
  <guideline>Match the ${context.genre} genre and ${urgency} urgency</guideline>
  <guideline>Include multiple paths/approaches</guideline>
  <guideline>Design for ${context.partySize || 1} player(s)</guideline>
  <guideline>Provide clear objectives and meaningful choices</guideline>
  <guideline>Include specific, actionable stages</guideline>
  <guideline>Create opportunities for roleplay</guideline>
  <guideline>Consider consequences of player actions</guideline>
  <guideline>Make it engaging and memorable</guideline>
  <guideline>Include appropriate rewards for level ${context.playerLevel || 1}</guideline>
</guidelines>`;
  }

  /**
   * Calculate narrative importance of quest
   */
  private static calculateNarrativeWeight(
    quest: {
      stages?: unknown[];
      connections?: { npcs?: unknown[] };
      hooks?: { twists?: unknown[] };
    },
    request: QuestRequest,
  ): number {
    let weight = 5; // Base weight

    // Adjust based on quest type and scope
    if (request.type === 'main') weight += 3;
    else if (request.type === 'personal') weight += 2;
    else if (request.type === 'side') weight += 1;

    if (request.scope === 'campaign-arc') weight += 2;
    else if (request.scope === 'multi-session') weight += 1;

    // Increase weight for complex quests
    if ((quest.stages?.length || 0) > 3) weight += 1;
    if ((quest.connections?.npcs?.length || 0) > 2) weight += 1;
    if ((quest.hooks?.twists?.length || 0) > 1) weight += 1;

    return Math.min(weight, 10);
  }

  /**
   * Save quest to database
   */
  static async saveQuest(quest: GeneratedQuest): Promise<string> {
    try {
      const questData = {
        title: quest.title,
        description: quest.description,
        quest_type: quest.type,
        difficulty_level: quest.difficulty,
        status: 'available',
        campaign_id: quest.metadata.campaignId,
        character_id: quest.metadata.characterId,
        metadata: {
          ...quest,
          generatedAt: quest.metadata.createdAt.toISOString(),
          generator: 'QuestGenerator',
          version: '1.0',
        },
      };

      const { data, error } = await supabase.from('quests').insert(questData).select('id').single();

      if (error) {
        logger.error('Error saving quest:', error);
        throw new Error('Failed to save quest to database');
      }

      logger.info(`💾 Saved quest "${quest.title}" with ID: ${data.id}`);
      return data.id;
    } catch (error) {
      logger.error('Error saving quest:', error);
      throw error;
    }
  }

  /**
   * Generate and save a quest in one call
   */
  static async createQuest(request: QuestRequest): Promise<GeneratedQuest> {
    const quest = await this.generateQuest(request);

    try {
      const questId = await this.saveQuest(quest);
      quest.id = questId;

      logger.info(`✅ Created quest "${quest.title}" successfully`);
      return quest;
    } catch (saveError) {
      logger.warn('Quest generated but failed to save:', saveError);
      // Return the generated quest even if save failed
      return quest;
    }
  }

  /**
   * Generate a quest based on current memories and context
   */
  /**
   * @param userId - User ID for ownership validation (SECURITY: strongly recommended)
   */
  static async generateMemoryBasedQuest(
    campaignId: string,
    sessionId: string,
    characterId: string,
    questType: QuestRequest['type'] = 'side',
    userId?: string,
  ): Promise<GeneratedQuest> {
    try {
      // Security check: Verify user ownership of campaign
      if (!userId) {
        logger.warn('[QuestGenerator] No userId provided - this is insecure');
      }

      // Build query with ownership validation
      let campaignQuery = supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId);

      if (userId) {
        campaignQuery = campaignQuery.eq('user_id', userId); // SECURITY: Ensure user owns this campaign
      }

      // Get campaign and memories in parallel
      const [campaignResult, memories] = await Promise.all([
        campaignQuery.single(),
        MemoryManager.getRelevantMemories(sessionId, 'quest opportunities', 5),
      ]);

      if (!campaignResult.data) {
        throw new Error('Campaign not found or access denied');
      }

      const campaign = campaignResult;

      const request: QuestRequest = {
        type: questType,
        difficulty: 'medium',
        urgency: 'soon',
        scope: 'single-session',
        context: {
          campaignId,
          sessionId,
          characterId,
          genre: campaign.data.genre || 'fantasy',
          playerLevel: await getAveragePartyLevel(campaignId, sessionId),
          recentMemories: memories,
        },
      };

      return await this.createQuest(request);
    } catch (error) {
      logger.error('Failed to generate memory-based quest:', error);
      throw error;
    }
  }

  /**
   * Generate a quest hook from current game state
   */
  static async generateQuestHook(
    campaignId: string,
    sessionId: string,
    contextMessage: string,
  ): Promise<{ title: string; hook: string; questType: string }> {
    try {
      const geminiManager = this.getGeminiManager();

      const result = await geminiManager.executeWithRotation(async (genAI) => {
        const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

        const prompt = `<task>
  <description>Generate a quest hook based on the current game context</description>
</task>

<context>
  <game_situation>${contextMessage}</game_situation>
</context>

<output_format>
  <instruction>Generate a quest hook in JSON format:</instruction>
  <json_structure>
{
  "title": "Quest Title",
  "hook": "1-2 sentence hook that introduces the quest opportunity",
  "questType": "main|side|personal|investigation|social"
}
  </json_structure>
</output_format>

<guidelines>
  <guideline>Make it immediately actionable and intriguing</guideline>
</guidelines>`;

        const response = await model.generateContent(prompt);
        const text = await response.response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }

        // Fallback if JSON parsing fails
        return {
          title: 'Mysterious Opportunity',
          hook: 'Something interesting has caught your attention...',
          questType: 'side',
        };
      });

      return result;
    } catch (error) {
      logger.error('Failed to generate quest hook:', error);
      return {
        title: 'Adventure Awaits',
        hook: 'A new opportunity presents itself...',
        questType: 'side',
      };
    }
  }
}
