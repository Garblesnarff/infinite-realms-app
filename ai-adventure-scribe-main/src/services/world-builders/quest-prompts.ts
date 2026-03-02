import type { QuestRequest } from '@/services/world-builders/quest-generator';

/**
 * Builds the prompt for quest generation
 * Extracted from QuestGenerator.ts
 */
export function buildQuestPromptTemplate(request: QuestRequest): string {
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
 * Builds the prompt for quest hook generation
 * Extracted from QuestGenerator.ts
 */
export function buildQuestHookPromptTemplate(contextMessage: string): string {
  return `<task>
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
}
