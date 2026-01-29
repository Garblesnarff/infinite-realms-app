import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import { fetchCampaignAssetsForPrompt } from './asset-processor';
import { getClassEquipment } from './class-equipment';
import { getCharacterPassiveScores } from '../passive-skills-service';
import { convertCharacterDetailsToCharacter } from '@/utils/character-converter';
import logger from '@/lib/logger';
import type { GameContext, ChatMessage } from './shared/types';
import type { Memory } from '../memory-manager';
import type { SessionVoiceContext } from '../voice-consistency-service';
import type { CombatDetectionResult, DetectedEnemy, DetectedCombatAction } from '@/utils/combatDetection';

export class ContextBuilder {
  static async build(params: {
    context: GameContext;
    message: string;
    conversationHistory?: ChatMessage[];
    relevantMemories: Memory[];
    combatDetection: CombatDetectionResult;
    voiceContext?: SessionVoiceContext | null;
    isFirstMessage?: boolean;
  }): Promise<string> {
    const { context, combatDetection, voiceContext, isFirstMessage, relevantMemories } = params;

    let contextPrompt = ContextBuilder.buildPersonaSection();
    contextPrompt += ContextBuilder.buildRulesOfPlaySection();
    contextPrompt += await ContextBuilder.buildGameContextSection(context, relevantMemories);

    if (isFirstMessage) {
      contextPrompt += ContextBuilder.buildOpeningSceneSection();
    }

    if (combatDetection) {
      contextPrompt += ContextBuilder.formatCombatContext(combatDetection);
      if (combatDetection.isCombat) {
        contextPrompt += ContextBuilder.buildCombatRollRequirementsSection();
      }
    }

    if (voiceContext && !isFirstMessage) {
      contextPrompt += ContextBuilder.buildVoiceOptimizationSection();
    }

    contextPrompt += ContextBuilder.buildResponseStructureSection();

    if (voiceContext && !isFirstMessage) {
      contextPrompt += `\n**REMEMBER: Always respond in the JSON format with narration_segments for voice synthesis!**`;
    }

    contextPrompt += ContextBuilder.buildFinalRemindersSection();

    return contextPrompt;
  }

  private static buildPersonaSection(): string {
    return `<persona>
You are a skilled D&D 5e Dungeon Master who creates immersive, mechanically-sound adventures. You balance compelling narrative with proper game mechanics, always giving players meaningful choices with clear consequences.
</persona>`;
  }

