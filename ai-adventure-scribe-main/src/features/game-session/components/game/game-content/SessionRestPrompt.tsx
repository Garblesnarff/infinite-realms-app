import React from 'react';

import { Button } from '@/components/ui/button';

/**
 * #1239 item 1: the session-start prompt shown when a continuation session
 * starts with the hero below max HP. Presentational only — the decision and
 * the rest call live in use-session-rest-gate.ts. Renders full-screen like
 * the game screen's other load gates, so the greeting cannot fire behind it.
 */
export interface SessionRestPromptProps {
  characterName: string;
  currentHp: number;
  maxHp: number;
  resting: boolean;
  restError: string | null;
  onRestFirst: () => void;
  onContinue: () => void;
}

export const SessionRestPrompt: React.FC<SessionRestPromptProps> = ({
  characterName,
  currentHp,
  maxHp,
  resting,
  restError,
  onRestFirst,
  onContinue,
}) => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="text-center p-10 max-w-md">
      <h1 className="text-2xl font-semibold mb-2">Rest first?</h1>
      <p className="text-muted-foreground mb-4">
        {characterName} starts at {currentHp}/{maxHp} HP.
      </p>
      <p className="text-muted-foreground mb-6">
        A long rest restores full HP, spell slots, and features before the session begins. Or
        continue as you are — HP carries between sessions inside one adventure.
      </p>
      {restError ? (
        <p className="text-destructive mb-4" role="alert">
          Rest failed: {restError}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button onClick={onRestFirst} disabled={resting}>
          {resting ? 'Resting…' : 'Rest first?'}
        </Button>
        <Button variant="outline" onClick={onContinue} disabled={resting}>
          Continue as you are
        </Button>
      </div>
    </div>
  </div>
);
