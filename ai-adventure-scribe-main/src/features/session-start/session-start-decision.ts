import { userDataApi } from '@/services/user-data-api';

/**
 * ONE shared session-start decision (#1380), extracted from
 * CampaignSelectionModal.handleStartSession (#1359) so every entry point
 * that starts a hero on a campaign decides the same way:
 *
 * - an active session resumes exactly (creating would retire it server-side);
 * - a completed session continues through the game route, which creates the
 *   N+1 continuation itself — the same path premade Play-as uses — so
 *   "Rest first?" fires below max HP. The chain's starter link rides along
 *   when the latest completed row carries one;
 * - no sessions at all keeps the caller's old create path.
 *
 * A failed session read is the caller's problem to fail closed on (toast,
 * no create, no navigate): creating blind would strand the unread
 * playthrough behind a fresh session 1.
 *
 * No picker here on purpose: a single character id is one chain (ac-1355).
 * The picker exists one level up, for premade name collisions — several
 * character rows sharing one hero name — where buildSavedPlaythroughs
 * returns more than one row (CampaignDetailPage, CharacterSelectionModal
 * template picks).
 */
export type PairSessionStartDecision =
  | { kind: 'resume'; sessionId: string }
  | { kind: 'continue'; starterCampaignId: string | null }
  | { kind: 'create' };

type SessionRow = Record<string, unknown>;

const asRecord = (value: unknown): SessionRow | null =>
  typeof value === 'object' && value !== null ? (value as SessionRow) : null;

export function decidePairSessionStart(
  sessions: readonly unknown[],
  fallbackStarterCampaignId?: string | null,
): PairSessionStartDecision {
  const rows = sessions
    .map(asRecord)
    .filter((row): row is SessionRow => row !== null)
    // Highest session number first: the chain's latest row carries the
    // starter link, whatever order the list endpoint returns.
    .sort(
      (a, b) =>
        (typeof b.session_number === 'number' ? b.session_number : 0) -
        (typeof a.session_number === 'number' ? a.session_number : 0),
    );
  const active = rows.find((row) => row.status === 'active');
  if (active && typeof active.id === 'string') {
    return { kind: 'resume', sessionId: active.id };
  }
  const completed = rows.find((row) => row.status === 'completed');
  if (completed) {
    const fromRow =
      typeof completed.starter_campaign_id === 'string' && completed.starter_campaign_id.length > 0
        ? completed.starter_campaign_id
        : null;
    return { kind: 'continue', starterCampaignId: fromRow ?? fallbackStarterCampaignId ?? null };
  }
  return { kind: 'create' };
}

/** Page the pair's sessions (pageSize 100, as #1359 did) and decide. */
export async function loadPairSessionStart(input: {
  campaignId: string;
  characterId: string;
  fallbackStarterCampaignId?: string | null;
}): Promise<PairSessionStartDecision> {
  const sessions: unknown[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = await userDataApi.listSessions({
      campaignId: input.campaignId,
      characterId: input.characterId,
      limit: pageSize,
      offset,
    });
    sessions.push(...page);
    if (page.length < pageSize) break;
  }
  return decidePairSessionStart(sessions, input.fallbackStarterCampaignId);
}

/**
 * Game-route target for a resume/continue decision — the modal's exact
 * shapes (#1359): resume carries ?session=, continue carries the starter
 * link when the chain has one, and neither carries ?new=true (the game
 * route's own init resumes the active session or creates the N+1).
 * Returns null for 'create': the caller keeps its own create path.
 */
export function sessionStartGameTarget(input: {
  campaignId: string;
  characterId: string;
  decision: PairSessionStartDecision;
}): string | null {
  const base = `/app/game/${input.campaignId}?character=${input.characterId}`;
  if (input.decision.kind === 'resume') {
    return `${base}&session=${input.decision.sessionId}`;
  }
  if (input.decision.kind === 'continue') {
    return input.decision.starterCampaignId
      ? `${base}&starterCampaign=${encodeURIComponent(input.decision.starterCampaignId)}`
      : base;
  }
  return null;
}
