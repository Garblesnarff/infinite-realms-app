/* eslint-disable @typescript-eslint/no-explicit-any -- Compatibility boundary for legacy character shapes. */
/* eslint-disable max-lines */
import type { SessionListApiRow } from '../../shared/session-list-contract';
import type {
  CombatEntryPayload,
  PendingCombatIntentPayload,
  StructuredCombatStartPayload,
} from '@/services/combat/structured-combat-payload';

export type {
  CampaignPayload,
  CharacterPayload,
  CharacterStatsPayload,
} from '@/services/user-data-payload-helpers';

import { waitForAuth } from '@/lib/auth-gate';
import {
  getAuthHeaders,
  loadCachedSession,
  persistSession,
  refreshAccessTokenOnce,
} from '@/services/auth/TokenService';
import {
  normalizeCharacter,
  prepareCampaignPayload,
  prepareCharacterPayload,
} from '@/services/user-data-payload-helpers';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

/** Mirror of `EquippedLoadout` in `server-bun/src/services/combat/equipped-loadout.ts`. */
export type EquippedWeaponProfile = {
  id: string;
  name: string;
  damageDice: string;
  damageType: string;
  normalRange: number;
  longRange?: number;
  magicBonus: number;
  finesse: boolean;
  ranged: boolean;
  proficient: boolean;
};

export type EquippedLoadout = {
  weapons: EquippedWeaponProfile[];
  armor: string[];
  armorClass: number | null;
};

export type SessionMessagePayload = {
  id?: string;
  speaker_type: string;
  speaker_id?: string;
  message: string;
  context?: Record<string, unknown>;
  images?: unknown[];
  timestamp?: string;
};
export type SessionMessagePage = {
  messages: any[];
  total: number;
  hasMore: boolean;
};
export type MemoryQuery = {
  limit?: number;
  category?: string;
  recentMinutes?: number;
  minNarrativeWeight?: number;
  top?: boolean;
};
export type SessionContextPayload = Record<string, unknown> & {
  id: string;
  campaign_id: string | null;
  character_id: string | null;
  starter_campaign_id?: string | null;
  campaign: Record<string, unknown>;
  character: Record<string, unknown> & { character_stats?: Record<string, number>[] };
};

export type TacticalMapActionPayload = {
  action: 'move' | 'place' | 'remove' | 'update_cell';
  entityId?: string | null;
  x?: number | null;
  y?: number | null;
  changes?: Record<string, unknown> | null;
};

// Defined next to the builder that produces it so server-side tests can share both.
export type { StructuredCombatStartPayload };

export type AoECastPayload = {
  phase: 'propose' | 'resolve';
  actorId: string;
  spellId: string;
  origin: { x: number; y: number };
  direction: { x: number; y: number } | null;
  slotLevel: number | null;
};

export type CombatPersistencePayload = {
  sessionId: string;
  status: 'active' | 'paused' | 'completed';
  currentRound: number;
  currentTurnOrder: number;
  location: string | null;
  startedAt: string;
  participants: Array<{
    id: string;
    characterId: string | null;
    npcId: string | null;
    name: string;
    participantType: 'player' | 'npc' | 'enemy' | 'monster';
    initiative: number;
    initiativeModifier: number;
    turnOrder: number;
    isActive: boolean;
    armorClass: number;
    maxHp: number;
    speed: number;
    damageResistances: string[];
    damageImmunities: string[];
    damageVulnerabilities: string[];
  }>;
  statuses: Array<{
    participantId: string;
    currentHp: number;
    maxHp: number;
    tempHp: number;
    isConscious: boolean;
    deathSavesSuccesses: number;
    deathSavesFailures: number;
  }>;
  conditions: Array<{
    participantId: string;
    conditionName: string;
    durationRounds: number | null;
    source: string | null;
  }>;
};

export type CombatParticipantStatusResponse = {
  participant_id: string;
  encounter_id: string;
  current_hp: number;
  max_hp: number;
  temp_hp: number;
  is_conscious: boolean;
  death_saves_successes: number;
  death_saves_failures: number;
  damage_resistances: string[];
  damage_immunities: string[];
  damage_vulnerabilities: string[];
};

export type CombatParticipantStatusUpdate = {
  currentHp?: number;
  tempHp?: number;
  isConscious?: boolean;
  deathSavesSuccesses?: number;
  deathSavesFailures?: number;
};

export type CombatDamageLogPayload = {
  participantId: string;
  damageAmount: number;
  damageType: string;
  sourceParticipantId: string | null;
  sourceDescription: string | null;
  roundNumber: number;
};

