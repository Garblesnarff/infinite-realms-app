import type {
  CombatDetectionResult,
  DetectedEnemy,
  DetectedCombatAction,
} from '@/utils/combatDetection';

export class CombatRulesPrompts {
  static buildCombatRulesSection(): string {
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
2. Add to \`roll_requests\`: \`{"type": "save", "formula": "1d20", "purpose": "Death saving throw", "dc": 10, "ac": null, "advantage": false, "disadvantage": false}\`
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
2. Add to \`roll_requests\`: \`{"type": "damage", "formula": "1d8+3", "purpose": "Cure Wounds healing", "dc": null, "ac": null, "advantage": false, "disadvantage": false}\`
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

  static buildEncounterDifficultySection(): string {
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

  static formatCombatContext(combatDetection: CombatDetectionResult): string {
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
1. **REQUEST** dice rolls for player actions via the \`roll_requests\` array field (DO NOT roll for the player)
2. **AUTO-EXECUTE** NPC/enemy actions and narrate them behind the screen (do not put NPC rolls in \`roll_requests\`, which is player-facing only)
3. **DESCRIBE** actions cinematically while maintaining mechanical accuracy
4. **ENFORCE** turn order (player turn, then all NPCs, then player again)
`;

    return combatText;
  }

  /**
   * Combat-only. The tactical digest is the single source of geometry, and the server
   * rejects an attack the board does not allow, so this section states the same contract
   * the validator enforces.
   */
  static buildSpatialTurnContractSection(): string {
    return `
<spatial_turn_contract>
<title>MANDATORY: SPATIAL COHERENCE ON EVERY COMBAT TURN</title>
Every combatant's turn must match the tactical digest: a melee attack requires the attacker within
5ft of its target, so when the digest shows more distance you MUST emit a \`map_actions\` move that
closes the gap (never more than that entity's movementRemaining) before or instead of attacking.
Ranged attacks and spells require line of sight in the digest and take the listed cover into account,
and monsters move on their own turns through \`map_actions\` too - prose movement changes nothing.

Worked example - digest line \`void-maw|Void-Maw@2,3 mv30/30 vs[seeker:30ft/LoS/c0/range]\`, Void-Maw's turn
(move 25ft to close, then attack in the same turn):
\`map_actions\`: \`[{"action":"move","entityId":"void-maw","x":5,"y":6,"changes":null}]\`
\`combat_actions\`: \`[{"actor_id":"void-maw","action_type":"attack","target_ids":["seeker"],"weapon_id":null,"spell_id":null,"slot_level":null,"movement_feet":25}]\`
</spatial_turn_contract>`;
  }

  static buildCombatRollRequirementsSection(): string {
    return `
<combat_roll_requirements>
For ALL player-facing combat actions, add an entry to the \`roll_requests\` array field of your
JSON response (not a text block). Each entry needs type/formula/purpose/dc/ac/advantage/disadvantage:
Attack: \\\`{"type": "attack", "formula": "1d20+mod", "purpose": "Attack with weapon", "dc": null, "ac": 15, "advantage": false, "disadvantage": false}\\\`
Damage: \\\`{"type": "damage", "formula": "1d8+mod", "purpose": "Weapon damage", "dc": null, "ac": null, "advantage": false, "disadvantage": false}\\\`
Save: \\\`{"type": "save", "formula": "1d20+mod", "purpose": "Save vs effect", "dc": 14, "ac": null, "advantage": false, "disadvantage": false}\\\`
NPC/enemy rolls are handled behind the screen in your narration - do NOT add them to \`roll_requests\`, which is for the player only.
</combat_roll_requirements>`;
  }
}
