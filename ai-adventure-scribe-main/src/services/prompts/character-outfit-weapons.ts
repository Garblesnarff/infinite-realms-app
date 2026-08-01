import type { EnhancementSelection } from './character-prompt-types';

export const extractWeaponsFromClass = (characterClass: string): string[] => {
  const classWeaponsMap: Record<string, string[]> = {
    barbarian: ['greataxe', 'battleaxe'],
    fighter: ['longsword', 'shield'],
    paladin: ['longsword', 'mace', 'shield'],
    ranger: ['longbow', 'shortsword'],
    rogue: ['rapier', 'dagger'],
    bard: ['rapier', 'dagger'],
    cleric: ['mace', 'shield'],
    druid: ['quarterstaff', 'scimitar'],
    monk: ['quarterstaff', 'unarmed strikes'],
    sorcerer: ['light crossbow', 'dagger'],
    warlock: ['light crossbow', 'eldritch blast'],
    wizard: ['quarterstaff', 'dagger'],
    artificer: ['hand crossbow', 'simple weapon'],
    'blood hunter': ['greatsword', 'hand crossbow'],
  };

  const weapons = classWeaponsMap[characterClass.toLowerCase()] || ['appropriate weapons'];
  return weapons;
};

export const extractWeaponsFromEnhancements = (
  enhancementSelections: EnhancementSelection[],
): string[] => {
  const weapons: string[] = [];

  enhancementSelections.forEach((selection) => {
    const value = Array.isArray(selection.value)
      ? selection.value.join(' ')
      : String(selection.value);
    const combined = `${value} ${selection.customValue || ''}`.toLowerCase();

    if (combined.includes('sword') || combined.includes('blade')) {
      weapons.push('sword');
    }
    if (combined.includes('axe')) {
      weapons.push('axe');
    }
    if (combined.includes('bow') || combined.includes('arrow')) {
      weapons.push('bow');
    }
    if (combined.includes('dagger') || combined.includes('knife')) {
      weapons.push('dagger');
    }
    if (combined.includes('mace') || combined.includes('hammer')) {
      weapons.push('mace');
    }
    if (combined.includes('staff') || combined.includes('quarterstaff')) {
      weapons.push('quarterstaff');
    }
    if (combined.includes('crossbow')) {
      weapons.push('crossbow');
    }
    if (combined.includes('spear') || combined.includes('lance')) {
      weapons.push('spear');
    }
  });

  return [...new Set(weapons)];
};

export const summarizeOutfit = (outfitParts: string[]): string => {
  if (outfitParts.length === 0) {
    return '';
  }

  const armorTypes = outfitParts.filter(
    (part) =>
      part.includes('armor') ||
      part.includes('chainmail') ||
      part.includes('plate') ||
      part.includes('leather'),
  );
  const clothingTypes = outfitParts.filter(
    (part) =>
      part.includes('robe') ||
      part.includes('cloak') ||
      part.includes('vestments') ||
      part.includes('clothing'),
  );
  const accessories = outfitParts.filter(
    (part) =>
      part.includes('symbol') ||
      part.includes('focus') ||
      part.includes('instrument') ||
      part.includes('book'),
  );

  const summaryParts: string[] = [];

  if (armorTypes.length > 0) {
    summaryParts.push(armorTypes[0].split(' with ')[0]);
  }
  if (clothingTypes.length > 0) {
    summaryParts.push(clothingTypes[0]);
  }
  if (accessories.length > 0) {
    summaryParts.push(accessories[0]);
  }

  return summaryParts.length > 0 ? `wearing ${summaryParts.join(' and ')}` : '';
};

export const summarizeWeapons = (weaponParts: string[]): string => {
  if (weaponParts.length === 0) {
    return '';
  }

  const primaryWeapons = weaponParts.filter(
    (w) => w.includes('sword') || w.includes('axe') || w.includes('staff') || w.includes('bow'),
  );
  const summary =
    primaryWeapons.length > 0
      ? `armed with ${primaryWeapons.join(' and ')}`
      : `armed with ${weaponParts[0]}`;

  return summary;
};
