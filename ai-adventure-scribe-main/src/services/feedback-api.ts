import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import { APP_BUILD_SHORT } from '@/services/app-version';

export const FEEDBACK_MESSAGE_MAX = 4_000;

export interface FeedbackPayload {
  message: string;
  page: string;
  build?: string;
  campaignSlug?: string;
  sessionId?: string;
}

/** The deployed build GET /version reports (`short`); the bundle's own stamp if it can't answer. */
export async function fetchBuild(): Promise<string> {
  try {
    const res = await fetchWithAuth('/version', { retryBudgetMs: 0 });
    if (res.ok) {
      const { short } = (await res.json()) as { short?: unknown };
      if (typeof short === 'string' && short) return short;
    }
  } catch {
    // Fall through: feedback must not fail because /version did.
  }
  return APP_BUILD_SHORT;
}

/** POST /v1/feedback. The server adds the user id from the bearer token when one is sent. */
export async function submitFeedback(payload: Omit<FeedbackPayload, 'build'>): Promise<void> {
  const build = await fetchBuild();
  const res = await fetchWithAuth('/v1/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, build }),
  });
  if (!res.ok) {
    throw new Error(res.status === 429 ? 'Too many messages. Try again later.' : 'Could not send');
  }
}
