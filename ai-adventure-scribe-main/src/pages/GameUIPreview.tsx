import React from 'react';

import { CenterStagePreview } from '@/features/game-session/components/game/overhaul/CenterStagePreview';
import { LeftRail } from '@/features/game-session/components/game/overhaul/LeftRail';
import { MOCK_VIEW_MODEL as vm } from '@/features/game-session/components/game/overhaul/mockData';
import { RightSheet } from '@/features/game-session/components/game/overhaul/RightSheet';

/**
 * Standalone, public preview of the navy+gold game-session overhaul UI rendered
 * with mock data. Lets us iterate the layout visually without a live session.
 * Route: /ui-preview
 */
const GameUIPreview: React.FC = () => (
  <div className="ir-app min-h-screen">
    {/* Top bar */}
    <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
      <div className="flex items-center gap-8">
        <span className="ir-display flex items-center gap-2 text-lg font-bold tracking-wide text-infinite-gold">
          <span>✦</span> INFINITE REALMS
        </span>
        <nav className="hidden gap-6 text-[11px] font-medium uppercase tracking-[1.5px] text-foreground/60 md:flex">
          <span className="text-infinite-gold">Campaigns</span>
          <span>Character</span>
          <span>World</span>
          <span>Journal</span>
          <span>Settings</span>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5">
          <span className="h-6 w-6 rounded-full border border-infinite-gold/40 bg-infinite-dark-lighter" />
          <div className="leading-tight">
            <p className="text-[11px] font-semibold text-foreground">Adventurer</p>
            <p className="text-[9px] text-emerald-400">● Level 5</p>
          </div>
        </div>
        <button className="ir-btn-gold">Save Session</button>
      </div>
    </header>

    {/* 3-column game layout */}
    <main className="grid h-[calc(100vh-57px)] grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(220px,260px)_1fr_minmax(300px,340px)]">
      <LeftRail campaign={vm.campaign} party={vm.party} partyMax={vm.partyMax} combat={vm.combat} />
      <CenterStagePreview title={vm.scene.title} blurb={vm.scene.blurb} />
      <RightSheet c={vm.character} />
    </main>
  </div>
);

export default GameUIPreview;
