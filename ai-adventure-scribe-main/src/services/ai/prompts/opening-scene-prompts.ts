/**
 * OpeningScenePrompts - Handles building the opening scene requirements section of the prompt
 * Extracted from ContextBuilderPrompts.ts
 */
export class OpeningScenePrompts {
  static buildSection(): string {
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
}
