/* eslint-disable @typescript-eslint/no-explicit-any */
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
**These are the character's real, equipped items. Never name a weapon that is not on this list.**
**USE EXACT WEAPON DICE from this list for damage roll requests.**
</equipment>`;
  }

  public static async buildCharacterSection(char: Record<string, any>): Promise<string> {
    let section = `<character_details>
PLAYER CHARACTER: ${char.name}, a level ${char.level} ${char.race || 'Unknown Race'} ${char.class?.name || char.class || 'Unknown Class'}`;

    if (char.background) {
      section += ` (${char.background} background)`;
    }

    if (char.character_stats && char.character_stats.length > 0) {
      const stats = char.character_stats[0];
      const calcMod = (score: number = 10): string => {
        const mod = Math.floor((score - 10) / 2);
        return mod >= 0 ? `+${mod}` : `${mod}`;
      };

      section += `
<ability_scores>
STR ${stats.strength}(${calcMod(stats.strength)}), DEX ${stats.dexterity}(${calcMod(stats.dexterity)}), CON ${stats.constitution}(${calcMod(stats.constitution)}), INT ${stats.intelligence}(${calcMod(stats.intelligence)}), WIS ${stats.wisdom}(${calcMod(stats.wisdom)}), CHA ${stats.charisma}(${calcMod(stats.charisma)})
</ability_scores>`;

      const profBonus =
        char.level >= 17 ? 6 : char.level >= 13 ? 5 : char.level >= 9 ? 4 : char.level >= 5 ? 3 : 2;
      section += `
<proficiency_bonus>+${profBonus}</proficiency_bonus>`;
    }

    section += await CharacterContextPrompts.buildEquipmentSection(char);

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
