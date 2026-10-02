import React from 'react';
import { Link } from 'react-router-dom';

import type { MissingGameTarget } from './useGameData';

import { Button } from '@/components/ui/button';

interface MissingGameTargetPanelProps {
  target: MissingGameTarget;
  campaignId: string | undefined;
}

/**
 * Shown when a game link has no hero to open with, or points at no adventure.
 * Player-facing words only; the lookup lives in useGameData.
 */
export const MissingGameTargetPanel: React.FC<MissingGameTargetPanelProps> = ({
  target,
  campaignId,
}) => {
  const heroesPath =
    target === 'no-hero' && campaignId
      ? `/app/campaigns/${encodeURIComponent(campaignId)}/characters`
      : null;
  const noAdventure = heroesPath === null;
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center p-10 max-w-md space-y-4">
        <h1 className="font-heading text-xl text-infinite-gold">
          {noAdventure ? 'We could not find this adventure.' : 'Pick your hero to continue'}
        </h1>
        {!noAdventure && (
          <p className="text-sm text-muted-foreground">
            This adventure has no hero yet on your account.
          </p>
        )}
        <Button asChild variant="ir-gold">
          {noAdventure ? (
            <Link to="/app">Your adventures</Link>
          ) : (
            <Link to={heroesPath}>Choose a hero</Link>
          )}
        </Button>
      </div>
    </div>
  );
};
