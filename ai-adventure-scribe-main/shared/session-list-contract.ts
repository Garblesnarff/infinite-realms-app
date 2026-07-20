export const SESSION_LIST_API_FIELDS = [
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
] as const;

export interface SessionListSource {
  id: string;
  campaignId: string | null;
  characterId: string | null;
  sessionNumber: number | null;
  startTime: Date | null;
  endTime: Date | null;
  status: string | null;
  currentSceneDescription: string | null;
  summary: string | null;
  sessionNotes: string | null;
  turnCount: number | null;
  sessionState: unknown;
  starterCampaignId: string | null;
  campaignVersion: number | null;
  ruleset: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
}

type SessionListTimestamp = Date | string | null;

export interface SessionListApiRow {
  id: string;
  campaign_id: string | null;
  character_id: string | null;
  session_number: number | null;
  start_time: SessionListTimestamp;
  end_time: SessionListTimestamp;
  status: string | null;
  current_scene_description: string | null;
  summary: string | null;
  session_notes: string | null;
  turn_count: number | null;
  session_state: unknown;
  starter_campaign_id: string | null;
  campaign_version: number | null;
  ruleset: unknown;
  created_at: SessionListTimestamp;
  updated_at: SessionListTimestamp;
  character: unknown;
  session_chronicles: unknown[];
}

export function mapSessionListApiRow(
  session: SessionListSource,
  character: unknown,
  sessionChronicles: unknown[],
): SessionListApiRow {
  return {
    id: session.id,
    campaign_id: session.campaignId,
    character_id: session.characterId,
    session_number: session.sessionNumber,
    start_time: session.startTime,
    end_time: session.endTime,
    status: session.status,
    current_scene_description: session.currentSceneDescription,
    summary: session.summary,
    session_notes: session.sessionNotes,
    turn_count: session.turnCount,
    session_state: session.sessionState,
    starter_campaign_id: session.starterCampaignId,
    campaign_version: session.campaignVersion,
    ruleset: session.ruleset,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    character,
    session_chronicles: sessionChronicles,
  };
}

/**
 * Resolve a starter link from a list requested with starter_only=true.
 * An empty list is a valid "not a starter campaign" result. A returned row
 * without the documented snake_case link is a broken response contract.
 */
export function resolveStarterCampaignIdFromSessionList(value: unknown): string | null {
  if (!Array.isArray(value)) {
    throw new Error('Session list returned a malformed response');
  }
  if (value.length === 0) return null;

  const [session] = value;
  if (
    !session ||
    typeof session !== 'object' ||
    !Object.prototype.hasOwnProperty.call(session, 'starter_campaign_id') ||
    typeof (session as { starter_campaign_id?: unknown }).starter_campaign_id !== 'string' ||
    !(session as { starter_campaign_id: string }).starter_campaign_id.trim()
  ) {
    throw new Error('Session list omitted a valid starter_campaign_id');
  }

  return (session as { starter_campaign_id: string }).starter_campaign_id;
}
