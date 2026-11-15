import React from 'react';

import {
  actorIsDying,
  nearestEnemyDistanceFeet,
  summarizeCombatTurn,
  turnBarSub,
  turnBarTitle,
  type CombatTurnBusy,
  type CombatTurnSummary,
  type NearestEnemy,
} from './combat-turn-order';
import {
  facingName,
  rosterEntryForParticipant,
} from '../../../../../../shared/engine-display-name';

import type { Character } from '@/types/character';

import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { cn } from '@/lib/utils';
import { isHostileParticipantType } from '@/services/combat/engine-result-card';
import { resolvePlayerHitPoints } from '@/utils/character/player-hit-points';

const subscribeTableLook = (notify: () => void): (() => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

/** The HP block's input: nulls mean the value is not known yet, so it skeletonizes. */
export interface TurnBarHitPoints {
  current: number | null;
  maximum: number | null;
  temp: number;
}

const hpBarColor = (current: number, maximum: number): string => {
  if (maximum <= 0) return 'bg-ir-hp-bad';
  const pct = (current / maximum) * 100;
  if (pct >= 50) return 'bg-ir-hp-good';
  if (pct >= 25) return 'bg-ir-hp-warn';
  return 'bg-ir-hp-bad';
};

/** One HP value, 150 px wide (120 px under 700 px): label, value, 6 px bar (#85). */
const TurnBarHitPointsBlock: React.FC<{ hp: TurnBarHitPoints }> = ({ hp }) => {
  if (hp.current === null || hp.maximum === null) {
    return (
      <div
        data-testid="combat-turn-hp"
        aria-label="Loading hit points"
        className="h-9 w-[150px] shrink-0 animate-pulse rounded bg-white/10 max-[699px]:w-[120px]"
      />
    );
  }
  const pct = hp.maximum > 0 ? Math.max(0, Math.min(100, (hp.current / hp.maximum) * 100)) : 0;
  const value = hp.temp > 0 ? `${hp.current} + ${hp.temp} temp` : `${hp.current} / ${hp.maximum}`;
  return (
    <div data-testid="combat-turn-hp" className="w-[150px] shrink-0 max-[699px]:w-[120px]">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          HP
        </span>
        <span className="text-base font-bold tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn('h-full rounded-full', hpBarColor(hp.current, hp.maximum))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const EDGE_SHADOW = {
  gold: 'shadow-[inset_3px_0_0_0_rgb(var(--c-infinite-gold))]',
  teal: 'shadow-[inset_3px_0_0_0_rgb(var(--c-infinite-teal))]',
  bad: 'shadow-[inset_3px_0_0_0_var(--ir-hp-bad)]',
} as const;

/**
 * The one turn bar above the chat feed (#2417, restyled #85): the title, the sub line, the
 * turn tokens and the HP block. A screen reader hears the sentence only, as one sentence;
 * the visual chunks are aria-hidden, except the Map button, which stays reachable.
 * Under 700 px the bar wraps to two rows (title + HP, then tokens + Map).
 */
const TurnBarShell: React.FC<{
  title: string;
  sub: string | null;
  hpSentence: string | null;
  next?: string;
  edge: keyof typeof EDGE_SHADOW;
  titleClassName: string;
  children?: React.ReactNode;
}> = ({ title, sub, hpSentence, next, edge, titleClassName, children }) => {
  const sentence =
    `${title.replace(/…$/, '')}. ${sub ? `${sub}. ` : ''}${next ? `${next} ` : ''}${hpSentence ? `${hpSentence}.` : ''}`.trim();
  return (
    <div
      data-testid="combat-turn-bar"
      role="status"
      aria-live="polite"
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-3.5 border-b border-white/10 bg-infinite-surface/95 px-4 py-2.5',
        EDGE_SHADOW[edge],
      )}
    >
      <p className="sr-only" data-testid="combat-turn-sentence">
        {sentence}
      </p>
      <div
        aria-hidden="true"
        className="order-1 min-w-0 flex-1 [body.ir-table-look_&]:max-[699px]:basis-full"
      >
        <p
          data-testid="combat-turn-text"
          className={cn('font-heading truncate text-base font-bold tracking-wide', titleClassName)}
        >
          {title}
        </p>
        {sub && (
          <p
            data-testid="combat-turn-sub"
            className="truncate text-xs text-muted-foreground [body.ir-table-look_&]:overflow-visible [body.ir-table-look_&]:whitespace-normal"
          >
            {sub}
          </p>
        )}
        {next && (
          <p data-testid="combat-turn-next" className="text-xs">
            {next}
          </p>
        )}
      </div>
      {children}
    </div>
  );
};

