/* eslint-disable @typescript-eslint/no-explicit-any -- Compatibility boundary for legacy character shapes. */
/* eslint-disable max-lines */
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
  'tool_proficiencies',
  'saving_throw_proficiencies',
  'languages',
  'cantrips',
  'known_spells',
  'prepared_spells',
  'ritual_spells',
  'spell_slots',
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
] as const;

function prepareCharacterPayload(payload: Record<string, unknown>): CharacterPayload {
  const prepared: Record<string, unknown> = {};
  for (const field of CHARACTER_FIELDS) {
    if (payload[field] !== undefined) prepared[field] = payload[field];
  }
  for (const field of [
    'spell_slots',
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = window.localStorage.getItem('workos_access_token');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  deleteCharacter: (characterId: string): Promise<void> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}`, { method: 'DELETE' }),
};
