import { Send } from 'lucide-react';
import React from 'react';

import { SceneHeader } from './SceneHeader';

/**
 * Presentational center column for the /ui-preview harness — sample DM / player
 * messages, a dice-roll result card, and the action chip bar. The live game page
 * reuses SceneHeader + ActionChips but keeps the real MessageList / ChatInput.
 */

const DiceResultCard: React.FC = () => (
  <div className="my-2 flex items-center gap-4 rounded-xl border border-infinite-gold/25 bg-[linear-gradient(135deg,rgba(20,28,46,0.9),rgba(12,18,32,0.9))] p-4">
    <div className="relative flex h-16 w-16 items-center justify-center">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <polygon
          points="50,4 92,28 92,72 50,96 8,72 8,28"
          fill="rgba(79,182,196,0.12)"
          stroke="rgba(79,182,196,0.7)"
          strokeWidth="2"
        />
      </svg>
      <span className="ir-display relative text-2xl font-bold text-infinite-teal">18</span>
    </div>
    <div>
      <p className="text-xs text-muted-foreground">You rolled a d20</p>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="ir-display text-2xl font-bold text-foreground">18</span>
        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
          Success
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">vs DC 15 (Persuasion) · +6 Persuasion Modifier</p>
    </div>
  </div>
);

const DmMessage: React.FC<{ time: string; children: React.ReactNode }> = ({ time, children }) => (
  <div className="flex gap-3">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-infinite-gold/40 bg-infinite-dark-lighter text-infinite-gold/70">
      ✦
    </div>
    <div className="min-w-0 flex-1">
      <p className="ir-display mb-1 text-[10px] font-semibold uppercase tracking-[1.5px] text-infinite-gold/70">
        DM <span className="ml-1 text-muted-foreground">{time}</span>
      </p>
      <div className="space-y-2 text-sm leading-relaxed text-foreground/85">{children}</div>
    </div>
  </div>
);

const PlayerMessage: React.FC<{ time: string; children: React.ReactNode }> = ({ time, children }) => (
  <div className="flex flex-col items-end">
    <p className="ir-display mb-1 text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
      <span className="mr-1">{time}</span> You
    </p>
    <div className="max-w-[80%] rounded-2xl rounded-tr-sm border border-infinite-purple/40 bg-infinite-purple/15 px-4 py-2.5 text-sm text-foreground/90">
      {children}
    </div>
  </div>
);

const Quote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="ir-narr border-l-2 border-infinite-gold/50 pl-3 text-foreground/75">{children}</p>
);

const CHIPS = [
  { label: 'Attack', cls: 'border-red-500/40 text-red-300 hover:bg-red-500/10' },
  { label: 'Cast Spell', cls: 'border-sky-500/40 text-sky-300 hover:bg-sky-500/10' },
  { label: 'Inspect', cls: 'border-white/15 text-foreground/70 hover:bg-white/5' },
  { label: 'Persuade', cls: 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10' },
  { label: 'Roll Dice', cls: 'border-sky-500/40 text-sky-300 hover:bg-sky-500/10' },
];

export const CenterStagePreview: React.FC<{ title: string; blurb: string }> = ({ title, blurb }) => (
  <div className="ir-panel flex h-full flex-col">
    <SceneHeader title={title} blurb={blurb} />
    <div className="flex-1 space-y-5 overflow-y-auto border-t border-white/5 px-4 py-4">
      <DmMessage time="10:24 AM">
        <p>
          The trail leads you through gnarled trees and into a veil of thick fog. Ahead looms the crumbling watchtower,
          its stones cloaked in moss and shadow. A chill wind whispers through the broken windows.
        </p>
        <p>As you approach the rusted gate, it creaks open on its own.</p>
        <Quote>
          A figure steps into view atop the stairs — tall, shrouded, eyes glimmering with unearthly light. "You trespass
          where you do not belong…"
        </Quote>
      </DmMessage>

      <PlayerMessage time="10:25 AM">
        I raise my shield and step forward. "We mean no harm. We seek only answers. Who are you, and what is this place?"
      </PlayerMessage>

      <DmMessage time="10:26 AM">
        <p>The figure tilts its head, voice like distant thunder.</p>
        <Quote>"I am the remnant of a vow long broken. Turn back, or be unmade."</Quote>
        <DiceResultCard />
      </DmMessage>

      <PlayerMessage time="10:26 AM">I hold my ground. "We've come too far to turn back now."</PlayerMessage>
    </div>

    {/* Input */}
    <div className="border-t border-white/5 p-3">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <input
          disabled
          placeholder="What do you do next?"
          className="flex-1 bg-transparent text-sm text-foreground/80 placeholder:text-muted-foreground focus:outline-none"
        />
        <button className="ir-btn-gold !px-3 !py-2">
          <Send className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip.label}
            className={`rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors ${chip.cls}`}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  </div>
);
