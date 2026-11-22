/**
 * #1703: single rule for whether a session is a finished one-shot.
 *
 * A one-shot ends the adventure only when the engine completes it with a non-empty completion
 * summary. Ending a session by hand (End session -> POST /v1/sessions/:id/complete with no
 * summary) leaves summary null/blank, so the session stays resumable and shows the two choices.
 */
export function isFinishedOneShotSession(session: {
  status?: string | null;
  campaignLength?: string | null;
  summary?: string | null;
}): boolean {
  return (
    session.status === 'completed' &&
    session.campaignLength === 'one-shot' &&
    typeof session.summary === 'string' &&
    session.summary.trim().length > 0
  );
}
