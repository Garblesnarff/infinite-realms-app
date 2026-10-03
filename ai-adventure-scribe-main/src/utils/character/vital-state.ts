/**
 * #2517: the single truth for "dead" on the client: `character_stats`'
 * `vital_state`, written server-side by the vitals mirror at the killing
 * resolution. Surfaces carry the stats row under either `stats` (REST
 * mapping) or `character_stats` (Supabase-shaped records, object or
 * one-element array), so both are read.
 */
type VitalStateCarrier = {
  stats?: { vital_state?: string | null; vitalState?: string | null } | null;
  character_stats?:
    | { vital_state?: string | null; vitalState?: string | null }
    | Array<{ vital_state?: string | null; vitalState?: string | null }>
    | null;
};

export function getCharacterVitalState(character: VitalStateCarrier): string | null {
  // `character_stats` (object or first array row) is read first; a missing
  // row or a row without the field falls back to the REST `stats` mapping
  // of the same record, so an empty stats array cannot mask a dead state
  // carried on the other shape.
  const statsRow = Array.isArray(character.character_stats)
    ? character.character_stats[0]
    : character.character_stats;
  return (
    statsRow?.vital_state ??
    statsRow?.vitalState ??
    character.stats?.vital_state ??
    character.stats?.vitalState ??
    null
  );
}

export function isFallenCharacter(character: VitalStateCarrier): boolean {
  return getCharacterVitalState(character) === 'dead';
}
