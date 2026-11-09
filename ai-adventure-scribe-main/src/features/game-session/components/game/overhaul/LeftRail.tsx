import React from 'react';

import type { CampaignSummaryVM, CharacterSheetVM, CombatantVM, PartyMemberVM } from './types';

import { IRBar, IRPanel, IRPanelHeader, IRThumb } from '@/components/ui/ir-primitives';
import { tableImageUrl } from '@/features/campaigns/table/image-url';
import { TableImage } from '@/features/campaigns/table/TableImage';
import { formatCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';

const CurrentCampaign: React.FC<{ campaign: CampaignSummaryVM }> = ({ campaign }) => (
  <IRPanel>
    <IRPanelHeader title="Current Campaign" />
    <div className="flex items-center gap-3 p-3">
      <IRThumb src={campaign.thumbnailUrl} size={40} />
      <div className="min-w-0">
        {/* #1216: the title wraps ("THE NOON TITHE: SIEG…" at 1280 px). */}
        <p className="ir-display break-words text-sm font-semibold text-foreground">
          {campaign.name}
        </p>
        <p className="ir-text-min truncate text-xs text-infinite-gold/80">{campaign.chapter}</p>
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
        <span className="ir-text-min shrink-0 text-muted-foreground">
          {formatCharacterSheetHitPoints({
            current: member.currentHp,
            maximum: member.maxHp,
          })}
        </span>
      </div>
      <p className="ir-text-min truncate text-muted-foreground">{member.subtitle}</p>
      {member.currentHp !== null && member.maxHp !== null && (
        <IRBar value={member.currentHp} max={member.maxHp} className="mt-1" />
      )}
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

const STATE_LABEL = { acted: 'Acted', now: 'Now', waiting: 'Waiting', down: 'Down' } as const;
const VITAL_LABEL = { dying: 'Unconscious', stable: 'Stable', dead: 'Dead' } as const;

const EncounterTracker: React.FC<{
  round: number;
  actedCount?: number;
  combatants: CombatantVM[];
}> = ({ round, actedCount, combatants }) => (
  <IRPanel>
    <IRPanelHeader title="Encounter Tracker" />
    <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
      <span className="ir-text-min whitespace-nowrap text-foreground/80">Round {round}</span>
      {actedCount !== undefined && (
        <span className="ir-text-min text-foreground/80">
          {actedCount} of {combatants.length} have acted this round
        </span>
      )}
    </div>
    <div className="space-y-1 p-2 pt-1">
      {combatants.map((c) => (
        <div
          key={c.id}
          data-state={c.state}
          className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-white ${
            c.isEnemy
              ? 'border-white/5 border-l-4 border-l-red-500 bg-red-500/10'
              : 'border-white/5 bg-white/[0.02]'
          } ${c.isActive ? 'ring-1 ring-infinite-gold' : ''}`}
        >
          <span className="ir-display w-6 text-sm font-bold">
            {String(c.initiative).padStart(2, '0')}
          </span>
          <span className="flex-1 truncate text-xs">{c.name}</span>
          {c.vitalState && c.vitalState !== 'standing' ? (
            <span
              data-vital-state={c.vitalState}
              className="inline-flex items-center gap-1 rounded-full bg-[#475569] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#f1f5f9]"
            >
              {c.vitalState === 'dying' && (
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
              )}
              {VITAL_LABEL[c.vitalState]}
            </span>
          ) : (
            c.state && (
              <span
                className={`ir-text-min uppercase tracking-wide ${
                  c.state === 'now' ? 'font-bold text-infinite-gold' : 'text-white/70'
                }`}
              >
                {STATE_LABEL[c.state]}
              </span>
            )
          )}
        </div>
      ))}
    </div>
  </IRPanel>
);

/** Compact view of the same character data used by the full sheet. */
export const TableCharacterCard: React.FC<{
  character: CharacterSheetVM;
  onOpenSheet: () => void;
  preferredPortrait?: string;
}> = ({ character, onOpenSheet, preferredPortrait }) => {
  const [expanded, setExpanded] = React.useState(false);
  const portrait = tableImageUrl(preferredPortrait ?? null, 144, 144);
  const alternatePortrait = tableImageUrl(character.avatarUrl ?? null, 144, 144);
  const portraitImage = (size: number): React.ReactNode => (
    <TableImage
      src={portrait}
      alt=""
      width={size}
      height={size}
      className="rounded object-cover"
      fallback={
        <TableImage
          src={alternatePortrait}
          alt=""
          width={size}
          height={size}
          className="rounded object-cover"
          fallback={<span aria-hidden="true">{character.name.slice(0, 1)}</span>}
        />
      }
    />
  );
  const hp = formatCharacterSheetHitPoints({
    current: character.hpCurrent,
    maximum: character.hpMax,
  }).replace('/', ' / ');
  return (
    <section
      className="ir-index-card rounded-lg p-1 text-[#2a1a0c] md:p-4"
      aria-label="Character summary"
    >
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 text-left md:hidden"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {portraitImage(36)}
        <span className="min-w-0 flex-1 truncate font-bold">{character.name}</span>
        <span>
          ♥ {hp} · AC {character.ac ?? '—'}
        </span>
      </button>
      <div className="hidden items-center gap-3 md:flex">
        {portraitImage(64)}
        <div className="min-w-0">
          <h2 className="ir-display break-words text-lg font-bold">{character.name}</h2>
          <p>
            {character.subtitle} · Level {character.level}
          </p>
        </div>
      </div>
      <div className={expanded ? 'block' : 'hidden md:block'}>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <dt>AC</dt>
            <dd>{character.ac ?? '—'}</dd>
          </div>
          <div>
            <dt>INIT</dt>
            <dd>{character.initiative}</dd>
          </div>
          <div>
            <dt>SPEED</dt>
            <dd>{character.speed}</dd>
          </div>
        </dl>
        <p className="mt-3 font-semibold">Hit points · {hp}</p>
        {character.hpCurrent !== null &&
          character.hpMax !== null &&
          character.hpMax > 0 &&
          character.hpMax <= 20 && (
            <p aria-hidden="true" className="break-words text-[#7a1016]">
              {Array.from({ length: character.hpMax }, (_, index) =>
                index < (character.hpCurrent ?? 0) ? '♥' : '♡',
              ).join(' ')}
            </p>
          )}
        {character.attacks.map((attack) => (
          <p key={attack.id}>
            {attack.name} {attack.bonus} · {attack.damage}
          </p>
        ))}
        <button type="button" onClick={onOpenSheet} className="min-h-11 underline">
          Open full sheet
        </button>
      </div>
    </section>
  );
};

export const LeftRail: React.FC<{
  campaign: CampaignSummaryVM;
  party: PartyMemberVM[];
  partyMax: number;
  combat: { active: boolean; round: number; actedCount?: number; combatants: CombatantVM[] };
}> = ({ campaign, party, partyMax, combat }) => (
  <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
    <CurrentCampaign campaign={campaign} />
    <CurrentObjective campaign={campaign} />
    <RegionMap campaign={campaign} />
    <Party party={party} partyMax={partyMax} />
    {combat.active && (
      <EncounterTracker
        round={combat.round}
        actedCount={combat.actedCount}
        combatants={combat.combatants}
      />
    )}
  </div>
);
