import { getGeminiApiManager, type GeminiApiManager } from '@/infrastructure/ai';

import { GEMINI_TEXT_MODEL } from '@/config/ai';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { getAveragePartyLevel } from '@/utils/character-level-utils';

export interface LocationRequest {
  type: 'settlement' | 'dungeon' | 'wilderness' | 'landmark' | 'building' | 'room';
  size?: 'tiny' | 'small' | 'medium' | 'large' | 'massive';
  purpose?: string; // What the location is for
  atmosphere?: 'peaceful' | 'mysterious' | 'dangerous' | 'sacred' | 'corrupt' | 'bustling';
  connectedTo?: string; // Location ID this connects to
  context: {
    campaignId: string;
    sessionId?: string;
    genre: string;
    currentStory?: string;
    nearbyLocations?: string[];
    playerLevel?: number;
  };
}

export interface GeneratedLocation {
  id?: string;
  name: string;
  description: string;
  type: string;
  atmosphere: string;
  sizeCategory: string;
  keyFeatures: string[];
  inhabitants: string[];
  threats: string[];
  treasures: string[];
  secrets: string[];
  connections: string[];
  lore: string;
  narrativeHooks: string[];
  sensoryDetails: {
    sights: string[];
    sounds: string[];
    smells: string[];
    atmosphere: string;
  };
  mechanics: {
    skillChallenges: string[];
    hiddenElements: string[];
    interactiveFeatures: string[];
  };
  metadata: {
    createdAt: Date;
    campaignId: string;
    sessionId?: string;
    narrativeWeight: number;
    storyArc?: string;
  };
}

export class LocationGenerator {
  private static getGeminiManager(): GeminiApiManager {
    return getGeminiApiManager();
  }

