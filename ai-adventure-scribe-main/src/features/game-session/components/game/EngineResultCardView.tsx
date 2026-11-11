import { AlertTriangle, ArrowRight, Check, Minus, type LucideIcon } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';
import {
  engineCardAriaLabel,
  engineCardMathText,
  type EngineBadge,
  type EngineBadgeIcon,
  type EngineBadgeTone,
  type EngineResultCard,
} from '@/services/combat/engine-result-card';

const BADGE_ICONS: Record<EngineBadgeIcon, LucideIcon> = {
  check: Check,
  alert: AlertTriangle,
  dash: Minus,
};

const BADGE_TONES: Record<EngineBadgeTone, string> = {
  gold: 'bg-[#e8c36a] text-[#1a1200]',
  red: 'bg-[#b3261e] text-white',
  grey: 'bg-[#475569] text-white',
};

const TABLE_BADGE_TONES: Record<EngineBadgeTone, string> = {
  gold: '[body.ir-table-look_&]:bg-[linear-gradient(160deg,#f6e3b8,#d5b070_45%,#c4a05a)] [body.ir-table-look_&]:text-[#1a1206] [body.ir-table-look_&]:ring-1 [body.ir-table-look_&]:ring-[#f3deb0]',
  red: '[body.ir-table-look_&]:bg-[linear-gradient(160deg,#c2323a,#7a1016)] [body.ir-table-look_&]:text-[#ffe9d6] [body.ir-table-look_&]:ring-1 [body.ir-table-look_&]:ring-[#ef8a8a]',
  grey: '[body.ir-table-look_&]:bg-[#121b30] [body.ir-table-look_&]:text-[#d4dbef] [body.ir-table-look_&]:ring-1 [body.ir-table-look_&]:ring-[#d4dbef]/50',
};

export const EngineBadgeView: React.FC<{ badge: EngineBadge }> = ({ badge }) => {
  const Icon = BADGE_ICONS[badge.icon];
  return (
    <span
      data-testid="engine-card-badge"
      data-tone={badge.tone}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide [body.ir-table-look_&]:min-h-10 [body.ir-table-look_&]:gap-2 [body.ir-table-look_&]:rounded-lg [body.ir-table-look_&]:px-3 [body.ir-table-look_&]:text-sm',
        BADGE_TONES[badge.tone],
        TABLE_BADGE_TONES[badge.tone],
        '[body.ir-table-look_&]:font-heading',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {badge.word}
    </span>
  );
};

const DeathSaveBadgeView: React.FC<{ badge: EngineBadge; roll: number }> = ({ badge, roll }) => {
  const Icon = BADGE_ICONS[badge.icon];
  const word =
    roll === 20
      ? 'NATURAL 20'
      : roll === 1
        ? 'NATURAL 1'
        : badge.tone === 'gold'
          ? 'SUCCESS'
          : 'FAILED';
  const tone = roll === 20 ? 'gold' : roll === 1 ? 'red' : badge.tone;
  return (
    <span
      data-testid="engine-card-badge"
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide [body.ir-table-look_&]:min-h-10 [body.ir-table-look_&]:gap-2 [body.ir-table-look_&]:rounded-lg [body.ir-table-look_&]:px-3 [body.ir-table-look_&]:text-sm',
        BADGE_TONES[tone],
        TABLE_BADGE_TONES[tone],
        '[body.ir-table-look_&]:font-heading',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {word}
    </span>
  );
};