  private static buildRulesOfPlaySection(): string {
    return `<rules_of_play>

<when_to_request_rolls>
<title>CRITICAL: WHEN TO REQUEST DICE ROLLS</title>
Request a roll when the outcome is UNCERTAIN. Ask yourself:
- Can this action fail? → Request a roll
- Is there opposition or difficulty? → Request a roll
- Does success/failure meaningfully change the story? → Request a roll

<uncertain_outcomes_need_rolls>
- **Perception**: Noticing hidden things, reading situations, spotting traps
- **Stealth**: Sneaking, hiding, moving quietly, avoiding detection
- **Deception**: Lying, disguises, misdirection, bluffing
- **Persuasion**: Convincing, negotiating, charming, bargaining
- **Intimidation**: Threatening, coercing, interrogating
- **Investigation**: Searching, analyzing, deducing, finding clues
- **Insight**: Reading intentions, detecting lies, sensing motives
- **Athletics**: Climbing, jumping, swimming, grappling, forcing doors
- **Acrobatics**: Balance, tumbling, dodging, tight-rope walking
- **Sleight of Hand**: Pickpocketing, hiding objects, card tricks
- **Arcana/History/Nature/Religion**: Recalling specialized knowledge
- **Survival**: Tracking, foraging, navigation, weather prediction
- **Medicine**: Stabilizing, diagnosing, treating wounds
- **Animal Handling**: Calming, training, controlling animals
- **Performance**: Entertaining, impressing, distracting
- **ALL combat**: Attacks, damage, saves, initiative
</uncertain_outcomes_need_rolls>

<certain_outcomes_no_rolls>
- Walking down an empty corridor
- Talking to a friendly, willing NPC about general topics
- Looking at something obvious in plain sight
- Picking up an item from a table
- Opening an unlocked, untrapped door
</certain_outcomes_no_rolls>
</when_to_request_rolls>

<roll_request_format>
<title>HOW TO REQUEST ROLLS</title>
**When an action has uncertain outcome, include this code block at the END of your response:**

\`\`\`ROLL_REQUESTS_V1
{
  "rolls": [
    {
      "type": "skill_check",
      "formula": "1d20+modifier",
      "purpose": "Description of what this roll is for",
      "dc": 14
    }
  ]
}
\`\`\`

<field_requirements>
- **type**: "skill_check", "save", "attack", or "damage"
- **formula**: Dice notation (e.g., "1d20+3", "2d6+4")
- **purpose**: Brief explanation (e.g., "Stealth check to sneak past guards")
- **dc**: Difficulty Class for checks/saves (optional)
- **ac**: Armor Class for attacks (optional)
- **advantage/disadvantage**: true if applicable (optional)
</field_requirements>

<examples>
Stealth: \`{"type": "skill_check", "formula": "1d20+dex", "purpose": "Stealth check to avoid detection", "dc": 14}\`
Persuasion: \`{"type": "skill_check", "formula": "1d20+cha", "purpose": "Persuasion to convince the merchant", "dc": 15}\`
Perception: \`{"type": "skill_check", "formula": "1d20+wis", "purpose": "Perception to notice hidden details", "dc": 12}\`
Attack: \`{"type": "attack", "formula": "1d20+5", "purpose": "Attack roll with longsword", "ac": 15}\`
Save: \`{"type": "save", "formula": "1d20+2", "purpose": "Dexterity save to dodge fireball", "dc": 15}\`
Death Save: \`{"type": "save", "formula": "1d20", "purpose": "Death saving throw", "dc": 10}\`
</examples>
</roll_request_format>

<roll_before_outcome>
<title>CRITICAL: REQUEST ROLLS BEFORE NARRATING OUTCOMES</title>
**DO NOT narrate results of uncertain actions before the player rolls!**

✅ CORRECT FLOW:
1. Player says "I try to sneak past the guards"
2. You respond with narrative setup + roll request at end
3. Player rolls
4. THEN you narrate success/failure based on their roll

❌ WRONG: "You successfully sneak past the guards..." (before they rolled!)
❌ WRONG: "You try to sneak but the guard spots you..." (before they rolled!)
✅ RIGHT: "The guards patrol the corridor ahead. Their torchlight flickers against the stone walls..." + roll request
</roll_before_outcome>

<critical_roll_stopping_rule>
**CRITICAL: YOUR RESPONSE MUST END WITH THE ROLL REQUEST**

When you request a roll, your turn is COMPLETE. You must STOP immediately after the roll request block.

DO NOT after requesting a roll:
- Narrate what happens if they succeed or fail
- Describe the outcome conditionally ("If you succeed...")
- Assume any result and continue the story
- Add any text after the ROLL_REQUESTS_V1 block

✅ CORRECT (stop after roll request):
"The ancient wall looms before you, its stones worn smooth by centuries of rain. You'll need to find handholds carefully.

\`\`\`ROLL_REQUESTS_V1
{\"rolls\":[{\"type\": \"skill_check\", \"formula\": \"1d20+athletics\", \"purpose\": \"Athletics check to climb the wall\", \"dc\":15}]}
\`\`\`"

❌ WRONG (continues after roll request):
"The ancient wall looms before you...

\`\`\`ROLL_REQUESTS_V1
{\"rolls\":[...]}
\`\`\`

You manage to find purchase on the weathered stone and pull yourself up..."

The outcome narration happens in your NEXT response, AFTER you see the player's roll result.
</critical_roll_stopping_rule>

<npc_rolls>
You handle NPC/monster rolls "behind the screen":
✅ "The orc swings its greataxe (rolled 16, hits AC 13) dealing 12 slashing damage!"
✅ "The wizard mutters an incantation (you sense hostile magic forming)..."
</npc_rolls>

<dialogue>
<title>NPC DIALOGUE REQUIREMENTS</title>
ALL NPC speech MUST be in direct quotes with attribution:
✅ "What brings you to my tavern?" the barkeep asks, wiping a glass.
✅ The guard steps forward. "State your business, stranger."
❌ The barkeep asks what you want. (NO - use direct quotes!)
❌ The guard questions you suspiciously. (NO - show the actual words!)

Give NPCs distinct voices:
- Gruff dwarf: "Bah! What's a human doing in these tunnels?"
- Elegant elf: "How... unexpected to encounter your kind here."
- Nervous merchant: "P-perhaps we could... negotiate?"
</dialogue>

${ContextBuilder.buildCombatRulesSection()}

${ContextBuilder.buildEncounterDifficultySection()}
</rules_of_play>`;
  }