  /**
   * Generate a detailed location using AI
   */
  static async generateLocation(request: LocationRequest): Promise<GeneratedLocation> {
    try {
      const geminiManager = this.getGeminiManager();

      const result = await geminiManager.executeWithRotation(async (genAI) => {
        const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

        const prompt = this.buildLocationPrompt(request);

        const response = await model.generateContent(prompt);
        const text = await response.response.text();

        try {
          // Extract JSON from the response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in location generation response');
          }

          const locationData = JSON.parse(jsonMatch[0]);

          // Add metadata
          const location: GeneratedLocation = {
            ...locationData,
            id: undefined, // Will be set when saved
            metadata: {
              createdAt: new Date(),
              campaignId: request.context.campaignId,
              sessionId: request.context.sessionId,
              narrativeWeight: this.calculateNarrativeWeight(locationData, request),
              storyArc: request.context.currentStory,
            },
          };

          return location;
        } catch (parseError) {
          logger.error('Failed to parse location JSON:', parseError);
          throw new Error('Failed to generate location: Invalid response format');
        }
      });

      logger.info(`🏰 Generated location: ${result.name}`);
      return result;
    } catch (error) {
      logger.error('Location generation failed:', error);
      throw new Error(
        `Failed to generate location: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Build the prompt for location generation
   */
  private static buildLocationPrompt(request: LocationRequest): string {
    const { type, size = 'medium', purpose, atmosphere = 'mysterious', context } = request;

    return `<task>
  <description>You are a master world builder creating a ${type} for a ${context.genre} D&D campaign. Generate a detailed, immersive location.</description>
</task>

<requirements>
  <type>${type}</type>
  <size>${size}</size>
  <purpose>${purpose || 'undefined - be creative'}</purpose>
  <atmosphere>${atmosphere}</atmosphere>
  <player_level>${context.playerLevel || 'unknown'}</player_level>
  <genre>${context.genre}</genre>
</requirements>

<context>
  ${request.context.currentStory ? `<current_story>${request.context.currentStory}</current_story>` : ''}
  ${request.context.nearbyLocations?.length ? `<nearby_locations>${request.context.nearbyLocations.join(', ')}</nearby_locations>` : ''}
</context>

<verbalized_sampling_technique>
  <instruction>Before generating the final location, internally brainstorm 3-4 distinct atmospheric concepts with probability scores (0.0-1.0) representing how typical each approach is for this type of ${type}</instruction>

  <atmosphere_diversity_dimensions>
    <expected_atmosphere>Generic ${atmosphere} ${type} (prob: 0.85) - Meets typical expectations</expected_atmosphere>
    <contrasting_element>Expected type with unexpected mood (prob: 0.50) - e.g., cheerful dungeon, ominous tavern, welcoming tomb</contrasting_element>
    <unique_feature>Standard location with memorable twist (prob: 0.40) - One element that makes it unforgettable</unique_feature>
    <wild_card>Completely subversive approach (prob: ≤0.30) - Challenges assumptions about this ${type}</wild_card>
  </atmosphere_diversity_dimensions>

  <example_process_for_${type}>
    Internal brainstorming for ${atmosphere} ${type}:

    Atmospheric variations with probabilities:
    1. Typical ${atmosphere} ${type} (prob: 0.85) - Classic and familiar
    2. ${type} with contrasting mood element (prob: 0.55) - Unexpected emotional tone
    3. ${type} with unique historical twist (prob: 0.45) - Memorable backstory element
    4. (Wild Card) ${type} that subverts genre expectations (prob: ≤0.30) - Surprising but logical

    Select the atmosphere that:
    - Creates the most vivid sensory experience
    - Provides interesting exploration opportunities
    - Balances familiarity with originality
    - Offers multiple narrative hooks for the DM
  </example_process_for_${type}>

  <sensory_diversity>
    Vary across dimensions:
    - Visual aesthetics: From expected to surreal
    - Sound design: From silence to cacophony to unusual music
    - Smell palette: From pleasant to nauseating to otherworldly
    - Tactile elements: Temperature, texture, spatial feeling
    - Historical depth: From straightforward to layered mysteries
  </sensory_diversity>

  <selection_criteria>
    Choose the location concept that:
    - Maximizes immersion and player curiosity
    - Fits ${context.genre} while avoiding clichés
    - Provides clear interaction opportunities
    - Creates memorable moments for the party
    - Balances challenge appropriate to level ${context.playerLevel || 1}
  </selection_criteria>
</verbalized_sampling_technique>

<output_format>
  <instruction>Generate a location in this EXACT JSON format:</instruction>
  <json_structure>
{
  "name": "Location Name",
  "description": "Rich 2-3 paragraph description with atmosphere and mood",
  "type": "${type}",
  "atmosphere": "${atmosphere}",
  "sizeCategory": "${size}",
  "keyFeatures": ["3-5 notable physical features"],
  "inhabitants": ["Who or what lives here - be specific"],
  "threats": ["Dangers present - monsters, traps, hazards"],
  "treasures": ["Valuable items, knowledge, or resources"],
  "secrets": ["Hidden elements players might discover"],
  "connections": ["How this connects to other locations"],
  "lore": "Historical background and significance",
  "narrativeHooks": ["Story opportunities for DM"],
  "sensoryDetails": {
    "sights": ["What players see"],
    "sounds": ["What players hear"],  
    "smells": ["What players smell"],
    "atmosphere": "Overall sensory mood"
  },
  "mechanics": {
    "skillChallenges": ["Required skill checks"],
    "hiddenElements": ["Things requiring investigation"],
    "interactiveFeatures": ["Things players can interact with"]
  }
}
  </json_structure>
</output_format>

<guidelines>
  <guideline>Make it vivid and immersive</guideline>
  <guideline>Include specific, memorable details</guideline>
  <guideline>Provide clear hooks for player interaction</guideline>
  <guideline>Match the ${context.genre} genre</guideline>
  <guideline>Consider player level ${context.playerLevel || 1} for appropriate challenges</guideline>
  <guideline>Be creative but grounded in D&D logic</guideline>
  <guideline>Include both obvious and subtle elements</guideline>
</guidelines>`;
  }

  /**
   * Calculate narrative importance of location
   */
  private static calculateNarrativeWeight(
    location: { type?: string; narrativeHooks?: string[]; secrets?: string[] },
    request: LocationRequest,
  ): number {
    let weight = 5; // Base weight

    // Increase weight for story-critical locations
    if (request.context.currentStory && (location.narrativeHooks?.length || 0) > 2) weight += 2;
    if ((location.secrets?.length || 0) > 2) weight += 1;
    if (location.type === 'dungeon' || location.type === 'landmark') weight += 1;
    if (request.atmosphere === 'dangerous' || request.atmosphere === 'sacred') weight += 1;

    return Math.min(weight, 10);
  }

  /**
   * Save location to database
   */
  static async saveLocation(location: GeneratedLocation): Promise<string> {
    try {
      const locationData = {
        name: location.name,
        description: location.description,
        location_type: location.type,
        campaign_id: location.metadata.campaignId,
        metadata: {
          ...location,
          generatedAt: location.metadata.createdAt.toISOString(),
          generator: 'LocationGenerator',
          version: '1.0',
        },
      };

      const { data, error } = await supabase
        .from('locations')
        .insert(locationData)
        .select('id')
        .single();

      if (error) {
        logger.error('Error saving location:', error);
        throw new Error('Failed to save location to database');
      }

      logger.info(`💾 Saved location "${location.name}" with ID: ${data.id}`);
      return data.id;
    } catch (error) {
      logger.error('Error saving location:', error);
      throw error;
    }
  }

  /**
   * Generate and save a location in one call
   */
  static async createLocation(request: LocationRequest): Promise<GeneratedLocation> {
    const location = await this.generateLocation(request);

    try {
      const locationId = await this.saveLocation(location);
      location.id = locationId;

      logger.info(`✅ Created location "${location.name}" successfully`);
      return location;
    } catch (saveError) {
      logger.warn('Location generated but failed to save:', saveError);
      // Return the generated location even if save failed
      return location;
    }
  }

  /**
   * Generate a location based on current game context
   * @param userId - User ID for ownership validation (SECURITY: strongly recommended)
   */
  static async generateContextualLocation(
    campaignId: string,
    sessionId: string,
    playerAction: string,
    currentLocationId?: string,
    userId?: string,
  ): Promise<GeneratedLocation> {
    try {
      // Security check: Verify user ownership of campaign
      if (!userId) {
        logger.warn('[LocationGenerator] No userId provided - this is insecure');
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

      // Determine location type based on player action
      const locationType = this.inferLocationTypeFromAction(playerAction);

      const request: LocationRequest = {
        type: locationType,
        size: 'medium',
        atmosphere: 'mysterious',
        context: {
          campaignId,
          sessionId,
          genre: campaign.genre || 'fantasy',
          currentStory: playerAction,
          playerLevel: await getAveragePartyLevel(campaignId, sessionId),
        },
      };

      return await this.createLocation(request);
    } catch (error) {
      logger.error('Failed to generate contextual location:', error);
      throw error;
    }
  }

  /**
   * Infer what type of location is needed based on player action
   */
  private static inferLocationTypeFromAction(action: string): LocationRequest['type'] {
    const actionLower = action.toLowerCase();

    if (
      actionLower.includes('enter') ||
      actionLower.includes('building') ||
      actionLower.includes('shop')
    ) {
      return 'building';
    }
    if (
      actionLower.includes('forest') ||
      actionLower.includes('wilderness') ||
      actionLower.includes('travel')
    ) {
      return 'wilderness';
    }
    if (
      actionLower.includes('dungeon') ||
      actionLower.includes('cave') ||
      actionLower.includes('underground')
    ) {
      return 'dungeon';
    }
    if (
      actionLower.includes('town') ||
      actionLower.includes('city') ||
      actionLower.includes('village')
    ) {
      return 'settlement';
    }

    // Default to a generic building/room
    return 'room';
  }
}
