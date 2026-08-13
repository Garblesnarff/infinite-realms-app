/* eslint-disable max-lines, no-console */
import { loginWithPassword } from '../shared/auth/headless-auth';

const DEFAULT_BASE_URL = 'http://localhost:8888';
const REQUEST_TIMEOUT_MS = 75_000;
const SESSIONLESS_ID = '00000000-0000-4000-8000-000000000000';
const SESSION_LIST_FIELDS = [
  'id',
  'campaign_id',
  'character_id',
  'session_number',
  'start_time',
  'end_time',
  'status',
  'current_scene_description',
  'summary',
  'session_notes',
  'turn_count',
  'session_state',
  'starter_campaign_id',
  'campaign_version',
  'ruleset',
  'created_at',
  'updated_at',
  'character',
  'session_chronicles',
];
const SESSION_CONTEXT_FIELDS = [
  'id',
  'campaign_id',
  'character_id',
  'session_number',
  'start_time',
  'end_time',
  'status',
  'current_scene_description',
  'summary',
  'session_notes',
  'turn_count',
  'starter_campaign_id',
  'campaign_version',
  'ruleset',
  'created_at',
  'updated_at',
  'campaign',
  'character',
];

export type SmokeStatus = 'PASS' | 'FAIL';

export interface SmokeResult {
  name: string;
  status: SmokeStatus;
  detail: string;
}

export interface SmokeOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasFields = (value: unknown, fields: string[]): value is JsonRecord =>
  isRecord(value) && fields.every((field) => Object.hasOwn(value, field));

const contentTypeIsJson = (response: Response): boolean =>
  (response.headers.get('content-type') || '').toLowerCase().includes('application/json');

async function readJson(response: Response): Promise<{ raw: string; json: unknown }> {
  const raw = await response.text();
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    return { raw, json: null };
  }
}

const realisticPrompt = `You are the dungeon master for a D&D 5e game. The party has just entered a candlelit banquet hall where every guest is frozen in place. In 2-3 sentences, describe one sensory detail and end by asking the player what they do.`;

