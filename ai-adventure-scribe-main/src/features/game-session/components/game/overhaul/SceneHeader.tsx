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
  /** #1754: starter campaigns only. The plaque opens the region map; gets the plaque back for focus. */
  onOpenMap?: (plaque: HTMLElement) => void;
  /** #1754: in a fight the same plaque opens the fight board. */
  onOpenFightBoard?: () => void;
}> = ({
  title,
  blurb,
  onSceneInfo,
  right,
  tableExtra,
  chapter,
  location,
  party = [],
  combat,
  onOpenMap,
  onOpenFightBoard,
}) => (
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
      <PlacePlaque
        location={location}
        blurb={blurb}
        combat={combat}
        onOpenMap={onOpenMap}
        onOpenFightBoard={onOpenFightBoard}
      />
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

const PLAQUE_CLASS =
  'min-w-0 border border-[#d5b070] bg-[#0e1a36] px-3 py-2 text-center text-[#f6e3b8] max-[699px]:flex max-[699px]:items-baseline max-[699px]:justify-between max-[699px]:gap-2 max-[699px]:px-2 max-[699px]:py-1';

/**
 * The middle plaque: `EXPLORING · <place>` or the fight round. #1754: on a starter campaign it
 * is a button, the map outside a fight and the fight board in one (design §9).
 */
function PlacePlaque({
  location,
  blurb,
  combat,
  onOpenMap,
  onOpenFightBoard,
}: {
  location?: string;
  blurb?: string;
  combat?: { active: boolean; round: number; combatants: CombatantVM[] };
  onOpenMap?: (plaque: HTMLElement) => void;
  onOpenFightBoard?: () => void;
}): React.ReactElement {
  const inFight = Boolean(combat?.active);
  const status = inFight ? `Round ${combat?.round}` : 'EXPLORING';
  const place = inFight
    ? (combat?.combatants.find((actor) => actor.isActive)?.name ?? 'Combat')
    : location;
  const onOpen = inFight ? onOpenFightBoard : onOpenMap;
  if (!onOpen) {
    return (
      <section className={PLAQUE_CLASS}>
        <p className="ir-display shrink-0 text-sm">{status}</p>
        {place && (
          <p className="ir-display min-w-0 truncate text-lg font-bold max-[699px]:text-sm">
            {place}
          </p>
        )}
        {blurb && <p className="truncate text-sm max-[699px]:hidden">{blurb}</p>}
      </section>
    );
  }
  const label = inFight
    ? 'Open fight board'
    : location
      ? `Open map, you are at ${location}`
      : 'Open map';
  return (
    <button
      type="button"
      aria-label={label}
      data-testid="place-plaque"
      className={`${PLAQUE_CLASS} block min-h-11 w-full cursor-pointer hover:bg-[#16264a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]`}
      onClick={(event) => (inFight ? onOpenFightBoard?.() : onOpenMap?.(event.currentTarget))}
    >
      <span className="ir-display block shrink-0 text-sm">{status}</span>
      {place && (
        <span className="ir-display block min-w-0 truncate text-lg font-bold max-[699px]:text-sm">
          {place}
        </span>
      )}
      {blurb && <span className="block truncate text-sm max-[699px]:hidden">{blurb}</span>}
    </button>
  );
}
