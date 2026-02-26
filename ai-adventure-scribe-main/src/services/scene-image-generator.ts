import { openRouterService, type UploadOptions } from './openrouter-service';

import type { Character } from '@/types/character';

import logger from '@/lib/logger';

type Quality = 'low' | 'medium' | 'high';

export interface AssetReference {
  url: string;
  type: 'npc' | 'location' | 'item' | 'monster' | 'scene' | 'character';
  name: string;
}

export interface SceneImageRequest {
  sceneText: string;
  campaign?: {
    id?: string;
    name?: string;
    genre?: string | null;
    tone?: string | null;
    atmosphere?: string | null;
    era?: string | null;
    location?: string | null;
    background_image?: string | null;
  };
  character?: Pick<
    Character,
    | 'name'
    | 'race'
    | 'subrace'
    | 'class'
    | 'appearance'
    | 'personality_notes'
    | 'avatar_url'
    | 'image_url'
    | 'theme'
  > | null;
  quality?: Quality;
  model?: string;
  storage?: UploadOptions;
  referenceImageUrl?: string | null; // Optional explicit reference image URL
  assetUrls?: AssetReference[]; // Campaign assets from message (NPCs, locations, etc.)
}

export interface SceneImageResult {
  url: string;
  prompt: string;
  model: string;
  quality: Quality;
}

/**
 * Generate a scene image grounded in campaign tone and character style.
 * Uses server-proxied image generation, then uploads to Supabase storage.
 */
export async function generateSceneImage(req: SceneImageRequest): Promise<SceneImageResult> {
  const quality: Quality =
    req.quality || (import.meta.env.VITE_DM_IMAGE_QUALITY as Quality) || 'low';
  const model = req.model || 'google/gemini-2.5-flash-image';

  const prompt = buildPrompt(req);

  // Collect all reference images (character avatar + campaign assets)
  const referenceBase64s: string[] = [];

  // 1. Character avatar (highest priority - always first)
  const charUrl = req.referenceImageUrl || req.character?.avatar_url || req.character?.image_url;
  if (charUrl) {
    try {
      referenceBase64s.push(await fetchImageAsBase64(charUrl));
    } catch (e) {
      logger.warn('[SceneImage] Failed to fetch character reference image');
    }
  }

  // 2. Campaign assets from message (prioritize locations, then NPCs)
  if (req.assetUrls?.length) {
    const assetPriority: Record<string, number> = {
      location: 0,
      scene: 1,
      npc: 2,
      character: 3,
      monster: 4,
      item: 5,
    };
    const sortedAssets = [...req.assetUrls].sort(
      (a, b) => (assetPriority[a.type] ?? 6) - (assetPriority[b.type] ?? 6),
    );

    // Limit to 3 additional assets (4 total with character)
    for (const asset of sortedAssets.slice(0, 3)) {
      try {
        referenceBase64s.push(await fetchImageAsBase64(asset.url));
        logger.info('[SceneImage] Added asset reference', { type: asset.type, name: asset.name });
      } catch (e) {
        logger.warn('[SceneImage] Failed to fetch asset reference', {
          type: asset.type,
          name: asset.name,
        });
      }
    }
  }

  // 3. Fallback to campaign background if no other references
  if (referenceBase64s.length === 0 && req.campaign?.background_image) {
    try {
      referenceBase64s.push(await fetchImageAsBase64(req.campaign.background_image));
    } catch (e) {
      logger.warn('[SceneImage] Failed to fetch campaign background');
    }
  }

  const t0 = performance.now();
  logger.info('[SceneImage] Generating image', {
    model,
    quality,
    promptLen: prompt.length,
    referenceCount: referenceBase64s.length,
  });
  const base64 = await openRouterService.generateImage({
    prompt,
    model,
    referenceImages: referenceBase64s.length > 0 ? referenceBase64s : undefined,
    quality,
  });

  const uploadedUrl = await openRouterService.uploadImage(
    base64,
    req.storage || defaultStorage(req),
  );
  const ms = Math.round(performance.now() - t0);
  logger.info('[SceneImage] Uploaded image', { ms, urlPreview: uploadedUrl?.slice(0, 60) });
  return { url: uploadedUrl, prompt, model, quality };
}

function defaultStorage(req: SceneImageRequest): UploadOptions {
  const label = `scene`;
  if (req.campaign?.id) {
    return { entityType: 'campaign', entityId: req.campaign.id, label };
  }
  return { label };
}

function buildPrompt(req: SceneImageRequest): string {
  const parts: string[] = [];
  parts.push('Create a high-quality fantasy illustration of the described scene.');
  if (req.campaign?.name) parts.push(`World: ${req.campaign.name}.`);
  if (req.campaign?.genre) parts.push(`Genre: ${req.campaign.genre}.`);
  if (req.campaign?.tone) parts.push(`Tone: ${req.campaign.tone}.`);
  if (req.campaign?.atmosphere) parts.push(`Atmosphere: ${req.campaign.atmosphere}.`);
  if (req.campaign?.era || req.campaign?.location) {
    parts.push(
      `Setting: ${[req.campaign.location, req.campaign.era].filter(Boolean).join(' / ')}.`,
    );
  }

  if (req.character) {
    const c = req.character;
    const race = c.subrace?.name || (typeof c.race === 'string' ? c.race : (c.race as any)?.name);
    const klass = (typeof c.class === 'string' ? c.class : c.class?.name) || '';
    const desc: string[] = [];
    if (race) desc.push(race);
    if (klass) desc.push(klass);
    if (c.appearance) desc.push(String(c.appearance));
    if (c.personality_notes) desc.push(String(c.personality_notes));
    if (c.theme) desc.push(`Theme: ${c.theme}`);
    if (desc.length) parts.push(`Character cues: ${desc.join(', ')}.`);
  }

  // Core scene content last so it has the most weight
  parts.push(`Scene: ${truncate(req.sceneText, 800)}`);

  // Technical preferences
  parts.push('Style: epic fantasy art, cinematic composition, sharp focus, dramatic lighting.');
  parts.push('Do not include UI text or overlays. No watermarks.');

  return parts.join(' ');
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType?.startsWith('image/')) {
    throw new Error(`Invalid content-type: ${contentType}, expected image/*`);
  }

  const blob = await res.blob();
  const base64 = await blobToBase64(blob);
  // Strip prefix for API compatibility
  const cleaned = base64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
  return cleaned;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
