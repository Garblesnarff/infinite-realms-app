import React from 'react';

/**
 * Shared presentational primitives for the navy+gold overhaul UI.
 * They lean on the `.ir-panel` / `.ir-panel-h` classes defined in
 * src/styles/ir-overhaul.css, but add layout helpers used across panels.
 */

export const IRPanel: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className = '', children }) => (
  <section className={`ir-panel overflow-hidden ${className}`}>{children}</section>
);

export const IRPanelHeader: React.FC<{
  title: string;
  right?: React.ReactNode;
}> = ({ title, right }) => (
  <header className="ir-panel-h justify-between">
    <span>{title}</span>
    {right ? (
      <span className="text-[10px] tracking-normal text-infinite-gold/80">{right}</span>
    ) : null}
  </header>
);

/** A small labelled stat tile (HP / AC / INIT / SPD, ability scores, etc.). */
export const IRStatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}> = ({ label, value, sub, className = '' }) => (
  <div
    className={`flex flex-col items-center justify-center rounded-md border border-white/10 bg-white/[0.03] px-1 py-2 text-center ${className}`}
  >
    <span className="ir-display text-[9px] font-semibold uppercase tracking-[1.5px] text-infinite-gold/80">
      {label}
    </span>
    <span className="mt-0.5 text-base font-bold leading-none text-foreground">{value}</span>
    {sub != null && (
      <span className="mt-0.5 text-[10px] leading-none text-muted-foreground">{sub}</span>
    )}
  </div>
);

/** Label + modifier row used in Saving Throws / Skills lists. */
export const IRModRow: React.FC<{ label: string; modifier: string }> = ({ label, modifier }) => (
  <div className="flex items-center justify-between border-b border-white/5 py-1 last:border-0">
    <span className="text-[11px] text-foreground/80">{label}</span>
    <span className="text-[11px] font-semibold text-infinite-gold">{modifier}</span>
  </div>
);

/** Thin progress bar (HP / XP). */
export const IRBar: React.FC<{
  value: number;
  max: number;
  className?: string;
  barClassName?: string;
}> = ({ value, max, className = '', barClassName = 'bg-emerald-500/80' }) => {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/10 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${barClassName}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

/** Square avatar / thumbnail with gold ring. */
export const IRThumb: React.FC<{
  src?: string;
  alt?: string;
  size?: number;
  className?: string;
}> = ({ src, alt = '', size = 40, className = '' }) => (
  <div
    className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-infinite-gold/40 bg-gradient-to-br from-infinite-dark-lighter to-infinite-dark ${className}`}
    style={{ width: size, height: size }}
  >
    {src ? (
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    ) : (
      <span className="ir-display text-infinite-gold/50" style={{ fontSize: size * 0.4 }}>
        ✦
      </span>
    )}
  </div>
);