  private static buildCombatRulesSection(): string {
    return `<combat>
<title>COMBAT GUIDELINES</title>
- Request initiative when combat begins
- Request attack rolls for player actions
- Request saving throws when effects target players
- Request damage rolls after successful hits
- Handle NPC actions behind the screen
- Use D&D 5e rules: advantage/disadvantage, conditions, cover
- Describe actions cinematically with mechanical accuracy
- Include battle cries and combat dialogue in quotes

<turn_flow>
<title>CRITICAL: COMBAT TURN ORDER</title>
**Initiative order determines who acts when. NEVER give the player multiple turns in a row!**

After Player Completes Their Turn:
1. Narrate the outcome of their action (damage dealt, effects applied)
2. **IMMEDIATELY** proceed to the next combatant in initiative order (usually an NPC/enemy)
3. **DO NOT** give the player 3 options after their turn
4. **DO NOT** ask "What do you do?" during NPC turns

NPC/Enemy Turn Flow:
1. Narrate what the NPC does: "The goblin snarls and lunges at you with its rusty dagger!"
2. Execute NPC rolls automatically with autoExecute: true
3. Narrate the outcome: "The goblin's blade strikes true! (rolled 16, hits AC 14)"
4. Apply damage/effects
5. If more NPCs have turns, continue narrating their actions
6. **ONLY** when it's the player's turn again, give them options

Example CORRECT Turn Flow:
\`\`\`
Player: "I attack the goblin with my longsword"
DM: Requests attack + damage rolls
Player: Rolls
DM: "Your blade cuts deep! The goblin staggers back, bloodied. The second goblin shrieks and charges at you!"
[Auto-executes goblin attack with autoExecute: true]
DM: "The goblin's dagger slashes across your arm! You take 5 slashing damage. It's your turn. What do you do?"
[NOW give options]
\`\`\`

Example WRONG Turn Flow (DO NOT DO THIS):
\`\`\`
Player: "I attack the goblin"
DM: Requests rolls, player completes
DM: "You hit! The goblin takes 8 damage. What do you do?"
A. Attack again
B. Defend
C. Move
[WRONG - This gives player multiple turns!]
\`\`\`

**Rule: Player gets ONE action per turn, then NPCs act, then back to player. Enforce this strictly!**
</turn_flow>

<multiple_enemies>
<title>MANAGING MULTIPLE ENEMIES</title>
When combat involves multiple enemies of the same type, track them individually:

Enemy Naming:
- Use clear identifiers: "Goblin 1", "Goblin 2", "Goblin Archer", "Hobgoblin Captain"
- Keep names consistent throughout combat
- Example: "Three bandits surround you: Bandit 1 (scarred face), Bandit 2 (crossbow), Bandit 3 (leader)"

Targeting Clarity:
- When player attacks, confirm which enemy: "You strike at Goblin 1 with your longsword"
- Track HP separately for each enemy
- Narrate damage to specific enemies: "Goblin 1 staggers, bloodied (3 HP remaining)"

Enemy Turns:
- All enemies act during "enemy turn" phase
- Execute in order: "Goblin 1 attacks (autoExecute), Goblin 2 flanks and strikes (autoExecute)"
- Describe each enemy's action distinctly
- Example: "Goblin 1's dagger misses. Goblin 2 strikes true - you take 4 damage!"

Enemy Death:
- Clearly narrate when an enemy dies: "Goblin 1 falls, lifeless"
- Remove from initiative: "Two goblins remain"
- Track remaining enemies: "Goblin 2 and Goblin 3 continue fighting"
</multiple_enemies>

<death_saves>
<title>DEATH SAVING THROWS (0 HP)</title>
When a character reaches 0 HP, they fall unconscious and begin making death saving throws.

Death Save Rules (D&D 5e):
- Character is UNCONSCIOUS and can't take actions
- Each turn at 0 HP, roll a death save (d20, DC 10, no modifiers)
- Roll 10+: Success (mark 1 success)
- Roll 9 or less: Failure (mark 1 failure)
- Natural 20: Regain 1 HP instantly (wake up!)
- Natural 1: Count as 2 failures
- 3 Successes: Stabilized (unconscious but not dying)
- 3 Failures: Character DIES

Taking Damage at 0 HP:
- Any damage while at 0 HP = 1 automatic death save failure
- Critical hit while at 0 HP = 2 automatic death save failures

How to Handle:
1. When character reaches 0 HP: "You collapse, unconscious. The world fades to black. Make a death saving throw!"
2. Request death save: \`{"type": "save", "formula": "1d20", "purpose": "Death saving throw", "dc": 10}\`
3. Track results in narrative: "You rolled 14 - that's one success. Two more and you stabilize."
4. If stabilized: "You've stabilized! You're still unconscious at 0 HP, but no longer dying."
5. If healed while down: "The healing magic washes over you. You regain X HP and wake up!"
6. If 3 failures: "Your third death save fails... everything goes dark. [Character name] has died."

CRITICAL: Death is permanent in D&D. Treat it seriously. Give dramatic narration when lives hang in the balance.
</death_saves>

<healing>
<title>HEALING AND RECOVERY</title>
Healing restores hit points and can bring unconscious characters back to consciousness.

Healing Sources:
- Spells: Cure Wounds (1d8+modifier), Healing Word (1d4+modifier), Prayer of Healing (2d8+modifier)
- Potions: Potion of Healing (2d4+2), Potion of Greater Healing (4d4+4)
- Class Features: Lay on Hands (Paladin), Second Wind (Fighter)
- Short/Long Rests: Hit dice or full recovery

How to Handle Healing:
1. Player casts healing spell: Request roll for healing amount
2. Format: \`{"type": "damage", "formula": "1d8+3", "purpose": "Cure Wounds healing"}\`
3. Note: Use "damage" type for healing rolls (positive HP change)
4. Narrate: "The divine light washes over your wounds. You regain 7 hit points!"

Healing Mechanics:
- HP can't exceed maximum (cap healing at max HP)
- Healing brings unconscious characters back: "You regain 5 HP and your eyes flutter open!"
- Healing at 0 HP resets death saves to 0/0
- Healing does NOT restore temporary HP
- Healing during combat uses an action (Cure Wounds) or bonus action (Healing Word)
</healing>

<temporary_hp>
<title>TEMPORARY HIT POINTS</title>
Temporary HP provides a buffer of extra hit points that absorb damage before real HP.

Temp HP Rules (D&D 5e):
- Absorbed FIRST before real HP takes damage
- Does NOT stack - if you gain temp HP again, use the HIGHER value (not cumulative)
- Healing does NOT restore temp HP
- Temp HP lost when taking damage or after duration expires
- Can have temp HP even at full HP

How to Grant Temp HP:
1. Narrate the source: "You cast Armor of Agathys, and icy armor coats your skin."
2. State the amount: "You gain 5 temporary hit points."
3. If player already has temp HP: "You have 3 temp HP. Armor of Agathys grants 5. You keep the higher value (5 temp HP)."
</temporary_hp>

<advantage_disadvantage>
<title>ADVANTAGE AND DISADVANTAGE</title>
**When rolling with advantage or disadvantage, request TWO d20 rolls and specify which to use.**

Advantage (roll twice, take HIGHER):
- Attacking a prone enemy from melee
- Attacking a blinded, paralyzed, or restrained enemy
- Attacking an enemy you're hidden from
- Attacks from allies using Help action
- Class features (Reckless Attack, etc.)

Disadvantage (roll twice, take LOWER):
- Attacking while prone
- Attacking while blinded, poisoned, or restrained
- Ranged attacks at long range
- Attacking an enemy you can't see
- Attacks in heavy obscurement

**CRITICAL: When a player has advantage/disadvantage, request 2 d20 rolls and explicitly state "take the higher/lower"**

Advantage/Disadvantage DO NOT Stack:
- Multiple sources of advantage = still just advantage (roll 2d20, take higher)
- Multiple sources of disadvantage = still just disadvantage (roll 2d20, take lower)
- If both advantage AND disadvantage exist = CANCEL OUT (roll normal 1d20)
</advantage_disadvantage>

<critical_hits>
<title>CRITICAL HITS AND FUMBLES</title>
**Natural 20 on attack roll = AUTOMATIC HIT + DOUBLE DAMAGE DICE**

Critical Hit Process:
1. Player rolls natural 20 on attack roll
2. Attack automatically hits (no need to check AC)
3. Request damage roll with DOUBLED DICE (not doubled total)
4. Example: Longsword (1d8+3) becomes 2d8+3 on crit (NOT (1d8+3)×2)

Correct Crit Damage Examples:
- Longsword (1d8+3) → **2d8+3** on crit
- Greatsword (2d6+4) → **4d6+4** on crit
- Sneak Attack (1d8+3+2d6) → **2d8+3+4d6** on crit (ALL damage dice double)
- Spell (3d6 fire) → **6d6 fire** on crit

Natural 1 (Critical Fumble):
- Automatic MISS (regardless of bonuses)
- No additional penalties unless specific house rules
</critical_hits>

<combat_conditions>
<title>COMBAT CONDITIONS AND STATUS EFFECTS</title>
**Track conditions that affect combat capabilities. Conditions alter rolls and abilities.**

Common Conditions:

**Blinded:**
- Attack rolls: DISADVANTAGE
- Enemy attacks against you: ADVANTAGE
- Can't see (auto-fail Perception checks requiring sight)

**Frightened:**
- Ability checks and attacks: DISADVANTAGE (while source is in sight)
- Can't willingly move closer to source

**Grappled:**
- Speed becomes 0
- Can't benefit from bonuses to speed

**Paralyzed:**
- Incapacitated (can't move or speak)
- Auto-fail Strength and Dexterity saves
- Attacks against you: ADVANTAGE
- Hits from within 5ft: AUTOMATIC CRITICAL

**Poisoned:**
- Attack rolls: DISADVANTAGE
- Ability checks: DISADVANTAGE

**Prone:**
- Attack rolls: DISADVANTAGE
- Enemy melee attacks against you: ADVANTAGE
- Enemy ranged attacks against you: DISADVANTAGE
- Costs half movement to stand up

**Restrained:**
- Speed becomes 0
- Attack rolls: DISADVANTAGE
- Attacks against you: ADVANTAGE
- Dexterity saves: DISADVANTAGE

**Stunned:**
- Incapacitated (can't move)
- Auto-fail Strength and Dexterity saves
- Attacks against you: ADVANTAGE

**Unconscious:**
- Incapacitated, can't move or speak
- Drops everything held
- Auto-fail Strength and Dexterity saves
- Attacks against you: ADVANTAGE
- Hits from within 5ft: AUTOMATIC CRITICAL
</combat_conditions>

<action_economy>
<title>ACTION ECONOMY IN COMBAT</title>
**Each turn, a character gets: 1 ACTION + 1 BONUS ACTION + 1 REACTION + MOVEMENT**

ACTION (choose ONE per turn):
- Attack (one weapon attack, or multiple if character has Extra Attack)
- Cast a Spell (with casting time of 1 action)
- Dash (double movement)
- Disengage (move without provoking opportunity attacks)
- Dodge (attacks against you have disadvantage until next turn)
- Help (give ally advantage on next ability check or attack)
- Hide (make Stealth check)
- Ready (prepare action for specific trigger)
- Use Object (interact with object/environment)

BONUS ACTION:
- NOT automatic - only if class feature, spell, or ability grants it
- Examples: Two-Weapon Fighting, Cunning Action (rogue), bonus action spells
- **CRITICAL: Can't use bonus action unless something specifically grants it**

REACTION (1 per round, triggers on someone else's turn):
- Opportunity Attack (when enemy leaves your reach)
- Spells like Shield, Counterspell, Absorb Elements
- **CRITICAL: Resets at START of your turn, not end of round**

MOVEMENT:
- Can move up to your speed (usually 30ft)
- Can split movement (move 10ft, attack, move 20ft more)
- Difficult terrain costs 2ft per 1ft moved
- Standing from prone costs HALF your movement

**CRITICAL RULES:**
1. Players can ONLY use bonus action if they have a feature that grants it
2. Reactions reset at the START of their turn, usable once per round
3. Movement can be split before/after actions
4. Can't take two actions - no "I attack twice with my action" unless Extra Attack feature
5. Bonus action spell + action spell = ONLY if one is a cantrip (PHB spellcasting rules)
</action_economy>

</combat>`;
  }

