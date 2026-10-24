/* eslint-disable @typescript-eslint/no-explicit-any */
import { abilityModifier } from '../../../../shared/ability-modifier';
import { proficiencyBonus } from '../../../../shared/proficiency-bonus';
import { getCharacterPassiveScores } from '../../passive-skills-service';

import type { EquippedLoadout } from '@/services/user-data-api';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { convertCharacterDetailsToCharacter } from '@/utils/character-converter';

/**
 * CharacterContextPrompts - Handles building the character and equipment sections of the prompt.
 * Extracted from game-context-prompts.ts
 */
export class CharacterContextPrompts {
  /**
   * Renders the character's equipment from the sheet.
   *
   * This block used to be generated from a table of class defaults, so a ranger who had sold
   * her longsword and was carrying a longbow was described to the DM as holding a longsword in
   * studded leather, with damage dice and an AC nobody had ever rolled. The DM then narrated
   * attacks with weapons the character did not own, which the engine either refused or
   * silently substituted. Everything here comes from `inventory_items` + `character_equipment`
   * (equipped=true) via the same resolver the attack engine uses, and the AC is the sheet's own.
   */
  public static async buildEquipmentSection(char: Record<string, any>): Promise<string> {
    const characterId = typeof char.id === 'string' ? char.id : null;
    const armorClass = char.character_stats?.[0]?.armor_class;

    let loadout: EquippedLoadout | null = null;
    if (characterId) {
      try {
        loadout = await userDataApi.getCharacterLoadout(characterId);
      } catch (loadoutError) {
        logger.warn(
          `[ContextBuilder] Failed to load equipped gear for character ${char.name}:`,
          loadoutError,
        );
      }
    }

    // No sheet to read means no numbers to state. Saying so is better than inventing a
    // loadout: the DM can ask, and the engine stays the only thing that rolls damage.
    if (!loadout) {
      return `
<equipment>
UNKNOWN — the character's equipment could not be read from their sheet.
Do not name specific weapons, damage dice, or armour class. Describe attacks in the fiction and
let the engine resolve them.
</equipment>`;
    }

    const weapons = loadout.weapons.map((weapon) => {
      const bonus = weapon.magicBonus ? ` +${weapon.magicBonus}` : '';
      const reach = weapon.ranged
        ? `range ${weapon.normalRange}/${weapon.longRange ?? weapon.normalRange} ft`
        : `reach ${weapon.normalRange} ft`;
      return `${weapon.name}${bonus} (${weapon.damageDice} ${weapon.damageType}, ${reach})`;
    });

    const armorText = loadout.armor.length > 0 ? loadout.armor.join(', ') : 'No armour equipped';
    const carriedItems = loadout.carriedItems ?? [];
    const carriedText =
      carriedItems.length > 0
        ? carriedItems
            .map(
              (item) =>
                `${item.name} x${item.quantity} (${item.itemType}, ${item.equipped ? 'equipped' : 'carried'})`,
            )
            .join(' | ')
        : 'None recorded';
    const carriedGuidance =
      carriedItems.length > 0
        ? `
**These are the character's real items; never name a weapon outside this list.**
**Do not say a carried item is absent; use the typed draw/equip engine path first.**`
        : '';
    const acText =
      typeof armorClass === 'number'
        ? `AC ${armorClass}`
        : typeof loadout.armorClass === 'number'
          ? `AC ${loadout.armorClass}`
          : 'AC unknown';

    return `
<equipment>
EQUIPPED WEAPONS: ${weapons.length > 0 ? weapons.join(' | ') : 'None — unarmed strike (1d1 bludgeoning, reach 5 ft)'}
ARMOR: ${armorText} | ${acText}
 CARRIED ITEMS: ${carriedText}
${carriedGuidance}
**USE EXACT WEAPON DICE from this list for damage roll requests.**
</equipment>`;
  }

  /**
   * Renders the character's real class features and spells from the sheet (#217).
   *
   * The equipment block above is built from the sheet, but until now nothing in the prompt
   * named a feature or a spell, so the DM ruled from its mood: a level-1 Fighter's Action
   * Surge went through in one session and a Rogue's Mage Hand was refused in another. The
   * lists come from the session context payload: the spell lists are the union the
   * gate reads (the sheet's columns merged with its `character_spells` rows,
   * comma-separated text, or an array from the other producers), and `featureNames` is
   * the server's list for the character's class and level — the same membership the
   * server-side gate enforces after the turn. `featureNames` is null when the server
   * cannot vouch for the list (multiclass, classless, a class the feature library does
   * not cover): then no feature claim is made at all. An empty payload renders
   * nothing: a list we do not have must never read as a list of nothing.
   */
  public static buildFeaturesAndSpellsSection(char: Record<string, any>): string {
    const nameList = (value: unknown): string[] => {
      const raw =
        typeof value === 'string'
          ? value.split(',')
          : Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === 'string')
            : [];
      // Case-insensitive dedupe keeping the first casing, matching the
      // case-insensitive membership of the gate's lists (dm-feature-gate).
      const seen = new Set<string>();
      return raw
        .map((name) => name.trim())
        .filter((name) => {
          if (!name || seen.has(name.toLowerCase())) return false;
          seen.add(name.toLowerCase());
          return true;
        });
    };

