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

/** Badge text on its fill is at least 4.5:1 in all three tones. */
const BADGE_TONES: Record<EngineBadgeTone, string> = {
  gold: 'bg-[#e8c36a] text-[#1a1200]',
  red: 'bg-[#b3261e] text-white',
  grey: 'bg-[#475569] text-white',
};

export const EngineBadgeView: React.FC<{ badge: EngineBadge }> = ({ badge }) => {
  const Icon = BADGE_ICONS[badge.icon];
  return (
    <span
      data-testid="engine-card-badge"
      data-tone={badge.tone}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide',
        BADGE_TONES[badge.tone],
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {badge.word}
    </span>
  );
};

const HpLine: React.FC<{ hp: NonNullable<EngineResultCard['hp']> }> = ({ hp }) => {
  const max = hp.maxHp;
  const left = max && max > 0 ? Math.max(0, Math.min(100, (hp.newHp / max) * 100)) : undefined;
  return (
    <div className="mt-2" data-testid="engine-card-hp">
      <div className="flex items-baseline justify-between gap-2 text-sm text-white/90">
        <span>
          {hp.name} · HP {hp.newHp}
          {max ? ` of ${max}` : ''}
        </span>
        <span className="font-bold tabular-nums text-red-300">−{hp.lost}</span>
      </div>
      {left !== undefined && (
        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-red-950" aria-hidden="true">
          <div className="bg-[#e8c36a]" style={{ width: `${left}%` }} />
        </div>
      )}
    </div>
  );
};

const DeathSavePips: React.FC<{ successes?: number; failures: number }> = ({
  successes,
  failures,
}) => (
  <span className="inline-flex items-center gap-1" aria-hidden="true">
    {[0, 1, 2].map((index) => (
      <span
        key={`s${index}`}
        className={cn(
          'h-2.5 w-2.5 rounded-full border border-[#e8c36a]',
          index < (successes ?? 0) && 'bg-[#e8c36a]',
        )}
      />
    ))}
    <span className="mx-1 h-3 w-px bg-white/30" />
    {[0, 1, 2].map((index) => (
      <span
        key={`f${index}`}
        className={cn(
          'h-2.5 w-2.5 rounded-full border border-red-400',
          index < failures && 'bg-red-400',
        )}
      />
    ))}
  </span>
);

const isLight = (card: EngineResultCard): boolean => !card.math && !card.effect && !card.hp;

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
  return (
    <div
      data-testid="engine-result-card"
      data-kind={card.kind}
      data-side={card.side}
      className={cn(
        'mb-3 rounded-lg border border-white/10 bg-black/35 px-3 backdrop-blur-sm',
        'border-l-[5px]',
        card.side === 'party' ? 'border-l-[#4fb6c4]' : 'border-l-red-500',
        light ? 'py-2' : 'py-3',
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
          {card.badge && <EngineBadgeView badge={card.badge} />}
        </div>
        {card.deathSave && (
          <p className="mt-1 flex items-center gap-2 text-sm text-white/85">
            <DeathSavePips {...card.deathSave} />
            <span>
              {card.deathSave.failures} of 3 failures
              {card.deathSave.successes !== undefined
                ? ` · ${card.deathSave.successes} of 3 successes`
                : ''}
            </span>
          </p>
        )}
        {card.math && (
          <p className="mt-1 text-[15px] tabular-nums text-white/85">
            {engineCardMathText(card.math, showTargetNumbers)}
          </p>
        )}
        {card.effect && <p className="mt-1 text-sm font-bold text-white">{card.effect}</p>}
        {card.detail && <p className="mt-1 text-sm text-white/80">{card.detail}</p>}
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