const HpLine: React.FC<{ hp: NonNullable<EngineResultCard['hp']> }> = ({ hp }) => {
  const max = hp.maxHp && hp.maxHp > 0 ? hp.maxHp : undefined;
  const pct = (value: number): number => Math.max(0, Math.min(100, (value / (max ?? 1)) * 100));
  // The payload carries the damage, not the old HP: from = to + damage, capped at the maximum.
  // When that adds nothing (temporary HP absorbed the hit), keep the plain wording.
  const from = max ? Math.min(max, hp.newHp + hp.lost) : hp.newHp + hp.lost;
  const dropped = from > hp.newHp;
  return (
    <div className="mt-2" data-testid="engine-card-hp">
      <div className="flex items-baseline justify-between gap-2 text-sm text-white/90">
        <span>
          {hp.name} · HP {dropped ? `${from} → ${hp.newHp}` : hp.newHp}
          {max ? ` of ${max}` : ''}
        </span>
        <span className="font-bold tabular-nums text-red-300">−{hp.lost}</span>
      </div>
      {max && (
        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-[#3a0d10]" aria-hidden="true">
          <div className="bg-[#e8c36a]" style={{ width: `${pct(hp.newHp)}%` }} />
          {dropped && (
            <div className="bg-[#7a1016]" style={{ width: `${pct(from) - pct(hp.newHp)}%` }} />
          )}
        </div>
      )}
    </div>
  );
};

function Pip({ filled, kind }: { filled: boolean; kind: 'saved' | 'failed' }): React.ReactElement {
  const mark =
    kind === 'saved' ? (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6 12.5l4 4L18 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 7l10 10M17 7L7 17"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </svg>
    );
  const filledClass =
    kind === 'saved'
      ? 'border-[#e8c36a] bg-[#e8c36a] text-infinite-dark ir-end-pip-saved'
      : 'border-red-400 bg-red-400 text-white ir-end-pip-failed';
  const emptyClass =
    kind === 'saved' ? 'border-[#e8c36a] ir-end-pip-empty' : 'border-red-400 ir-end-pip-empty';
  return (
    <span
      data-testid="death-save-pip"
      data-kind={kind}
      data-filled={filled ? 'true' : 'false'}
      className={cn(
        'inline-flex h-2.5 w-2.5 items-center justify-center rounded-full border',
        '[body.ir-table-look_&]:h-5 [body.ir-table-look_&]:w-5 [body.ir-table-look_&]:border-0 [body.ir-table-look_&]:transition-[background-color,box-shadow] [body.ir-table-look_&]:duration-150 motion-reduce:[body.ir-table-look_&]:transition-none motion-reduce:[body.ir-table-look_&]:!duration-0 [html[data-reduce-motion=on]_body.ir-table-look_&]:transition-none [html[data-reduce-motion=on]_body.ir-table-look_&]:!duration-0',
        filled ? filledClass : emptyClass,
      )}
    >
      {filled ? <span className="hidden [body.ir-table-look_&]:inline-flex">{mark}</span> : null}
    </span>
  );
}

const DeathSavePips: React.FC<{ successes?: number; failures: number }> = ({
  successes,
  failures,
}) => {
  return (
    <span
      className="inline-flex items-center gap-1 [body.ir-table-look_&]:flex-wrap [body.ir-table-look_&]:gap-x-3.5 [body.ir-table-look_&]:gap-y-1.5"
      aria-hidden="true"
    >
      {/* A tally the producer did not report is never invented: omit the Saved group entirely. */}
      {successes !== undefined && (
        <>
          <span className="inline-flex items-center [body.ir-table-look_&]:gap-2">
            <span className="hidden text-[13px] font-bold tracking-wide text-infinite-gold [body.ir-table-look_&]:inline [body.ir-table-look_&]:text-[#f3deb0]">
              Saved
            </span>
            <span className="inline-flex gap-1 [body.ir-table-look_&]:gap-[5px]">
              {[0, 1, 2].map((index) => (
                <Pip key={`s${index}`} kind="saved" filled={index < successes} />
              ))}
            </span>
          </span>
          <span className="mx-1 h-3 w-px bg-white/30 [body.ir-table-look_&]:hidden" />
        </>
      )}
      <span className="inline-flex items-center [body.ir-table-look_&]:gap-2">
        <span className="hidden text-[13px] font-bold tracking-wide text-red-300 [body.ir-table-look_&]:inline [body.ir-table-look_&]:text-[#ef8a8a]">
          Failed
        </span>
        <span className="inline-flex gap-1 [body.ir-table-look_&]:gap-[5px]">
          {[0, 1, 2].map((index) => (
            <Pip key={`f${index}`} kind="failed" filled={index < failures} />
          ))}
        </span>
      </span>
    </span>
  );
};

const isLight = (card: EngineResultCard): boolean => !card.math && !card.effect && !card.hp;

function deathSaveMathText(
  math: Extract<NonNullable<EngineResultCard['math']>, { kind: 'save' }>,
  showTargetNumbers: boolean,
): string {
  if (math.roll === 20) return 'd20 20 · natural 20';
  if (math.roll === 1) return 'd20 1 · natural 1';
  return showTargetNumbers ? `d20 ${math.roll} vs DC ${math.dc}` : `d20 ${math.roll}`;
}

/**
 * The engine result card (#2417). Replaces the plain `⚙️ Engine:` line. Everything on it comes
 * from the engine result fields; the line is only its screen reader sentence. Target numbers
 * follow the player's "Show target numbers" setting.
 */
export const EngineResultCardView: React.FC<{
  card: EngineResultCard;
  showTargetNumbers: boolean;
}> = ({ card, showTargetNumbers }) => {
  const light = isLight(card);
  const deathMath = card.kind === 'death_save' && card.math?.kind === 'save' ? card.math : null;
  const revived = deathMath?.roll === 20;
  const showDetail = !deathMath;
  return (
    <div
      data-testid="engine-result-card"
      data-kind={card.kind}
      data-side={card.side}
      className={cn(
        'mb-3 rounded-lg border border-white/10 bg-black/35 px-3 backdrop-blur-sm [body.ir-table-look_&]:rounded-xl [body.ir-table-look_&]:bg-[#0c1220] [body.ir-table-look_&]:px-4',
        'border-l-[5px]',
        card.side === 'party'
          ? 'border-l-[#4fb6c4] [body.ir-table-look_&]:border-l-[#4fb6c4]'
          : 'border-l-red-500 [body.ir-table-look_&]:border-l-[#ef8a8a]',
        light ? 'py-2' : 'py-3',
        card.kind === 'move' &&
          '[body.ir-table-look_&]:border-l [body.ir-table-look_&]:border-l-white/10',
      )}
    >
      {/* The sentence is page text, so a screen reader in browse mode reads it; the visual
          card below repeats it piece by piece and is hidden from assistive technology. */}
      <p className="sr-only" data-testid="engine-card-sentence">
        {engineCardAriaLabel(card, showTargetNumbers)}
      </p>
      <div aria-hidden="true">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p
            className={cn(
              'min-w-0 flex-1 basis-48 break-words text-white',
              light ? 'text-sm' : 'text-base font-bold',
            )}
          >
            {card.kind === 'move' && (
              <ArrowRight className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
            )}
            {card.title}
          </p>
          {card.badge &&
            (deathMath ? (
              <DeathSaveBadgeView badge={card.badge} roll={deathMath.roll} />
            ) : (
              <EngineBadgeView badge={card.badge} />
            ))}
        </div>
        {card.math && !deathMath && (
          <p className="mt-1 text-[15px] tabular-nums text-white/85 [body.ir-table-look_&]:text-[#d4dbef]">
            {card.kind === 'spell' && card.math.kind === 'attack' && 'Spell attack: '}
            {engineCardMathText(card.math, showTargetNumbers)}
          </p>
        )}
        {deathMath && (
          <p className="mt-1 text-sm tabular-nums text-white/85 [body.ir-table-look_&]:text-[#d4dbef]">
            {deathSaveMathText(deathMath, showTargetNumbers)}
          </p>
        )}
        {card.effect && (
          <p className="mt-0.5 text-sm font-bold text-white [body.ir-table-look_&]:text-[#eaeefa]">
            {card.effect}
          </p>
        )}
        {card.deathSave && !revived && (
          <div className="mt-2.5">
            <DeathSavePips {...card.deathSave} />
          </div>
        )}
        {card.deathSave && !deathMath && (
          <p className="mt-1 text-sm text-white/85">
            {card.deathSave.failures} of 3 failures
            {card.deathSave.successes !== undefined
              ? ` · ${card.deathSave.successes} of 3 successes`
              : ''}
          </p>
        )}
        {showDetail && card.detail && (
          <p className="mt-1 text-sm text-white/80 [body.ir-table-look_&]:text-[#d4dbef]">
            {card.detail}
          </p>
        )}
        {card.hp && <HpLine hp={card.hp} />}
        {card.status && <p className="mt-1 text-sm text-white/80">{card.status}</p>}
        {card.initiative && (
          <p className="mt-1 text-sm text-white/85">
            {card.initiative.order.map((entry) => `${entry.name} ${entry.initiative}`).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
};
