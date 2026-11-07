import React from 'react';

import { SavePips } from './SavePips';

import { PLAYER_DEATH_SAVE_ROLL_TIMEOUT_MS } from '@/services/combat/player-roll-bridge';

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
   * The roll prompt is open in the tray above (it carries the Roll button), so the panel shows
   * no second button. The countdown still reads the same bridge timer.
   */
  promptOpen?: boolean;
  /** Whose turn it is while the player cannot act. Omitted when the engine has not named them. */
  waitingOn?: string | null;
  /**
   * Whole seconds left on the death-save bridge timer (#2504). Null when that timer is not
   * running. The panel does not invent a clock.
   */
  autoRollSecondsLeft?: number | null;
}

function clampPips(count: number): number {
  return Math.max(0, Math.min(3, count));
}

/**
 * The dying state of the composer (#2518, spec §8 of #2520, Table 11).
 *
 * It replaces the composer: a character on the floor cannot type an action. Pips carry the
 * words Saved and Failed. The auto-roll line is the bridge timer, announced at the start and
 * at 10 seconds only.
 */
export const DyingPanel: React.FC<DyingPanelProps> = ({
  name,
  state,
  successes,
  failures,
  isOwnTurn,
  onRoll,
  promptOpen = false,
  waitingOn,
  autoRollSecondsLeft = null,
}) => {
  const stable = state === 'stable';
  const saved = clampPips(successes);
  const failed = clampPips(failures);
  const tally = `${saved} ${saved === 1 ? 'success' : 'successes'} and ${failed} ${
    failed === 1 ? 'failure' : 'failures'
  } of 3`;
  const showRoll = Boolean(isOwnTurn && onRoll && !promptOpen);
  const showClock = Boolean(isOwnTurn && !stable && autoRollSecondsLeft !== null);
  const timeoutSeconds = PLAYER_DEATH_SAVE_ROLL_TIMEOUT_MS / 1000;
  const barPercent =
    autoRollSecondsLeft === null
      ? 0
      : Math.max(0, Math.min(100, Math.round((100 * autoRollSecondsLeft) / timeoutSeconds)));
  const [announcement, setAnnouncement] = React.useState('');
  const announcedStart = React.useRef(false);

  React.useEffect(() => {
    if (!showClock || autoRollSecondsLeft === null) {
      announcedStart.current = false;
      setAnnouncement('');
      return;
    }
    if (!announcedStart.current) {
      announcedStart.current = true;
      setAnnouncement(`Auto-roll in ${autoRollSecondsLeft} s`);
      return;
    }
    if (autoRollSecondsLeft === 10) setAnnouncement('Auto-roll in 10 s');
  }, [showClock, autoRollSecondsLeft]);

  return (
    <section
      data-testid="dying-panel"
      aria-label={stable ? 'Stable' : 'Dying'}
      className="ir-dying-shell mx-3 my-3 flex overflow-hidden rounded-xl border border-white/10 bg-black/35 text-foreground"
    >
      <span
        aria-hidden="true"
        className={`w-[5px] shrink-0 ${
          stable
            ? 'bg-slate-500 [body.ir-table-look_&]:bg-[#475569]'
            : 'bg-red-300 [body.ir-table-look_&]:bg-[#ef8a8a]'
        }`}
      />
      <div className="min-w-0 flex-1 px-3.5 pb-3.5 pt-3">
        <h2
          className="ir-display m-0 text-lg font-bold leading-tight"
          data-testid="dying-panel-title"
        >
          {stable ? `${name} is stable` : `${name} is dying`}
        </h2>
        {!stable && (
          <>
            <div className="mt-2">
              <SavePips successes={saved} failures={failed} />
              <span className="sr-only">{tally}</span>
            </div>
            {isOwnTurn ? (
              <>
                <p className="mt-2.5 text-[15px] font-bold" data-testid="dying-panel-hint">
                  Death saving throw — roll a d20
                </p>
                <p className="ir-end-muted mt-0.5 text-sm text-white/65">
                  {promptOpen
                    ? 'No modifiers. 10 or higher saves. Roll the d20 above.'
                    : 'No modifiers. 10 or higher saves.'}
                </p>
              </>
            ) : (
              <p className="mt-2.5 text-[15px] font-bold" data-testid="dying-panel-hint">
                You cannot act. Wait for your turn.
              </p>
            )}
            {showRoll && (
              <button
                type="button"
                data-testid="dying-panel-roll"
                onClick={onRoll}
                className="ir-end-brass ir-display mt-2.5 min-h-[52px] w-full rounded-xl border border-infinite-gold bg-infinite-gold text-[17px] font-bold tracking-wide text-infinite-dark"
              >
                Roll death save
              </button>
            )}
            {showClock && (
              <div className="mt-2 flex items-center gap-2.5">
                <span
                  role="timer"
                  aria-live="off"
                  data-testid="dying-panel-countdown"
                  className="ir-end-body shrink-0 text-sm tabular-nums text-white/80"
                >
                  Auto-roll in {autoRollSecondsLeft} s
                </span>
                <div
                  aria-hidden="true"
                  className="ir-end-bar h-1.5 flex-1 overflow-hidden rounded-sm bg-white/10"
                >
                  <i
                    className="block h-1.5 rounded-sm bg-infinite-gold [body.ir-table-look_&]:bg-[#d5b070]"
                    style={{ width: `${barPercent}%` }}
                  />
                </div>
              </div>
            )}
            {!isOwnTurn && waitingOn ? (
              <div
                role="status"
                data-testid="dying-panel-waiting"
                className="mt-2 inline-flex min-h-11 items-center gap-2.5 rounded-full bg-black/40 px-3.5 py-2 text-sm text-white/80 shadow-[0_0_0_1px_rgba(255,255,255,.15)] [body.ir-table-look_&]:bg-[#121b30] [body.ir-table-look_&]:text-[#d4dbef] [body.ir-table-look_&]:shadow-[0_0_0_1px_rgba(213,176,112,.3)]"
              >
                {waitingOn} is acting
                <span aria-hidden="true">
                  <i className="ir-end-dot" />
                  <i className="ir-end-dot" />
                  <i className="ir-end-dot" />
                </span>
              </div>
            ) : null}
            <span className="sr-only" role="status" data-testid="dying-panel-countdown-live">
              {announcement}
            </span>
          </>
        )}
        {stable && (
          <>
            <p className="ir-end-body mt-2 text-[15px] text-white/80">
              Unconscious. No roll. You wake with 1 HP after 1d4 hours, or when someone heals you.
            </p>
            <div className="ir-display mt-2.5 inline-flex min-h-8 items-center gap-2 rounded-lg bg-slate-600 px-3 text-[13px] font-bold tracking-wide text-slate-50 [body.ir-table-look_&]:bg-[#475569] [body.ir-table-look_&]:text-[#f1f5f9]">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M6 12h12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              STABLE
            </div>
          </>
        )}
      </div>
    </section>
  );
};