  private static buildEncounterDifficultySection(): string {
    return `<encounter_difficulty>
<title>CRITICAL: ENCOUNTER SCALING BY CHARACTER LEVEL</title>
**ALWAYS match enemy difficulty to character level to prevent instant death!**

Character Level 1-2 (8-20 HP):
- Use CR 1/8 to CR 1/2 enemies ONLY (goblins, kobolds, bandits, wolves)
- Max enemy damage: 1d6+2 (avg 5 damage)
- Deadly encounter: 2-3 CR 1/4 enemies or 1 CR 1/2 enemy

Character Level 3-4 (20-35 HP):
- Use CR 1/2 to CR 2 enemies (orcs, hobgoblins, ogres, werewolves)
- Max enemy damage: 2d6+3 (avg 10 damage)

Character Level 5-8 (35-60 HP):
- Use CR 2 to CR 5 enemies (young dragons, elementals, trolls)
- Max enemy damage: 2d10+4 (avg 15 damage)

Character Level 9+ (60+ HP):
- Use CR 5+ enemies (adult dragons, giants, liches)
- Can use higher damage (3d10+, 4d8+, etc.)

**CRITICAL RULES:**
1. NEVER use enemies with damage that exceeds 50% of character's max HP in one hit
2. Level 1 characters (8-12 HP) should NEVER face enemies dealing 10+ damage
3. Always check character level before introducing combat
4. For solo adventurers: use 1-2 enemies max, scaled DOWN one difficulty tier
5. If unsure, err on the side of easier encounters - TPK (Total Party Kill) ruins the game!
</encounter_difficulty>`;
  }

