import { waitForAuth } from '@/lib/auth-gate';
import { getAuthHeaders } from '@/services/auth/TokenService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

type JsonObject = Record<string, unknown>;

export interface MyCharacterSummary {
  id: string;
  name: string;
  class: string | null;
  race: string | null;
  level: number;
}

export interface CompanionPartyMember {
  id?: string;
  character_id?: string;
  companion_id?: string;
  name?: string;
  class?: string | JsonObject | null;
  class_name?: string | null;
  race?: string | JsonObject | null;
  race_name?: string | null;
  level?: number | null;
  current_hp?: number | null;
  max_hp?: number | null;
  currentHitPoints?: number | null;
  maxHitPoints?: number | null;
  is_companion?: boolean;
  isCompanion?: boolean;
  companion?: boolean;
  role?: string;
  type?: string;
  controller?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CompanionCombatParticipant {
  id?: string;
  participant_id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface CompanionCombat {
  id?: string;
  encounter_id?: string;
  encounterId?: string;
  your_companion_participant_id?: string | null;
  companion_participant_id?: string | null;
  actor_id?: string | null;
  participants?: CompanionCombatParticipant[];
  [key: string]: unknown;
}

export interface CompanionSceneResponse {
  companions?: CompanionPartyMember[];
  party?: CompanionPartyMember[] | JsonObject;
  combat?: CompanionCombat | null;
  companion_id?: string;
  your_companion_id?: string;
  [key: string]: unknown;
}

export interface RollForCompanionInput {
  kind: 'skill' | 'ability' | 'save';
  name: string;
  reason?: string;
}

export interface CombatIntent {
  type: string;
  actorId: string;
  targetId?: string;
}

export class CompanionApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(responseBody || `Request failed with status ${status}`);
    this.name = 'CompanionApiError';
    this.status = status;
    this.responseBody = responseBody || `Request failed with status ${status}`;
  }
}

const pathForSession = (sessionId: string, suffix: string): string =>
  `/v1/sessions/${encodeURIComponent(sessionId)}${suffix}`;

const readResponseBody = async (response: Response): Promise<string> => {
  if (typeof response.text === 'function') return response.text();
  const json = await response.json();
  return JSON.stringify(json);
};

const requestJson = async <T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> => {
  await waitForAuth();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal: signal ?? init.signal,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...init.headers,
    },
  });
  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    // Keep the server body intact. In particular, WebMCP callers need the exact
    // 422 explanation when the engine rejects a companion action.
    throw new CompanionApiError(response.status, responseBody);
  }

  if (!responseBody) return undefined as T;
  return JSON.parse(responseBody) as T;
};

const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const nestedName = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value;
  return asString(asObject(value)?.name);
};

const characterListFromResponse = (value: unknown): JsonObject[] => {
  if (Array.isArray(value))
    return value.map(asObject).filter((item): item is JsonObject => item !== null);
  const object = asObject(value);
  const characters = object?.characters;
  return Array.isArray(characters)
    ? characters.map(asObject).filter((item): item is JsonObject => item !== null)
    : [];
};

const projectCharacter = (character: JsonObject): MyCharacterSummary | null => {
  const id = asString(character.id ?? character.character_id);
  const name = asString(character.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    class: nestedName(character.class ?? character.class_name ?? character.character_class),
    race: nestedName(character.race ?? character.race_name),
    level: asNumber(character.level ?? character.character_level) ?? 1,
  };
};

export const listMyCharacters = async (signal?: AbortSignal): Promise<MyCharacterSummary[]> => {
  const response = await requestJson<unknown>('/v1/characters', { method: 'GET' }, signal);
  return characterListFromResponse(response)
    .map(projectCharacter)
    .filter((character): character is MyCharacterSummary => character !== null);
};

export const joinParty = (
  sessionId: string,
  characterId: string,
  signal?: AbortSignal,
): Promise<unknown> =>
  requestJson(
    pathForSession(sessionId, '/companions'),
    {
      method: 'POST',
      body: JSON.stringify({ character_id: characterId }),
    },
    signal,
  );

export const getCompanionScene = (
  sessionId: string,
  companionId?: string | null,
  signal?: AbortSignal,
): Promise<CompanionSceneResponse> => {
  const query = companionId ? `?companion_id=${encodeURIComponent(companionId)}` : '';
  return requestJson(`${pathForSession(sessionId, '/scene')}${query}`, { method: 'GET' }, signal);
};

