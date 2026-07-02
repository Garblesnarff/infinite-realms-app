/**
 * Builds the generateSceneImage() request payload from campaign/character
 * context, split out of useImageGeneration.ts.
 */

import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';

import { type AssetReference, type SceneImageRequest } from '@/services/scene-image-generator';

// Campaign objects that may carry runtime enhancement data not yet
// reflected in the Campaign interface.
export type CampaignContext = Campaign & { enhancementEffects?: { atmosphere?: string[] } };

interface BuildSceneImageRequestParams {
  sceneText: string;
  campaign: CampaignContext | null;
  character: Character | null;
  routeCampaignId?: string;
  assetUrls: AssetReference[];
  label: string;
  quality: 'low' | 'medium' | 'high';
  model: string;
}

export function buildSceneImageRequest({
  sceneText,
  campaign,
  character,
  routeCampaignId,
  assetUrls,
  label,
  quality,
  model,
}: BuildSceneImageRequestParams): SceneImageRequest {
  return {
    sceneText,
    campaign: {
      id: routeCampaignId || undefined,
      name: campaign?.name,
      genre: campaign?.genre || undefined,
      tone: campaign?.tone || undefined,
      atmosphere: campaign?.enhancementEffects?.atmosphere?.[0] || undefined,
    },
    character: character
      ? {
          name: character.name,
          race: character.race,
          subrace: character.subrace,
          class: character.class,
          appearance: character.appearance || undefined,
          personality_notes: character.personalityNotes || character.personality_notes || undefined,
          avatar_url: character.avatar_url || undefined,
          image_url: character.image_url || undefined,
          theme: character.theme || undefined,
        }
      : null,
    assetUrls: assetUrls.length > 0 ? assetUrls : undefined,
    quality,
    model,
    storage: routeCampaignId
      ? { entityType: 'campaign', entityId: routeCampaignId, label }
      : { label },
  };
}
