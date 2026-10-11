import React from 'react';

/**
 * Centered scene header used at the top of the game center column.
 * Reused by both the live game page and the /ui-preview harness.
 */
export const SceneHeader: React.FC<{
  title: string;
  blurb?: string;
  onSceneInfo?: () => void;
  right?: React.ReactNode;
}> = ({ title, blurb, onSceneInfo, right }) => (
  <div className="relative flex items-start justify-between gap-3 px-4 py-3">
    <button
      onClick={onSceneInfo}
      className="ir-hit ir-text-min shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 font-medium text-foreground/70 transition-colors hover:border-infinite-gold/40 hover:text-infinite-gold"
    >
      Scene Info
    </button>
    <div className="min-w-0 flex-1 text-center">
      <h1 className="ir-display truncate text-xl font-bold tracking-wide text-foreground">
        {title}
      </h1>
      {blurb && <p className="ir-narr mt-0.5 truncate text-sm text-foreground/70">{blurb}</p>}
    </div>
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
      {right}
    </div>
  </div>
);
