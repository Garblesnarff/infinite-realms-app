const numeric = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const dexterityModifier = (character: Record<string, unknown>): number => {
  const scores = (character.abilityScores || character.ability_scores) as
    | Record<string, unknown>
    | undefined;
  const dexterity = scores?.dexterity;
  if (dexterity && typeof dexterity === 'object') {
    const modifier = (dexterity as { modifier?: unknown }).modifier;
    if (typeof modifier === 'number' && Number.isFinite(modifier)) return modifier;
  }
  const stats = character.stats as Record<string, unknown> | undefined;
  const flatDexterity = character.dexterity ?? stats?.dexterity;
  if (typeof flatDexterity === 'number' && Number.isFinite(flatDexterity)) {
    return Math.floor((flatDexterity - 10) / 2);
  }
  const characterStats = character.character_stats;
  if (Array.isArray(characterStats)) {
    const row = characterStats.find((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object'),
    );
    const rowDexterity = row?.dexterity;
    if (typeof rowDexterity === 'number' && Number.isFinite(rowDexterity)) {
      return Math.floor((rowDexterity - 10) / 2);
    }
  }
  return 0;
};

/**
 * The player context the server's combat-entry detector needs (#1907 PR1).
 *
 * Sent with inactive-session DM turns so the detector can build a pending handoff. The explicit
 * entry endpoint later re-derives the participant row; this payload never seats combat itself.
 * The character record never leaves the client whole: only the values a participant row needs
 * travel with the turn.
 */
export type CombatEntryPlayerPayload = {
  characterId: string | null;
  name: string;
  initiativeModifier: number;
  hpCurrent?: number;
  hpMax?: number;
};

export type CombatEntryPayload = {
  combatants: Array<{ name: string; monsterId?: string; count: number }>;
  sceneSpec: unknown;
  player: CombatEntryPlayerPayload;
  /** Omit to make the server roll initiative and mark the seat `(auto-rolled)`. */
  playerInitiativeRoll?: number;
  /** Server-detected player declaration; `/enter` resolves this into the first engine action. */
  declaredAttack?: {
    verb: string;
    actorName: string;
    actorSlug?: string;
    monsterId?: string;
    attackSource?: 'unarmed' | 'weapon' | 'spell';
    weaponName?: string;
    spellId?: string;
    spellName?: string;
  };
};

export type PendingCombatIntentPayload = {
  actorId: string;
  actionType: string;
  targetIds: string[];
  sourceText: string;
};

export function buildCombatEntryPlayer(
  character: Record<string, unknown> | undefined | null,
): CombatEntryPlayerPayload | null {
  if (!character) return null;
  const name = typeof character.name === 'string' && character.name.trim() ? character.name : null;
  if (!name) return null;
  const hpCurrent = numeric(character.currentHitPoints ?? character.current_hit_points, 0);
  const hpMax = numeric(character.maxHitPoints ?? character.max_hit_points, 0);
  return {
    characterId: typeof character.id === 'string' ? character.id : null,
    name,
    initiativeModifier: dexterityModifier(character),
    ...(hpCurrent > 0 ? { hpCurrent } : {}),
    ...(hpMax > 0 ? { hpMax } : {}),
  };
}
