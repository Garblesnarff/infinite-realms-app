import React from 'react';

import type { CharacterSheetVM, SpellVM } from './types';

import { Button } from '@/components/ui/button';
import {
  IRBar,
  IRModRow,
  IRPanel,
  IRPanelHeader,
  IRStatTile,
  IRThumb,
} from '@/components/ui/ir-primitives';
import { useCampaign } from '@/contexts/CampaignContext';
import { MISSING_ARMOR_CLASS_LABEL } from '@/utils/character/character-sheet-armor-class';
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
    <IRStatTile label="AC" value={c.ac ?? MISSING_ARMOR_CLASS_LABEL} />
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

const spellLevelLabel = (level: number | null): string => {
  if (level === 0) return 'Cantrip';
  return level == null ? 'Level unknown' : `Level ${level}`;
};

const SpellEntry: React.FC<{
  spell: SpellVM;
  /** Cast stays offered in combat (#2233): it is the one cast path that reaches the engine. */
  isInCombat: boolean;
  showActions: boolean;
  pendingSpellId?: string;
  /** A cast in flight; every Cast button waits for it (#2305). */
  castingSpellId?: string;
  onCastSpell?: (spell: SpellVM) => void | Promise<void>;
  onTogglePrepared?: (spellId: string, isPrepared: boolean) => void | Promise<void>;
}> = ({ spell, showActions, pendingSpellId, castingSpellId, onCastSpell, onTogglePrepared }) => (
  <div className="rounded border border-white/5 bg-white/[0.02] p-2">
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-foreground/90">{spell.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {spellLevelLabel(spell.level)}
          {spell.school ? ` · ${spell.school}` : ''}
        </p>
      </div>
      {showActions && (
        <div className="flex shrink-0 items-center gap-1">
          {spell.canPrepare && onTogglePrepared && (
            <Button
              type="button"
              size="sm"
              variant={spell.isPrepared ? 'secondary' : 'outline'}
              className="h-6 px-1.5 text-[10px]"
              disabled={pendingSpellId === spell.id}
              aria-pressed={spell.isPrepared}
              aria-label={`${spell.isPrepared ? 'Unprepare' : 'Prepare'} ${spell.name}`}
              onClick={() => void onTogglePrepared(spell.id, !spell.isPrepared)}
            >
              {pendingSpellId === spell.id ? 'Saving…' : spell.isPrepared ? 'Prepared' : 'Prepare'}
            </Button>
          )}
          {onCastSpell && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 border-infinite-gold/30 px-1.5 text-[10px] text-infinite-gold"
              aria-label={`Cast ${spell.name}`}
              disabled={castingSpellId !== undefined}
              onClick={() => void onCastSpell(spell)}
            >
              {castingSpellId === spell.id ? 'Casting…' : 'Cast'}
            </Button>
          )}
        </div>
      )}
    </div>
    {spell.description && (
      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
        {spell.description}
      </p>
    )}
  </div>
);

const SpellGroup: React.FC<{
  title: string;
  spells: SpellVM[];
  isInCombat: boolean;
  showActions?: boolean;
  pendingSpellId?: string;
  /** A cast in flight; every Cast button waits for it (#2305). */
  castingSpellId?: string;
  onCastSpell?: (spell: SpellVM) => void | Promise<void>;
  onTogglePrepared?: (spellId: string, isPrepared: boolean) => void | Promise<void>;
}> = ({
  title,
  spells,
  isInCombat,
  showActions = true,
  pendingSpellId,
  castingSpellId,
  onCastSpell,
  onTogglePrepared,
}) => (
  <section aria-label={title} className="space-y-1.5">
    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-infinite-gold/80">
      {title}
    </h3>
    {spells.length > 0 ? (
      <div className="space-y-1.5">
        {spells.map((spell) => (
          <SpellEntry
            key={spell.id}
            spell={spell}
            isInCombat={isInCombat}
            showActions={showActions}
            pendingSpellId={pendingSpellId}
            castingSpellId={castingSpellId}
            onCastSpell={onCastSpell}
            onTogglePrepared={onTogglePrepared}
          />
        ))}
      </div>
    ) : (
      <p className="text-[10px] text-muted-foreground">None recorded.</p>
    )}
  </section>
);