export async function runApiSmoke(options: SmokeOptions = {}): Promise<SmokeResult[]> {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const log = options.log || console.log;
  const baseUrl = (env.API_SMOKE_BASE_URL || env.LLM_SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    '',
  );
  let token = env.LLM_SMOKE_BEARER_TOKEN;
  const requireAuth = env.API_SMOKE_REQUIRE_AUTH === '1' || env.API_SMOKE_REQUIRE_AUTH === 'true';
  const allowInfraSkips =
    env.API_SMOKE_ALLOW_INFRA_SKIPS === '1' || env.API_SMOKE_ALLOW_INFRA_SKIPS === 'true';
  const results: SmokeResult[] = [];
  let sessions: unknown[] = [];

  const record = (name: string, status: SmokeStatus, detail: string): void => {
    const result = { name, status, detail };
    results.push(result);
    log(`${status} ${name} - ${detail}`);
  };

  const request = (path: string, init?: RequestInit): Promise<Response> =>
    fetchImpl(`${baseUrl}${path}`, {
      ...init,
      signal: init?.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  if (!token && env.SMOKE_EMAIL && env.SMOKE_PASSWORD) {
    try {
      token = (
        await loginWithPassword({
          baseUrl,
          email: env.SMOKE_EMAIL,
          password: env.SMOKE_PASSWORD,
          fetchImpl,
        })
      ).accessToken;
      record('password-login', 'PASS', 'received WorkOS access token');
    } catch (error) {
      record('password-login', 'FAIL', error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const response = await request('/health');
    const { json } = await readJson(response);
    const status = isRecord(json) ? json.status : undefined;
    const modelHealth = isRecord(json) && isRecord(json.modelHealth) ? json.modelHealth : null;
    const providers = modelHealth ? [modelHealth.openrouter, modelHealth.gemini] : [];
    const unknownModels = providers.flatMap((provider) =>
      isRecord(provider) && Array.isArray(provider.unlistedModels)
        ? provider.unlistedModels.filter((model): model is string => typeof model === 'string')
        : [],
    );

    if (response.status !== 200 || !contentTypeIsJson(response) || !isRecord(json)) {
      record('health', 'FAIL', `expected 200 application/json object; got ${response.status}`);
    } else if (status === 'down') {
      record('health', 'FAIL', 'service reports down');
    } else if (unknownModels.length > 0) {
      record('health', 'FAIL', `configured model not listed: ${unknownModels.join(', ')}`);
    } else if (status === 'degraded') {
      record('health', 'PASS', 'WARN service is degraded for a non-model-list reason');
    } else if (status !== 'healthy') {
      record('health', 'FAIL', `unexpected health status ${String(status)}`);
    } else {
      record('health', 'PASS', 'healthy JSON response');
    }
  } catch (error) {
    record('health', 'FAIL', error instanceof Error ? error.message : String(error));
  }

  try {
    const response = await request('/v1/starter-character-templates?campaign_id=the-eternal-feast');
    const { raw, json } = await readJson(response);
    if (
      response.status === 200 &&
      contentTypeIsJson(response) &&
      Array.isArray(json) &&
      json.length >= 5 &&
      raw.length > 5 * 1024
    ) {
      record(
        'starter-character-templates',
        'PASS',
        `${json.length} templates, ${raw.length} bytes`,
      );
    } else if (allowInfraSkips && response.status >= 500) {
      record(
        'starter-character-templates',
        'PASS',
        `SKIP local database-backed endpoint unavailable (${response.status})`,
      );
    } else {
      record(
        'starter-character-templates',
        'FAIL',
        `expected 200 JSON array (>=5, >5KB); got ${response.status}, ${raw.length} bytes`,
      );
    }
  } catch (error) {
    record(
      'starter-character-templates',
      'FAIL',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!token) {
    const status: SmokeStatus = requireAuth ? 'FAIL' : 'PASS';
    const detail = requireAuth
      ? 'LLM_SMOKE_BEARER_TOKEN is required'
      : 'SKIP no LLM_SMOKE_BEARER_TOKEN (public checks only)';
    for (const name of ['sessions-list', 'session-context', 'llm-generate', 'tactical-map-404']) {
      record(name, status, detail);
    }
    return results;
  }

  const authHeaders = { Authorization: `Bearer ${token}` };

  try {
    const response = await request('/v1/sessions', { headers: authHeaders });
    const { json } = await readJson(response);
    sessions = Array.isArray(json) ? json : [];
    const row = sessions[0];
    if (
      response.status === 200 &&
      contentTypeIsJson(response) &&
      sessions.length > 0 &&
      hasFields(row, SESSION_LIST_FIELDS) &&
      typeof row.id === 'string'
    ) {
      record('sessions-list', 'PASS', `${sessions.length} session(s), contract fields present`);
    } else {
      record(
        'sessions-list',
        'FAIL',
        `expected non-empty 200 JSON array with all session contract fields; got ${response.status}`,
      );
    }
  } catch (error) {
    record('sessions-list', 'FAIL', error instanceof Error ? error.message : String(error));
  }

  const firstSession = sessions[0];
  const sessionId =
    env.API_SMOKE_SESSION_ID ||
    (isRecord(firstSession) && typeof firstSession.id === 'string' ? firstSession.id : undefined);
  if (!sessionId) {
    record('session-context', 'FAIL', 'no API_SMOKE_SESSION_ID and session list was empty');
  } else {
    try {
      const response = await request(`/v1/sessions/${encodeURIComponent(sessionId)}/context`, {
        headers: authHeaders,
      });
      const { json } = await readJson(response);
      const valid =
        hasFields(json, SESSION_CONTEXT_FIELDS) &&
        hasFields(json.campaign, ['id', 'name', 'description']) &&
        hasFields(json.character, [
          'id',
          'name',
          'level',
          'race',
          'class',
          'background',
          'character_stats',
        ]) &&
        Array.isArray(json.character.character_stats);
      if (response.status === 200 && contentTypeIsJson(response) && valid) {
        record('session-context', 'PASS', `joined context contract present for ${sessionId}`);
      } else {
        record(
          'session-context',
          'FAIL',
          `expected 200 joined JSON context; got ${response.status}`,
        );
      }
    } catch (error) {
      record('session-context', 'FAIL', error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const response = await request('/v1/llm/generate', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        'X-Request-Id': `api-smoke-${Date.now()}`,
      },
      body: JSON.stringify({
        prompt: realisticPrompt,
        maxTokens: 120,
        temperature: 0.4,
        provider: env.LLM_SMOKE_PROVIDER || 'openrouter',
        requestType: 'user',
      }),
    });
    const { json } = await readJson(response);
    if (
      response.status === 200 &&
      contentTypeIsJson(response) &&
      isRecord(json) &&
      typeof json.text === 'string' &&
      json.text.trim().length > 0
    ) {
      record('llm-generate', 'PASS', `${json.text.trim().length} response characters`);
    } else {
      const error = isRecord(json) && typeof json.error === 'string' ? `: ${json.error}` : '';
      record(
        'llm-generate',
        'FAIL',
        `expected 200 JSON with non-empty text; got ${response.status}${error}`,
      );
    }
  } catch (error) {
    record('llm-generate', 'FAIL', error instanceof Error ? error.message : String(error));
  }

  try {
    const response = await request(`/v1/sessions/${SESSIONLESS_ID}/tactical-map`, {
      headers: authHeaders,
    });
    const { raw, json } = await readJson(response);
    if (
      response.status === 404 &&
      contentTypeIsJson(response) &&
      isRecord(json) &&
      typeof json.error === 'string' &&
      !raw.trimStart().startsWith('<')
    ) {
      record('tactical-map-404', 'PASS', 'clean 404 JSON error');
    } else {
      record('tactical-map-404', 'FAIL', `expected 404 JSON error; got ${response.status}`);
    }
  } catch (error) {
    record('tactical-map-404', 'FAIL', error instanceof Error ? error.message : String(error));
  }

  return results;
}

if (import.meta.main) {
  const results = await runApiSmoke();
  if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
}
