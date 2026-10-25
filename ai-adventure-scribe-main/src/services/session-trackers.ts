import { getAuthHeaders } from '@/services/auth/TokenService';

const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:8888').replace(/\/+$/, '');

export interface SessionTracker {
  name: string;
  value: number;
  limit: number;
}

/**
 * #1095: GET the session's campaign trackers from latest server state.
 * The single GET fallback for every surface the #1062 envelope cannot
 * reach: DM turns the tracker step skipped, the greeting, and the
 * tracker sheet. The envelope stays primary — callers fetch only when
 * it carried nothing.
 *
 * Fail-open like the envelope read, but without inventing an absence:
 * a non-OK response, a malformed body, a network failure, or an
 * aborted request yields null — "unknown" — never invented state. Only
 * a well-formed empty list yields []. The shape check mirrors
 * DMMessage's render check field for field, so a malformed entry drops
 * out rather than printing a half line. Callers that only attach a
 * line treat null as "leave as today"; the sheet renders null as a
 * load failure with a retry, not as "no trackers".
 */
export async function fetchSessionTrackers(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionTracker[] | null> {
  try {
    const response = await fetch(
      `${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/trackers`,
      { headers: getAuthHeaders(), signal },
    );
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { trackers?: unknown } | null;
    if (!body || !Array.isArray(body.trackers)) return null;
    const filtered = body.trackers.filter(
      (entry): entry is SessionTracker =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { name?: unknown }).name === 'string' &&
        (entry as { name: string }).name.trim().length > 0 &&
        Number.isFinite((entry as { value?: unknown }).value) &&
        Number.isFinite((entry as { limit?: unknown }).limit) &&
        (entry as { limit: number }).limit > 0,
    );
    // A list that filters to empty is not an empty list: every entry
    // was malformed, so the state is unknown, not "no trackers".
    if (body.trackers.length > 0 && filtered.length === 0) return null;
    return filtered;
  } catch {
    return null;
  }
}