const SpellsSection: React.FC<{
  c: CharacterSheetVM;
  isInCombat: boolean;
  pendingSpellId?: string;
  /** A cast in flight; every Cast button waits for it (#2305). */
  castingSpellId?: string;
  spellActionError?: string;
  onCastSpell?: (spell: SpellVM) => void | Promise<void>;
  onTogglePrepared?: (spellId: string, isPrepared: boolean) => void | Promise<void>;
}> = ({
  c,
  isInCombat,
  pendingSpellId,
  castingSpellId,
  spellActionError,
  onCastSpell,
  onTogglePrepared,
}) => (
  <IRPanel>
    <IRPanelHeader title="Spells" />
    <div className="space-y-3 p-2.5">
      {c.spellcasting ? (
        <div className="grid grid-cols-3 gap-1.5 rounded border border-white/5 bg-white/[0.02] p-2 text-center">
          <div>
            <p className="text-[9px] uppercase text-muted-foreground">Ability</p>
            <p className="text-[11px] font-semibold text-foreground">{c.spellcasting.ability}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase text-muted-foreground">Attack</p>
            <p className="text-[11px] font-semibold text-foreground">
              {c.spellcasting.spellAttackBonus == null
                ? '—'
                : c.spellcasting.spellAttackBonus >= 0
                  ? `+${c.spellcasting.spellAttackBonus}`
                  : c.spellcasting.spellAttackBonus}
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase text-muted-foreground">Save DC</p>
            <p className="text-[11px] font-semibold text-foreground">
              {c.spellcasting.spellSaveDC ?? '—'}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">No spellcasting data recorded.</p>
      )}

      {spellActionError && (
        <p role="alert" className="text-[10px] text-destructive">
          {spellActionError}
        </p>
      )}

      <SpellGroup
        title="Cantrips"
        spells={c.spells.cantrips}
        isInCombat={isInCombat}
        pendingSpellId={pendingSpellId}
        castingSpellId={castingSpellId}
        onCastSpell={c.spellcasting ? onCastSpell : undefined}
        onTogglePrepared={onTogglePrepared}
      />
      <SpellGroup
        title={c.spellcasting?.canPrepare ? 'Spellbook' : 'Known Spells'}
        spells={c.spells.known}
        isInCombat={isInCombat}
        pendingSpellId={pendingSpellId}
        castingSpellId={castingSpellId}
        onCastSpell={c.spellcasting ? onCastSpell : undefined}
        onTogglePrepared={onTogglePrepared}
      />
      {c.spellcasting?.canPrepare && (
        <SpellGroup
          title="Prepared"
          spells={c.spells.prepared}
          isInCombat={isInCombat}
          showActions={false}
        />
      )}

      {c.spellcasting && (
        <section aria-label="Spell Slots" className="space-y-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-infinite-gold/80">
            Spell Slots
          </h3>
          {c.spellcasting.slots.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {c.spellcasting.slots.map((slot) => (
                <div
                  key={slot.level}
                  className="flex items-center justify-between rounded border border-white/5 px-2 py-1 text-[10px]"
                >
                  <span className="text-muted-foreground">Level {slot.level}</span>
                  <span className="font-semibold text-foreground">
                    {slot.current}/{slot.max}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">No spell slots recorded.</p>
          )}
        </section>
      )}
    </div>
  </IRPanel>
);

export const RightSheet: React.FC<{
  c: CharacterSheetVM;
  sessionId?: string;
  isInCombat?: boolean;
  pendingSpellId?: string;
  /** A cast in flight; every Cast button waits for it (#2305). */
  castingSpellId?: string;
  spellActionError?: string;
  onCastSpell?: (spell: SpellVM) => void | Promise<void>;
  onTogglePrepared?: (spellId: string, isPrepared: boolean) => void | Promise<void>;
}> = ({
  c,
  sessionId,
  isInCombat = false,
  pendingSpellId,
  castingSpellId,
  spellActionError,
  onCastSpell,
  onTogglePrepared,
}) => (
  <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
    <SheetHeader c={c} />
    {sessionId ? <CompanionPartyStrip sessionId={sessionId} /> : null}
    <CoreStats c={c} />
    <AbilityScores c={c} />

    <SpellsSection
      c={c}
      isInCombat={isInCombat}
      pendingSpellId={pendingSpellId}
      castingSpellId={castingSpellId}
      spellActionError={spellActionError}
      onCastSpell={onCastSpell}
      onTogglePrepared={onTogglePrepared}
    />

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
