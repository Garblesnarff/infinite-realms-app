export type AmmunitionKind = 'arrows' | 'bolts' | 'bullets' | 'needles';

export function ammunitionForWeapon(name: string): AmmunitionKind | null {
  if (/crossbow/i.test(name)) return 'bolts';
  if (/\b(?:shortbow|longbow)\b/i.test(name)) return 'arrows';
  if (/\bsling\b/i.test(name)) return 'bullets';
  if (/\bblowgun\b/i.test(name)) return 'needles';
  return null;
}

export function isAmmunition(name: string, kind: AmmunitionKind): boolean {
  if (/\b(?:case|quiver)\b/i.test(name)) return false;
  return new RegExp(`\\b${kind.slice(0, -1)}s?\\b`, 'i').test(name);
}
