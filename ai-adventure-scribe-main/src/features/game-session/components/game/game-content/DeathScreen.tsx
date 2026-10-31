import React from 'react';

import { CampaignEndState } from './CampaignEndState';
import { formatNarrative } from '../../chat/message-list/formatNarrative';
import { prepareChatDisplayText } from '../../chat/message-list/prepare-chat-display-text';

import { useMessageContext } from '@/contexts/MessageContext';
import { combatEngineBlocksFromContext } from '@/utils/combat-engine-blocks';

export { displayFinalLine } from './CampaignEndState';

/**
 * The route back into a campaign with a new hero. A starter campaign goes
 * through its hero pick; a custom campaign goes through character creation
 * carrying the campaign. Never the bare `/app/characters/create`: after the
 * wizard that lands on the character list, not in the game, and carries no
 * campaign (#2520 §5).
 */
export function buildChooseHeroHref(input: {
  starterSlug?: string | null;
  campaignId?: string | null;
}): string {
  if (input.starterSlug && input.campaignId) {
    return `/explore/${encodeURIComponent(input.starterSlug)}/choose-character?campaignId=${encodeURIComponent(input.campaignId)}`;
  }
  if (input.campaignId) {
    return `/app/characters/create?campaign=${encodeURIComponent(input.campaignId)}`;
  }
  return '/explore';
}

/**
 * The engine prefixes its transcript lines (`⚙️ Engine: …`). The player
 * already saw those lines rendered from the formatter; on this screen the
 * raw prefix must not leak through.
 */
interface FallenEndStateProps {
  /** Name of the fallen player character, when known. */
  characterName?: string | null;
  /** Trusted character presentation data from the owning game route. */
  portraitUrl?: string | null;
  identity?: string | null;
  /**
   * #2517: the engine's final lines (killing blow, failed death saves). The
   * killing round gets no DM narration; the screen carries these instead.
   * Absent on a restored load — the lines are in the story behind the
   * "Read the story so far" view.
   */
  finalLines?: string[];
  /** Campaign display name for the hero-pick helper line. */
  campaignName?: string | null;
  /**
   * Route back into this campaign with a new hero (buildChooseHeroHref);
   * null hides the offer when there is no campaign to return to (#1215).
   */
  chooseHeroHref: string | null;
  /**
   * #2517: the hero-pick route is not final yet (the starter-campaign list
   * that resolves the slug is still loading). A wrong-route click in that
   * window strands the player on the custom-campaign form, so the button
   * waits for the resolved route instead of racing it.
   */
  chooseHeroPending?: boolean;
  /**
   * The read-only story (session log). When provided, "Read the story so
   * far" swaps to it INSIDE this end state — there is no dismiss back to a
   * live game (#2520 §4).
   */
  storyContent?: React.ReactNode;
}

/**
 * #2517/#2520: the fallen character's end state, rendered as a page state —
 * it replaces the game screen rather than overlaying it, so no composer,
 * sheet or tracker exists underneath. The single truth for showing it is
 * `character_stats.vital_state === 'dead'`, read in the session load
 * payload; `party_defeated` and PartyDefeatedError are live triggers only.
 */
export const FallenEndState: React.FC<FallenEndStateProps> = ({
  characterName,
  portraitUrl,
  identity,
  finalLines,
  campaignName,
  chooseHeroHref,
  chooseHeroPending,
  storyContent,
}) => (
  <CampaignEndState
    mode="fallen"
    characterName={characterName}
    portraitUrl={portraitUrl}
    identity={identity}
    finalLines={finalLines}
    campaignName={campaignName}
    chooseHeroHref={chooseHeroHref}
    chooseHeroPending={chooseHeroPending}
    storyContent={storyContent}
  />
);

/**
 * The saved session log, read-only: no composer, no roll tray, no sheet.
 * Renders the messages the MessageProvider already loaded for the session.
 */
export const FallenStoryLog: React.FC = () => {
  const { messages, historyReady, hasMore, loadMore, isLoading, isFetchingMore, messagesError } =
    useMessageContext();
  const requestedAtCount = React.useRef(-1);
  React.useEffect(() => {
    if (
      historyReady &&
      hasMore &&
      !isLoading &&
      !isFetchingMore &&
      !messagesError &&
      messages.length > requestedAtCount.current
    ) {
      requestedAtCount.current = messages.length;
      loadMore();
    }
  }, [historyReady, hasMore, isLoading, isFetchingMore, messagesError, loadMore, messages.length]);
  // The chat display preparation removes engine lines and roll requests from DM prose.
  const visible = messages
    .map((message) => {
      let text = '';
      if (message.sender === 'dm') {
        text = prepareChatDisplayText(message.text ?? '').text;
      } else if (
        message.sender === 'player' &&
        message.context?.intent !== 'dice_roll' &&
        !message.context?.diceRoll
      ) {
        text = message.text ?? '';
      } else if (message.sender === 'system') {
        const blocks = combatEngineBlocksFromContext(message.context);
        const cards = blocks.length
          ? blocks.flatMap((block) => block.cards ?? [])
          : (message.context?.engineCards ?? []);
        text = cards
          .flatMap((card) => {
            if (card.kind === 'initiative' || card.kind === 'refused') return [];
            if (card.kind === 'death_save') return card.detail ? [card.detail] : [];
            const outcome = card.badge ? `: ${card.badge.word.toLowerCase()}` : '';
            const status =
              card.status && card.hp
                ? `${card.hp.name} is ${card.status.toLowerCase()}`
                : card.status;
            return [[`${card.title}${outcome}.`, card.effect, status].filter(Boolean).join(' ')];
          })
          .join('\n\n');
      }
      return { message, text };
    })
    .filter(({ text }) => text.trim());
  if (visible.length === 0 && !hasMore) {
    return (
      <p className="text-sm text-muted-foreground">The story so far is still being written.</p>
    );
  }
  return (
    <div data-testid="death-screen-story-log" className="space-y-3">
      {hasMore && (
        <button type="button" onClick={loadMore} disabled={isLoading || isFetchingMore}>
          {isLoading || isFetchingMore
            ? 'Loading earlier story…'
            : messagesError
              ? 'Retry loading earlier story'
              : 'Load earlier story'}
        </button>
      )}
      {visible.map(({ message, text }, index) => (
        <div key={message.id ?? index}>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-card-foreground">
            {formatNarrative(text).content}
          </div>
        </div>
      ))}
    </div>
  );
};
