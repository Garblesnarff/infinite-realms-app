import React from 'react';

import type { CharacterSheetVM } from './types';

import {
  IRBar,
  IRModRow,
  IRPanel,
  IRPanelHeader,
  IRStatTile,
  IRThumb,
} from '@/components/ui/ir-primitives';
import { useCampaign } from '@/contexts/CampaignContext';
import { formatCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';
import { CompanionPartyStrip } from '@/webmcp/CompanionPartyStrip';

const SheetHeader: React.FC<{ c: CharacterSheetVM }> = ({ c }) => {
  const { state } = useCampaign();
  const mode = state.campaign?.id
    ? localStorage.getItem(`game:levelingMode:${state.campaign.id}`)
    : null;
  const isMilestone =
    mode?.includes('milestone') || state.campaign?.rules_config?.levelingMode === 'milestone';
  return (
    <IRPanel>
      <IRPanelHeader title="Character Sheet" />
      <div className="p-3">
        <div className="flex items-start gap-3">
          <IRThumb src={c.avatarUrl} size={48} />
          <div className="min-w-0 flex-1">
            <p className="ir-display truncate text-sm font-semibold text-foreground">{c.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{c.subtitle}</p>
            <p className="mt-1 text-[11px] font-semibold text-infinite-gold">Level {c.level}</p>
          </div>
        </div>
        {!isMilestone && (
          <div className="mt-2">
            <IRBar value={c.xpCurrent} max={c.xpMax} barClassName="bg-infinite-gold/80" />
            <p className="mt-1 text-right text-[10px] text-muted-foreground">
              {c.xpCurrent.toLocaleString()} / {c.xpMax.toLocaleString()} XP
            </p>
          </div>
        )}
      </div>
    </IRPanel>
  );
};

const CoreStats: React.FC<{ c: CharacterSheetVM }> = ({ c }) => (
  <div className="grid grid-cols-4 gap-2">
    <IRStatTile
      label="HP"
      value={formatCharacterSheetHitPoints({ current: c.hpCurrent, maximum: c.hpMax })}
    />
    <IRStatTile label="AC" value={c.ac} />
    <IRStatTile label="INIT" value={c.initiative} />
    <IRStatTile label="SPD" value={`${c.speed} ft`} />
  </div>
);

const AbilityScores: React.FC<{ c: CharacterSheetVM }> = ({ c }) => (
  <div className="grid grid-cols-6 gap-1.5">
    {c.abilityScores.map((a) => (
      <IRStatTile key={a.label} label={a.label} value={a.score} sub={a.modifier} />
    ))}
  </div>
);

const TwoCol: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-2 gap-3">{children}</div>
);

export const RightSheet: React.FC<{ c: CharacterSheetVM; sessionId?: string }> = ({
  c,
  sessionId,
}) => (
  <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
    <SheetHeader c={c} />
    {sessionId ? <CompanionPartyStrip sessionId={sessionId} /> : null}
    <CoreStats c={c} />
    <AbilityScores c={c} />

    <TwoCol>
      <IRPanel>
        <IRPanelHeader title="Saving Throws" />
        <div className="px-3 py-1.5">
          {c.savingThrows.map((s) => (
            <IRModRow key={s.label} label={s.label} modifier={s.modifier} />
          ))}
        </div>
      </IRPanel>
      <IRPanel>
        <IRPanelHeader title="Skills" />
        <div className="px-3 py-1.5">
          {c.skills.map((s) => (
            <IRModRow key={s.label} label={s.label} modifier={s.modifier} />
          ))}
        </div>
      </IRPanel>
    </TwoCol>

    <TwoCol>
      <IRPanel>
        <IRPanelHeader title="Attacks" />
        <div className="space-y-1.5 p-2.5">
          {c.attacks.map((a) => (
            <div key={a.id} className="flex items-center gap-2">
              <IRThumb size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="truncate text-[11px] font-medium text-foreground/90">
                    {a.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{a.damage}</span>
                </div>
                <span className="text-[10px] font-semibold text-infinite-gold">{a.bonus}</span>
              </div>
            </div>
          ))}
        </div>
      </IRPanel>
      <IRPanel>
        <IRPanelHeader title="Conditions" />
        <div className="space-y-1.5 p-2.5">
          {c.conditions.map((cd) => (
            <div key={cd.id} className="flex items-center gap-2">
              <IRThumb src={cd.iconUrl} size={26} />
              <span className="flex-1 truncate text-[11px] text-foreground/90">{cd.name}</span>
              {cd.duration && (
                <span className="text-[10px] text-muted-foreground">{cd.duration}</span>
              )}
            </div>
          ))}
        </div>
      </IRPanel>
    </TwoCol>

    <TwoCol>
      <IRPanel>
        <IRPanelHeader title="Equipment" />
        <div className="space-y-1.5 p-2.5">
          {c.equipment.map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <IRThumb size={26} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-foreground/90">{e.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">{e.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </IRPanel>
      <IRPanel>
        <IRPanelHeader title="Inventory" />
        <div className="p-2.5">
          {(c.gold != null || c.carriedWeight != null) && (
            <div className="mb-1.5 flex items-center justify-between border-b border-white/5 pb-1.5 text-[10px]">
              {c.gold != null && (
                <span className="font-semibold text-infinite-gold">
                  {c.gold.toLocaleString()} gp
                </span>
              )}
              {c.carriedWeight != null && (
                <span className="text-muted-foreground">
                  {c.carriedWeight} / {c.maxWeight} lb
                </span>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            {c.inventory.map((it) => (
              <div key={it.id} className="flex items-center gap-2">
                <IRThumb size={26} />
                <span className="flex-1 truncate text-[11px] text-foreground/90">{it.name}</span>
                {it.quantity != null && it.quantity > 1 && (
                  <span className="text-[10px] text-muted-foreground">x{it.quantity}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </IRPanel>
    </TwoCol>
  </div>
);
