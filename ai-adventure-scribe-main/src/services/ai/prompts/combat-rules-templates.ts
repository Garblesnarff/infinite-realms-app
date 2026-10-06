/* eslint-disable max-lines */
/**
 * Combat Rules Prompt Templates
 *
 * XML-style prompt block templates extracted from combat-rules-prompts.ts for modularity.
 */

export const COMBAT_RULES_TEMPLATE = `<combat>
<title>COMBAT GUIDELINES</title>
- Request initiative when combat begins
- Declare the current player's attack in \`roll_requests\` as a \`"type": "attack"\` entry naming
  both sides, or in \`combat_actions\` if you prefer to name ids in their own fields. Either way
  the engine moves the attacker into reach, rolls it against the target's cover-adjusted AC, and
  applies the damage. You never roll it and never write its result.
- Request saving throws when effects target players
- NPC turns are already resolved by the engine before the player's declaration. Never emit an NPC
  or monster \`combat_actions\` entry; narrate only the authoritative engine result supplied.
- An attack that appears only in your narration is an attack that never happened
- Use D&D 5e rules: advantage/disadvantage, conditions, cover
- Describe actions cinematically with mechanical accuracy
- Include battle cries and combat dialogue in quotes

<hit_point_narration>
<title>CRITICAL: NEVER NARRATE NUMERIC HIT POINTS</title>
Hit points are private engine/UI state. Never state a creature's numeric current HP, maximum HP,
remaining HP, healing amount, or hit-point total in player-facing narration. Do not repeat a
number from the engine, tactical digest, or a roll result as an HP value.

Describe condition only with these tiers: **unharmed**, **wounded**, **bloodied**, or **near death**.
Use the authoritative condition supplied by the engine when one is available; do not calculate or
invent a tier from prose. Say "The goblin staggers, bloodied" or "The healing steadies you; you
look wounded," never "3 HP remaining" or "you regain 7 hit points."

This rule applies to PCs and NPCs, damage and healing, and temporary hit points. Numeric HP may
remain an internal mechanic, but it must never appear in the DM's narration or dialogue.
</hit_point_narration>

<turn_flow> <!-- INTENTIONAL_ELICITATION_DIALECT -->
<title>CRITICAL: COMBAT TURN ORDER</title>
**Initiative order determines who acts when. NEVER give the player multiple turns in a row!**

Before a player declaration:
1. The client asks the engine to resolve every NPC currently holding the board
2. The DM is called only after the current participant is the player
3. Declare only the player's action; NPC actions are never model-authored on this path
4. Narrate the supplied \`<engine_resolved_outcomes>\` for the NPC turns before the player's result
5. **ONLY** when it is the player's turn again, give them options

Example CORRECT Turn Flow:
\`\`\`
Player: "I attack the goblin with my longsword"
DM: text sets the swing up; \`roll_requests\`: [{"type":"attack","formula":"1d20","purpose":"the-seeker attacks goblin-1 with longsword","dc":null,"ac":null,"advantage":false,"disadvantage":false}]
Engine: resolves the attack, applies damage, reports it back
Engine: resolves NPC turns automatically and reports them in \`<engine_resolved_outcomes>\`
DM: (next turn, narrating those authoritative results) "The goblin's dagger slashes across your arm! It's your turn. What do you do?"
[NOW give options]
\`\`\`

Example WRONG Turn Flow (DO NOT DO THIS):
\`\`\`
Player: "I attack the goblin"
DM: "You hit! The goblin takes 8 damage. What do you do?"
     \`roll_requests\`: [], \`combat_actions\`: []
[WRONG - the attack was declared nowhere, so the engine never rolled it, the goblin took no
damage, and those numbers came from nothing. It also gives the player two turns in a row.]
\`\`\`

**Rule: Player gets ONE action per turn. The engine then resolves NPCs before the next player declaration.**
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
- Narrate damage to specific enemies with a condition tier only: "Goblin 1 staggers, bloodied"

Enemy Turns:
- All enemies act during "enemy turn" phase
- The engine declares and resolves each one in initiative order before the next player declaration
- Narrate each authoritative enemy result distinctly; never emit an NPC \`combat_actions\` entry

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
1. When the engine reports the character is down: "You collapse, unconscious. The world fades to black. Make a death saving throw!"
2. Add to \`roll_requests\`: \`{"type": "save", "formula": "1d20", "purpose": "Death saving throw", "dc": 10, "ac": null, "advantage": false, "disadvantage": false}\`
3. Track results in narrative: "You rolled 14 - that's one success. Two more and you stabilize."
4. If stabilized: "You've stabilized! You're still unconscious, but no longer dying."
5. If healed while down: "The healing magic washes over you. Your eyes flutter open!"
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
4. Narrate the condition change without a number: "The divine light washes over your wounds. You look less battered."

Healing Mechanics:
- HP can't exceed maximum (cap healing at max HP)
- Healing brings unconscious characters back: "The healing brings you back from near death, and your eyes flutter open!"
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
2. Describe the temporary buffer without stating its numeric amount.
3. If the player already has temporary hit points, keep the stronger buffer without mentioning either numeric value.
</temporary_hp>

<advantage_disadvantage>
<title>ADVANTAGE AND DISADVANTAGE</title>
**Advantage and disadvantage on an attack are applied by the engine.** Set \`advantage\`/
\`disadvantage\` on a \`roll_requests\` entry only for saves and ability checks; for attacks,
the conditions below are read off the board and applied when the attack is resolved.

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

**CRITICAL: On a save or ability check, set the \`advantage\`/\`disadvantage\` flag on the roll
request - never ask for two separate d20 rolls.**

Advantage/Disadvantage DO NOT Stack:
- Multiple sources of advantage = still just advantage (roll 2d20, take higher)
- Multiple sources of disadvantage = still just disadvantage (roll 2d20, take lower)
- If both advantage AND disadvantage exist = CANCEL OUT (roll normal 1d20)
</advantage_disadvantage>

<critical_hits>
<title>CRITICAL HITS AND FUMBLES</title>
**Natural 20 on attack roll = AUTOMATIC HIT + DOUBLE DAMAGE DICE**

Critical Hit Process (the engine performs all of it; this is so your narration matches):
1. A natural 20 on the attack roll automatically hits
2. The damage dice are DOUBLED (not the total): Longsword (1d8+3) becomes 2d8+3, NOT (1d8+3)×2
3. You narrate the crit the engine reports - you never request the damage roll yourself

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

/** Replaces the one occurrence of `from` with `to`; throws if it is absent or repeated, so a template edit cannot silently orphan a variant. */
const swapText = (source: string, from: string, to: string): string => {
  if (source.split(from).length !== 2)
    throw new Error(`combat-rules-templates: text not found exactly once: ${from.slice(0, 60)}`);
  return source.replace(from, to);
};

/**
 * COMBAT_RULES_TEMPLATE as sent while combat is active (#2400). The engine resolves attacks, spells
 * and saves there and the client drops every DM roll_request (#2385), so the template must not
 * teach one. The out-of-combat template above is unchanged.
 */
export const COMBAT_RULES_IN_COMBAT_TEMPLATE = [
  [
    `- Request initiative when combat begins
