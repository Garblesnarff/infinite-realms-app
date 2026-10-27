/* eslint-disable import/order */
import React, { useMemo, useEffect, useRef } from 'react';

import { formatNarrative } from './formatNarrative';
import { prepareChatDisplayText } from './prepare-chat-display-text';
import { MessageAssetDisplay } from './MessageAssetDisplay';
import { MessageVoicePlayer } from './MessageVoicePlayer';
import { CombatRoundDivider } from './CombatRoundDivider';
import { HandoutCard } from '../../handouts/HandoutCard';
import { EngineLine } from './EngineLine';
import { parseEngineLine, type EngineRosterRow } from './engine-line-model';
import { EngineResultCardView } from '../../game/EngineResultCardView';
import { useShowTargetNumbers } from '../../../hooks/use-show-target-numbers';
import type { ChatMessage } from '@/types/game';

import { Button } from '@/components/ui/button';
import { useCampaignAssetsContext } from '@/contexts/CampaignAssetsContext';
import { useOptionalCombat } from '@/contexts/CombatContext';
import { useSceneBackground, type AssetType } from '@/contexts/SceneBackgroundContext';
import { findPlaceInText } from './scene-place';
import { cn } from '@/lib/utils';
import { isEngineResultCard } from '@/services/combat/engine-result-card';
import { combatEngineBlocksFromContext, engineBlockDividerKey } from '@/utils/combat-engine-blocks';
import { resolveNarrationSegments } from '@/utils/narration-segments';

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
  /** The divider key of the last engine block printed before this message (#2417). */
  previousEngineKey?: string;
}

