import React from 'react';

import { CampaignEndState } from './CampaignEndState';
import { formatNarrative } from '../../chat/message-list/formatNarrative';
import { prepareChatDisplayText } from '../../chat/message-list/prepare-chat-display-text';

import { useMessageContext } from '@/contexts/MessageContext';

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
  const { messages } = useMessageContext();
  // The chat display preparation removes engine lines and roll requests from DM prose.
  const visible = messages
    .filter((message) => message.sender === 'dm' || message.sender === 'player')
    .map((message) => ({
      message,
      text:
        message.sender === 'dm'
          ? prepareChatDisplayText(message.text ?? '').text
          : (message.text ?? ''),
    }))
    .filter(({ text }) => text.trim());
  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">The story so far is still being written.</p>
    );
  }
  return (
    <div data-testid="death-screen-story-log" className="space-y-3">
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
