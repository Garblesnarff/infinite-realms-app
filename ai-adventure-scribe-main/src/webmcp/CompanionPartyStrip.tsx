import React from 'react';

import {
  getActiveCompanions,
  getPartyClass,
  getPartyHitPoints,
  getPartyLevel,
} from './companion-api';
import { useCompanionScene } from './use-companion-scene';

export const CompanionPartyStrip: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => {
  const { data: scene } = useCompanionScene(sessionId);
  const companions = getActiveCompanions(scene);

  if (!sessionId || companions.length === 0) return null;

  return (
    <section
      aria-label="Companion party"
      className="rounded-lg border border-infinite-teal/30 bg-infinite-teal/5 p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-infinite-teal">
          Companions
        </h3>
        <span className="text-[10px] text-muted-foreground">{companions.length}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {companions.map((companion, index) => {
          const name = companion.name ?? `Companion ${index + 1}`;
          const hitPoints = getPartyHitPoints(companion);
          const level = getPartyLevel(companion);
          const className = getPartyClass(companion);

          return (
            <div
              key={companion.id ?? companion.companion_id ?? companion.character_id ?? name}
              className="min-w-[9rem] flex-1 rounded-md border border-white/10 bg-black/10 px-2.5 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold text-foreground">{name}</span>
                {level != null && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">Lv {level}</span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {className ?? 'Companion'}
              </div>
              {hitPoints && (
                <div className="mt-1 text-[10px] font-medium text-infinite-teal">
                  HP {hitPoints.current}/{hitPoints.max}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
