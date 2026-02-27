import type { CampaignParams } from '../types';

/**
 * Build campaign name prompt
 */
export function buildCampaignNamePrompt(params: CampaignParams): string {
  return `Generate a compelling, evocative campaign name for a D&D 5e adventure.

**Campaign Parameters:**
- Genre: ${params.genre}
- Difficulty: ${params.difficulty}
- Expected Length: ${params.length}
- Tone: ${params.tone}

**Requirements:**
1. The name should be 2-5 words maximum
2. It should evoke the campaign's tone and genre
3. It should be memorable and unique - avoid generic fantasy names
4. It should hint at adventure, mystery, or conflict

**Verbalized Sampling Technique:**
Generate 4 potential campaign names with probability scores (0.0-1.0):
- Standard ${params.genre} name (prob: ~0.85): Classic genre-appropriate name
- Evocative with mystery (prob: ~0.55): Hints at hidden depths
- Poetic/unusual (prob: ~0.35): Unexpected word pairings
- Wild card (prob: ≤0.25): Truly unique and memorable

**Anti-LLM Name Patterns - REJECT these:**
- Generic compound words: Shadowfall, Darkrise, Stormborn, Nightbane
- [Color]+[Element]: Crimson Dawn, Azure Twilight, Emerald Storm
- [Emotion]+[Fantasy noun]: Forgotten Realms, Lost Kingdoms, Eternal Shadows

**Approved patterns:**
- Historical fragments: "Before the Silence", "What Was Promised"
- Unexpected pairings: "The Copper Hymns", "Gentle Ruin"
- Mysterious incompleteness: "The Third (no second)", "Almost-Home"
- Evocative imagery: "Where Winter Waits", "The Singing Scar"

**IMPORTANT: Return ONLY the campaign name, nothing else. No quotes, no explanation, just the name.**

Example outputs:
- Grim Harvest
- The Shattered Crown
- What the Mountain Forgot
- Copper and Ash
- Before the Thaw`;
}

/**
 * Build campaign description prompt
 */
