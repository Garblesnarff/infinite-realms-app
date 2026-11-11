import React from 'react';

import type { CombatantVM, PartyMemberVM } from './types';

import { tableImageUrl } from '@/features/campaigns/table/image-url';
import { TableImage } from '@/features/campaigns/table/TableImage';

/** Scene header and the Table-look plaque use the same live view model. */
export const SceneHeader: React.FC<{
  title: string;
  blurb?: string;
  onSceneInfo?: () => void;
  right?: React.ReactNode;
  tableExtra?: React.ReactNode;
  chapter?: string;
  location?: string;
  party?: PartyMemberVM[];
  combat?: { active: boolean; round: number; combatants: CombatantVM[] };
}> = ({ title, blurb, onSceneInfo, right, tableExtra, chapter, location, party = [], combat }) => (
  <>
    <div className="relative flex items-start justify-between gap-3 px-4 py-3 [body.ir-table-look_&]:hidden">
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
    <div className="hidden min-w-0 gap-1 p-2 max-[699px]:gap-0 max-[699px]:p-1 [body.ir-table-look_&]:grid [body.ir-table-look_&]:grid-cols-2 min-[700px]:[body.ir-table-look_&]:grid-cols-3">
      <section className="min-w-0 border border-[#d5b070] bg-[#0e1a36] px-3 py-2 text-center text-[#f6e3b8] max-[699px]:flex max-[699px]:items-center max-[699px]:justify-between max-[699px]:gap-2 max-[699px]:px-2 max-[699px]:py-1">
        <h1 className="ir-display truncate text-lg font-bold max-[699px]:text-sm">{title}</h1>
        {chapter && <p className="text-sm">{chapter}</p>}
      </section>
      <section className="min-w-0 border border-[#d5b070] bg-[#0e1a36] px-3 py-2 text-center text-[#f6e3b8] max-[699px]:flex max-[699px]:items-baseline max-[699px]:justify-between max-[699px]:gap-2 max-[699px]:px-2 max-[699px]:py-1">
        <p className="ir-display shrink-0 text-sm">
          {combat?.active ? `Round ${combat.round}` : 'EXPLORING'}
        </p>
        {(combat?.active || location) && (
          <p className="ir-display min-w-0 truncate text-lg font-bold max-[699px]:text-sm">
            {combat?.active
              ? (combat.combatants.find((actor) => actor.isActive)?.name ?? 'Combat')
              : location}
          </p>
        )}
        {blurb && <p className="truncate text-sm max-[699px]:hidden">{blurb}</p>}
      </section>
      <section className="min-w-0 border border-[#d5b070] bg-[#0e1a36] px-3 py-2 text-[#f6e3b8] max-[699px]:col-span-2 max-[699px]:flex max-[699px]:max-h-24 max-[699px]:flex-wrap max-[699px]:items-center max-[699px]:justify-between max-[699px]:gap-2 max-[699px]:overflow-y-auto max-[699px]:px-2 max-[699px]:py-1">
        <div className="flex items-center justify-between gap-2 max-[699px]:contents">
          <p className="ir-display text-sm max-[699px]:hidden">The Table</p>
          {tableExtra}
        </div>
        {party.map((member) => (
          <div
            key={member.id}
            className="flex min-w-0 flex-1 items-center gap-2 max-[699px]:min-w-[160px]"
          >
            <TableImage
              src={tableImageUrl(member.avatarUrl ?? null, 72, 72)}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 rounded-full object-cover"
              fallback={
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d5b070]"
                >
                  {member.name.slice(0, 1)}
                </span>
              }
            />
            <div className="min-w-0 flex-1">
              <p className="flex justify-between gap-2 text-sm">
                <span className="break-words">{member.name}</span>
                <span className="shrink-0">
                  {member.currentHp != null && member.maxHp != null
                    ? `${member.currentHp} / ${member.maxHp}`
                    : 'HP unavailable'}
                </span>
              </p>
              {member.currentHp != null && member.maxHp != null && member.maxHp > 0 && (
                <progress
                  className="block h-1.5 w-full"
                  value={member.currentHp}
                  max={member.maxHp}
                  aria-label={`${member.name} hit points`}
                />
              )}
            </div>
          </div>
        ))}
        {combat?.active &&
          combat.combatants
            .filter((actor) => actor.isEnemy)
            .map((foe) => (
              <p key={foe.id} className="text-sm max-[699px]:basis-full">
                {foe.name} · {foe.healthCondition ?? 'condition unavailable'}
              </p>
            ))}
      </section>
    </div>
  </>
);
