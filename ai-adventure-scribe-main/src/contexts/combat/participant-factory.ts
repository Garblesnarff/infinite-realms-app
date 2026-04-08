/**
 * Combat Participant Factory
 * Creates and initializes CombatParticipant objects
 * Extracted from CombatContext.tsx to reduce duplication
 */

import type { CombatParticipant, FightingStyleName } from '@/types/combat';

import { rollDie } from '@/utils/diceRolls';
import { FIGHTING_STYLES } from '@/utils/fightingStyles';

/**
 * Character data used for enriching player participants
 */
export interface CharacterData {
  id: string;
  spellSlots?: CombatParticipant['spellSlots'];
  preparedSpells?: CombatParticipant['preparedSpells'];
  activeConcentration?: CombatParticipant['activeConcentration'];
  damageResistances?: string[];
  damageImmunities?: string[];
  damageVulnerabilities?: string[];
  fightingStyles?: string[];
  visionTypes?: CombatParticipant['visionTypes'];
  obscurement?: CombatParticipant['obscurement'];
  isHidden?: boolean;
  stealthCheckBonus?: number;
}

/**
 * Options for participant creation
 */
export interface CreateParticipantOptions {
  /** Whether to roll initiative (default: true) */
  rollInitiative?: boolean;
  /** Character data to enrich player participants */
  characterData?: CharacterData | null;
}

/**
 * Create a fully initialized CombatParticipant from partial data
 */
export function createCombatParticipant(
  partial: Partial<CombatParticipant>,
  options: CreateParticipantOptions = {},
): CombatParticipant {
  const { rollInitiative: shouldRollInitiative = true, characterData } = options;

  const participant: CombatParticipant = {
    id: partial.id || crypto.randomUUID(),
    participantType: partial.participantType || 'monster',
    name: partial.name || 'Unknown',
    characterId: partial.characterId,
    initiative: shouldRollInitiative
      ? rollDie(20) + (partial.initiative || 0)
      : partial.initiative || 0,
    armorClass: partial.armorClass || 10,
    maxHitPoints: partial.maxHitPoints || 1,
    currentHitPoints: partial.currentHitPoints || partial.maxHitPoints || 1,
    temporaryHitPoints: partial.temporaryHitPoints || 0,
    position: partial.position,
    conditions: partial.conditions || [],
    deathSaves: partial.deathSaves || { successes: 0, failures: 0 },
    actionTaken: partial.actionTaken || false,
    bonusActionTaken: partial.bonusActionTaken || false,
    reactionTaken: partial.reactionTaken || false,
    movementUsed: partial.movementUsed || 0,
    reactionOpportunities: partial.reactionOpportunities || [],
    monsterData: partial.monsterData,
    spellSlots: partial.spellSlots,
    activeConcentration: partial.activeConcentration || null,
    // Damage resistances, immunities, and vulnerabilities
    damageResistances: partial.damageResistances || [],
    damageImmunities: partial.damageImmunities || [],
    damageVulnerabilities: partial.damageVulnerabilities || [],
    // Fighting styles
    fightingStyles: partial.fightingStyles || [],
    // Weapons
    mainHandWeapon: partial.mainHandWeapon,
    offHandWeapon: partial.offHandWeapon,
    // Vision and stealth
    visionTypes: partial.visionTypes || [],
    obscurement: partial.obscurement || 'clear',
    isHidden: partial.isHidden || false,
    stealthCheckBonus: partial.stealthCheckBonus || 0,
  };

  // Enrich player participants with character data
  if (
    partial.participantType === 'player' &&
    partial.characterId &&
    characterData?.id === partial.characterId
  ) {
    enrichParticipantWithCharacterData(participant, characterData);
  }

  return participant;
}

/**
 * Enrich a participant with data from the character context
 */
export function enrichParticipantWithCharacterData(
  participant: CombatParticipant,
  characterData: CharacterData,
): void {
  participant.spellSlots = characterData.spellSlots;
  participant.preparedSpells = characterData.preparedSpells;
  participant.activeConcentration = characterData.activeConcentration;
  participant.damageResistances = characterData.damageResistances || [];
  participant.damageImmunities = characterData.damageImmunities || [];
  participant.damageVulnerabilities = characterData.damageVulnerabilities || [];

  // Convert fighting style strings to FightingStyle objects
  participant.fightingStyles =
    characterData.fightingStyles?.map((style) => {
      const styleName = style as FightingStyleName;
      return FIGHTING_STYLES[styleName] || { name: styleName, description: '', effect: {} };
    }) || [];

  // Copy vision and stealth properties
  participant.visionTypes = characterData.visionTypes || [];
  participant.obscurement = characterData.obscurement || 'clear';
  participant.isHidden = characterData.isHidden || false;
  participant.stealthCheckBonus = characterData.stealthCheckBonus || 0;
}

/**
 * Sort participants by initiative (highest first)
 */
export function sortByInitiative(participants: CombatParticipant[]): CombatParticipant[] {
  return [...participants].sort((a, b) => b.initiative - a.initiative);
}
