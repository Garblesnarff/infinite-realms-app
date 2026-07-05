import type { LocationRequest } from './location-types';

/**
 * Build the prompt for location generation
 */
export function buildLocationPrompt(request: LocationRequest): string {
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
export function calculateNarrativeWeight(
  location: { type?: string; narrativeHooks?: string[]; secrets?: string[] },
  request: LocationRequest,
): number {
  let weight = 5; // Base weight

  // Increase weight for story-critical locations
  if (request.context.currentStory && (location.narrativeHooks?.length || 0) > 2) {
    weight += 2;
  }
  if ((location.secrets?.length || 0) > 2) {
    weight += 1;
  }
  if (location.type === 'dungeon' || location.type === 'landmark') {
    weight += 1;
  }
  if (request.atmosphere === 'dangerous' || request.atmosphere === 'sacred') {
    weight += 1;
  }

  return Math.min(weight, 10);
}
