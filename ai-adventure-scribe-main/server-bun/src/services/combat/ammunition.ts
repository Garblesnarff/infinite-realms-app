import { sql, type SQL } from 'drizzle-orm';

import { gameSessions } from '../../../../db/schema/index';

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

// A session PATCH replaces the JSON blob. Preserve this engine-owned ledger from the row.
export function ammunitionPreservingSessionState(merged: SQL): SQL {
  const stored = sql`${gameSessions.sessionState} -> 'ammunition_spent'`;
  return sql`CASE WHEN jsonb_typeof(${stored}) = 'array'
    THEN (${merged} - 'ammunition_spent') || jsonb_build_object('ammunition_spent', ${stored})
    ELSE ${merged} - 'ammunition_spent' END`;
}