/**
 * DMMessage Component
 * Renders DM-specific message bubbles with navy styling (#88)
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
    previousEngineKey,
  }) => {
    const { showTargetNumbers } = useShowTargetNumbers();
    // The live encounter roster names slugs and says which side an actor is on (#87).
    const participants = useOptionalCombat()?.state?.activeEncounter?.participants;
    const roster = useMemo<EngineRosterRow[]>(
      () =>
        (participants ?? []).map((participant) => ({
          id: participant.id,
          name: participant.name,
          displayName: participant.displayName,
          participantType: participant.participantType,
          maxHitPoints: participant.maxHitPoints,
        })),
      [participants],
    );
    // Get campaign assets for displaying entity images
    const { getAsset, assets } = useCampaignAssetsContext();
    const { setSceneBackground } = useSceneBackground();
    const hasSetBackgroundRef = useRef(false);

    /**
     * ⚡ Bolt: Consolidate content processing into a single memoized block.
     * This avoids redundant regex execution and multiple memoization overheads.
     */
    const processed = useMemo(() => {
      // 1-2. Strip roll requests, visual prompts and asset tags; split off engine lines
      const { text, engineLines, assetTags } = prepareChatDisplayText(displayContent);
      const combatEngineBlocks = combatEngineBlocksFromContext(message.context);

      // 3. Format narrative structure (markdown-like emphasis, etc)
      const narrative = formatNarrative(text);

      return {
        ...narrative,
        assetTags,
        cleanContent: text,
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

    // #1062: the server-attached tracker line, rendered from envelope
    // state — never from the DM's prose, which is where the bracket-line
    // leak came from. Shape-checked at render: a malformed context entry
    // drops out rather than printing a half line.
    const storyTrackers = useMemo(() => {
      const raw = message.context?.storyTrackers;
      if (!Array.isArray(raw)) return [];
      return raw.filter(
        (entry): entry is { name: string; value: number; limit: number } =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as { name?: unknown }).name === 'string' &&
          (entry as { name: string }).name.trim().length > 0 &&
          Number.isFinite((entry as { value?: unknown }).value) &&
          Number.isFinite((entry as { limit?: unknown }).limit) &&
          (entry as { limit: number }).limit > 0,
      );
    }, [message.context]);

    // Set scene background based on referenced assets (priority: location > scene > monster > npc)
    useEffect(() => {
      // Only set background once per message and only for the last message in a group
      if (hasSetBackgroundRef.current || !isLastInGroup) {
        return;
      }

      // The DM rarely tags a place, but names it in the prose. The place named last
      // is a candidate after the tags; a place with no chunk adds nothing, so the
      // previous image stays up.
      const locations = assets.filter((asset) => asset.type === 'location');
      const placeInText = findPlaceInText(cleanContent, locations);
      const candidateTags = placeInText
        ? [...assetTags, { type: 'location', key: placeInText.key }]
        : assetTags;
      if (candidateTags.length === 0) {
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

      for (const tag of candidateTags) {
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
    }, [assetTags, cleanContent, assets, getAsset, setSceneBackground, isLastInGroup]);

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

    // #88: narration uses the ir-narr token (EB Garamond, italic per ticket 3).
    // `dm-narrative` stays alongside it: the #464 display path (FallenStoryLog's
    // chat-display test) selects on it, and inside `.ir-app` the two-class
    // `.ir-app .ir-narr` selector outranks the single-class `.dm-narrative`
    // (Inter) rule, so EB Garamond still governs in the app.
    // The bubble caps width at 72ch, so the old lg:78ch narrative cap is dead.
    const narrativeClass = cn(
      'dm-narrative ir-narr text-[16px] md:text-[17px] leading-[1.65] text-foreground hyphens-auto',
      'selection:bg-infinite-purple/20 selection:text-white break-words',
      shouldClamp && 'max-h-[22rem] overflow-hidden clamp-fade',
    );

    // The mood word is data for developers, not for players (#2256): it renders in dev builds only.
    const emotionLabel = import.meta.env.DEV ? message.context?.emotion : undefined;
    const hasContextMetadata = Boolean(emotionLabel || message.context?.location);
    const timestamp = message.timestamp
      ? new Date(message.timestamp).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : '';

    return (
      <div className="w-full">
        {combatEngineBlocks.map((block, blockIndex) => {
          const cards = Array.isArray(block.cards) ? block.cards.filter(isEngineResultCard) : [];
          // A line a card stands for is not printed twice; any other line keeps its row.
          const chipLines = block.lines.filter(
            (line) =>
              !cards.some((card) => line.includes(card.line) || card.covers?.includes(line)),
          );
          const key = engineBlockDividerKey(block);
          const previousKey = combatEngineBlocks
            .slice(0, blockIndex)
            .reduce<
              string | undefined
            >((last, earlier) => engineBlockDividerKey(earlier) ?? last, previousEngineKey);
          return (
            <section
              key={`combat-engine-${block.sequence}`}
              aria-label={`Combat engine round ${block.round}`}
              data-testid="combat-engine-block"
            >
              {block.actor && key !== previousKey && (
                <CombatRoundDivider round={block.round} actor={block.actor} />
              )}
              {cards.map((card, index) => (
                <EngineResultCardView
                  key={`${block.sequence}-card-${index}-${card.line}`}
                  card={card}
                  showTargetNumbers={showTargetNumbers}
                />
              ))}
              {chipLines.map((line, index) => (
                <EngineLine
                  key={`${block.sequence}-${index}-${line}`}
                  model={parseEngineLine(line, { side: block.source, roster })}
                  showLabel={cards.length === 0 && index === 0}
                />
              ))}
            </section>
          );
        })}
        {engineLines.map((line, index) => (
          <EngineLine
            key={line}
            model={parseEngineLine(line, { roster })}
            showLabel={index === 0}
          />
        ))}
        {/* #88: the label sits directly above the bubble, first in group only,
            so consecutive DM messages don't repeat it. */}
        {/* #88 label at the #228 12px floor (text-xs), not the ticket's 11px:
            the guard forbids sub-12px classes on the game screen. */}
        {isFirstInGroup && (
          <div className="mb-1 text-xs font-semibold uppercase tracking-[.1em] text-infinite-gold">
            Dungeon Master
          </div>
        )}
        <article
          aria-label="Dungeon Master message"
          className={cn(
            'message-bubble dm-bubble relative overflow-hidden rounded-2xl rounded-tl-[4px] border border-white/10 bg-infinite-dark-lighter',
            'px-[18px] py-3.5 max-w-[72ch] transition-all duration-300',
          )}
        >
          {message.context?.previouslyOn && (
            <div className="text-xs text-amber-500/70 font-semibold uppercase tracking-widest mb-2 pb-2 border-b border-amber-500/20">
              ◆ Previously on your adventure...
            </div>
          )}
          {content ? <div className={narrativeClass}>{content}</div> : null}

          {storyTrackers.length > 0 && (
            <div
              data-testid="story-tracker-line"
              className="mt-3 text-sm text-white/70"
              aria-label="Story clock"
            >
              {storyTrackers
                .map((tracker) => `${tracker.name} Clock: ${tracker.value}/${tracker.limit}`)
                .join(' · ')}
            </div>
          )}

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
              {emotionLabel && (
                <div className="flex items-center gap-2">
                  <span role="img" aria-label="mood" className="text-lg leading-none">
                    🎭
                  </span>
                  <span>{emotionLabel}</span>
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
              narrationSegments={resolveNarrationSegments(
                message as unknown as Parameters<typeof resolveNarrationSegments>[0],
              )}
            />
          )}

          {isLastInGroup && timestamp && (
            <div className="ir-text-min uppercase tracking-[0.35em] text-white/60">{timestamp}</div>
          )}
        </div>
      </div>
    );
  },
);
