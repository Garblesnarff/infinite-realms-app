import { Check } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { EngineBadgeView } from '../EngineResultCardView';

import { Button } from '@/components/ui/button';
import { useShowTargetNumbers } from '@/features/game-session/hooks/use-show-target-numbers';
import { cn } from '@/lib/utils';
import { engineCardMathText, type EngineResultCard } from '@/services/combat/engine-result-card';
import {
  cancelSheetCast,
  dismissSheetCast,
  useSheetCastProgress,
  type SheetCastProgress,
} from '@/services/combat/sheet-cast-progress';

/** The elapsed time shows from here. */
export const ELAPSED_FROM_SECONDS = 5;
/** The DM's wait gets a second line from here. */
export const LONG_WAIT_SECONDS = 20;
/** The player is offered Keep waiting and Cancel cast from here. */
export const TIMEOUT_SECONDS = 60;
/** The engine's own roll is quick; past this the wait is the DM writing. */
const ROLLING_SECONDS = 10;

/** The dock's status line, word for word from the design spec on #2393. */
export function castStatusText(cast: SheetCastProgress, elapsedSeconds: number): string {
  if (cast.phase === 'save') return 'Press Continue below.';
  if (cast.phase === 'roll') return 'Roll your die below.';
  const longWait = elapsedSeconds >= LONG_WAIT_SECONDS ? ' This can take up to a minute.' : '';
  if (cast.phase === 'resolving') {
    return elapsedSeconds < ROLLING_SECONDS
      ? `Rolling for ${cast.targetName ?? 'the target'}`
      : `The DM is writing what happens.${longWait}`;
  }
  return elapsedSeconds < ELAPSED_FROM_SECONDS
    ? 'Sending your spell to the DM'
    : `The DM is reading the scene.${longWait}`;
}

type StepState = 'done' | 'now' | 'next';

function stepStates(cast: SheetCastProgress): Array<{ label: string; state: StepState }> {
  const past = cast.phase === 'resolving' || cast.phase === 'done';
  return [
    { label: 'Sent', state: 'done' },
    {
      label: 'Save',
      state: cast.phase === 'save' ? 'now' : cast.savePassed || past ? 'done' : 'next',
    },
    {
      label: 'Result',
      state: cast.phase === 'done' ? 'done' : cast.phase === 'resolving' ? 'now' : 'next',
    },
  ];
}

const STEP_STATE_TEXT: Record<StepState, string> = { done: 'done', now: 'now', next: 'waiting' };

function useElapsedSeconds(since: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, since]);
  return Math.max(0, Math.floor((now - since) / 1000));
}

const IndeterminateBar: React.FC = () => (
  <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-white/10">
    {/* Reduced motion: the same bar, full and still. The status text carries the change. */}
    <div className="h-full w-1/3 rounded-full bg-infinite-gold/80 animate-cast-indeterminate motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
  </div>
);

/** The result in short form: the badge, then the math, the effect and the target's state. */
const CastResult: React.FC<{ result: EngineResultCard }> = ({ result }) => {
  const { showTargetNumbers } = useShowTargetNumbers();
  const line = [
    [result.math ? engineCardMathText(result.math, showTargetNumbers) : '', result.effect]
      .filter(Boolean)
      .join(' · '),
    result.status,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {result.badge && <EngineBadgeView badge={result.badge} />}
      <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm text-foreground">
        {line}
      </p>
    </div>
  );
};

/**
 * What a cast from the sheet is doing, at the top of the sheet's scroll area (#2418). The status
 * line is a polite live region, so a screen reader hears each change; the bar is decoration.
 */
export const CastingDock: React.FC = () => {
  const { cast } = useSheetCastProgress();
  const waiting =
    cast !== null && cast.phase !== 'done' && cast.phase !== 'save' && cast.phase !== 'roll';
  const elapsed = useElapsedSeconds(cast?.phaseStartedAt ?? 0, waiting);
  // Keep waiting hides the time-out for another minute of this phase.
  const [patience, setPatience] = useState<{ since: number; until: number } | null>(null);
  const keptWaiting =
    patience !== null && patience.since === cast?.phaseStartedAt && elapsed < patience.until;

  const dockRef = useRef<HTMLElement>(null);
  /** The dock is about to leave with the button that was pressed: focus moves to the sheet, not `<body>`. */
  const leaveDock = (action: () => void): void => {
    dockRef.current?.parentElement?.focus();
    action();
  };

  if (!cast) return null;

  const timedOut = waiting && elapsed >= TIMEOUT_SECONDS && !keptWaiting;
  return (
    <section
      ref={dockRef}
      tabIndex={-1}
      aria-label="Casting"
      data-testid="casting-dock"
      className="sticky top-0 z-10 space-y-2 outline-none rounded border border-infinite-gold/30 bg-[#12182a] p-3 shadow-lg"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display min-w-0 truncate text-base font-semibold text-infinite-gold">
          {cast.phase === 'done' ? cast.spellName : `Casting ${cast.spellName}`}
        </h3>
        {waiting && elapsed >= ELAPSED_FROM_SECONDS && (
          <span
            className="shrink-0 text-sm tabular-nums text-muted-foreground"
            data-testid="casting-elapsed"
          >
            {elapsed} s
          </span>
        )}
      </div>

      {cast.phase === 'done' ? (
        <>
          {cast.results?.map((result, index) => (
            <CastResult key={index} result={result} />
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11"
            onClick={() => leaveDock(dismissSheetCast)}
          >
            Dismiss
          </Button>
        </>
      ) : (
        <>
          <p role="status" aria-live="polite" className="text-sm text-foreground">
            {castStatusText(cast, elapsed)}
          </p>
          {waiting && <IndeterminateBar />}
          <ol className="flex flex-wrap gap-1.5 text-xs">
            {stepStates(cast).map((step) => (
              <li
                key={step.label}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                  step.state === 'done' && 'border-infinite-gold/40 text-infinite-gold',
                  step.state === 'now' &&
                    'border-infinite-gold bg-infinite-gold/15 font-semibold text-foreground',
                  step.state === 'next' && 'border-white/10 text-muted-foreground',
                )}
              >
                {step.state === 'done' && <Check className="h-3 w-3" aria-hidden="true" />}
                {step.label}
                <span className="sr-only">, {STEP_STATE_TEXT[step.state]}</span>
              </li>
            ))}
          </ol>
          {timedOut && (
            <div
              role="alert"
              className="space-y-2 rounded border border-red-400/40 bg-red-500/10 p-2"
            >
              <p className="text-sm font-medium text-foreground">This is taking too long.</p>
              {!cast.cancellable && (
                <p className="text-xs text-muted-foreground">
                  The spell has already resolved, so it cannot be cancelled.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    // The prompt (and this button) goes away; focus stays in the dock.
                    dockRef.current?.focus();
                    setPatience({ since: cast.phaseStartedAt, until: elapsed + TIMEOUT_SECONDS });
                  }}
                >
                  Keep waiting
                </Button>
                {cast.cancellable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-11"
                    onClick={() => leaveDock(() => void cancelSheetCast())}
                  >
                    Cancel cast
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