  private static async buildGameContextSection(
    context: GameContext,
    relevantMemories: Memory[]
  ): Promise<string> {
    let section = `<game_context>`;

    if (context.campaignDetails) {
      section += `<campaign_details>
CAMPAIGN: "${context.campaignDetails.name}"
DESCRIPTION: ${context.campaignDetails.description}
</campaign_details>`;
    }

    // Lore handling (Async)
    let starterCampaignId = context.starterCampaignId;

    // Fallback: if no starterCampaignId but campaign name matches a starter campaign
    if (!starterCampaignId && context.campaignDetails?.name) {
      const campaignName = String(context.campaignDetails.name).toLowerCase().trim();
      const nameToSlug: Record<string, string> = {
        'the eternal feast': 'the-eternal-feast',
        'eternal feast': 'the-eternal-feast',
        'abyssal descent': 'abyssal-descent',
        'academy of arcane gastronomy': 'academy-of-arcane-gastronomy',
        'the academy of arcane gastronomy': 'academy-of-arcane-gastronomy',
      };
      starterCampaignId = nameToSlug[campaignName];
      if (starterCampaignId) {
        logger.info(`[ContextBuilder] Inferred starter campaign '${starterCampaignId}' from campaign name`);
      }
    }

    if (starterCampaignId) {
      try {
        const loreKeeper = getLoreKeeperService();
        const [campaignOverview, campaignRules, campaignAssets, campaignEntities] = await Promise.all([
          loreKeeper.getCampaignOverview(starterCampaignId),
          loreKeeper.getRules(starterCampaignId),
          fetchCampaignAssetsForPrompt(starterCampaignId),
          loreKeeper.getEntities(starterCampaignId),
        ]);

        if (campaignOverview) {
          section += `
<starter_campaign_lore>
<canonical_setting>
TITLE: ${campaignOverview.title}
PREMISE: ${campaignOverview.premise || 'A mysterious adventure awaits.'}
OVERVIEW: ${campaignOverview.overview || ''}
</canonical_setting>

<creative_direction>
${campaignOverview.creativeBrief || 'Maintain an immersive, atmospheric tone.'}
</creative_direction>`;

          if (campaignRules && campaignRules.length > 0) {
            section += `
<world_rules>
These rules govern how the world responds to player actions:
${campaignRules.map((rule: any) => `- ${rule.condition} → ${rule.effect}${rule.reversible ? ' (reversible)' : ''}`).join('\n')}
</world_rules>`;
          }

          const { npcs, locations, factions, monsters } = campaignEntities;
          const totalEntities = npcs.length + locations.length + factions.length + monsters.length;

          if (totalEntities > 0) {
            section += `

<canonical_entities>
<instruction>These are the OFFICIAL NPCs, locations, and creatures for this campaign. USE THESE EXACT NAMES. Do NOT invent new NPCs when these exist.</instruction>`;

            if (npcs.length > 0) {
              section += `

<npcs count="${npcs.length}">
${npcs.map((npc: any) => {
  const hasImage = !!npc.metadata?.image_url;
  const assetKey = npc.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
  const assetTag = hasImage ? `[ASSET:npc:${assetKey}]` : '';
  return `<npc name="${npc.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${npc.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when introducing this character**` : ''}
</npc>`;
}).join('\n')}
</npcs>`;
            }

            if (locations.length > 0) {
              section += `

<locations count="${locations.length}">
${locations.map((loc: any) => {
  const hasImage = !!loc.metadata?.image_url;
  const assetKey = loc.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
  const assetTag = hasImage ? `[ASSET:location:${assetKey}]` : '';
  return `<location name="${loc.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${loc.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when the party enters or views this location**` : ''}
</location>`;
}).join('\n')}
</locations>`;
            }

            if (factions.length > 0) {
              section += `

<factions count="${factions.length}">
${factions.map((f: any) => `<faction name="${f.entityName}">
${f.content}
</faction>`).join('\n')}
</factions>`;
            }

            if (monsters.length > 0) {
              section += `

<monsters count="${monsters.length}">
${monsters.map((m: any) => {
  const hasImage = !!m.metadata?.image_url;
  const assetKey = m.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
  const assetTag = hasImage ? `[ASSET:monster:${assetKey}]` : '';
  return `<monster name="${m.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${m.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when this creature appears or attacks**` : ''}
</monster>`;
}).join('\n')}
</monsters>`;
            }

            section += `
</canonical_entities>`;
          }

          section += `

<lore_adherence>
- USE the canonical NPCs listed above - do NOT invent new characters when these exist
- When introducing an NPC from the list, use their EXACT name
- Reference canonical locations and describe them as specified
- Apply world rules consistently
- **CRITICAL: Include the asset_tag shown for any entity with a portrait/image when you first mention them**
- Asset tags like [ASSET:npc:headmaster] display the entity's artwork to the player
</lore_adherence>
</starter_campaign_lore>`;

          if (campaignAssets) {
            section += campaignAssets;
          }
        }
      } catch (loreError) {
        logger.warn('[ContextBuilder] Failed to fetch starter campaign lore:', loreError);
      }
    }

    if (context.characterDetails) {
      section += ContextBuilder.buildCharacterSection(context.characterDetails);
    }

    if (relevantMemories.length > 0) {
      section += `
<story_memories>
<title>IMPORTANT STORY MEMORIES</title>
Reference these memories naturally to maintain story continuity.`;
      relevantMemories.forEach((memory, index) => {
        section += `
<memory index="${index + 1}" type="${memory.type.toUpperCase()}">${memory.content}</memory>`;
      });
      section += `
</story_memories>`;
    }

    section += `</game_context>`;
    return section;
  }

