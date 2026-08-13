type SessionTimestamp = string | null;

type SessionWithCreatedAt = {
  id: string;
  created_at: SessionTimestamp;
};

function createdAtTime(value: SessionTimestamp): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

/**
 * Derive the campaign-local number shown in the session list.
 *
 * The stored session_number is a continuation value and is commonly 1 for
 * independently started sessions, so the list display uses creation order.
 */
export function getCampaignSessionNumbers(
  sessions: readonly SessionWithCreatedAt[],
): Map<string, number> {
  const chronological = [...sessions].sort((left, right) => {
    const timeDifference = createdAtTime(left.created_at) - createdAtTime(right.created_at);
    return timeDifference || left.id.localeCompare(right.id);
  });

  return new Map(chronological.map((session, index) => [session.id, index + 1]));
}