export function buildCampaignDescriptionPrompt(params: CampaignParams): string {
  return `Create an engaging D&D 5e campaign description that hooks players immediately and sets up an epic adventure.

**Campaign Parameters:**
- Genre: ${params.genre}
- Difficulty: ${params.difficulty}
- Expected Length: ${params.length}
- Tone: ${params.tone}

**Requirements:**
1. **Hook**: Start with a compelling central mystery, threat, or opportunity that demands heroes
2. **Stakes**: Make it clear what happens if the heroes don't act (people die, world ends, etc.)
3. **Unique Elements**: Include distinctive locations, NPCs, or plot devices that make this campaign memorable
4. **Player Agency**: Hint at meaningful choices and multiple approaches to challenges
5. **World Integration**: Suggest how character backgrounds might connect to the plot
6. **Adventure Potential**: Indicate specific types of encounters (exploration, political intrigue, combat, puzzles)

**Tone Guidelines:**
- ${params.tone === 'dark' ? 'Emphasize moral dilemmas, harsh consequences, and atmospheric dread. Heroes face difficult choices with no clear "right" answer.' : ''}
- ${params.tone === 'heroic' ? 'Focus on noble quests, clear good vs evil, and inspiring moments. Heroes are destined for greatness and legendary deeds.' : ''}
- ${params.tone === 'comedic' ? 'Include absurd situations, witty NPCs, and opportunities for humor. Serious threats exist but approached with levity.' : ''}
- ${params.tone === 'mysterious' ? 'Layer in secrets, hidden agendas, and puzzles to solve. Nothing is quite what it seems on the surface.' : ''}
- ${params.tone === 'gritty' ? 'Realistic consequences, resource management, and survival elements. Combat is dangerous and magic is rare.' : ''}

**Verbalized Sampling Technique:**
To maximize creativity and avoid generic campaign concepts, internally brainstorm 3-4 potential campaign hooks with probability assessments before selecting the final one:

<hook_diversity_process>
Generate multiple hook variations with probability scores (0.0-1.0):
- Expected ${params.genre} hook (prob: ~0.85): Classic approach that matches genre conventions
- Twist on genre (prob: ~0.55): Unexpected element within ${params.genre} framework
- Subversive approach (prob: ~0.35): Challenges genre assumptions creatively
- Wild card hook (prob: ≤0.30): Unconventional campaign angle that's memorable and unique

<diversity_dimensions>
- Vary antagonist types: Monster threat, political conspiracy, cosmic horror, moral dilemma, environmental disaster
- Vary stakes scale: Personal, local, regional, world-ending, planar
- Vary player engagement: Direct confrontation, mystery investigation, social navigation, exploration-driven
- Ensure at least one approach subverts typical ${params.genre} expectations
</diversity_dimensions>

<example_for_${params.genre}>
Situation: ${params.genre} campaign, ${params.tone} tone

Potential hooks with probabilities:
1. Standard ${params.genre} threat (prob: 0.85) - Familiar and engaging
2. ${params.genre} with unexpected twist (prob: 0.60) - Fresh take on familiar
3. Genre-blending approach (prob: 0.40) - Combines elements unexpectedly
4. (Wild Card) Subversive concept (prob: 0.25) - Memorable and unique

Select the hook that best balances creativity with player appeal for ${params.tone} ${params.genre}.
</example_for_${params.genre}>
</hook_diversity_process>

<proper_noun_diversity>
**CRITICAL: Location and NPC Names Must Be Evocative and Specific**

Before finalizing your description, brainstorm 3-4 naming variations for each proper noun:

**Location Names** - Avoid generic names like "Dark Woods" or "Ancient Temple":
1. Descriptive but common (prob: 0.85): "Shadowfen Marsh", "Ironpeak Mountains"
2. Evocative with history (prob: 0.55): "The Weeping Stones", "Broken Crown Citadel"
3. Mysterious/poetic (prob: 0.35): "Veilwhisper Grove", "The Hundred Silent Towers"
4. Wild card (prob: ≤0.30): "Where-The-Gods-Wept", "Thirteenth Echo"

**NPC Names** - Avoid fantasy name generators:
1. Standard fantasy (prob: 0.80): "Aldric the Wise", "Ravenna Blackthorn"
2. Cultural flavor (prob: 0.50): "Grandmother Kettlewick", "Captain Ironjaw"
3. Memorable epithet (prob: 0.40): "The Architect of Sorrows", "Three-Fingered Margot"
4. Wild card (prob: ≤0.30): "Nobody", "The One Who Remembers"

**Artifacts/Factions** - Make them sound legendary:
1. Standard naming (prob: 0.75): "The Order of Light", "The Sunblade"
2. Specific history (prob: 0.50): "The Last Legion", "The Crown That Weeps"
3. Mysterious origin (prob: 0.35): "The Covenant of Ash", "The Key to What Was Lost"
4. Wild card (prob: ≤0.25): "The Thing Beneath", "Those Who Went Before"

Example Internal Process:
\`\`\`
Need a forest location:
1. Darkwood Forest (0.85) - Generic
2. The Thornveil (0.60) - Evocative
3. Whisperwilds (0.40) - Mysterious
4. The Green Remembrance (0.25) - Poetic/unique
→ Select: "Whisperwilds" or "The Green Remembrance"
\`\`\`

**MANDATORY RULES - ANTI-LLM NAME PATTERNS**:

**REJECT IMMEDIATELY** if the name matches ANY of these common LLM patterns:
1. [Adjective]+[Common Noun]: Frostpeak, Darkwood, Shadowfen, Ironforge, Blackfen, Whisperwood, Silverdale, Stormhaven
2. [Element]+[Place]: Windmere, Stonekeep, Firevale, Frosthaven, Shadowmere
3. [Emotion]+[Wood/Dale/Haven]: Sorrowdale, Grimwood, Hopehaven, Dreadhaven
4. Anything with: Shadow-, Dark-, Iron-, Frost-, Storm-, Silver-, Raven-, Whis(per/tle)-
5. Compound words that sound "fantasy-generic": Thornvale, Ashford, Ravenwood, Deepwood

**REQUIRE ALL THREE**:
- Historical fragment OR incomplete phrase ("Where...", "The [Noun] That...", "Before the...")
- Unexpected word pairing (concepts that don't typically go together)
- Probability score ≤0.25 (TRUE wild card tier ONLY)

**APPROVED name patterns**:
- Poetic fragments: "Where-Winter-Waits", "The Green Remembrance", "Before-the-Thaw"
- Historical echoes: "The Mines That Remember", "What-Was-Promised", "The Merchant's Regret"
- Unexpected pairings: "Copper Hymns", "The Singing Scar", "Gentle Ruin", "The Joyful Descent"
- Mysterious incompleteness: "The Third (no second)", "Almost-Home", "The Question", "Twice-Told"

**HARD RULE**: If you can imagine this name appearing in 10+ other fantasy settings, REJECT IT and brainstorm again with prob ≤0.20
</proper_noun_diversity>

**Structure:**
- **Paragraph 1**: The central hook and immediate threat/opportunity
- **Paragraph 2**: The unique world elements, key NPCs, and what makes this adventure special
- **Paragraph 3**: What players can expect - types of challenges, character integration, and why this matters

Create a campaign description that makes players say "I want to play in this world right now!"`;
}
