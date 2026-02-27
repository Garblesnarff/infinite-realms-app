/**
 * Build opening scene requirements for first message
 * Uses verbalized sampling for creative diversity (Stanford research)
 */
export function buildOpeningScenePrompt(): string {
  return `<opening_scene_requirements>
<title>CAMPAIGN OPENING - FIRST MESSAGE</title>

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
[Complete opening scene - 2-3 paragraphs with sensory details, NPC dialogue in quotes, ends with A/B/C action options]
</text>
</response>
<response>
<probability>0.3</probability>
<text>
[Different approach - complete scene with dialogue and A/B/C options]
</text>
</response>
<response>
<probability>0.2</probability>
<text>
[Creative/unexpected approach - complete scene with dialogue and A/B/C options]
</text>
</response>

CRITICAL RULES:
- Each <text> MUST be a COMPLETE, STANDALONE opening scene
- Include NPC dialogue in quotes, sensory details, and A/B/C action options in EACH response
- Do NOT output anything outside the <response> tags
- The system will randomly select ONE response based on probabilities
- NEVER repeat or rephrase paragraphs within a single response - each paragraph should appear exactly ONCE
- Do NOT write draft paragraphs followed by expanded versions - write final content only
</verbalized_sampling_output>

<scene_requirements>
1. **Scene Setting**: Location, atmosphere, sensory details (sights, sounds, smells)
2. **Character Integration**: Connect background/skills to the scenario naturally
3. **Active NPC**: Include at least one speaking NPC with quoted dialogue
4. **Immediate Hook**: Compelling problem, opportunity, or mystery requiring action
5. **Clear Choices**: End with 2-3 action options in A/B/C format with bold action names
</scene_requirements>

<action_format>
Format choices as: A. **Action Name**, brief description
Example:
A. **Approach the stranger**, introducing yourself and asking about the commotion
B. **Observe from the shadows**, gathering information before revealing yourself
C. **Check for danger**, scanning the room for potential threats
</action_format>

<mechanics>
- Specify dice rolls for uncertain outcomes when appropriate
- Reference character abilities that might be relevant
- Include environmental details suggesting tactical options
</mechanics>
</opening_scene_requirements>`;
}
