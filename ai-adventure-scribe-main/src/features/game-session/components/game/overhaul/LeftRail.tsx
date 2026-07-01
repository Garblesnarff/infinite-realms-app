import React from 'react';

import type { CampaignSummaryVM, CombatantVM, PartyMemberVM } from './types';

import { IRBar, IRPanel, IRPanelHeader, IRThumb } from '@/components/ui/ir-primitives';

const CurrentCampaign: React.FC<{ campaign: CampaignSummaryVM }> = ({ campaign }) => (
  <IRPanel>
    <IRPanelHeader title="Current Campaign" />
    <div className="flex items-center gap-3 p-3">
      <IRThumb src={campaign.thumbnailUrl} size={40} />
      <div className="min-w-0">
        <p className="ir-display truncate text-sm font-semibold text-foreground">{campaign.name}</p>
        <p className="truncate text-xs text-infinite-gold/80">{campaign.chapter}</p>
      </div>
    </div>
  </IRPanel>
);

const CurrentObjective: React.FC<{ campaign: CampaignSummaryVM }> = ({ campaign }) => (
  <IRPanel>
    <IRPanelHeader title="Current Objective" />
    <div className="space-y-2 p-3">
      <p className="text-xs leading-relaxed text-foreground/85">{campaign.objective}</p>
      {campaign.objectiveTasks.map((task) => (
        <div key={task.id} className="flex items-center gap-2">
          <span
            className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
              task.done ? 'border-emerald-400 bg-emerald-400/20' : 'border-infinite-gold/60'
            }`}
          >
            {task.done && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
          </span>
          <span className="text-xs text-foreground/80">{task.label}</span>
        </div>
      ))}
    </div>
  </IRPanel>
);

const RegionMap: React.FC<{ campaign: CampaignSummaryVM }> = ({ campaign }) => (
  <IRPanel>
    <IRPanelHeader title="Region Map" />
    <div className="relative m-3 h-28 overflow-hidden rounded-md border border-white/10 bg-[radial-gradient(circle_at_60%_40%,rgba(79,182,196,0.10),transparent_60%),linear-gradient(160deg,#0b1322,#070b14)]">
      {campaign.regionMapUrl && (
        <img
          src={campaign.regionMapUrl}
          alt="Region map"
          className="absolute inset-0 h-full w-full object-cover opacity-70"
        />
      )}
      {/* decorative dotted path */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path
          d="M30 80 Q 90 40 150 60"
          stroke="rgba(213,176,112,0.45)"
          strokeWidth="1.5"
          strokeDasharray="3 5"
          fill="none"
        />
        <circle cx="30" cy="80" r="3" fill="#4fb6c4" />
        <circle cx="150" cy="60" r="3" fill="#d5b070" />
      </svg>
      {campaign.regionLabel && (
        <span className="ir-narr absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground/90">
          {campaign.regionLabel}
        </span>
      )}
    </div>
  </IRPanel>
);

const PartyMemberRow: React.FC<{ member: PartyMemberVM }> = ({ member }) => (
  <div className="flex items-center gap-2.5 px-3 py-2">
    <IRThumb src={member.avatarUrl} size={32} />
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs font-semibold text-foreground">{member.name}</p>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {member.currentHp}/{member.maxHp}
        </span>
      </div>
      <p className="truncate text-[10px] text-muted-foreground">{member.subtitle}</p>
      <IRBar value={member.currentHp} max={member.maxHp} className="mt-1" />
    </div>
  </div>
);

const Party: React.FC<{ party: PartyMemberVM[]; partyMax: number }> = ({ party, partyMax }) => (
  <IRPanel>
    <IRPanelHeader title="Party" right={`${party.length} / ${partyMax}`} />
    <div className="divide-y divide-white/5">
      {party.map((m) => (
        <PartyMemberRow key={m.id} member={m} />
      ))}
    </div>
  </IRPanel>
);

const EncounterTracker: React.FC<{ round: number; combatants: CombatantVM[] }> = ({
  round,
  combatants,
}) => (
  <IRPanel>
    <IRPanelHeader title="Encounter Tracker" />
    <div className="flex items-center justify-between px-3 pb-1 pt-2">
      <span className="text-[11px] text-foreground/80">Round {round}</span>
      <span className="ir-display text-[9px] uppercase tracking-[1.5px] text-infinite-gold/70">
        Init Order
      </span>
    </div>
    <div className="space-y-1 p-2 pt-1">
      {combatants.map((c) => (
        <div
          key={c.id}
          className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
            c.isEnemy
              ? 'border-red-500/40 bg-red-500/10'
              : c.isActive
                ? 'border-infinite-gold/40 bg-infinite-gold/10'
                : 'border-white/5 bg-white/[0.02]'
          }`}
        >
          <span
            className={`ir-display w-6 text-sm font-bold ${c.isEnemy ? 'text-red-400' : 'text-infinite-gold'}`}
          >
            {String(c.initiative).padStart(2, '0')}
          </span>
          <span className="flex-1 truncate text-xs text-foreground/90">{c.name}</span>
          <span className="h-3.5 w-3.5 rounded-[3px] border border-white/20" aria-hidden="true" />
        </div>
      ))}
    </div>
  </IRPanel>
);

export const LeftRail: React.FC<{
  campaign: CampaignSummaryVM;
  party: PartyMemberVM[];
  partyMax: number;
  combat: { active: boolean; round: number; combatants: CombatantVM[] };
}> = ({ campaign, party, partyMax, combat }) => (
  <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
    <CurrentCampaign campaign={campaign} />
    <CurrentObjective campaign={campaign} />
    <RegionMap campaign={campaign} />
    <Party party={party} partyMax={partyMax} />
    {combat.active && <EncounterTracker round={combat.round} combatants={combat.combatants} />}
  </div>
);
