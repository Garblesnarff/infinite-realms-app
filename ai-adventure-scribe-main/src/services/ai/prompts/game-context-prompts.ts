/* eslint-disable @typescript-eslint/no-explicit-any */
import { CampaignContextPrompts } from './campaign-context-prompts';
import { CharacterContextPrompts } from './character-context-prompts';

import type { Memory } from '../../memory-manager';
import type { GameContext } from '../shared/types';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { hasStarterPlaythroughSignal } from '@/utils/starter-playthrough';

/**
 * GameContextPrompts - Handles building the game context sections of the prompt
 * Extracted from ContextBuilderPrompts.ts
 */
/**
 * Resolve the starter campaign id for a game context, using the same
 * precedence `buildGameContextSection` uses internally.
 */
export function resolveStarterCampaignId(context: GameContext): string | undefined {
  const rawCampaignDetails = context.campaignDetails || {};
  return (
    context.starterCampaignId || (rawCampaignDetails.starter_campaign_id as string | undefined)
  );
}

export class GameContextPrompts {
  static async buildGameContextSection(
    context: GameContext,
    relevantMemories: Memory[],
    /**
     * #2450: pre-rendered starter-campaign lore section. When provided (even as
     * ''), it is used verbatim and no lore fetch happens — the caller owns the
     * fetch/render/budget lifecycle. When undefined, the legacy internal fetch
     * path runs unchanged.
     */
    loreSection?: string,
  ): Promise<string> {
    let section = `<game_context>`;
    const rawCampaignDetails = context.campaignDetails || {};
    const nestedCampaignDetails =
      (rawCampaignDetails.campaign as Record<string, unknown> | undefined) ||
      (rawCampaignDetails.basic as Record<string, unknown> | undefined) ||
      rawCampaignDetails;
    const campaignName =
      nestedCampaignDetails.name || nestedCampaignDetails.title || 'Unnamed Campaign';
    const campaignDescription =
      nestedCampaignDetails.description || nestedCampaignDetails.premise || '';

    if (context.campaignDetails) {
      section += `<campaign_details>
CAMPAIGN: "${campaignName}"
DESCRIPTION: ${campaignDescription}
</campaign_details>`;
    }

    // A missing nullable starter link is normal for custom campaigns. Only report a missing link
    // when the context separately identifies this as a starter playthrough.
    const starterCampaignId =
      context.starterCampaignId || (rawCampaignDetails.starter_campaign_id as string | undefined);
    const isStarterPlaythrough =
      context.isStarterPlaythrough ??
      (Boolean(starterCampaignId) || hasStarterPlaythroughSignal(rawCampaignDetails));

    if (loreSection !== undefined) {
      section += loreSection;
    } else {
      if (isStarterPlaythrough && !starterCampaignId) {
        const message = 'Missing required starter_campaign_id for AI game context';
        logger.error('[ContextBuilder] Missing required starter_campaign_id', {
          sessionId: context.sessionId,
          campaignId: context.campaignId,
        });
        userDataApi.reportClientFailure('missing_starter_campaign_id', context.sessionId, message);
      }

      if (starterCampaignId) {
        section += await CampaignContextPrompts.buildStarterCampaignLoreSection(starterCampaignId);
      }
    }

    if (context.characterDetails) {
      section += await GameContextPrompts.buildCharacterSection(context.characterDetails);
    }

    if (relevantMemories.length > 0) {
      section += `
<story_memories>
<title>IMPORTANT STORY MEMORIES</title>
Reference these memories naturally to maintain story continuity.
Memories are color, not authority: where a memory conflicts with <scene_state>, the <scene_state> facts are correct and the memory is stale.`;
      relevantMemories.forEach((memory, index) => {
        section += `
<memory index="${index + 1}" type="${memory.type.toUpperCase()}">${memory.content}</memory>`;
      });
      section += `
</story_memories>`;
    }

    section += `</game_context>`;
    return section;
  }

  /**
   * Delegates the equipment section rendering to CharacterContextPrompts
   */
  public static async buildEquipmentSection(char: Record<string, any>): Promise<string> {
    return CharacterContextPrompts.buildEquipmentSection(char);
  }

  /**
   * Delegates the character section rendering to CharacterContextPrompts
   */
  public static async buildCharacterSection(char: Record<string, any>): Promise<string> {
    return CharacterContextPrompts.buildCharacterSection(char);
  }
}