    // The feature claim is made only when the server vouches for the list:
    // `featureNames` is null (or absent, on an older payload) for a multiclass,
    // classless, or library-uncovered character — the cases the gate does not
    // rule on — so for them the prompt prints no feature list and refuses no
    // feature, however many spells it lists (#217, self-review R1/R2).
    const featuresKnown = Array.isArray(char.featureNames);
    const features = featuresKnown ? nameList(char.featureNames) : [];
    const lines: string[] = [];
    const cantrips = nameList(char.cantrips);
    if (cantrips.length > 0) lines.push(`CANTRIPS (cast at will): ${cantrips.join(', ')}`);
    const prepared = nameList(char.preparedSpells);
    if (prepared.length > 0) lines.push(`PREPARED SPELLS: ${prepared.join(', ')}`);
    const known = nameList(char.knownSpells);
    if (known.length > 0) lines.push(`KNOWN SPELLS: ${known.join(', ')}`);
    const ritual = nameList(char.ritualSpells);
    if (ritual.length > 0) lines.push(`RITUAL SPELLS: ${ritual.join(', ')}`);
    const spellsKnown = lines.length > 0;
    if (!featuresKnown && !spellsKnown) return '';
    if (featuresKnown) {
      lines.unshift(
        features.length > 0 ? `CLASS FEATURES: ${features.join(', ')}` : 'CLASS FEATURES: (none)',
      );
    }

    const claimText =
      featuresKnown && spellsKnown
        ? "the character's real class features and spells"
        : featuresKnown
          ? "the character's real class features"
          : "the character's real spells";
    const actionText =
      featuresKnown && spellsKnown
        ? 'use a feature or cast a spell'
        : featuresKnown
          ? 'use a feature'
          : 'cast a spell';
    const placeholder =
      featuresKnown && spellsKnown
        ? '<the feature or spell>'
        : featuresKnown
          ? '<the feature>'
          : '<the spell>';
    const spellGuidance = spellsKnown
      ? ' Prepared casters cast their prepared spells and cantrips; a wizard also casts rituals from their spellbook.'
      : '';

    return `
<features_and_spells>
${lines.join('\n')}
**These are ${claimText}, from their sheet — they have no others.**
**If the player tries to ${actionText} these lists do not give them, it does not work: refuse it in one plain line ("${char.name} can't use ${placeholder}: it isn't on their character sheet.") and do not roll, resolve, or narrate any effect from it.${spellGuidance}**
</features_and_spells>`;
  }

  public static async buildCharacterSection(char: Record<string, any>): Promise<string> {
    // #708: bind the name to the player at its first presentation in the
    // prompt. Premade names are bare role titles ("The Apprentice"), which
    // read as NPC descriptors; an unbound label lets the DM narrate the PC
    // in the third person as a separate person standing nearby. The full
    // <player_identity> anchor rides in the starter-lore head (see
    // CampaignContextPrompts.renderLoreHead): the character block is in the
    // prompt-section counter's system_rules remainder, whose #2533 budget
    // (ai-service-prompt-diet.test.ts) has only a few tokens of headroom,
    // while the lore head is campaign canon with room.
    let section = `<character_details>
PLAYER CHARACTER: ${char.name} (you, the player), a level ${char.level} ${char.race || 'Unknown Race'} ${char.class?.name || char.class || 'Unknown Class'}`;

    if (char.background) {
      section += ` (${char.background} background)`;
    }

    if (char.character_stats && char.character_stats.length > 0) {
      const stats = char.character_stats[0];
      const calcMod = (score: number = 10): string => {
        const mod = abilityModifier(score);
        return mod >= 0 ? `+${mod}` : `${mod}`;
      };

      section += `
<ability_scores>
STR ${stats.strength}(${calcMod(stats.strength)}), DEX ${stats.dexterity}(${calcMod(stats.dexterity)}), CON ${stats.constitution}(${calcMod(stats.constitution)}), INT ${stats.intelligence}(${calcMod(stats.intelligence)}), WIS ${stats.wisdom}(${calcMod(stats.wisdom)}), CHA ${stats.charisma}(${calcMod(stats.charisma)})
</ability_scores>`;

      section += `
<proficiency_bonus>+${proficiencyBonus(char.level)}</proficiency_bonus>`;
    }

    section += await CharacterContextPrompts.buildEquipmentSection(char);

    section += CharacterContextPrompts.buildFeaturesAndSpellsSection(char);

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
      logger.warn(
        `[ContextBuilder] Failed to calculate passive skills for character ${char.name} (non-fatal):`,
        passiveSkillError,
      );
    }

    section += `
</character_details>`;
    return section;
  }
}
