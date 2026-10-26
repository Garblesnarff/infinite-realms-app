import { ChevronDown } from 'lucide-react';
import React from 'react';

import { facingName, rosterEntryForParticipant } from '../../../../../shared/engine-display-name';
import { useTacticalMapContext } from '../tactical/TacticalMapProvider';
import { summarizeCombatTurn } from './overhaul/combat-turn-order';
import { useOverhaulViewModel } from './overhaul/useOverhaulViewModel';

import type { ChatMessage } from '@/types/game';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCombat, useOptionalCombat } from '@/contexts/CombatContext';
import { resolveEquipmentById, resolveEquipmentByName } from '@/data/equipment/resolver';
import {
  useCombatLegalActions,
  type LegalAction,
} from '@/features/game-session/hooks/use-combat-legal-actions';
import { cn } from '@/lib/utils';

/** The chat box's placeholder in combat (#90): the chat box stays available. */
export const COMBAT_CHAT_PLACEHOLDER =
  'Or describe what you do… e.g. “I feint high and cut at its legs”';

export interface ActionBarItem {
  id: string;
  name: string;
}

export interface ActionBarSpellInfo {
  range?: string;
  timing: 'action' | 'bonus';
}

export interface CombatActionBarProps {
  /** The engine's legal actions for the player's turn (GET /v1/combat/:id/legal-actions). */
  actions: LegalAction[];
  /** False on an enemy's turn, while a turn is in flight, or while the menu refreshes. */
  enabled: boolean;
  /** The character has spells: Cast shows. */
  hasSpells: boolean;
  /** Consumables in the pack: Use item shows only when there is one. */
  consumables: ActionBarItem[];
  /** Name for a participant id (targets). */
  nameOf: (participantId: string) => string;
  /** "{Weapon} · +{bonus}" for the default attack. */
  attackSub?: string;
  /** "{feet} ft" of movement left. */
  moveSub?: string;
  /** The map can show move mode (a map exists and movement remains). */
  canMove: boolean;
  spellInfo: (action: LegalAction) => ActionBarSpellInfo | null;
  onAction: (action: LegalAction) => void;
  onMove: () => void;
  onUseItem: (item: ActionBarItem) => void;
}

const buttonBase =
  'inline-flex min-h-11 items-center gap-2 rounded-lg border border-[color:var(--ir-control-border)] bg-white/[0.03] px-3.5 text-sm font-semibold max-[699px]:flex-1 max-[699px]:basis-[calc(33%-8px)] max-[699px]:justify-center';
const primary = 'border-infinite-gold text-infinite-gold bg-infinite-gold/10';
const disabledClass = 'opacity-45';
const subClass = 'text-xs text-muted-foreground max-[699px]:hidden';

/** One choice per action × target, so a fight with two targets lists both. */
function choicesFor(actions: LegalAction[]): LegalAction[] {
  return actions.flatMap((action) =>
    action.targetIds && action.targetIds.length > 1
      ? action.targetIds.map((targetId) => ({ ...action, targetIds: [targetId] }))
      : [action],
  );
}

const BarButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { isPrimary?: boolean; sub?: string }
> = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { isPrimary?: boolean; sub?: string }
>(({ isPrimary, sub, className, disabled, children, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    disabled={disabled}
    className={cn(buttonBase, isPrimary && primary, disabled && disabledClass, className)}
    {...rest}
  >
    <span>{children}</span>
    {sub && <span className={subClass}>{sub}</span>}
  </button>
));
BarButton.displayName = 'BarButton';

/**
 * #90: the one place to act in combat. Every button sends an existing authoritative intent
 * through the same legal-action pipeline the DM option buttons used; nothing here adds a rule.
 */
export const CombatActionBar: React.FC<CombatActionBarProps> = ({
  actions,
  enabled,
  hasSpells,
  consumables,
  nameOf,
  attackSub,
  moveSub,
  canMove,
  spellInfo,
  onAction,
  onMove,
  onUseItem,
}) => {
  const attacks = choicesFor(actions.filter((action) => action.type === 'attack'));
  const spells = choicesFor(actions.filter((action) => action.type === 'spell'));
  const dodge = actions.find((action) => action.type === 'dodge');
  const endTurn = actions.find((action) => action.type === 'end_turn');
  const withTarget = (action: LegalAction): string =>
    action.targetIds?.[0] ? `${action.label} → ${nameOf(action.targetIds[0])}` : action.label;
  const attackOn = enabled && attacks.length > 0;
  const castOn = enabled && spells.length > 0;

  return (
    <div
      role="toolbar"
      aria-label="Your actions"
      data-testid="combat-action-bar"
      className="flex flex-wrap items-center gap-2 px-3 pt-2"
    >
      <BarButton
        isPrimary
        sub={attackSub}
        disabled={!attackOn}
        onClick={() => attacks[0] && onAction(attacks[0])}
      >
        Attack
      </BarButton>
      {attacks.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!attackOn}>
            <BarButton
              aria-label="Other weapons and targets"
              disabled={!attackOn}
              className="max-[699px]:basis-auto max-[699px]:flex-none"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </BarButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {attacks.map((action, index) => (
              <DropdownMenuItem key={`${action.label}-${index}`} onSelect={() => onAction(action)}>
                {withTarget(action)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {hasSpells && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!castOn}>
            <BarButton disabled={!castOn}>Cast</BarButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {spells.map((action, index) => {
              const info = spellInfo(action);
              return (
                <DropdownMenuItem
                  key={`${action.label}-${index}`}
                  onSelect={() => onAction(action)}
                  className="flex flex-col items-start"
                >
                  <span>{withTarget(action)}</span>
                  {info && (
                    <span className="text-xs text-muted-foreground">
                      {[info.range, info.timing].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <BarButton sub={moveSub} disabled={!enabled || !canMove} onClick={onMove}>
        Move
      </BarButton>
      <BarButton disabled={!enabled || !dodge} onClick={() => dodge && onAction(dodge)}>
        Dodge
      </BarButton>
      {consumables.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!enabled}>
            <BarButton disabled={!enabled}>Use item</BarButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {consumables.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => onUseItem(item)}>
                {item.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <BarButton
        disabled={!enabled || !endTurn}
        onClick={() => endTurn && onAction(endTurn)}
        className="min-[700px]:ml-auto"
      >
        End turn
      </BarButton>
    </div>
  );
};

/** The name of whoever holds the turn when it is not the player's, else null. */
export function useEnemyTurnName(): string | null {
  const state = useOptionalCombat()?.state;
  const encounter = state?.isInCombat ? state.activeEncounter : null;
  const summary = React.useMemo(() => summarizeCombatTurn(encounter), [encounter]);
  const now = summary?.actors.find((actor) => actor.state === 'now');
  return now && !now.isPlayer ? now.name : null;
}

/** The chat box placeholder while an encounter is active (#90). */
export function useCombatChatPlaceholder(): string | undefined {
  // Optional: the game column renders without the combat provider in some harnesses (#2517).
  const inCombat = useOptionalCombat()?.state.isInCombat === true;
  const enemy = useEnemyTurnName();
  if (!inCombat) return undefined;
  return enemy ? `Wait — it is the ${enemy}'s turn` : COMBAT_CHAT_PLACEHOLDER;
}

const normalizeName = (value: string): string => value.trim().toLowerCase();

/** The weapon the server's "Attack with {weapon}" label names (combat-weapon-options.ts). */
const weaponNameFromLabel = (label: string): string =>
  label.replace(/^(Equip and attack|Attack) with /, '').replace(/ \(move closer first\)$/, '');

/**
 * The live bar: legal actions from the engine, the sheet's attacks / spells / pack for the sub
 * labels and menus, the map for movement.
 */
type CombatActionBarLiveProps = {
  turnInFlight: boolean;
  onSendMessage: (message: ChatMessage) => Promise<void>;
  onSendText: (text: string) => Promise<void>;
  onMove: () => void;
};

export const CombatActionBarLive: React.FC<CombatActionBarLiveProps> = (props) => {
  // Out of combat (or with no combat provider mounted) there is no bar and no legal-action fetch.
  if (useOptionalCombat()?.state.isInCombat !== true) return null;
  return <CombatActionBarInCombat {...props} />;
};

const CombatActionBarInCombat: React.FC<CombatActionBarLiveProps> = ({
  turnInFlight,
  onSendMessage,
  onSendText,
  onMove,
}) => {
  const { state } = useCombat();
  const encounter = state.isInCombat ? state.activeEncounter : null;
  const { actions, isPlayerTurn, isRefreshing, error, runAction } = useCombatLegalActions({
    enabled: Boolean(encounter),
    onSendMessage,
    onSendText,
  });
  const vm = useOverhaulViewModel();
  const map = useTacticalMapContext()?.map ?? null;
  const [running, setRunning] = React.useState(false);

  const roster = React.useMemo(
    () => (encounter?.participants ?? []).map(rosterEntryForParticipant),
    [encounter?.participants],
  );
  const nameOf = React.useCallback(
    (participantId: string) => facingName(undefined, participantId, roster),
    [roster],
  );
  if (!encounter) return null;

  const character = vm.character;
  const allSpells = [...character.spells.cantrips, ...character.spells.known];
  const hasSpells = Boolean(character.spellcasting) && allSpells.length > 0;
  const consumables = character.inventory
    .filter(
      (item) =>
        (resolveEquipmentById(item.id) ?? resolveEquipmentByName(item.name))?.category ===
        'consumable',
    )
    .map((item) => ({ id: item.id, name: item.name }));
  const defaultAttack = actions.find((action) => action.type === 'attack');
  const attackVm = defaultAttack
    ? character.attacks.find(
        (attack) =>
          attack.id === defaultAttack.weaponId ||
          normalizeName(attack.name) === normalizeName(weaponNameFromLabel(defaultAttack.label)),
      )
    : undefined;
  const attackSub = attackVm ? `${attackVm.name} · ${attackVm.bonus}` : undefined;
  const mapActor = map?.entities.find(
    (entity) => entity.id === encounter.currentTurnParticipantId && entity.type === 'pc',
  );
  const moveSub = mapActor ? `${mapActor.movementRemaining} ft` : undefined;
  const spellInfo = (action: LegalAction): ActionBarSpellInfo | null => {
    const spell = allSpells.find(
      (candidate) => candidate.id === action.spellId || `Cast ${candidate.name}` === action.label,
    );
    if (!spell) return null;
    return {
      range: spell.range,
      timing: spell.castingTime?.toLowerCase().includes('bonus action') ? 'bonus' : 'action',
    };
  };
  const run = (work: () => Promise<void>): void => {
    if (running) return;
    setRunning(true);
    void work().finally(() => setRunning(false));
  };

  return (
    <>
      {error && (
        <p role="alert" className="px-3 pt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <CombatActionBar
        actions={actions}
        enabled={isPlayerTurn && !turnInFlight && !isRefreshing && !running}
        hasSpells={hasSpells}
        consumables={consumables}
        nameOf={nameOf}
        attackSub={attackSub}
        moveSub={moveSub}
        canMove={Boolean(mapActor && mapActor.movementRemaining > 0)}
        spellInfo={spellInfo}
        onAction={(action) => run(() => runAction(action))}
        onMove={onMove}
        onUseItem={(item) => run(() => onSendText(`I use my ${item.name}.`))}
      />
    </>
  );
};
