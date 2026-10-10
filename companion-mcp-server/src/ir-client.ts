/**
 * Thin HTTP client for the Infinite Realms companion API
 * (ai-adventure-scribe-main/server-bun/src/routes/v1/companion-routes.ts).
 *
 * Response shapes are imported type-only from the real service so they
 * cannot drift from what production sends. The demo token travels only in
 * the Authorization header and is never included in errors or logs.
 */

import type {
  ActiveCompanion,
  CompanionPublicRow,
  CompanionRollRequest,
  CompanionRollResult,
  PartyRosterMember,
  RedactedScene,
} from '../../ai-adventure-scribe-main/server-bun/src/services/session/companion-service.js';

export interface JoinResult {
  companion: CompanionPublicRow;
  party: PartyRosterMember[];
}

export interface ListResult {
  companions: ActiveCompanion[];
}

export interface LeaveResult {
  companion: CompanionPublicRow;
}

export interface SayResult {
  message: {
    id: string;
    session_id: string;
    speaker_type: string;
    text: string;
  };
}

export class IrApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(IrApiError.describe(status, body));
    this.name = 'IrApiError';
  }

  private static describe(status: number, body: unknown): string {
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const nested = record.error as Record<string, unknown> | undefined;
      const message =
        (typeof nested?.message === 'string' && nested.message) ||
        (typeof record.error === 'string' && record.error) ||
        (typeof record.message === 'string' && record.message);
      if (message) return `IR API error ${status}: ${message}`;
    }
    return `IR API request failed with status ${status}`;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

export class CompanionApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly demoToken: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.demoToken}`,
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `IR API request to ${path} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!response.ok) throw new IrApiError(response.status, body);
    return body as T;
  }

  join(sessionId: string, characterId: string): Promise<JoinResult> {
    return this.request<JoinResult>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/companions`,
      {
        method: 'POST',
        body: JSON.stringify({ character_id: characterId }),
      },
    );
  }

  list(sessionId: string): Promise<ListResult> {
    return this.request<ListResult>(`/v1/sessions/${encodeURIComponent(sessionId)}/companions`);
  }

  leave(sessionId: string, companionId: string): Promise<LeaveResult> {
    return this.request<LeaveResult>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/companions/${encodeURIComponent(companionId)}`,
      { method: 'DELETE' },
    );
  }

  scene(sessionId: string, companionId?: string): Promise<RedactedScene> {
    const query = companionId ? `?companion_id=${encodeURIComponent(companionId)}` : '';
    return this.request<RedactedScene>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/scene${query}`,
    );
  }

  say(sessionId: string, companionId: string, text: string): Promise<SayResult> {
    return this.request<SayResult>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/companions/${encodeURIComponent(companionId)}/say`,
      {
        method: 'POST',
        body: JSON.stringify({ text }),
      },
    );
  }

  roll(
    sessionId: string,
    companionId: string,
    roll: CompanionRollRequest,
  ): Promise<CompanionRollResult> {
    return this.request<CompanionRollResult>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/companions/${encodeURIComponent(companionId)}/roll`,
      { method: 'POST', body: JSON.stringify(roll) },
    );
  }
}
