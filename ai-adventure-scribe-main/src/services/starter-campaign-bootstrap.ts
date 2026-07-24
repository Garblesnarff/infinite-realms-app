import type { CampaignPayload } from '@/services/user-data-api';

export interface StarterCampaignBootstrapSource {
  id: string;
  title: string;
  premise: string;
  genre: string[];
  tone: string[];
  difficulty: string;
  coverImageUrl: string | null;
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
    campaign_length: 'full',
    status: 'active',
    background_image: starter.coverImageUrl,
  });
  log(`Created new campaign ${campaign.id} for starter ${starter.id}`);
  return campaign.id;
}
