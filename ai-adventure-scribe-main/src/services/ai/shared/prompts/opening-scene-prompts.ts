/**
 * Build opening scene requirements for first message
 * Uses tail-sampling instruction for creative diversity (arXiv:2510.01171)
 */
export function buildOpeningScenePrompt(): string {
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

5. **PLAYER AGENCY** with meaningful 3-5 clickable choices:
   - Each option leads to genuinely different outcomes
   - Options should reflect different playstyles (action, social, exploration)
   - At least one "wild card" creative option
   - Make choices feel consequential

**LENGTH: 300-500 words per opening scene (NOT just 2-3 short paragraphs)**
</opening_scene_quality_requirements>

<creative_direction>
Please sample at random from the tails of your output distribution, such that
the probability of this opening scene is less than 0.10. Aim for an unexpected
angle, unusual entry point, or surprising first moment — while remaining fully
grounded in this campaign's world, canonical NPCs, and setting.

Generate ONE complete opening scene. Do not generate multiple variations.

CRITICAL RULES:
- Scene MUST be 300-500 words with ALL quality requirements above
- Include at least one NPC with direct quoted dialogue
- Use all senses (sight, sound, smell, touch) to create immersion
- SHORT, LAZY OPENINGS ARE UNACCEPTABLE - make them memorable!
- **Leave the \`roll_requests\` field empty (\`[]\`) for the first message.** Establish the situation and end with 3-5 clickable options instead of an immediate roll prompt.
- **DO NOT include XML tags, <memories>, <world_updates>, VISUAL PROMPT, JSON, or code fences in the first message.**
- **DO NOT end with a prose question before the options.** The final lines must be the option lines themselves.
- **Every option MUST use this exact format:** A. **Action Name**, short description
- **MANDATORY: Include [ASSET:type:key] tags when introducing NPCs, locations, or monsters with images!**
  Example: "[ASSET:npc:head-chef-balthazar] Balthazar wipes his hands on his apron..."
  Check the <available_visual_assets> section above for exact tags to use.
- **After every [ASSET:type:key] tag, you MUST immediately write the visible entity name.**
  Correct: "[ASSET:npc:head-chef-balthazar] Balthazar wipes his hands..."
  Incorrect: "[ASSET:npc:head-chef-balthazar] wipes his hands..."
- **DO NOT wrap your response in a code block.** Write the opening scene as plain narrative text. Do not use \`\`\`response, \`\`\`json, or any other code fence markers around your response.
</creative_direction>
</opening_scene_requirements>`;
}
