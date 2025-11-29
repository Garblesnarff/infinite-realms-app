import { getGeminiApiManager } from '../gemini-api-manager-singleton';

import type { GeminiApiManager } from '../gemini-api-manager';

import { GEMINI_TEXT_MODEL } from '@/config/ai';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { getAveragePartyLevel } from '@/utils/character-level-utils';

export interface NPCRequest {
  role:
    | 'shopkeeper'
    | 'guard'
    | 'noble'
    | 'commoner'
    | 'villain'
    | 'ally'
    | 'mentor'
    | 'mysterious'
    | 'authority';
  importance: 'minor' | 'major' | 'critical';
  location?: string;
  purpose?: string; // Why this NPC exists in the story
  relationship?: 'friendly' | 'neutral' | 'hostile' | 'romantic' | 'rival';
  context: {
    campaignId: string;
    sessionId?: string;
    genre: string;
    currentStory?: string;
    playerCharacterName?: string;
    locationName?: string;
    playerLevel?: number;
  };
}

export interface GeneratedNPC {
  id?: string;
  name: string;
  description: string;
  race: string;
  class?: string;
  level?: number;

  // Physical Characteristics
  gender?: 'male' | 'female';
  age?: number;
  height?: number; // in inches
  weight?: number; // in pounds
  eyes?: string;
  skin?: string;
  hair?: string;

  // Core Identity
  role: string;
  occupation: string;
  socialStatus: string;

  // Personality & Psychology
  personality: {
    traits: string[];
    ideals: string[];
    bonds: string[];
    flaws: string[];
    mannerisms: string[];
    speech: string;
  };

  // Motivations & Goals
  goals: {
    immediate: string[];
    longTerm: string[];
    secret: string[];
  };

  // Relationships & History
  background: string;
  relationships: {
    allies: string[];
    enemies: string[];
    family: string[];
    organizations: string[];
  };

  // Story Integration
  secrets: string[];
  questHooks: string[];
  narrativeRole: string;

  // Practical Details
  appearance: {
    physicalFeatures: string[];
    clothing: string;
    equipment: string[];
    distinguishingMarks: string[];
  };

  // Gameplay Mechanics
  abilities: {
    notableSkills: string[];
    combatRole?: string;
    specialAbilities: string[];
  };

  // Story Metadata
  metadata: {
    createdAt: Date;
    campaignId: string;
    sessionId?: string;
    importance: string;
    narrativeWeight: number;
    storyArc?: string;
    locationId?: string;
  };
}

export class NPCGenerator {
  private static getGeminiManager(): GeminiApiManager {
    return getGeminiApiManager();
  }