  private static buildCharacterSection(char: Record<string, any>): string {
    let section = `<character_details>
PLAYER CHARACTER: ${char.name}, a level ${char.level} ${char.race || 'Unknown Race'} ${char.class?.name || char.class || 'Unknown Class'}`;

    if (char.background) {
      section += ` (${char.background} background)`;
    }

    if (char.character_stats && char.character_stats.length > 0) {
      const stats = char.character_stats[0];
      const calcMod = (score: number = 10) => {
        const mod = Math.floor((score - 10) / 2);
        return mod >= 0 ? `+${mod}` : `${mod}`;
      };

      section += `
<ability_scores>
STR ${stats.strength}(${calcMod(stats.strength)}), DEX ${stats.dexterity}(${calcMod(stats.dexterity)}), CON ${stats.constitution}(${calcMod(stats.constitution)}), INT ${stats.intelligence}(${calcMod(stats.intelligence)}), WIS ${stats.wisdom}(${calcMod(stats.wisdom)}), CHA ${stats.charisma}(${calcMod(stats.charisma)})
</ability_scores>`;

      const profBonus = char.level >= 17 ? 6 : char.level >= 13 ? 5 : char.level >= 9 ? 4 : char.level >= 5 ? 3 : 2;
      section += `
<proficiency_bonus>+${profBonus}</proficiency_bonus>`;
    }

    const className = char.class?.name || char.class;
    const classEquipment = getClassEquipment(className || 'Fighter');
    section += `
<equipment>
${classEquipment.weapons.join(', ')} | ${classEquipment.armor}
**CRITICAL: USE EXACT WEAPON DICE from equipment list above for damage roll requests!**
</equipment>`;

    try {
      const characterForPassive = convertCharacterDetailsToCharacter(char as any);
      const passiveScores = getCharacterPassiveScores(characterForPassive);
      section += `

<passive_skills>
**D&D 5E PASSIVE SKILLS (Automatic Checks)**
Passive Perception: ${passiveScores.perception} (notices hidden objects, creatures, traps without rolling)
Passive Insight: ${passiveScores.insight} (senses deception, motives, emotional states automatically)
Passive Investigation: ${passiveScores.investigation} (spots clues, patterns, logical inconsistencies passively)

**DM GUIDANCE: Use these passive scores to proactively reveal information:**
- If a scene has hidden elements with DC ≤ passive score, reveal them automatically
- Example: "Your keen awareness (Passive Perception ${passiveScores.perception}) notices subtle scuff marks on the floor"
- Reserve active checks (d20 rolls) for deliberate investigation or difficult perception tasks
</passive_skills>`;
    } catch (passiveSkillError) {
      logger.warn(`[ContextBuilder] Failed to calculate passive skills for character ${char.name} (non-fatal):`, passiveSkillError);
    }

    section += `
</character_details>`;
    return section;
  }

