import React from 'react';

import {
  combatTurnText,
  summarizeCombatTurn,
  type CombatTurnBusy,
  type CombatTurnSummary,
} from './combat-turn-order';

import { useCombat } from '@/contexts/CombatContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { cn } from '@/lib/utils';

/**
 * The one turn bar above the chat feed (#2417): the round, whose turn it is, a pip per actor and
 * who is next. A screen reader hears the label only, as one sentence.
 */
export const CombatTurnBar: React.FC<{ summary: CombatTurnSummary; busy: CombatTurnBusy }> = ({
  summary,
  busy,
}) => {
  const turnText = combatTurnText(summary, busy);
  const label = `Round ${summary.round}. Turn ${summary.turn} of ${summary.actors.length}. ${turnText.replace(/…$/, '')}.`;
  return (
    <div
      data-testid="combat-turn-bar"
      className="shrink-0 border-b border-white/10 bg-[#0b1120]/90 px-3 py-2"
    >
      <p className="sr-only" data-testid="combat-turn-sentence">
        {label}
      </p>
      <div aria-hidden="true">
        <div className="flex items-baseline gap-x-3 overflow-hidden">
          <span className="font-display shrink-0 whitespace-nowrap text-base font-semibold text-infinite-gold">
            Round {summary.round}
          </span>
          <span
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              summary.active.isPlayer ? 'text-infinite-gold' : 'text-red-400',
            )}
            data-testid="combat-turn-text"
          >
            <span className="hidden sm:inline">
              Turn {summary.turn} of {summary.actors.length} ·{' '}
            </span>
            {turnText}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {summary.actors.map((actor) => (
            <span
              key={actor.id}
              data-testid="combat-turn-pip"
              data-state={actor.state}
              className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                'h-6 min-w-6 px-1 sm:h-2.5 sm:w-2.5 sm:min-w-0 sm:p-0',
                actor.state === 'acted' && 'border-white/20 bg-white/25 text-white/70',
                actor.state === 'now' && 'border-infinite-gold bg-infinite-gold text-slate-950',
                actor.state === 'waiting' && 'border-white/20 bg-black/40 text-white/70',
              )}
            >
              <span className="max-w-[9rem] truncate sm:hidden">
                {actor.state === 'now' ? actor.name : actor.initials}
              </span>
            </span>
          ))}
        </div>
        <p className="mt-1 truncate text-xs text-white/70">{summary.nextLine}</p>
      </div>
    </div>
  );
};

/**
 * The bar wired to the live encounter. `turnInFlight` is the message handler's `isProcessing`:
 * the player's turn is being answered, engine and DM included. Then it says "Casting…" when the
 * message is a sheet cast, and "<name> is acting…" while an enemy holds the turn.
 */
export const CombatTurnBarLive: React.FC<{ turnInFlight: boolean }> = ({ turnInFlight }) => {
  const { state } = useCombat();
  const { messages } = useMessageContext();
  const summary = React.useMemo(
    () => summarizeCombatTurn(state.isInCombat ? state.activeEncounter : null),
    [state.isInCombat, state.activeEncounter],
  );
  if (!summary) return null;
  const lastPlayerMessage = [...messages].reverse().find((message) => message.sender === 'player');
  const busy: CombatTurnBusy = !turnInFlight
    ? null
    : lastPlayerMessage?.context?.intent === 'spell_cast'
      ? 'casting'
      : 'acting';
  return <CombatTurnBar summary={summary} busy={busy} />;
};