export type JournalHandoutEntry = {
  id: string;
  sessionId: string;
  sessionNumber: number | null;
  recipient: string | null;
  mode: 'authored' | 'improvised';
  key: string | null;
  title: string;
  body: string | null;
  giver: string;
  assetPath: string | null;
  createdAt: string;
};

export type WorldBuilderStats = {
  locations: number;
  npcs: number;
  quests: number;
  totalElements: number;
};

/** Kinds the server allowlists for `POST /v1/telemetry/client-failure` (see #1680). */
export type ClientFailureKind =
  | 'lore_injection_failed'
  | 'scene_state_fetch_failed'
  | 'combat_intent_failed'
  | 'stale_client_detected'
  | 'malformed_ws_frame'
  | 'missing_starter_campaign_id'
  | 'invalid_ability_score_key';

export type NarrativeSceneStateResponse = {
  scene_state: string | null;
};

async function requestResponse(path: string, init: RequestInit = {}): Promise<Response> {
  await waitForAuth();
  const token = loadCachedSession()?.access_token;
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Wait for AuthContext to verify/refresh the session before reading the
  // token — otherwise cold page loads race out with a stale/expired token.
  await waitForAuth();
  const send = (): Promise<Response> =>
    fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...init.headers,
      },
    });
  let response = await send();

  if (response.status === 401) {
    const session = loadCachedSession();
    if (session?.refresh_token) {
      const tokens = await refreshAccessTokenOnce(session.refresh_token);
      if (tokens) {
        persistSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
        response = await send();
      }
    }
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as T & { error?: unknown };
  if (payload && typeof payload === 'object' && typeof payload.error === 'string') {
    throw new Error(payload.error);
  }
  return payload;
}

