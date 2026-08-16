import { useState, useRef, useCallback, useEffect } from 'react';

import { buildSceneImageRequest, type CampaignContext } from './buildSceneImageRequest';
import { extractSceneAssetReferences } from './extractSceneAssetReferences';
import {
  getImageGenerationCap,
  incrementImageGenerationCap,
  hasImageGenerationTriggered,
  MAX_IMAGE_GENERATIONS_PER_SESSION,
  markImageGenerationTriggered,
} from './image-generation-session-cap';

import type { Character } from '@/types/character';
import type { ChatMessage } from '@/types/game';

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { generateSceneImage } from '@/services/scene-image-generator';
import { parseBoundedInteger } from '@/utils/bounded-integer';
import { handleAsyncError } from '@/utils/error-handler';
import { generateImageLabel } from '@/utils/image-label-generator';
import { parseMessageOptions } from '@/utils/parseMessageOptions';
import { removeRollRequestsFromMessage } from '@/utils/rollRequestParser';

const env = import.meta.env as Record<string, string | undefined>;
const IMAGE_MAX = parseBoundedInteger(env.VITE_DM_IMAGE_MAX_PER_SESSION, {
  fallback: 3,
  min: 0,
  max: MAX_IMAGE_GENERATIONS_PER_SESSION,
});

interface UseImageGenerationProps {
  sessionId?: string;
  routeCampaignId?: string;
  character: Character | null;
  campaign: CampaignContext | null;
  messages: ChatMessage[];
  getAssetImageUrl?: (type: string, key: string) => string | null;
}

/**
 * Hook to manage image generation for DM messages
 * Handles auto-generation, per-session caps, and localStorage caching
 */
export const useImageGeneration = ({
  sessionId,
  routeCampaignId,
  character,
  campaign,
  messages,
  getAssetImageUrl,
}: UseImageGenerationProps) => {
  const [generatingFor, setGeneratingFor] = useState<Set<string>>(new Set());
  const [imageByMessage, setImageByMessage] = useState<
    Record<string, { url: string; prompt: string }>
  >({});
  const [genErrorByMessage, setGenErrorByMessage] = useState<Record<string, string>>({});
  const lastGenRef = useRef<number>(0);

  // Env flags
  const AUTO = String(env.VITE_DM_AUTO_IMAGE ?? 'false').toLowerCase();
  const isAuto = ['1', 'true', 'yes', 'on'].includes(AUTO);

  const handleGenerateScene = useCallback(
    async (message: ChatMessage & { id?: string; timestamp?: string }) => {
      const messageId = message.id || message.timestamp || `${Math.random()}`;
      try {
        setGenErrorByMessage((prev) => ({ ...prev, [messageId]: '' }));
        setGeneratingFor((prev) => new Set(prev).add(messageId));

        const parsed = parseMessageOptions(message.text || '');
        const baseText = parsed?.content || message.text || '';
        let sceneText = removeRollRequestsFromMessage(baseText);
        const vpMatch = (message.text || '').match(/^[\t ]*VISUAL\s+PROMPT:\s*(.+)$/im);
        if (vpMatch && vpMatch[1]) {
          sceneText += `\nVisual focus: ${vpMatch[1].trim()}`;
        }

        const t0 = performance.now();

        // Extract asset URLs from message for reference images
        const assetUrls = extractSceneAssetReferences(message.text, baseText, getAssetImageUrl);

        // Generate semantic label using campaign name and scene keywords
        // Falls back to 'scene' if no campaign name or scene text available
        const label = generateImageLabel(campaign?.name, sceneText, {
          fallbackLabel: 'scene',
          genre: campaign?.genre || undefined,
          characterName: character?.name || undefined,
        });

        const res = await generateSceneImage(
          buildSceneImageRequest({
            sceneText,
            campaign,
            character,
            routeCampaignId,
            assetUrls,
            label,
            quality: (env.VITE_DM_IMAGE_QUALITY as 'low' | 'medium' | 'high' | undefined) || 'low',
            model: env.VITE_DM_IMAGE_MODEL || 'google/gemini-2.5-flash-image',
          }),
        );

        setImageByMessage((prev) => ({
          ...prev,
          [messageId]: { url: res.url, prompt: res.prompt },
        }));

        if (message.id) {
          try {
            logger.info(
              { messageId: message.id, imageUrl: res.url },
              '[useImageGeneration] Attempting to attach image',
            );

            await llmApiClient.appendMessageImage({
              messageId: message.id,
              image: { url: res.url, prompt: res.prompt, model: res.model, quality: res.quality },
            });

            logger.info(
              { messageId: message.id },
              '[useImageGeneration] ✅ Image attached successfully',
            );
          } catch (persistErr) {
            logger.error(
              { error: persistErr, messageId: message.id },
              '[useImageGeneration] ❌ Image attachment FAILED',
            );
            handleAsyncError(persistErr, {
              userMessage: 'Failed to save generated image',
              logLevel: 'warn',
              showToast: false,
              context: { location: 'useImageGeneration.persist', messageId: message.id },
            });
          }
        }

        setGenErrorByMessage((prev) => {
          const updated = { ...prev };
          delete updated[messageId];
          return updated;
        });
        incrementImageGenerationCap(sessionId);
        lastGenRef.current = performance.now();
        logger.info('[useImageGeneration] Scene image generated', {
          ms: Math.round(lastGenRef.current - t0),
          model: res.model,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to generate image';
        setGenErrorByMessage((prev) => ({ ...prev, [messageId]: msg }));
        handleAsyncError(e, {
          userMessage: 'Failed to generate scene image',
          context: { location: 'useImageGeneration', messageId },
        });
      } finally {
        setGeneratingFor((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [character, campaign, routeCampaignId, sessionId, getAssetImageUrl],
  );

  // Auto-generate on DM-suggested imageRequests
  useEffect(() => {
    if (!isAuto || !sessionId) return;
    if (getImageGenerationCap(sessionId) >= IMAGE_MAX) return;

    // ⚡ Bolt: Using a single backward for loop to find the last DM message
    // instead of creating multiple intermediate arrays via map/reverse.
    // This reduces O(N) space complexity to O(1).
    let lastDm = null;
    let lastDmIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === 'dm') {
        lastDm = messages[i];
        lastDmIdx = i;
        break;
      }
    }

    if (!lastDm) return;

    const msgId = lastDm.id || lastDm.timestamp || `${lastDmIdx}`;
    if (hasImageGenerationTriggered(sessionId, String(msgId))) return;
    if (generatingFor.has(String(msgId))) return;

    const hasImageRequests =
      Array.isArray(lastDm.imageRequests) && (lastDm.imageRequests?.length ?? 0) > 0;
    const hasVisualMarker = /^[\t ]*VISUAL\s+PROMPT:\s*(.+)$/im.test(lastDm.text || '');
    if (!hasImageRequests && !hasVisualMarker) return;

    if (performance.now() - lastGenRef.current < 1000) return;

    markImageGenerationTriggered(sessionId, String(msgId));
    handleGenerateScene(lastDm).catch(() => {});
  }, [messages, isAuto, sessionId, generatingFor, handleGenerateScene]);

  return {
    generatingFor,
    imageByMessage,
    genErrorByMessage,
    handleGenerateScene,
  };
};
