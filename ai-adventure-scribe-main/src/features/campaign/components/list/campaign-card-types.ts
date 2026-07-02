export interface CampaignCardData {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  difficulty_level: string | null;
  campaign_length: string | null;
  tone: string | null;
  background_image?: string | null;
}