const hpSentenceOf = (hp: TurnBarHitPoints | undefined): string | null => {
  if (!hp || hp.current === null || hp.maximum === null) return null;
  return hp.temp > 0
    ? `HP ${hp.current} of ${hp.maximum} plus ${hp.temp} temporary`
    : `HP ${hp.current} of ${hp.maximum}`;
};

export interface CombatTurnBarProps {
  summary: CombatTurnSummary;
  busy: CombatTurnBusy;
  hp?: TurnBarHitPoints;
  enemyDistance?: NearestEnemy | null;
  playerDown?: boolean;
  onOpenMap?: () => void;
}

export const CombatTurnBar: React.FC<CombatTurnBarProps> = ({
  summary,
  busy,
  hp,
  enemyDistance,
  playerDown = false,
  onOpenMap,
}) => {
  const tableLook = React.useSyncExternalStore(
    subscribeTableLook,
    () => document.body.classList.contains('ir-table-look'),
    () => false,
  );
  const baseTitle = turnBarTitle(summary, busy, playerDown);
  const normalSub = turnBarSub(summary, enemyDistance ?? null, playerDown);
  const down = actorIsDying(summary.active, playerDown);
  const title = tableLook && down ? 'Dying' : baseTitle;
  const sub = tableLook
    ? `Round ${summary.round} · Turn ${summary.turn} of ${summary.actors.length}${normalSub && !normalSub.startsWith('Round ') ? ` · ${normalSub}` : ''}`
    : normalSub;
  const edge = down ? 'bad' : summary.active.isPlayer ? 'gold' : 'teal';
  const titleClassName = down
    ? 'text-ir-hp-bad'
    : summary.active.isPlayer
      ? 'text-infinite-gold'
      : 'text-infinite-teal';
  return (
    <TurnBarShell
      title={title}
      sub={sub}
      hpSentence={hpSentenceOf(hp)}
      next={summary.nextLine}
      edge={edge}
      titleClassName={titleClassName}
    >
      <div
        aria-hidden="true"
        className="order-2 flex flex-wrap items-center gap-1.5 max-[699px]:order-3 [body.ir-table-look_&]:max-w-full [body.ir-table-look_&]:min-w-0 [body.ir-table-look_&]:flex-nowrap [body.ir-table-look_&]:overflow-x-auto"
      >
        {summary.actors.map((actor) => (
          <span
            key={actor.id}
            data-testid="combat-turn-pip"
            data-state={actor.state}
            className={cn(
              'ir-tent-card inline-flex h-[30px] w-[30px] min-w-[30px] shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold [body.ir-table-look_&]:h-auto [body.ir-table-look_&]:w-[92px] [body.ir-table-look_&]:min-w-[92px] [body.ir-table-look_&]:flex-col [body.ir-table-look_&]:rounded [body.ir-table-look_&]:px-2 [body.ir-table-look_&]:py-1',
              actor.isPlayer ? 'ir-tent-card--player' : 'ir-tent-card--foe',
              actor.state === 'now' && 'ir-tent-card--current',
              actor.isPlayer ? 'border-infinite-gold' : 'border-infinite-teal',
              actor.state === 'acted' && 'bg-white/25 text-white/70',
              actor.state === 'now' &&
                'bg-infinite-gold text-slate-950 outline outline-2 outline-offset-2 outline-foreground',
              actor.state === 'waiting' && 'bg-black/40 text-white/70',
              actor.state === 'down' && 'bg-red-950/60 text-red-300/80 line-through',
            )}
          >
            {tableLook ? (
              <>
                <span>
                  {actor.initiative != null ? `${actor.initiative} · ` : ''}
                  {actor.name}
                </span>
                {actorIsDying(actor, actor.id === summary.active.id ? playerDown : false) ? (
                  <span
                    data-testid="combat-turn-dying"
                    className="inline-flex items-center gap-1 rounded-full bg-[#475569] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#f1f5f9]"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M5 8h6l-6 8h6M14 4h5l-5 6h5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {/* #1507: a hero at 0 HP is Unconscious, the tracker's word (DyingStates state 9). */}
                    Unconscious
                  </span>
                ) : (
                  actor.state === 'now' && <span>{actor.isPlayer ? 'Your turn' : 'Now'}</span>
                )}
              </>
            ) : (
              actor.initials
            )}
          </span>
        ))}
      </div>
      {hp && (
        <div aria-hidden="true" className="order-3 max-[699px]:order-2">
          <TurnBarHitPointsBlock hp={hp} />
        </div>
      )}
      {onOpenMap && (
        <button
          type="button"
          onClick={onOpenMap}
          className="order-4 hidden rounded-md border border-infinite-gold/30 bg-white/[0.03] px-3 py-1.5 text-sm font-medium text-infinite-gold/90 hover:bg-infinite-gold/10 max-[699px]:inline-flex"
        >
          Map
        </button>
      )}
    </TurnBarShell>
  );
};