- Declare the current player's attack in \`roll_requests\` as a \`"type": "attack"\` entry naming
  both sides, or in \`combat_actions\` if you prefer to name ids in their own fields. Either way
  the engine moves the attacker into reach, rolls it against the target's cover-adjusted AC, and
  applies the damage. You never roll it and never write its result.
- Request saving throws when effects target players
`,
    `- Initiative is already set and every saving throw is the engine's; do not request rolls
- Declare the current player's attack in \`combat_actions\` with \`actor_id\` and \`target_ids\`. The
  engine moves the attacker into reach, rolls it against the target's cover-adjusted AC, and
  applies the damage. You never roll it and never write its result.
`,
  ],
  [
    `DM: text sets the swing up; \`roll_requests\`: [{"type":"attack","formula":"1d20","purpose":"the-seeker attacks goblin-1 with longsword","dc":null,"ac":null,"advantage":false,"disadvantage":false}]`,
    `DM: text sets the swing up; \`combat_actions\`: [{"actor_id":"the-seeker","action_type":"attack","target_ids":["goblin-1"],"weapon_id":null,"spell_id":null,"slot_level":null,"movement_feet":0}]`,
  ],
  [`     \`roll_requests\`: [], \`combat_actions\`: []`, `     \`combat_actions\`: []`],
  [` Make a death saving throw!"`, `"`],
  [
    `- Each turn at 0 HP, roll a death save (d20, DC 10, no modifiers)`,
    `- Each turn at 0 HP, the player rolls a death save (d20, DC 10, no modifiers) through the engine's prompt, once per turn; the turn ends with it`,
  ],
  [
    `- Critical hit while at 0 HP = 2 automatic death save failures
`,
    `- Critical hit while at 0 HP = 2 automatic death save failures
- A melee blow within 5 feet of an unconscious character is an automatic critical hit (2 failures)
- Damage that drops a character to 0 with the overflow at or above their hit point maximum kills them outright: no dying phase

Monsters and a downed character (the engine enforces the consequences; you narrate the choice):
- A hostile already in melee with a downed character keeps attacking them unless the campaign bible says otherwise: a creature that feeds may keep feeding, a guard may drag them to a cell, a pack may move on. Never invent a blow the engine did not report.
- The round that kills a character always gets a narration paragraph: the engine's DEAD line is the biggest beat of the run.
`,
  ],
  [
    `2. Add to \`roll_requests\`: \`{"type": "save", "formula": "1d20", "purpose": "Death saving throw", "dc": 10, "ac": null, "advantage": false, "disadvantage": false}\`
3. Track results in narrative: "You rolled 14 - that's one success. Two more and you stabilize."`,
    `2. Do not request the death save; the player rolls it on their turn and the engine reports it in \`<engine_resolved_outcomes>\`
3. Narrate the result the engine reports: "That's one success. Two more and you stabilize."`,
  ],
  [
    `1. Player casts healing spell: Request roll for healing amount
2. Add to \`roll_requests\`: \`{"type": "damage", "formula": "1d8+3", "purpose": "Cure Wounds healing", "dc": null, "ac": null, "advantage": false, "disadvantage": false}\`
3. Note: Use "damage" type for healing rolls (positive HP change)
4. Narrate`,
    `1. Player casts a healing spell: the engine rolls and applies the healing; do not request a roll
2. Narrate`,
  ],
  [
    `**Advantage and disadvantage on an attack are applied by the engine.** Set \`advantage\`/
\`disadvantage\` on a \`roll_requests\` entry only for saves and ability checks; for attacks,
the conditions below are read off the board and applied when the attack is resolved.`,
    `**Advantage and disadvantage on an attack are applied by the engine.** The conditions below are
read off the board and applied when the attack is resolved; you request nothing.`,
  ],
  [
    `**CRITICAL: On a save or ability check, set the \`advantage\`/\`disadvantage\` flag on the roll
request - never ask for two separate d20 rolls.**

`,
    ``,
  ],
].reduce((text, [from, to]) => swapText(text, from, to), COMBAT_RULES_TEMPLATE);

