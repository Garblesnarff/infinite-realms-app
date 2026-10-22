import { ArrowLeft, Trophy } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface CampaignCompleteEndStateProps {
  /** Name of the player character who finished the adventure, when known. */
  characterName?: string | null;
  /** Campaign display name. */
  campaignName?: string | null;
  /**
   * #1020: how the story ended, as declared by the DM in the ending reply and
   * stored server-side as the session summary. Absent only if the completion
   * arrived without one.
   */
  summary?: string | null;
  /** Route back into this campaign with a new hero (buildChooseHeroHref). */
  chooseHeroHref: string;
  /**
   * The hero-pick route is not final yet (the starter-campaign list that
   * resolves the slug is still loading); the button waits for the resolved
   * route, as on the fallen end state.
   */
  chooseHeroPending?: boolean;
  /**
   * The read-only story (session log). When provided, "Read the story so far"
   * swaps to it INSIDE this end state — there is no dismiss back to a live
   * game, because the session is complete.
   */
  storyContent?: React.ReactNode;
}

/**
 * #1020: the completed campaign's end state, rendered as a page state — it
 * replaces the game screen rather than overlaying it, so no composer, sheet
 * or tracker exists underneath. Before this screen existed a finished
 * one-shot never ended at all: the session stayed active, the DM kept
 * improvising past the ending, and the player was stranded mid-story
 * (Hark G22-008/016). The single truth for showing it is the server: it
 * completes the session in /generate when the DM declares the ending and
 * keeps the reply's `campaign_ending` field only when that completion
 * applied; on load, reload and reconnect the game screen's load gate reads
 * the same truth (the session's status and stored summary) from the
 * session load payload and renders this screen as the restore.
 */
export const CampaignCompleteEndState: React.FC<CampaignCompleteEndStateProps> = ({
  characterName,
  campaignName,
  summary,
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
      <div data-testid="completion-screen-story" className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <Button
            data-testid="completion-screen-story-back"
            variant="ghost"
            size="sm"
            onClick={() => setView('end')}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <span className="text-sm font-medium text-card-foreground">{name} — adventure complete</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{storyContent}</div>
      </div>
    );
  }

  return (
    <div
      data-testid="completion-screen"
      className="flex h-full items-center justify-center overflow-y-auto bg-background p-4"
    >
      <Card className="max-w-lg w-full p-8 text-center space-y-6 border-border/60 shadow-2xl">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Trophy className="w-8 h-8 text-primary" aria-hidden="true" />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-card-foreground">Adventure complete</h2>
          <p className="text-muted-foreground leading-relaxed">
            {name} has finished {campaign}. The story is complete.
          </p>
        </div>

        {summary && (
          <div
            data-testid="completion-screen-summary"
            className="border-y border-border/40 py-3 text-sm text-muted-foreground"
          >
            <p>{summary}</p>
          </div>
        )}

        <div className="flex flex-col gap-3 pt-2">
          <div className="space-y-1">
            <Button
              data-testid="completion-screen-new-character"
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
              data-testid="completion-screen-read-story"
              variant="secondary"
              onClick={() => setView('story')}
              className="w-full"
            >
              Read the story so far
            </Button>
          )}
          <Button
            data-testid="completion-screen-explore"
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