export const userDataApi = {
  createSession: (payload: Record<string, unknown>): Promise<any> =>
    request('/v1/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  getSession: (sessionId: string): Promise<any> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}`),
  listSessions: (
    filters: {
      campaignId?: string;
      characterId?: string;
      status?: string;
      starterOnly?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<SessionListApiRow[]> => {
    const query = new URLSearchParams();
    if (filters.campaignId) query.set('campaign_id', filters.campaignId);
    if (filters.characterId) query.set('character_id', filters.characterId);
    if (filters.status) query.set('status', filters.status);
    if (filters.starterOnly) query.set('starter_only', 'true');
    if (filters.limit != null) query.set('limit', String(filters.limit));
    if (filters.offset != null) query.set('offset', String(filters.offset));
    return request(`/v1/sessions?${query.toString()}`);
  },
  updateSession: (sessionId: string, payload: Record<string, unknown>): Promise<any> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  completeSession: (sessionId: string, summary?: string): Promise<any> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ summary }),
    }),
  listQuests: (campaignId: string, status?: string): Promise<any[]> => {
    const query = new URLSearchParams({ campaign_id: campaignId });
    if (status) query.set('status', status);
    return request(`/v1/quests?${query.toString()}`);
  },
  createQuest: (payload: Record<string, unknown>): Promise<any> =>
    request('/v1/quests', { method: 'POST', body: JSON.stringify(payload) }),
  upsertQuest: (payload: Record<string, unknown>): Promise<any> =>
    request('/v1/quests/upsert', { method: 'POST', body: JSON.stringify(payload) }),
  getWorldBuilderStats: (campaignId: string): Promise<WorldBuilderStats> => {
    const query = new URLSearchParams({ campaign_id: campaignId });
    return request(`/v1/world-builder/stats?${query.toString()}`);
  },
  findWorldBuilderNpc: async (campaignId: string, name: string): Promise<any | null> => {
    const query = new URLSearchParams({ campaign_id: campaignId, name });
    const rows = await request<any[]>(`/v1/world-builder/npcs?${query.toString()}`);
    return rows[0] ?? null;
  },
  findWorldBuilderLocation: async (campaignId: string, name: string): Promise<any | null> => {
    const query = new URLSearchParams({ campaign_id: campaignId, name });
    const rows = await request<any[]>(`/v1/world-builder/locations?${query.toString()}`);
    return rows[0] ?? null;
  },
  createWorldBuilderNpc: (payload: Record<string, unknown>): Promise<any> =>
    request('/v1/world-builder/npcs', { method: 'POST', body: JSON.stringify(payload) }),
  createWorldBuilderLocation: (payload: Record<string, unknown>): Promise<any> =>
    request('/v1/world-builder/locations', { method: 'POST', body: JSON.stringify(payload) }),
  listStarterCharacterTemplates: (campaignId: string): Promise<any[]> =>
    request(`/v1/starter-character-templates?campaign_id=${encodeURIComponent(campaignId)}`),
  getStarterCharacterTemplate: (templateId: string): Promise<any | null> =>
    request(`/v1/starter-character-templates?id=${encodeURIComponent(templateId)}`),
  listCharacterQuestProgress: (characterId: string): Promise<any[]> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}/quest-progress`),
  getSessionContext: (sessionId: string): Promise<SessionContextPayload> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/context`),
  getTacticalMapContext: (sessionId: string, entityId: string): Promise<Response> =>
    requestResponse(
      `/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map/context/${encodeURIComponent(entityId)}`,
    ),
  startStructuredCombat: (
    sessionId: string,
    payload: StructuredCombatStartPayload,
  ): Promise<Response> =>
    requestResponse(`/v1/combat/sessions/${encodeURIComponent(sessionId)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  enterCombat: (sessionId: string, payload: CombatEntryPayload): Promise<Response> =>
    requestResponse(`/v1/combat/sessions/${encodeURIComponent(sessionId)}/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  setPendingCombatIntent: (
    encounterId: string,
    payload: PendingCombatIntentPayload,
  ): Promise<Response> =>
    requestResponse(`/v1/combat/${encodeURIComponent(encounterId)}/pending-intent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  clearPendingCombatIntent: (encounterId: string): Promise<Response> =>
    requestResponse(`/v1/combat/${encodeURIComponent(encounterId)}/pending-intent`, {
      method: 'DELETE',
    }),
  promotePendingCombatIntent: (encounterId: string): Promise<Response> =>
    requestResponse(`/v1/combat/${encodeURIComponent(encounterId)}/pending-intent/promote`, {
      method: 'POST',
    }),
  saveCombatEncounter: (
    encounterId: string,
    payload: CombatPersistencePayload,
  ): Promise<{
    ok: boolean;
    encounterId: string;
    participants: number;
    statuses: number;
    conditions: number;
    skippedConditions: string[];
  }> =>
    request(`/v1/combat/encounters/${encodeURIComponent(encounterId)}/persistence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logCombatDamage: (
    encounterId: string,
    payload: CombatDamageLogPayload,
  ): Promise<{ ok: boolean; id: string }> =>
    request(`/v1/combat/encounters/${encodeURIComponent(encounterId)}/damage-log`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getCombatParticipantStatus: (participantId: string): Promise<CombatParticipantStatusResponse> =>
    request(`/v1/combat/participants/${encodeURIComponent(participantId)}/status`),
  updateCombatParticipantStatus: (
    participantId: string,
    payload: CombatParticipantStatusUpdate,
  ): Promise<CombatParticipantStatusResponse> =>
    request(`/v1/combat/participants/${encodeURIComponent(participantId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getCharacterCombatStatus: (
    characterId: string,
  ): Promise<CombatParticipantStatusResponse | null> =>
    request(`/v1/combat/characters/${encodeURIComponent(characterId)}/combat-status`),
  getActiveCombat: (sessionId: string): Promise<Response> =>
    requestResponse(`/v1/combat/sessions/${encodeURIComponent(sessionId)}/active`),
  endTacticalMap: (sessionId: string): Promise<Response> =>
    requestResponse(`/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map/end`, {
      method: 'POST',
    }),
  applyTacticalMapAction: (
    sessionId: string,
    action: TacticalMapActionPayload,
  ): Promise<Response> =>
    requestResponse(`/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    }),
  applyDmTacticalActions: (
    sessionId: string,
    actions: TacticalMapActionPayload[],
  ): Promise<Response> =>
    requestResponse(`/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map/dm-actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions }),
    }),
  applyDmHandoutActions: (
    sessionId: string,
    actions: Array<{
      mode: 'authored' | 'improvised';
      key: string | null;
      title: string;
      body: string | null;
      giver: string;
    }>,
  ): Promise<Response> =>
    requestResponse(`/v1/sessions/${encodeURIComponent(sessionId)}/handout-actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions }),
    }),
  getSessionJournal: (sessionId: string): Promise<{ entries: JournalHandoutEntry[] }> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/journal`),
  resolveAoECast: (sessionId: string, payload: AoECastPayload): Promise<Response> =>
    requestResponse(`/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map/aoe-cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  listCampaigns: (): Promise<any[]> => request('/v1/campaigns'),
  getCampaign: (campaignId: string): Promise<any> =>
    request(`/v1/campaigns/${encodeURIComponent(campaignId)}`),
  listPublicCampaignTemplates: (): Promise<any[]> => request('/v1/public/campaign-templates'),
  createCampaign: (payload: CampaignPayload): Promise<any> =>
    request('/v1/campaigns', {
      method: 'POST',
      body: JSON.stringify(prepareCampaignPayload(payload)),
    }),
  updateCampaign: (campaignId: string, payload: Record<string, unknown>): Promise<any> =>
    request(`/v1/campaigns/${encodeURIComponent(campaignId)}`, {
      method: 'PUT',
      body: JSON.stringify(prepareCampaignPayload(payload)),
    }),
  deleteCampaign: (campaignId: string): Promise<void> =>
    request(`/v1/campaigns/${encodeURIComponent(campaignId)}`, { method: 'DELETE' }),
  listSessionMessages: (sessionId: string, offset = 0, limit = 50): Promise<SessionMessagePage> =>
    request(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages?offset=${offset}&limit=${limit}`,
    ),
  sessionMessageExists: async (sessionId: string, messageId: string): Promise<boolean> => {
    const result = await request<{ exists: boolean }>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
    );
    return result.exists;
  },
  saveSessionMessages: (
    sessionId: string,
    messages: SessionMessagePayload | SessionMessagePayload[],
  ): Promise<any> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(messages),
    }),
  listMemories: (sessionId: string, options: MemoryQuery = {}): Promise<any[]> => {
    const query = new URLSearchParams({ session_id: sessionId });
    if (options.limit) query.set('limit', String(options.limit));
    if (options.category) query.set('category', options.category);
    if (options.recentMinutes) query.set('recent_minutes', String(options.recentMinutes));
    if (options.minNarrativeWeight) {
      query.set('min_narrative_weight', String(options.minNarrativeWeight));
    }
    if (options.top) query.set('top', 'true');
    return request(`/v1/memories?${query.toString()}`);
  },
  createMemories: (records: Record<string, unknown>[]): Promise<any[]> =>
    request('/v1/memories', { method: 'POST', body: JSON.stringify(records) }),
  getMemory: (memoryId: string): Promise<any> =>
    request(`/v1/memories/${encodeURIComponent(memoryId)}`),
  updateMemoryContent: (memoryId: string, content: string): Promise<void> =>
    request(`/v1/memories/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  updateMemoryScores: (
    memoryId: string,
    updates: { importance?: number; narrative_weight?: number },
  ): Promise<void> =>
    request(`/v1/memories/${encodeURIComponent(memoryId)}/scores`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  matchMemories: (
    sessionId: string,
    embedding: string,
    limit: number,
    threshold: number,
  ): Promise<any[]> =>
    request('/v1/memories/match', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, embedding, limit, threshold }),
    }),
  getNarrativeSceneState: (sessionId: string): Promise<NarrativeSceneStateResponse> =>
    request(`/v1/narrative-facts/scene-state?session_id=${encodeURIComponent(sessionId)}`),
  listCharacters: async (campaignId?: string): Promise<any[]> => {
    const characters = await request<any[]>(
      `/v1/characters${campaignId ? `?campaign_id=${encodeURIComponent(campaignId)}` : ''}`,
    );
    return characters.map(normalizeCharacter);
  },
  getCharacter: async (characterId: string): Promise<any> =>
    normalizeCharacter(
      await request<Record<string, any>>(`/v1/characters/${encodeURIComponent(characterId)}`),
    ),
  createCharacter: (payload: CharacterPayload): Promise<any> =>
    request('/v1/characters', {
      method: 'POST',
      body: JSON.stringify(prepareCharacterPayload(payload)),
    }),
  updateCharacter: (characterId: string, payload: Record<string, unknown>): Promise<any> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}`, {
      method: 'PUT',
      body: JSON.stringify(prepareCharacterPayload(payload)),
    }),
  updateCharacterStats: (characterId: string, payload: CharacterStatsPayload): Promise<void> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}/stats`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  applyCharacterDamage: (
    characterId: string,
    amount: number,
  ): Promise<{ currentHitPoints: number; temporaryHitPoints: number }> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}/damage`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  deleteCharacter: (characterId: string): Promise<void> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}`, { method: 'DELETE' }),
  /**
   * The character's equipped weapons and armour, resolved server-side through the same code
   * the attack engine uses. Consumed by the DM prompt builder, which must describe the gear
   * the engine will actually roll with rather than a class-default guess.
   */
  getCharacterLoadout: (characterId: string): Promise<EquippedLoadout> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}/loadout`),
  /**
   * Report a continuity-path failure the client alone can see (a lore fetch that failed, a
   * scene-state fetch that came back null) so it pages through the same `alert()` path as
   * server-side continuity failures (#1680).
   *
   * Deliberately fire-and-forget: this must never throw into, delay, or otherwise affect the
   * turn that triggered it. Callers should `void` this call rather than await it.
   */
  reportClientFailure: (kind: ClientFailureKind, sessionId?: string, error?: string): void => {
    request('/v1/telemetry/client-failure', {
      method: 'POST',
      body: JSON.stringify({ kind, sessionId, error }),
    }).catch(() => {
      // Swallow: a failed failure-report must never itself fail anything.
    });
  },
};