export const ENCOUNTER_DIFFICULTY_TEMPLATE = `<encounter_difficulty>
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

/*
 * INTENTIONAL: this is the elicitation dialect, and in combat it is `combat_actions` only.
 *
 * The engine resolves attacks, spells and saves in combat. Since #2385 the client drops every DM `roll_request`
 * while an encounter is active, whatever its type, so a prompt that still taught attacks, saves
 * or checks as roll requests taught the DM to ask for rolls that never happen (run 16: attack
 * rolls for a save spell). Do not remove the worked `combat_actions` example below: run 9's
 * model, left with no worked declaration anywhere in the prompt, stopped declaring attacks
 * altogether and narrated twenty-three of them in pure prose.
 *
 * Outside combat the prompt is unchanged and still teaches roll_requests; every other section
 * that ships in combat has a combat-only variant (#2400).
 */
export const COMBAT_ROLL_REQUIREMENTS_TEMPLATE = `
<combat_roll_requirements> <!-- INTENTIONAL_ELICITATION_DIALECT -->
While combat is active, the engine resolves attacks, spells and saves, and applies the damage. Do not
request rolls, and never write an outcome - the engine resolves each action and reports back in \`<engine_resolved_outcomes>\` on your next turn.
Return \`"roll_requests": []\` for every combat response.

You declare actions. Declare the current player's attack as a \`combat_actions\` entry, naming
BOTH sides with ids copied verbatim from the tactical digest. The engine walks the attacker into
reach, rolls against the target's cover-adjusted AC and applies
the damage; you supply no \`ac\` or \`dc\`, and you do not emit a move to close the distance first.
Attack: \`{"actor_id": "the-seeker", "action_type": "attack", "target_ids": ["shadow-roach-1"], "weapon_id": null, "spell_id": null, "slot_level": null, "movement_feet": 0}\`
Each entry needs actor_id/action_type/target_ids/weapon_id/spell_id/slot_level/movement_feet, in the
\`combat_actions\` array field of your JSON response - never a text block. NPC/enemy turns are already
resolved behind the screen by the engine before the player's declaration; actions in this response
must belong to the current player only. Never emit or repair an NPC \`combat_actions\` entry.

What does NOT work is narrating a swing in \`text\` and declaring nothing: an action that appears in
\`combat_actions\` is the only action the engine rolls, and the creature you described striking
takes no damage from an action that appears nowhere.
</combat_roll_requirements>`;
