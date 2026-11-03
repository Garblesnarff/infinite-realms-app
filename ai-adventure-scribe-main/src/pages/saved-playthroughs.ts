import { userDataApi } from '@/services/user-data-api';

export interface SavedPlaythrough {
  characterId: string;
  campaignId: string;
  name: string;
  hpCurrent: number | null;
  hpMax: number | null;
  sessionNumber: number;
  /** ISO time of the newest session update, or null when none of the sessions had one. */
  lastPlayedAt: string | null;
  finished: boolean;
  fallen: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asTime = (value: unknown): { iso: string; ms: number } | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return { iso: value, ms };
};

const statsOf = (character: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!character) return null;
  const direct = asRecord(character.stats);
  if (direct) return direct;
  const rows = character.character_stats;
  if (!Array.isArray(rows)) return null;
  return asRecord(rows[0]);
};

const readVitals = (
  characters: readonly unknown[],
  characterId: string,
): { hpCurrent: number | null; hpMax: number | null; fallen: boolean } => {
  for (const entry of characters) {
    const character = asRecord(entry);
    if (!character || character.id !== characterId) continue;
    const stats = statsOf(character);
    return {
      hpCurrent: asNumber(stats?.current_hit_points),
      hpMax: asNumber(stats?.max_hit_points),
      fallen: stats?.vital_state === 'dead',
    };
  }
  return { hpCurrent: null, hpMax: null, fallen: false };
};

interface Bucket {
  name: string;
  sessionNumber: number;
  rank: number;
  rankUpdated: number;
  lastPlayedAt: string | null;
  lastPlayedMs: number;
  finished: boolean;
}

/**
 * One row per saved hero. The latest session is the highest session number,
 * and the later update breaks a tie. Last played is the newest update on any
 * of that hero's sessions. Newest last-played row comes first.
 */
export const buildSavedPlaythroughs = (input: {
  sessions: readonly unknown[];
  characters: readonly unknown[];
  starterCampaignId: string;
  heroName: string;
  campaignId: string;
}): SavedPlaythrough[] => {
  const buckets = new Map<string, Bucket>();

  for (const entry of input.sessions) {
    const session = asRecord(entry);
    if (!session || session.starter_campaign_id !== input.starterCampaignId) continue;
    if (session.status !== 'active' && session.status !== 'completed') continue;
    const characterId = session.character_id;
    if (typeof characterId !== 'string' || characterId.length === 0) continue;
    const character = asRecord(session.character);
    if (character?.name !== input.heroName) continue;

    const sessionNumber = asNumber(session.session_number);
    const rank = sessionNumber ?? 0;
    const updated = asTime(session.updated_at);
    const current = buckets.get(characterId) ?? {
      name: input.heroName,
      sessionNumber: sessionNumber ?? 1,
      rank: -1,
      rankUpdated: -1,
      lastPlayedAt: null,
      lastPlayedMs: -1,
      finished: false,
    };

    if (updated && updated.ms >= current.lastPlayedMs) {
      current.lastPlayedMs = updated.ms;
      current.lastPlayedAt = updated.iso;
    }
    if (
      rank > current.rank ||
      (rank === current.rank && (updated?.ms ?? -1) >= current.rankUpdated)
    ) {
      current.rank = rank;
      current.rankUpdated = updated?.ms ?? -1;
      current.sessionNumber = sessionNumber ?? 1;
      current.finished = session.status === 'completed';
    }
    buckets.set(characterId, current);
  }

  const rows: SavedPlaythrough[] = [];
  for (const [characterId, bucket] of buckets) {
    const vitals = readVitals(input.characters, characterId);
    rows.push({
      characterId,
      campaignId: input.campaignId,
      name: bucket.name,
      hpCurrent: vitals.hpCurrent,
      hpMax: vitals.hpMax,
      sessionNumber: bucket.sessionNumber,
      lastPlayedAt: bucket.lastPlayedAt,
      finished: bucket.finished,
      fallen: vitals.fallen,
    });
  }

  rows.sort((a, b) => {
    const playedAt = (iso: string | null): number | null => {
      if (!iso) return null;
      const ms = Date.parse(iso);
      return Number.isNaN(ms) ? null : ms;
    };
    const aTime = playedAt(a.lastPlayedAt);
    const bTime = playedAt(b.lastPlayedAt);
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return bTime - aTime;
  });
  return rows;
};

/** "last played 2 hours ago". A missing or unreadable time says unknown. */
export const relativeLastPlayed = (iso: string | null, now: number): string => {
  if (!iso) return 'last played unknown';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'last played unknown';
  const minutes = Math.floor(Math.max(0, now - then) / 60000);
  if (minutes < 1) return 'last played just now';
  if (minutes < 60) {
    return `last played ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `last played ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `last played ${days} ${days === 1 ? 'day' : 'days'} ago`;
};

export const playthroughLabel = (row: SavedPlaythrough, now: number): string => {
  const hp =
    row.hpCurrent !== null && row.hpMax !== null
      ? `HP ${row.hpCurrent}/${row.hpMax}`
      : 'HP unknown';
  const marks = [row.finished ? 'Finished' : null, row.fallen ? 'Fallen' : null]
    .filter((mark): mark is string => mark !== null)
    .join(' · ');
  const base = `${row.name} · ${hp} · Session ${row.sessionNumber} · ${relativeLastPlayed(row.lastPlayedAt, now)}`;
  return marks ? `${base} · ${marks}` : base;
};

/** Character list for HP and fallen. Missing client or a failed request leaves HP blank. */
export const loadPlaythroughCharacters = async (campaignId: string): Promise<unknown[]> => {
  if (typeof userDataApi.listCharacters !== 'function') return [];
  try {
    const rows: unknown = await userDataApi.listCharacters(campaignId);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};
