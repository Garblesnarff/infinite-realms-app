import type { Spell } from '@/types/character';

import { getClassSpells, allSpells } from '@/data/spellOptions';
import {
  spellProgressionTables,
  spellcastingClasses,
  type SpellProgression,
  type SpellcastingClass,
  type MulticlassSpellSlots,
  type MulticlassCalculation,
} from '@/services/spell-progression-data';

interface ApiSpell {
  id: string;
  name: string;
  level: number;
  school: string;
  ritual: boolean;
  concentration: boolean;
  casting_time: string;
  range_text: string;
  duration: string;
  description: string;
  components_verbal: boolean;
  components_somatic: boolean;
  components_material: boolean;
  material_components?: string;
  attack_save?: string;
  damage_effect?: string;
  available_classes?: string[];
  source_feature?: string;
}

// Convert frontend Spell to API-compatible format
function convertSpellToApiFormat(spell: Spell): ApiSpell {
  return {
    id: spell.id,
    name: spell.name,
    level: spell.level,
    school: spell.school,
    ritual: spell.ritual || false,
    concentration: spell.concentration || false,
    casting_time: spell.castingTime,
    range_text: spell.range,
    duration: spell.duration,
    description: spell.description,
    components_verbal: spell.verbal || false,
    components_somatic: spell.somatic || false,
    components_material: spell.material || false,
    material_components: spell.materialComponents || spell.materialDescription || '',
    attack_save: spell.attackSave || '',
    damage_effect: spell.damageEffect || spell.damage || '',
    available_classes: [],
  };
}

class LocalSpellService {
  async getAllSpells(filters?: {
    level?: number;
    school?: string;
    class?: string;
    ritual?: boolean;
    components?: string;
  }): Promise<Spell[]> {
    let filteredSpells = [...allSpells];
    if (filters?.level !== undefined) {
      filteredSpells = filteredSpells.filter((spell) => spell.level === filters.level);
    }
    if (filters?.school) {
      filteredSpells = filteredSpells.filter((spell) => spell.school === filters.school);
    }
    if (filters?.ritual !== undefined) {
      filteredSpells = filteredSpells.filter((spell) => spell.ritual === filters.ritual);
    }
    if (filters?.class) {
      const classSpells = getClassSpells(filters.class);
      const classSpellIds = new Set([
        ...classSpells.cantrips.map((s) => s.id),
        ...classSpells.spells.map((s) => s.id),
      ]);
      filteredSpells = filteredSpells.filter((spell) => classSpellIds.has(spell.id));
    }
    return filteredSpells;
  }

  async getClassSpells(
    className: string,
    level: number = 1,
  ): Promise<{ cantrips: Spell[]; spells: Spell[] }> {
    const classSpells = getClassSpells(className);
    void level;
    return {
      cantrips: classSpells.cantrips,
      spells: classSpells.spells,
    };
  }

  async getSpellProgression(className: string): Promise<SpellProgression[]> {
    return spellProgressionTables[className] || [];
  }

  async getMulticlassSpellSlots(casterLevel: number): Promise<MulticlassSpellSlots> {
    const spellSlotTable: Record<number, MulticlassSpellSlots> = {
      1: {
        caster_level: 1,
        spell_slots_1: 2,
        spell_slots_2: 0,
        spell_slots_3: 0,
        spell_slots_4: 0,
        spell_slots_5: 0,
        spell_slots_6: 0,
        spell_slots_7: 0,
        spell_slots_8: 0,
        spell_slots_9: 0,
      },
      2: {
        caster_level: 2,
        spell_slots_1: 3,
        spell_slots_2: 0,
        spell_slots_3: 0,
        spell_slots_4: 0,
        spell_slots_5: 0,
        spell_slots_6: 0,
        spell_slots_7: 0,
        spell_slots_8: 0,
        spell_slots_9: 0,
      },
      3: {
        caster_level: 3,
        spell_slots_1: 4,
        spell_slots_2: 2,
        spell_slots_3: 0,
        spell_slots_4: 0,
        spell_slots_5: 0,
        spell_slots_6: 0,
        spell_slots_7: 0,
        spell_slots_8: 0,
        spell_slots_9: 0,
      },
      4: {
        caster_level: 4,
        spell_slots_1: 4,
        spell_slots_2: 3,
        spell_slots_3: 0,
        spell_slots_4: 0,
        spell_slots_5: 0,
        spell_slots_6: 0,
        spell_slots_7: 0,
        spell_slots_8: 0,
        spell_slots_9: 0,
      },
      5: {
        caster_level: 5,
        spell_slots_1: 4,
        spell_slots_2: 3,
        spell_slots_3: 2,
        spell_slots_4: 0,
        spell_slots_5: 0,
        spell_slots_6: 0,
        spell_slots_7: 0,
        spell_slots_8: 0,
        spell_slots_9: 0,
      },
    };
    return spellSlotTable[casterLevel] || spellSlotTable[1];
  }

  async getSpellcastingClasses(): Promise<SpellcastingClass[]> {
    return spellcastingClasses;
  }

  async calculateMulticlassCasterLevel(
    classLevels: { className: string; level: number }[],
  ): Promise<MulticlassCalculation> {
    let totalCasterLevel = 0;
    let pactMagicSlots: { level: number; slots: number } | null = null;
    classLevels.forEach(({ className, level }) => {
      const spellcastingClass = spellcastingClasses.find((c) => c.name === className);
      if (spellcastingClass) {
        if (spellcastingClass.caster_type === 'full') {
          totalCasterLevel += level;
        } else if (spellcastingClass.caster_type === 'half') {
          totalCasterLevel += Math.floor(level / 2);
        } else if (spellcastingClass.caster_type === 'third') {
          totalCasterLevel += Math.floor(level / 3);
        } else if (spellcastingClass.caster_type === 'pact') {
          pactMagicSlots = {
            level: Math.min(5, Math.ceil(level / 2)),
            slots: level < 2 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4,
          };
        }
      }
    });
    const spellSlots =
      totalCasterLevel > 0 ? await this.getMulticlassSpellSlots(totalCasterLevel) : null;
    return { totalCasterLevel, spellSlots, pactMagicSlots };
  }

  async getSpellById(spellId: string): Promise<Spell> {
    const spell = allSpells.find((s) => s.id === spellId);
    if (!spell) {
      throw new Error(`Spell with ID ${spellId} not found`);
    }
    return spell;
  }
}

export const localSpellService = new LocalSpellService();
export type { SpellProgression, SpellcastingClass, MulticlassSpellSlots, MulticlassCalculation };
void convertSpellToApiFormat;
