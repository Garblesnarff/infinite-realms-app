/* eslint-disable @typescript-eslint/no-explicit-any -- Compatibility boundary for legacy character shapes. */
/* eslint-disable max-lines */
import { waitForAuth } from '@/lib/auth-gate';
import { getAuthHeaders, loadCachedSession } from '@/services/auth/TokenService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export type CharacterStatsPayload = Partial<{
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  armor_class: number;
  max_hit_points: number;
  current_hit_points: number;
  temporary_hit_points: number;
  initiative_bonus: number;
  speed: number;
}>;

export type CharacterPayload = Record<string, unknown> & {
  name: string;
  stats?: CharacterStatsPayload;
};

export type CampaignPayload = Record<string, unknown> & { name: string };
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

export type StructuredCombatStartPayload = {
  participants: Array<{
    encounterId: string;
    characterId?: string | null;
    npcId?: string | null;
    name: string;
    initiativeModifier: number;
    hpCurrent?: number | null;
    hpMax?: number | null;
  }>;
  sceneSpec: unknown;
};

const CHARACTER_FIELDS = [
  'name',
  'description',
  'race',
  'subrace',
  'class',
  'level',
  'alignment',
  'experience_points',
  'image_url',
  'avatar_url',
  'appearance',
  'personality_traits',
  'personality_notes',
  'backstory_elements',
  'background',
  'background_image',
  'theme',
  'session_notes',
  'campaign_id',
  'skill_proficiencies',
  'expertise_proficiencies',
  'tool_proficiencies',
  'saving_throw_proficiencies',
  'languages',
  'cantrips',
  'known_spells',
  'prepared_spells',
  'ritual_spells',
  'spell_slots',
  'pact_slots',
  'active_concentration',
  'class_features',
  'fighting_styles',
  'copper_pieces',
  'silver_pieces',
  'electrum_pieces',
  'gold_pieces',
  'platinum_pieces',
  'damage_resistances',
  'damage_immunities',
  'damage_vulnerabilities',
  'vision_types',
  'obscurement',
  'is_hidden',
  'stealth_check_bonus',
  'class_levels',
  'total_level',
  'stats',
  'equipment',
  'inventory_items',
] as const;

function prepareCharacterPayload(payload: Record<string, unknown>): CharacterPayload {
  const prepared: Record<string, unknown> = {};
  for (const field of CHARACTER_FIELDS) {
    if (payload[field] !== undefined) prepared[field] = payload[field];
  }
  for (const field of [
    'spell_slots',
    'pact_slots',
    'class_features',
    'fighting_styles',
    'damage_resistances',
    'damage_immunities',
    'damage_vulnerabilities',
    'class_levels',
    'vision_types',
  ]) {
    if (typeof prepared[field] === 'string') {
      try {
        prepared[field] = JSON.parse(prepared[field] as string);
      } catch {
        /* preserve value */
      }
    }
  }
  return prepared as CharacterPayload;
}

const CAMPAIGN_FIELDS = [
  'name',
  'description',
  'genre',
  'difficulty_level',
  'campaign_length',
  'tone',
  'setting',
  'setting_details',
  'thematic_elements',
  'status',
  'background_image',
  'art_style',
  'style_config',
  'rules_config',
] as const;

function prepareCampaignPayload(payload: Record<string, unknown>): CampaignPayload {
  const prepared: Record<string, unknown> = {};
  for (const field of CAMPAIGN_FIELDS) {
    if (payload[field] !== undefined) prepared[field] = payload[field];
  }
  return prepared as CampaignPayload;
}

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function normalizeCharacter<T extends Record<string, any>>(character: T): T {
  return {
    ...character,
    character_stats: character.stats ? [character.stats] : [],
  };
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
  ): Promise<any[]> => {
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
};
