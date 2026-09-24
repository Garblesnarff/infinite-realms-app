/* eslint-disable import/order */
import React, { useMemo, useEffect, useRef } from 'react';

import { formatNarrative } from './formatNarrative';
import { MessageAssetDisplay } from './MessageAssetDisplay';
import { MessageVoicePlayer } from './MessageVoicePlayer';
import { HandoutCard } from '../../handouts/HandoutCard';
import { EngineOutcomeChip } from '../../game/EngineOutcomeChip';

import type { ChatMessage } from '@/types/game';

import { Button } from '@/components/ui/button';
import { useCampaignAssetsContext } from '@/contexts/CampaignAssetsContext';
import { useSceneBackground, type AssetType } from '@/contexts/SceneBackgroundContext';
import { cn } from '@/lib/utils';
import { extractEngineGeneratedLines } from '@/utils/engine-lines';
import { combatEngineBlocksFromContext } from '@/utils/combat-engine-blocks';
import { resolveNarrationSegments } from '@/utils/narration-segments';
import { removeRollRequestsFromMessage } from '@/utils/rollRequestParser';
import { parseAssetTags } from '../../../utils/parse-asset-tags';

interface DMMessageProps {
  message: ChatMessage;
  messageId: string;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  displayContent: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  imageUrl?: string;
  isGeneratingImage: boolean;
  imageError?: string;
  onGenerateImage: () => void;
}

/**
 * DMMessage Component
 * Renders DM-specific message bubbles with purple gradient styling
 * Integrates voice controls, image generation, and action options
 */