  /**
   * Generate a detailed NPC using AI
   */
  static async generateNPC(request: NPCRequest): Promise<GeneratedNPC> {
    try {
      const geminiManager = this.getGeminiManager();

      const result = await geminiManager.executeWithRotation(async (genAI) => {
        const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

        const prompt = this.buildNPCPrompt(request);

        const response = await model.generateContent(prompt);
        const text = await response.response.text();

        try {
          // Extract JSON from the response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in NPC generation response');
          }

          const npcData = JSON.parse(jsonMatch[0]);

          // Add metadata
          const npc: GeneratedNPC = {
            ...npcData,
            id: undefined, // Will be set when saved
            metadata: {
              createdAt: new Date(),
              campaignId: request.context.campaignId,
              sessionId: request.context.sessionId,
              importance: request.importance,
              narrativeWeight: this.calculateNarrativeWeight(npcData, request),
              storyArc: request.context.currentStory,
              locationId: request.location,
            },
          };

          return npc;
        } catch (parseError) {
          logger.error('Failed to parse NPC JSON:', parseError);
          throw new Error('Failed to generate NPC: Invalid response format');
        }
      });

      logger.info(`👤 Generated NPC: ${result.name} (${result.role})`);
      return result;
    } catch (error) {
      logger.error('NPC generation failed:', error);
      throw new Error(
        `Failed to generate NPC: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Build the prompt for NPC generation
   */
  private static buildNPCPrompt(request: NPCRequest): string {
    const { role, importance, purpose, relationship = 'neutral', context } = request;

    return `<task>
  <description>You are a master character creator for a ${context.genre} D&D campaign. Create a compelling, three-dimensional NPC.</description>
</task>

<requirements>
  <role>${role}</role>
  <importance>${importance}</importance>
  <purpose>${purpose || 'undefined - be creative'}</purpose>
  <relationship>${relationship}</relationship>
  <genre>${context.genre}</genre>
  <player_level>${context.playerLevel || 'unknown'}</player_level>
</requirements>

<context>
  ${context.currentStory ? `<story>${context.currentStory}</story>` : ''}
  ${context.locationName ? `<location>${context.locationName}</location>` : ''}
  ${context.playerCharacterName ? `<player_character>${context.playerCharacterName}</player_character>` : ''}
</context>

<verbalized_sampling_technique>
  <instruction>Before generating the final NPC, internally brainstorm 3-4 distinct personality concepts with probability scores (0.0-1.0) representing how typical each approach is for this role</instruction>

  <personality_diversity_dimensions>
    <archetype_adherence>From stereotypical ${role} (prob: 0.9) to subversive/unexpected (prob: 0.2)</archetype_adherence>
    <complexity>Simple motivations (prob: 0.8) to multi-layered contradictions (prob: 0.3)</complexity>
    <alignment_presentation>Obvious alignment (prob: 0.75) to hidden/contradictory nature (prob: 0.35)</alignment_presentation>
    <speech_pattern>Standard speech (prob: 0.8) to unique dialect/quirk (prob: 0.4)</speech_pattern>
    <background_depth>Straightforward history (prob: 0.7) to mysterious/complex past (prob: 0.4)</background_depth>
  </personality_diversity_dimensions>

  <example_process_for_${role}>
    Internal brainstorming for ${importance} ${role}:

    Personality variations with probabilities:
    1. Typical ${role} archetype (prob: 0.85) - Meets expectations solidly
    2. ${role} with emotional depth (prob: 0.60) - Familiar but nuanced
    3. ${role} with unexpected hobby/trait (prob: 0.40) - Memorable twist
    4. (Wild Card) ${role} that subverts expectations (prob: ≤0.30) - Unconventional but compelling

    Select the personality that:
    - Best serves the ${importance} narrative role
    - Provides interesting player interaction opportunities
    - Balances authenticity with memorability
    - Offers unexpected depth without being nonsensical
  </example_process_for_${role}>

  <selection_criteria>
    Choose the NPC concept that maximizes:
    - Story potential (quest hooks, secrets, relationships)
    - Player engagement (interesting to interact with)
    - Genre authenticity (fits ${context.genre} but avoids clichés)
    - Roleplaying opportunities (distinct voice and mannerisms)
  </selection_criteria>
</verbalized_sampling_technique>

<output_format>
  <instruction>Generate an NPC in this EXACT JSON format:</instruction>
  <json_structure>
{
  "name": "Full Name",
  "description": "Rich 2-3 sentence description capturing essence",
  "race": "D&D race",
  "class": "D&D class or null",
  "level": null,
  "gender": "male or female",
  "age": 25,
  "height": 68,
  "weight": 150,
  "eyes": "Eye color",
  "skin": "Skin tone/color",
  "hair": "Hair color/style",
  "role": "${role}",
  "occupation": "Specific job/profession",
  "socialStatus": "Social position/rank",
  
  "personality": {
    "traits": ["3-4 personality traits"],
    "ideals": ["What drives them"],
    "bonds": ["What they care about most"],
    "flaws": ["Weaknesses/negative traits"],
    "mannerisms": ["Unique behaviors/quirks"],
    "speech": "How they speak (accent, vocabulary, tone)"
  },
  
  "goals": {
    "immediate": ["What they want right now"],
    "longTerm": ["Life goals/ambitions"],
    "secret": ["Hidden objectives"]
  },
  
  "background": "Detailed history and how they got to where they are",
  
  "relationships": {
    "allies": ["Important friends/allies"],
    "enemies": ["Rivals/enemies"],
    "family": ["Family members"],
    "organizations": ["Groups they belong to"]
  },
  
  "secrets": ["Things they're hiding"],
  "questHooks": ["Ways they could involve players in adventures"],
  "narrativeRole": "How they serve the story (quest giver, ally, obstacle, etc.)",
  
  "appearance": {
    "physicalFeatures": ["Notable physical characteristics"],
    "clothing": "What they typically wear",
    "equipment": ["Items they carry"],
    "distinguishingMarks": ["Scars, tattoos, unique features"]
  },
  
  "abilities": {
    "notableSkills": ["Skills they excel at"],
    "combatRole": "Fighter/caster/support/none",
    "specialAbilities": ["Unique abilities or talents"]
  }
}
  </json_structure>
</output_format>

<guidelines>
  <guideline>Create a unique, memorable character</guideline>
  <guideline>Match the ${context.genre} genre</guideline>
  <guideline>Give them clear motivations and flaws</guideline>
  <guideline>Include story hooks for player interaction</guideline>
  <guideline>Make them feel like a real person with agency</guideline>
  <guideline>Consider their role in the ${importance} story</guideline>
  <guideline>Include specific, vivid details</guideline>
  <guideline>Provide multiple adventure opportunities</guideline>
  <guideline>Physical characteristics should be race-appropriate (height in inches, weight in pounds)</guideline>
  <guideline>Age should fit their role and experience level</guideline>
  <guideline>Physical description should be vivid and memorable</guideline>
</guidelines>`;
  }

  /**
   * Calculate narrative importance of NPC
   */
  private static calculateNarrativeWeight(
    npc: { secrets?: string[]; questHooks?: string[]; goals?: { secret?: string[] } },
    request: NPCRequest,
  ): number {
    let weight = 5; // Base weight

    // Adjust based on importance
    if (request.importance === 'critical') weight += 3;
    else if (request.importance === 'major') weight += 2;
    else if (request.importance === 'minor') weight += 0;

    // Increase weight for story-rich NPCs
    if ((npc.secrets?.length || 0) > 1) weight += 1;
    if ((npc.questHooks?.length || 0) > 2) weight += 1;
    if ((npc.goals?.secret?.length || 0) > 0) weight += 1;
    if (['villain', 'mentor', 'ally'].includes(request.role)) weight += 1;

    return Math.min(weight, 10);
  }

  /**
   * Save NPC to database
   */
  static async saveNPC(npc: GeneratedNPC): Promise<string> {
    try {
      const npcData = {
        name: npc.name,
        description: npc.description,
        race: npc.race,
        class: npc.class,
        level: npc.level,
        gender: npc.gender,
        age: npc.age,
        height: npc.height,
        weight: npc.weight,
        eyes: npc.eyes,
        skin: npc.skin,
        hair: npc.hair,
        personality_traits: npc.personality.traits,
        campaign_id: npc.metadata.campaignId,
        location_id: npc.metadata.locationId,
        metadata: {
          ...npc,
          generatedAt: npc.metadata.createdAt.toISOString(),
          generator: 'NPCGenerator',
          version: '1.0',
        },
      };

      const { data, error } = await supabase.from('npcs').insert(npcData).select('id').single();

      if (error) {
        logger.error('Error saving NPC:', error);
        throw new Error('Failed to save NPC to database');
      }

      logger.info(`💾 Saved NPC "${npc.name}" with ID: ${data.id}`);
      return data.id;
    } catch (error) {
      logger.error('Error saving NPC:', error);
      throw error;
    }
  }

  /**
   * Generate and save an NPC in one call
   */
  static async createNPC(request: NPCRequest): Promise<GeneratedNPC> {
    const npc = await this.generateNPC(request);

    try {
      const npcId = await this.saveNPC(npc);
      npc.id = npcId;

      logger.info(`✅ Created NPC "${npc.name}" successfully`);
      return npc;
    } catch (saveError) {
      logger.warn('NPC generated but failed to save:', saveError);
      // Return the generated NPC even if save failed
      return npc;
    }
  }

  /**
   * Generate an NPC based on current game context and player action
   */
  /**
   * @param userId - User ID for ownership validation (SECURITY: strongly recommended)
   */
  static async generateContextualNPC(
    campaignId: string,
    sessionId: string,
    playerAction: string,
    locationName?: string,
    userId?: string,
  ): Promise<GeneratedNPC> {
    try {
      // Security check: Verify user ownership of campaign
      if (!userId) {
        logger.warn('[NPCGenerator] No userId provided - this is insecure');
      }

      // Build query with ownership validation
      let query = supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId);

      if (userId) {
        query = query.eq('user_id', userId); // SECURITY: Ensure user owns this campaign
      }

      const { data: campaign } = await query.single();

      if (!campaign) {
        throw new Error('Campaign not found or access denied');
      }

      // Infer NPC type from player action and location
      const npcRole = this.inferNPCRoleFromContext(playerAction, locationName);
      const importance = this.inferImportanceFromAction(playerAction);

      const request: NPCRequest = {
        role: npcRole,
        importance,
        context: {
          campaignId,
          sessionId,
          genre: campaign.genre || 'fantasy',
          currentStory: playerAction,
          locationName,
          playerLevel: await getAveragePartyLevel(campaignId, sessionId),
        },
      };

      return await this.createNPC(request);
    } catch (error) {
      logger.error('Failed to generate contextual NPC:', error);
      throw error;
    }
  }

  /**
   * Infer NPC role from context
   */
  private static inferNPCRoleFromContext(action: string, location?: string): NPCRequest['role'] {
    const actionLower = action.toLowerCase();
    const locationLower = location?.toLowerCase() || '';

    if (
      locationLower.includes('shop') ||
      actionLower.includes('buy') ||
      actionLower.includes('trade')
    ) {
      return 'shopkeeper';
    }
    if (
      locationLower.includes('guard') ||
      actionLower.includes('guard') ||
      locationLower.includes('gate')
    ) {
      return 'guard';
    }
    if (
      actionLower.includes('noble') ||
      locationLower.includes('palace') ||
      locationLower.includes('manor')
    ) {
      return 'noble';
    }
    if (
      actionLower.includes('help') ||
      actionLower.includes('mentor') ||
      actionLower.includes('learn')
    ) {
      return 'mentor';
    }
    if (
      actionLower.includes('enemy') ||
      actionLower.includes('villain') ||
      actionLower.includes('boss')
    ) {
      return 'villain';
    }
    if (
      actionLower.includes('mysterious') ||
      actionLower.includes('strange') ||
      actionLower.includes('hooded')
    ) {
      return 'mysterious';
    }

    // Default to commoner
    return 'commoner';
  }

  /**
   * Infer NPC importance from action
   */
  private static inferImportanceFromAction(action: string): NPCRequest['importance'] {
    const actionLower = action.toLowerCase();

    if (
      actionLower.includes('boss') ||
      actionLower.includes('main') ||
      actionLower.includes('important')
    ) {
      return 'critical';
    }
    if (
      actionLower.includes('quest') ||
      actionLower.includes('help') ||
      actionLower.includes('leader')
    ) {
      return 'major';
    }

    return 'minor';
  }
}