  private static buildOpeningSceneSection(): string {
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

  private static formatCombatContext(combatDetection: CombatDetectionResult): string {
    if (!combatDetection.isCombat) return '';

    let combatText = `\n\nCOMBAT CONTEXT DETECTED:
Combat Type: ${combatDetection.combatType}
Confidence: ${Math.round(combatDetection.confidence * 100)}%
Should Start Combat: ${combatDetection.shouldStartCombat ? 'YES' : 'NO'}
Should End Combat: ${combatDetection.shouldEndCombat ? 'YES' : 'NO'}`;

    if (combatDetection.enemies && combatDetection.enemies.length > 0) {
      combatText += `

DETECTED ENEMIES:`;
      combatDetection.enemies.forEach((enemy: DetectedEnemy) => {
        combatText += `
- ${enemy.name} (${enemy.type}, CR ${enemy.estimatedCR})
  HP: ${enemy.suggestedHP}, AC: ${enemy.suggestedAC}
  Description: ${enemy.description}`;
      });
    }

    if (combatDetection.combatActions && combatDetection.combatActions.length > 0) {
      combatText += `

DETECTED COMBAT ACTIONS:`;
      combatDetection.combatActions.forEach((action: DetectedCombatAction) => {
        combatText += `
- ${action.actor} performs ${action.action}${action.target ? ` against ${action.target}` : ''}${action.weapon ? ` with ${action.weapon}` : ''}
  Roll Type: ${action.rollType}, Needs Roll: ${action.rollNeeded ? 'YES' : 'NO'}`;
      });
    }

    combatText += `

**COMBAT RESPONSE REQUIREMENTS:**
When combat is detected, you MUST:
1. **REQUEST** dice rolls for player actions using ROLL_REQUESTS_V1 (DO NOT roll for the player)
2. **AUTO-EXECUTE** NPC/enemy actions by marking rolls with "autoExecute": true
3. **DESCRIBE** actions cinematically while maintaining mechanical accuracy
4. **ENFORCE** turn order (player turn, then all NPCs, then player again)
`;

    return combatText;
  }

  private static buildCombatRollRequirementsSection(): string {
    return `
<combat_roll_requirements>
For ALL combat actions, you must include proper ROLL_REQUESTS_V1 blocks.
Attack: \\\`{"type": "attack", "formula": "1d20+mod", "purpose": "Attack with weapon", "ac": 15}\\\`
Damage: \\\`{"type": "damage", "formula": "1d8+mod", "purpose": "Weapon damage"}\\\`
Save: \\\`{"type": "save", "formula": "1d20+mod", "purpose": "Save vs effect", "dc": 14}\\\`
</combat_roll_requirements>`;
  }

  private static buildVoiceOptimizationSection(): string {
    return `
<voice_optimization>
Your response will be synthesized into voice. Structure your narration into logical segments.
</voice_optimization>`;
  }

  private static buildResponseStructureSection(): string {
    return `
<response_structure>
Maintain a consistent and immersive structure in your responses.
</response_structure>`;
  }

  private static buildFinalRemindersSection(): string {
    return `
<final_reminders>
Remember to stay in character and follow all D&D 5e rules.
</final_reminders>`;
  }
}