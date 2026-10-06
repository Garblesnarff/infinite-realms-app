import { Heart } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';

export interface DyingPanelProps {
  /** The character's name: `The Scholar is dying`. */
  name: string;
  /** `dying` while saves are owed; `stable` once three successes (or a stabilising effect) came. */
  state: 'dying' | 'stable';
  successes: number;
  failures: number;
  /** The dying character's turn: the roll prompt is open (or about to be) and the save is theirs. */
  isOwnTurn: boolean;
  /** Re-opens the death save when a turn did not start on its own (a refused or failed send). */
  onRoll?: () => void;
  /**
   * The roll prompt is open in the tray above (it carries the Roll button and the auto-roll
   * countdown, #2538), so the panel shows no second button.
   */
  promptOpen?: boolean;
}

/** `●●○`: filled for each one reached, hollow for the rest. */
function pips(count: number, filled: string, hollow: string): string {
  const reached = Math.max(0, Math.min(3, count));
  return filled.repeat(reached) + hollow.repeat(3 - reached);
}

/**
 * The dying state of the composer (#2518, spec §8 of #2520).
 *
 * It REPLACES the composer rather than disabling it: a character on the floor cannot type an
 * action, so there is nothing to type into. It says what is happening in words as well as pips,
 * because colour and symbols alone make a death silent for a screen reader, and it says what the
 * player does next: wait for the enemy turn, or roll the save the prompt above is asking for.
 */
export const DyingPanel: React.FC<DyingPanelProps> = ({
  name,
  state,
  successes,
  failures,
  isOwnTurn,
  onRoll,
  promptOpen = false,
}) => {
  const stable = state === 'stable';
  const tally = `${successes} ${successes === 1 ? 'success' : 'successes'} and ${failures} ${
    failures === 1 ? 'failure' : 'failures'
  } of 3`;
  return (
    <div
      data-testid="dying-panel"
      role="status"
      aria-live="polite"
      className="mx-3 my-3 rounded-lg border border-white/10 border-l-[5px] border-l-[#ef8a8a] bg-black/35 px-4 py-3 text-[#eaeefa]"
    >
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 shrink-0 text-[#ef8a8a]" aria-hidden="true" />
        <h2 className="font-display text-lg leading-tight" data-testid="dying-panel-title">
          {stable ? `${name} is stable. Unconscious.` : `${name} is dying`}
        </h2>
      </div>
      {!stable && (
        <>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span data-testid="dying-panel-successes">
              <span className="text-[#aab3cc]">Saved </span>
              <span aria-hidden="true" className="tracking-widest text-[#d5b070]">
                {pips(successes, '●', '○')}
              </span>
            </span>
            <span data-testid="dying-panel-failures">
              <span className="text-[#aab3cc]">Failed </span>
              <span aria-hidden="true" className="tracking-widest text-[#ef8a8a]">
                {pips(failures, '✕', '○')}
              </span>
            </span>
            <span className="sr-only">{tally}</span>
          </p>
          <p className="mt-2 text-sm text-[#aab3cc]" data-testid="dying-panel-hint">
            {isOwnTurn
              ? promptOpen
                ? 'Roll the d20 above. No modifiers. 10 or higher saves.'
                : 'No modifiers. 10 or higher saves.'
              : 'You cannot act. Wait for your turn.'}
          </p>
          {isOwnTurn && onRoll && !promptOpen && (
            <Button
              type="button"
              data-testid="dying-panel-roll"
              onClick={onRoll}
              className="mt-2 min-h-[48px]"
            >
              Roll death save
            </Button>
          )}
        </>
      )}
      {stable && (
        <p className="mt-2 text-sm text-[#aab3cc]">
          No more saves. The fight cannot go on without you; the story does.
        </p>
      )}
    </div>
  );
};
