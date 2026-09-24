import { waitForAuth } from '@/lib/auth-gate';
import { logger } from '@/lib/logger';
import {
  getAuthHeaders,
  loadCachedSession,
  persistSession,
  refreshAccessTokenOnce,
} from '@/services/auth/TokenService';
import { parseJsonIfString } from '@/utils/parse-json-if-string';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export class Issue1784ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'Issue1784ApiError';
    this.status = status;
    this.code = code;
  }
}

export type Issue1784EquipmentRow = {
  id: string;
  character_id: string;
  item_name: string;
  item_type?: string | null;
  quantity?: number | null;
  equipped?: boolean | null;
  is_magic?: boolean | null;
  magic_bonus?: number | null;
  magic_properties?: string | null;
  requires_attunement?: boolean | null;
  is_attuned?: boolean | null;
  attunement_requirements?: string | null;
  magic_item_type?: string | null;
  magic_item_rarity?: string | null;
  magic_effects?: unknown;
};

export type Issue1784VoiceMappingRow = {
  id: string;
  session_id: string;
  character_name: string;
  voice_category: string | null;
  voice_id: string;
  last_used: string | null;
  updated_at: string | null;
  appearance_count: number | null;
};

export type Issue1784VoiceProfile = {
  id?: string;
  character_id: string;
  voice_style: string;
  speech_patterns: string[];
  vocabulary_level: 'simple' | 'average' | 'advanced' | 'archaic';
  tone: string;
  quirks: string[];
  example_phrases: string[];
  consistency_score: number;
  created_at?: string;
  updated_at?: string;
};

export type Issue1784SafetyEventPayload = Record<string, unknown>;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  const bodyText = await response.text().catch(() => '');
  let payload: { error?: string | { message?: string }; message?: string; code?: string } | null =
    null;
  if (typeof bodyText === 'string' && bodyText) {
    try {
      payload = parseJsonIfString(bodyText) as typeof payload;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof payload?.error === 'string'
        ? payload.error
        : payload?.error?.message || payload?.message || bodyText || response.statusText;
    throw new Issue1784ApiError(errorMessage, response.status, payload?.code);
  }

  if (response.status === 204 || !bodyText) return undefined as T;
  // Reuse the first parse. A second JSON.parse(bodyText) is redundant, and a
  // JSON.parse of a non-string (or of the coerced "[object Object]" body)
  // is the session-mappings SyntaxError from #2077.
  if (payload !== null) return payload as T;
  logger.warn('ISSUE1784_BODY_UNPARSEABLE', {
    path,
    status: response.status,
    bodyHead: bodyText.slice(0, 80),
  });
  // Returning the raw text typed as T let callers .map a string: an equipment body
  // of "[object Object]…" became "i.map is not a function" on the sheet (#2150).
  throw new Issue1784ApiError(
    `Unparseable response body from ${path}`,
    response.status,
    'BODY_UNPARSEABLE',
  );
}

export const issue1784Api = {
  getCharacterEquipment: (characterId: string): Promise<Issue1784EquipmentRow[]> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}/equipment`),

  getVoiceMappings: (sessionId: string): Promise<Issue1784VoiceMappingRow[]> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/voice-mappings`),

  upsertVoiceMapping: (
    sessionId: string,
    payload: {
      character_name: string;
      voice_category: string;
      voice_id: string;
      appearance_count: number;
    },
  ): Promise<Issue1784VoiceMappingRow> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/voice-mappings`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateVoiceMapping: (
    mappingId: string,
    payload: { appearance_count: number },
  ): Promise<Issue1784VoiceMappingRow> =>
    request(`/v1/voice-mappings/${encodeURIComponent(mappingId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getVoiceProfile: (characterId: string): Promise<Issue1784VoiceProfile | null> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}/voice-profile`),

  upsertVoiceProfile: (
    characterId: string,
    payload: Partial<
      Omit<Issue1784VoiceProfile, 'id' | 'character_id' | 'created_at' | 'updated_at'>
    >,
  ): Promise<Issue1784VoiceProfile> =>
    request(`/v1/characters/${encodeURIComponent(characterId)}/voice-profile`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  recordCharacterCreationFlow: (payload: {
    flow: 'legacy' | 'new';
    campaign_id?: string | null;
  }): Promise<void> =>
    request('/v1/telemetry/character-creation-flow', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  recordSafetyEvent: (
    sessionId: string,
    payload: Issue1784SafetyEventPayload,
  ): Promise<{ ok: boolean; id: string }> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/safety-events`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSessionConfig: <T = Record<string, unknown>>(sessionId: string): Promise<T> =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/config`),
};
