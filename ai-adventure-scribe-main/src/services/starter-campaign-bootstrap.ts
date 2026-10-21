import type { CampaignPayload } from '@/services/user-data-api';

export interface StarterCampaignBootstrapSource {
  id: string;
  title: string;
  premise: string;
  genre: string[];
  tone: string[];
  difficulty: string;
  coverImageUrl: string | null;
  estimatedSessions?: string | null;
  overview?: string | null;
}

// The lengths a starter can declare. 'short' is absent on purpose: it is
// only ever chosen by hand in the creation wizard — no starter data
// declares it, and no consumer defines its session boundary.
export type StarterCampaignLength = 'one-shot' | 'full';

/**
 * The overview's Estimated Length value: the rest of that line after the
 * label, or the next non-empty line when the value wraps. Null when the
 * overview declares no length line.
 */
function overviewLengthText(overview: string): string | null {
  const lines = overview.split('\n');
  const index = lines.findIndex((line) => /estimated length/i.test(line));
  if (index === -1) {
    return null;
  }
  const afterLabel = lines[index].replace(/^.*?estimated length\*{0,2}:?\*{0,2}/i, '').trim();
  if (afterLabel) {
    return afterLabel;
  }
  return (
    lines
      .slice(index + 1)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? null
  );
}

/**
 * Read a length from an Estimated Length value. The session count is the
 * number or range directly before "session(s)"; parentheticals are
 * ignored (a one-shot's "(2–4 hours)" is a duration, not a session
 * count). A bare "One-shot" label with no count also reads as a
 * one-shot. Null when the value declares no readable length.
 */
function lengthFromLengthText(text: string): StarterCampaignLength | null {
  const withoutParentheticals = text.replace(/\([^)]*\)/g, ' ');
  const sessions = withoutParentheticals.match(/(\d+)\s*(?:[-–]\s*(\d+))?\s*sessions?\b/i);
  if (sessions) {
    const highest = Math.max(Number(sessions[1]), sessions[2] ? Number(sessions[2]) : 0);
    return highest === 1 ? 'one-shot' : 'full';
  }
  if (/^one[\s-]?shot\b/i.test(text)) {
    return 'one-shot';
  }
  return null;
}

/**
 * The campaign_length a bootstrapped campaign inherits from its starter
 * (#829 finding 7 — this used to be hard-coded to 'full', so a one-shot
 * starter became a full campaign).
 *
 * The starter's own data, in its order of authority:
 * 1. The overview's Estimated Length line ("One-shot — 1 session
 *    (2–4 hours)", "1 session", "8–10 sessions"). It wins over the
 *    parsed field in both directions: rows ingested before the parser
 *    fix (finding 6) can carry the "2–4" hours range in
 *    estimatedSessions, while the overview line still reads correctly.
 * 2. estimatedSessions topping out at 1 — the parser's value for a
 *    one-shot once finding 6 is fixed, for records whose overview is
 *    not carried.
 *
 * Everything else stays 'full': no consumer in the app defines a
 * session boundary between 'short' and 'full', so a multi-session
 * estimate alone does not relabel a campaign.
 */
export function starterCampaignLength(
  starter: StarterCampaignBootstrapSource,
): StarterCampaignLength {
  const lengthText = starter.overview ? overviewLengthText(starter.overview) : null;
  if (lengthText) {
    const fromOverview = lengthFromLengthText(lengthText);
    if (fromOverview) {
      return fromOverview;
    }
  }
  const sessionCounts = (starter.estimatedSessions?.match(/\d+/g) ?? []).map(Number);
  if (sessionCounts.length > 0 && Math.max(...sessionCounts) === 1) {
    return 'one-shot';
  }
  return 'full';
}

export interface StarterCampaignBootstrapApi {
  listCampaigns(): Promise<Array<{ id: string; name: string }>>;
  createCampaign(payload: CampaignPayload): Promise<{ id: string }>;
}

/**
 * The campaign-row half of the browser's starter onboarding flow. Keeping it
 * here lets headless clients reuse the same ownership-scoped API behavior.
 */
export async function resolveOrCreateStarterCampaign(
  starter: StarterCampaignBootstrapSource,
  api: StarterCampaignBootstrapApi,
  log: (message: string) => void = () => undefined,
): Promise<string> {
  const existingCampaign = (await api.listCampaigns()).find(
    (candidate) => candidate.name === starter.title,
  );

  if (existingCampaign) {
    log(`Using existing campaign ${existingCampaign.id} for starter ${starter.id}`);
    return existingCampaign.id;
  }

  const campaign = await api.createCampaign({
    name: starter.title,
    description: starter.premise,
    genre: starter.genre[0] || 'fantasy',
    tone: starter.tone[0] || 'epic',
    difficulty_level: starter.difficulty,
    campaign_length: starterCampaignLength(starter),
    status: 'active',
    background_image: starter.coverImageUrl,
  });
  log(`Created new campaign ${campaign.id} for starter ${starter.id}`);
  return campaign.id;
}
