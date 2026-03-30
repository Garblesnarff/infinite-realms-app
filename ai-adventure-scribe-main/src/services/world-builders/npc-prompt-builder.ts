import type { NPCRequest } from './npc-types';

/**
 * Build the prompt for NPC generation
 */
export function buildNPCPrompt(request: NPCRequest): string {
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
