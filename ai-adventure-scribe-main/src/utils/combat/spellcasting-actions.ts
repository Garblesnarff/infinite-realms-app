/**
 * Combat-related spellcasting actions and concentration management
 */
import type { CombatParticipant, CombatAction } from '@/types/combat';
import type { SpellSlotLevel } from '@/utils/spell-slots-table';

import { spellApi } from '@/services/spellApi';
import { calculateProficiencyBonus } from '@/utils/character/basic-math';

/**
 * Handles spell casting logic: deduct slot, set concentration if applicable
 */
export async function castSpell(
  action: Partial<CombatAction>,
  participant: CombatParticipant,
  spellId: string,
  spellLevel: SpellSlotLevel,
): Promise<{ updatedParticipant: CombatParticipant; updatedAction: CombatAction }> {
  // Find the spell being cast
  const spell = await spellApi.getSpellById(spellId);
  if (!spell) {
    throw new Error(`Spell ${spellId} not found`);
  }

  // Mock validation for now
  const validation = { canCast: true, reasons: [] };
  if (!validation.canCast) {
    throw new Error(`Cannot cast ${spell.name}: ${validation.reasons.join(', ')}`);
  }

  if (!participant.spellSlots || participant.spellSlots[spellLevel]?.current <= 0) {
    throw new Error(`No available spell slots at level ${spellLevel} for ${participant.name}`);
  }

  // Deduct slot
  const updatedSlots = { ...participant.spellSlots };
  updatedSlots[spellLevel] = {
    ...updatedSlots[spellLevel],
    current: updatedSlots[spellLevel].current - 1,
  };

  // Set concentration if spell requires it
  let concentrationSpell = null;
  if (spell.concentration && !participant.activeConcentration) {
    concentrationSpell = spell.name;
  } else if (spell.concentration && participant.activeConcentration) {
    throw new Error(
      `${participant.name} is already concentrating on ${participant.activeConcentration}`,
    );
  }

  const updatedParticipant: CombatParticipant = {
    ...participant,
    spellSlots: updatedSlots,
    activeConcentration: concentrationSpell,
  };

  // Create detailed action description with component information
  let description = `${action.description} (Cast ${spell.name} using level ${spellLevel} slot)`;

  // Add component information to the action description
  const components = [];
  if (spell.components_verbal) components.push('V');
  if (spell.components_somatic) components.push('S');
  if (spell.components_material) components.push('M');

  if (components.length > 0) {
    description += ` [Components: ${components.join(', ')}]`;
  }

  if (spell.components_material && spell.material_components) {
    description += ` [Material: ${spell.material_components}]`;
  }

  const fullAction: CombatAction = {
    ...(action as CombatAction),
    description,
    // Add spell-specific fields
    spellName: spell.name,
    spellLevel: spell.level,
    components: {
      verbal: spell.components_verbal || false,
      somatic: spell.components_somatic || false,
      material: spell.components_material || false,
      materialDescription: spell.material_components,
      materialCost: spell.material_cost,
      materialConsumed: spell.material_consumed || false,
    },
  };

  // Handle material component consumption and tracking
  const componentTracking = { trackingMessage: '' }; // Mock for now

  if (componentTracking.trackingMessage) {
    fullAction.description += ` [${componentTracking.trackingMessage}]`;
  }

  return { updatedParticipant, updatedAction: fullAction };
}

/**
 * Checks if participant is concentrating and handles concentration checks
 */
export function checkConcentration(
  participant: CombatParticipant,
  damageTaken: number = 0,
): boolean {
  if (!participant.activeConcentration) return true;

  if (damageTaken === 0) return true;

  const dc = Math.max(10, Math.floor(damageTaken / 2));

  const combatant = participant as CombatParticipant & {
    abilityScores?: { constitution?: { modifier?: number; savingThrow?: boolean } };
    savingThrowProficiencies?: string[];
  };
  const constitution = combatant.abilityScores?.constitution;
  const conMod = constitution?.modifier || 0;
  const proficient = constitution?.savingThrow === true ||
    combatant.savingThrowProficiencies?.includes('constitution');
  const proficiencyBonus = proficient ? calculateProficiencyBonus(participant.level || 1) : 0;
  const roll = Math.floor(Math.random() * 20) + 1 + conMod + proficiencyBonus;

  const maintained = roll >= dc;
  if (!maintained) {
    participant.activeConcentration = null;
  }

  return maintained;
}
