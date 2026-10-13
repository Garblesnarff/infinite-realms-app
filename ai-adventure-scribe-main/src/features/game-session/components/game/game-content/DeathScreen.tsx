import { ArrowLeft, Skull } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useMessageContext } from '@/contexts/MessageContext';

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
export const displayFinalLine = (line: string): string =>
  line.replace(/^⚙\uFE0F?\s*Engine:\s*/, '');

interface FallenEndStateProps {
  /** Name of the fallen player character, when known. */
  characterName?: string | null;
  /**
   * #2517: the engine's final lines (killing blow, failed death saves). The
   * killing round gets no DM narration; the screen carries these instead.
   * Absent on a restored load — the lines are in the story behind the
   * "Read the story so far" view.
   */
  finalLines?: string[];
  /** Campaign display name for the hero-pick helper line. */
  campaignName?: string | null;
  /** Route back into this campaign with a new hero (buildChooseHeroHref). */
  chooseHeroHref: string;
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
  finalLines,
  campaignName,
  chooseHeroHref,
  chooseHeroPending,
  storyContent,
}) => {
  const navigate = useNavigate();
  const [view, setView] = React.useState<'end' | 'story'>('end');
  const name = characterName?.trim() || 'Your character';
  const campaign = campaignName?.trim() || 'this campaign';

  if (view === 'story' && storyContent) {
    return (
      <div data-testid="death-screen-story" className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <Button
            data-testid="death-screen-story-back"
            variant="ghost"
            size="sm"
            onClick={() => setView('end')}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <span className="text-sm font-medium text-card-foreground">{name} — fallen</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{storyContent}</div>
      </div>
    );
  }

  return (
    <div
      data-testid="death-screen"
      className="flex h-full items-center justify-center overflow-y-auto bg-background p-4"
    >
      <Card className="max-w-lg w-full p-8 text-center space-y-6 border-border/60 shadow-2xl">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <Skull className="w-8 h-8 text-destructive" aria-hidden="true" />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-card-foreground">{name} has fallen</h2>
          <p className="text-muted-foreground leading-relaxed">
            The party was defeated and the tale of {name} ends here. The story cannot continue
            with a fallen hero — but every ending is a new beginning.
          </p>
        </div>

        {finalLines && finalLines.length > 0 && (
          <div
            data-testid="death-screen-final-lines"
            className="space-y-1 border-y border-border/40 py-3 text-sm text-muted-foreground"
          >
            {finalLines.map((line, index) => (
              <p key={index}>{displayFinalLine(line)}</p>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 pt-2">
          <div className="space-y-1">
            <Button
              data-testid="death-screen-new-character"
              onClick={() => navigate(chooseHeroHref)}
              disabled={chooseHeroPending}
              className="w-full"
            >
              Choose a new hero
            </Button>
            <p className="text-xs text-muted-foreground">
              Begin {campaign} again with a new hero. {name}&rsquo;s story is kept.
            </p>
          </div>
          {storyContent && (
            <Button
              data-testid="death-screen-read-story"
              variant="secondary"
              onClick={() => setView('story')}
              className="w-full"
            >
              Read the story so far
            </Button>
          )}
          <Button
            data-testid="death-screen-explore"
            variant="ghost"
            onClick={() => navigate('/explore')}
            className="w-full"
          >
            Explore other campaigns
          </Button>
        </div>
      </Card>
    </div>
  );
};

/**
 * The saved session log, read-only: no composer, no roll tray, no sheet.
 * Renders the messages the MessageProvider already loaded for the session.
 */
export const FallenStoryLog: React.FC = () => {
  const { messages } = useMessageContext();
  const visible = messages.filter((message) => message.text?.trim());
  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">The story so far is still being written.</p>;
  }
  return (
    <div data-testid="death-screen-story-log" className="space-y-3">
      {visible.map((message, index) => (
        <div key={message.id ?? index} className="space-y-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {message.sender === 'player' ? 'You' : message.sender === 'dm' ? 'Dungeon Master' : 'System'}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-card-foreground">
            {message.text}
          </p>
        </div>
      ))}
    </div>
  );
};