/** The initiative-rolling window: the encounter exists but no turn holder yet (#85). */
export const CombatTurnBarLoading: React.FC<{ enemyName: string }> = ({ enemyName }) => (
  <TurnBarShell
    title="Setting up the fight…"
    sub={`Rolling initiative for ${enemyName}`}
    hpSentence={null}
    edge="gold"
    titleClassName="text-infinite-gold"
  >
    <div aria-hidden="true" className="order-3 max-[699px]:order-2">
      <TurnBarHitPointsBlock hp={{ current: null, maximum: null, temp: 0 }} />
    </div>
  </TurnBarShell>
);

/** Outside a fight the bar stays up as the Exploring strip (#85). */
export const CombatTurnBarExploring: React.FC<{
  campaignName: string | null;
  location: string | null;
  hp?: TurnBarHitPoints;
}> = ({ campaignName, location, hp }) => {
  const sub = [campaignName, location].filter(Boolean).join(' · ') || null;
  return (
    <TurnBarShell
      title="Exploring"
      sub={sub}
      hpSentence={hpSentenceOf(hp)}
      edge="gold"
      titleClassName="text-infinite-gold"
    >
      {hp && (
        <div aria-hidden="true" className="order-3 max-[699px]:order-2">
          <TurnBarHitPointsBlock hp={hp} />
        </div>
      )}
    </TurnBarShell>
  );
};

/**
 * The bar wired to the live encounter. `turnInFlight` is the message handler's `isProcessing`:
 * the player's turn is being answered, engine and DM included. Then it says "Casting…" when the
 * message is a sheet cast, and "<name> is acting…" while an enemy holds the turn.
 */
export const CombatTurnBarLive: React.FC<{
  turnInFlight: boolean;
  onOpenMap?: () => void;
}> = ({ turnInFlight, onOpenMap }) => {
  const { state } = useCombat();
  const { messages } = useMessageContext();
  const { state: campaignState } = useCampaign();
  const { state: characterState } = useCharacter();
  const encounter = state.isInCombat ? state.activeEncounter : null;
  const summary = React.useMemo(() => summarizeCombatTurn(encounter), [encounter]);
  const character = (characterState?.character ?? null) as Character | null;
  const hp = React.useMemo(
    () => resolvePlayerHitPoints(encounter, character),
    [encounter, character],
  );
  if (summary) {
    const lastPlayerMessage = [...messages]
      .reverse()
      .find((message) => message.sender === 'player');
    const busy: CombatTurnBusy = !turnInFlight
      ? null
      : lastPlayerMessage?.context?.intent === 'spell_cast'
        ? 'casting'
        : 'acting';
    const playerParticipant = summary?.active?.isPlayer
      ? encounter?.participants.find(
          (participant) =>
            participant.id === summary.active.id && participant.participantType === 'player',
        )
      : undefined;
    const playerDown = (playerParticipant?.currentHitPoints ?? 1) <= 0;
    return (
      <CombatTurnBar
        summary={summary}
        busy={busy}
        hp={hp}
        enemyDistance={nearestEnemyDistanceFeet(encounter)}
        playerDown={playerDown}
        onOpenMap={onOpenMap}
      />
    );
  }
  if (encounter) {
    // Seating / initiative window: no turn holder yet, so the summary is null. Name the
    // first hostile in initiative order, or the first seated actor if there is none.
    const inOrder = encounter.participants.filter((participant) => participant.isActive !== false);
    const roster = inOrder.map(rosterEntryForParticipant);
    const ordered = inOrder.slice().sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
    const first =
      ordered.find((participant) => isHostileParticipantType(participant.participantType)) ??
      ordered[0];
    if (!first) return null;
    return <CombatTurnBarLoading enemyName={facingName(undefined, first.id, roster)} />;
  }
  const location =
    [...messages].reverse().find((message) => message.context?.location)?.context?.location ?? null;
  return (
    <CombatTurnBarExploring
      campaignName={campaignState?.campaign?.name ?? null}
      location={location}
      hp={hp}
    />
  );
};