export const speakAsCompanion = (
  sessionId: string,
  companionId: string,
  text: string,
  signal?: AbortSignal,
): Promise<unknown> =>
  requestJson(
    pathForSession(sessionId, `/companions/${encodeURIComponent(companionId)}/say`),
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    },
    signal,
  );

export const rollForCompanion = (
  sessionId: string,
  companionId: string,
  input: RollForCompanionInput,
  signal?: AbortSignal,
): Promise<unknown> =>
  requestJson(
    pathForSession(sessionId, `/companions/${encodeURIComponent(companionId)}/roll`),
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    signal,
  );

export const submitCombatIntent = (
  encounterId: string,
  intent: CombatIntent,
  signal?: AbortSignal,
): Promise<unknown> =>
  requestJson(
    `/v1/combat/${encodeURIComponent(encounterId)}/intent`,
    {
      method: 'POST',
      body: JSON.stringify({ intent }),
    },
    signal,
  );

const partyMembersFromScene = (scene: CompanionSceneResponse): CompanionPartyMember[] => {
  if (Array.isArray(scene.companions)) return scene.companions;
  if (Array.isArray(scene.party)) return scene.party;

  const party = asObject(scene.party);
  if (Array.isArray(party?.companions)) return party.companions as CompanionPartyMember[];
  if (Array.isArray(party?.members)) return party.members as CompanionPartyMember[];
  return [];
};

const isActive = (member: CompanionPartyMember): boolean => {
  const status = member.status?.toLowerCase();
  return status !== 'left' && status !== 'inactive' && status !== 'dismissed';
};

const isCompanionMember = (member: CompanionPartyMember): boolean =>
  member.is_companion === true ||
  member.isCompanion === true ||
  member.companion === true ||
  member.role?.toLowerCase() === 'companion' ||
  member.type?.toLowerCase() === 'companion' ||
  member.controller?.toLowerCase() === 'webmcp';

export const getActiveCompanions = (
  scene: CompanionSceneResponse | null | undefined,
): CompanionPartyMember[] => {
  if (!scene) return [];
  const party = asObject(scene.party);
  const explicitCompanions = Array.isArray(scene.companions) || Array.isArray(party?.companions);
  const members = partyMembersFromScene(scene).filter(isActive);
  if (explicitCompanions) return members;

  const markedCompanions = members.filter(isCompanionMember);
  if (markedCompanions.length > 0) return markedCompanions;

  // The redacted route returns the main character followed by active companion
  // roster entries without private IDs or controller fields. Preserve that
  // public ordering as the final, route-contract-compatible fallback.
  if (Array.isArray(scene.party) && scene.party.length > 1) return members.slice(1);
  if (Array.isArray(party?.members) && party.members.length > 1) return members.slice(1);
  return [];
};

export const getPartyClass = (member: CompanionPartyMember): string | null =>
  nestedName(member.class ?? member.class_name);

export const getPartyLevel = (member: CompanionPartyMember): number | null =>
  asNumber(member.level);

export const getPartyHitPoints = (
  member: CompanionPartyMember,
): { current: number; max: number } | null => {
  const current = asNumber(member.current_hp ?? member.currentHitPoints);
  const max = asNumber(member.max_hp ?? member.maxHitPoints);
  return current !== null && max !== null ? { current, max } : null;
};

export const getCompanionId = (value: unknown): string | null => {
  const object = asObject(value);
  if (!object) return null;
  const direct = asString(object.companion_id ?? object.companionId);
  if (direct) return direct;
  const companion = asObject(object.companion);
  return asString(companion?.id) ?? asString(object.id);
};

export const getSceneCompanionId = (scene: CompanionSceneResponse): string | null =>
  asString(scene.your_companion_id ?? scene.companion_id) ??
  (Array.isArray(scene.companions) && scene.companions.length === 1
    ? getCompanionId(scene.companions[0])
    : null);

export const getCombatEncounterId = (combat: CompanionCombat): string | null =>
  asString(combat.encounter_id ?? combat.encounterId ?? combat.id);

export const getCombatActorId = (combat: CompanionCombat): string | null =>
  asString(
    combat.your_companion_participant_id ?? combat.companion_participant_id ?? combat.actor_id,
  );