export const DMMessage: React.FC<DMMessageProps> = React.memo(
  ({
    message,
    messageId,
    isFirstInGroup,
    isLastInGroup,
    displayContent,
    isExpanded,
    onToggleExpanded,
    imageUrl,
    isGeneratingImage,
    imageError,
    onGenerateImage,
  }) => {
    // Get campaign assets for displaying entity images
    const { getAsset } = useCampaignAssetsContext();
    const { setSceneBackground } = useSceneBackground();
    const hasSetBackgroundRef = useRef(false);

    /**
     * ⚡ Bolt: Consolidate content processing into a single memoized block.
     * This avoids redundant regex execution and multiple memoization overheads.
     */
    const processed = useMemo(() => {
      // 1. Remove roll requests and visual prompt markers from display
      let text = removeRollRequestsFromMessage(displayContent);
      text = text.replace(/^[\t ]*VISUAL\s+PROMPT:.*$/gim, '').trim();
      const { lines: engineLines, fiction } = extractEngineGeneratedLines(text);
      text = fiction;
      const combatEngineBlocks = combatEngineBlocksFromContext(message.context);

      // 2. Parse and remove asset tags, extracting referenced assets
      const { cleanContent, assets: assetTags } = parseAssetTags(text);

      // 3. Format narrative structure (markdown-like emphasis, etc)
      const narrative = formatNarrative(cleanContent);

      return {
        ...narrative,
        assetTags,
        cleanContent,
        engineLines: combatEngineBlocks.length ? [] : engineLines,
        combatEngineBlocks,
      };
    }, [displayContent, message.context]);

    const {
      content,
      charCount,
      paragraphCount,
      assetTags,
      cleanContent,
      engineLines,
      combatEngineBlocks,
    } = processed;

    // Set scene background based on referenced assets (priority: location > scene > monster > npc)
    useEffect(() => {
      // Only set background once per message and only for the last message in a group
      if (hasSetBackgroundRef.current || !isLastInGroup || assetTags.length === 0) {
        return;
      }

      // Priority order for background images
      const priorityOrder: AssetType[] = [
        'location',
        'scene',
        'monster',
        'npc',
        'item',
        'character',
      ];

      // Find the highest priority asset with an image
      let bestAsset = null;
      let bestPriority = Infinity;

      for (const tag of assetTags) {
        const asset = getAsset(tag.type, tag.key);
        if (asset?.imageUrl) {
          const priority = priorityOrder.indexOf(tag.type as AssetType);
          if (priority !== -1 && priority < bestPriority) {
            bestAsset = asset;
            bestPriority = priority;
          }
        }
      }

      if (bestAsset) {
        setSceneBackground(bestAsset.imageUrl, bestAsset.name, bestAsset.type as AssetType);
        hasSetBackgroundRef.current = true;
      }
    }, [assetTags, getAsset, setSceneBackground, isLastInGroup]);

    // Don't render if content is empty after removing roll requests — unless the
    // engine still has a fact to show as a chip.
    if (
      (!cleanContent || cleanContent.length === 0 || !content) &&
      engineLines.length === 0 &&
      combatEngineBlocks.length === 0
    ) {
      return null;
    }
    const exceedsClampThreshold = charCount > 800 || paragraphCount > 4;
    const shouldClamp = exceedsClampThreshold && !isExpanded;

    const narrativeClass = cn(
      'dm-narrative max-w-[72ch] lg:max-w-[78ch] text-[15px] md:text-base leading-7 text-white/90 tracking-normal hyphens-auto',
      'selection:bg-infinite-purple/20 selection:text-white break-words',
      shouldClamp && 'max-h-[22rem] overflow-hidden clamp-fade',
    );

    const hasContextMetadata = Boolean(message.context?.emotion || message.context?.location);
    const timestamp = message.timestamp
      ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    return (
      <div className="w-full">
        <article
          aria-label="Dungeon Master message"
          className={cn(
            'message-bubble dm-bubble relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#2d1155]/95 via-[#251147]/93 to-[#0b2336]/90',
            'px-5 py-4 md:px-6 md:py-5 shadow-lg md:shadow-xl transition-all duration-300 hover:shadow-2xl hover:shadow-infinite-purple/20',
          )}
        >
          {message.context?.previouslyOn && (
            <div className="text-xs text-amber-500/70 font-semibold uppercase tracking-widest mb-2 pb-2 border-b border-amber-500/20">
              ◆ Previously on your adventure...
            </div>
          )}
          {combatEngineBlocks.map((block) => (
            <section
              key={`combat-engine-${block.sequence}`}
              aria-label={`Combat engine round ${block.round}`}
              className="mb-3 rounded-2xl border border-cyan-300/20 bg-slate-950/30 px-3 py-2"
              data-testid="combat-engine-block"
            >
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-200/70">
                Round {block.round} · {block.source === 'npc' ? 'NPC turn' : 'Player turn'}
              </div>
              {block.lines.map((line, index) => (
                <EngineOutcomeChip key={`${block.sequence}-${index}-${line}`} line={line} />
              ))}
            </section>
          ))}
          {engineLines.map((line) => (
            <EngineOutcomeChip key={line} line={line} />
          ))}
          {content ? <div className={narrativeClass}>{content}</div> : null}

          {exceedsClampThreshold && (
            <div className="mt-4 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="text-xs font-semibold uppercase tracking-wider text-white/70 hover:text-white"
                onClick={onToggleExpanded}
              >
                {isExpanded ? 'Show less' : 'Read more'}
              </Button>
            </div>
          )}

          {/* Display campaign assets and generated images */}
          <MessageAssetDisplay
            assetTags={assetTags}
            getAsset={getAsset}
            className="mt-4"
            generatedImage={
              isLastInGroup
                ? {
                    url: imageUrl,
                    isGenerating: isGeneratingImage,
                    error: imageError,
                    onGenerate: onGenerateImage,
                  }
                : undefined
            }
          />

          {Array.isArray(message.context?.handouts) && message.context.handouts.length > 0 && (
            <div className="mt-4 space-y-3">
              {message.context.handouts.map((entry) => (
                <HandoutCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}

          {isFirstInGroup && hasContextMetadata && (
            <div className="mt-5 border-t border-white/10 pt-4 text-sm text-white/70 space-y-2">
              {message.context?.emotion && (
                <div className="flex items-center gap-2">
                  <span role="img" aria-label="mood" className="text-lg leading-none">
                    🎭
                  </span>
                  <span>{message.context.emotion}</span>
                </div>
              )}
              {message.context?.location && (
                <div className="flex items-center gap-2">
                  <span role="img" aria-label="location" className="text-lg leading-none">
                    📍
                  </span>
                  <span>{message.context.location}</span>
                </div>
              )}
            </div>
          )}
        </article>

        {/* Timestamp & voice controls */}
        <div className="mt-3 flex flex-col items-end gap-2 pr-1">
          {isLastInGroup && (
            <MessageVoicePlayer
              messageId={messageId}
              messageText={displayContent}
              narrationSegments={resolveNarrationSegments(message)}
            />
          )}

          {isLastInGroup && timestamp && (
            <div className="text-[11px] uppercase tracking-[0.35em] text-white/60">{timestamp}</div>
          )}
        </div>
      </div>
    );
  },
);
