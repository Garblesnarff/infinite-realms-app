import { useEffect, useState } from 'react';

import {
  attackModifierForRoll,
  describeAttackRoll,
  type AttackRollDescriptionSpec,
} from '../../../shared/describe-attack-roll';

import type {
  PlayerCheckRollSpec,
  PlayerDeathSaveRollSpec,
  PlayerInitiativeRollSpec,
  PlayerRollHost,
  PlayerRollOutcome,
  PlayerRollSpec,
} from '@/services/combat/player-roll-bridge';
import type { DiceRollRequest } from '@/types/combat';

/** Re-exported from shared/ so the popup and the server's narration repair read the same words (#467). */
export { attackModifierForRoll, describeAttackRoll, type AttackRollDescriptionSpec };

import { useGame } from '@/contexts/GameContext';
import { useShowTargetNumbers } from '@/features/game-session/hooks/use-show-target-numbers';
import { releasePlayerRollHost, setPlayerRollHost } from '@/services/combat/player-roll-bridge';

/**
 * Mounts the dice popup as the place combat goes to ask the player for an attack or initiative die.
 *
 * The bridge deliberately knows nothing about React: combat resolves inside plain service code
 * during a DM turn, and reaching into a context from there would mean threading the whole dice
 * queue through the resolution pipeline. Instead this hook registers the queue as a host for as
 * long as it is mounted, and unregisters on unmount so a request made after teardown falls back
 * to an engine roll rather than awaiting a popup that no longer exists.
 *
 * The queued request is tagged `combatAttackRoll` or `combatInitiativeRoll`, which is what stops the ordinary dice
 * handler from also sending the result to the DM as a chat message — the attack it belongs to
 * is already mid-resolution, and narrating the die as a fresh player utterance would put the
 * same attack through the engine twice.
 */
export function usePlayerRollHost(): string | null {
  const { requestDiceRoll, cancelDiceRoll } = useGame();
  const { showTargetNumbers } = useShowTargetNumbers();
  const [pendingRollId, setPendingRollId] = useState<string | null>(null);

  useEffect(() => {
    const rollHost: PlayerRollHost = {
      present: (spec: PlayerRollSpec, settle: (outcome: PlayerRollOutcome) => void) => {
        const request = isDeathSaveSpec(spec)
          ? {
              requestType: 'death_save' as const,
              description: DEATH_SAVE_ROLL_DESCRIPTION,
              rollConfig: { dieType: 20, count: 1, modifier: 0 },
              dc: DEATH_SAVE_DC,
              combatDeathSaveRoll: true,
            }
          : isCheckSpec(spec)
            ? {
                requestType: 'skill_check' as const,
                description: describeCheckRoll(spec),
                rollConfig: { dieType: 20, count: 1, modifier: spec.checkModifier },
                combatCheckRoll: true,
              }
            : isInitiativeSpec(spec)
              ? {
                  requestType: 'initiative' as const,
                  description: describeInitiativeRoll(spec),
                  rollConfig: { dieType: 20, count: 1, modifier: spec.initiativeModifier },
                  combatInitiativeRoll: true,
                }
              : {
                  requestType: 'attack' as const,
                  description: describeAttackRoll(spec, showTargetNumbers),
                  rollConfig: {
                    dieType: 20,
                    count: 1,
                    modifier: attackModifierForRoll(spec),
                    advantage: spec.advantage,
                    disadvantage: spec.disadvantage,
                  },
                  ...(spec.kind === 'spell-attack' || spec.targetAc <= 0 || !showTargetNumbers
                    ? {}
                    : {
                        ac: spec.targetAc,
                        ...(typeof spec.coverBonus === 'number'
                          ? { coverBonus: spec.coverBonus }
                          : {}),
                      }),
                  combatAttackRoll: true,
                };
        const rollId = requestDiceRoll(
          request as Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>,
        );

        setPendingRollId(rollId);
        registerSettler(rollId, (outcome) => {
          setPendingRollId(null);
          settle(outcome);
        });
        return {
          rollId,
          dismiss: () => {
            unregisterSettler(rollId);
            setPendingRollId(null);
            cancelDiceRoll(rollId);
          },
        };
      },
    };
    setPlayerRollHost(rollHost);
    return () => {
      // An unmounted message list cannot answer the queue. The bridge re-opens the prompt on a
      // replacement host if one mounts in the same commit, and otherwise settles it engine-rolled.
      setPendingRollId(null);
      releasePlayerRollHost(rollHost);
    };
  }, [requestDiceRoll, cancelDiceRoll, showTargetNumbers]);

  return pendingRollId;
}

/** "Initiative for The Seeker — 1d20+2" */
export function describeInitiativeRoll(spec: PlayerInitiativeRollSpec): string {
  const sign = spec.initiativeModifier >= 0 ? '+' : '';
  return `Initiative for ${spec.actorLabel} — 1d20${sign}${spec.initiativeModifier}`;
}

/** "Shove vs Goblin — 1d20+3" / "Hide — 1d20+5 vs passive Perception 13" */
export function describeCheckRoll(spec: PlayerCheckRollSpec): string {
  const sign = spec.checkModifier >= 0 ? '+' : '';
  const die = `1d20${sign}${spec.checkModifier}`;
  const target = spec.targetLabel ? ` vs ${spec.targetLabel}` : '';
  const opposed = spec.opposedByLabel ? ` vs ${spec.opposedByLabel}` : '';
  return `${spec.checkLabel}${target} — ${die}${opposed}`;
}

function isCheckSpec(spec: PlayerRollSpec): spec is PlayerCheckRollSpec {
  return 'checkLabel' in spec;
}

/**
 * The settlers, keyed by queued roll id.
 *
 * Module state rather than a ref because the dice handler that learns the result lives in a
 * different component subtree from the hook that queued the request, and the only thing the two
 * reliably share is the roll id the queue itself assigned.
 */
const settlers = new Map<string, (outcome: PlayerRollOutcome) => void>();

function registerSettler(rollId: string, settle: (outcome: PlayerRollOutcome) => void): void {
  settlers.set(rollId, settle);
}

function unregisterSettler(rollId: string): void {
  settlers.delete(rollId);
}

/**
 * Hands a completed or cancelled combat attack roll back to the resolution waiting on it.
 * Returns false when this roll was not one of ours, which is the dice handler's signal to treat
 * it as an ordinary narrative roll and send it to the DM.
 *
 * `cancelled` is the player's Dismiss: the attack is withdrawn, not engine-rolled (#2234).
 */
export function settleCombatAttackRoll(
  rollId: string,
  d20: number | null,
  options: { cancelled?: boolean; d20Rolls?: [number, number] } = {},
): boolean {
  return settleCombatPlayerRoll(
    rollId,
    options.cancelled
      ? { d20: null, cancelled: true }
      : { d20, ...(options.d20Rolls ? { d20Rolls: options.d20Rolls } : {}) },
  );
}

/** Hands an initiative d20 back to the entry flow instead of sending it to the DM. */
export function settleCombatInitiativeRoll(rollId: string, d20: number | null): boolean {
  return settleCombatPlayerRoll(rollId, { d20 });
}

/**
 * Hands a manually-rolled death save die back to the resolution waiting on it.
 * Returns false when this roll was not one of ours.
 *
 * A dismissed death-save prompt is never settled through here: dismissing must close the
 * panel without rolling the save (RG-019 — a dismiss that rolls can kill the character).
 * The bridge's bounded timer is the backstop that resolves the turn, so the dying
 * character's turn always ends even when the prompt is dismissed.
 */
export function settleCombatDeathSaveRoll(rollId: string, d20: number | null): boolean {
  return settleCombatPlayerRoll(rollId, { d20 });
}

/**
 * Hands a mid-combat check's d20 back to the engine instead of sending it to the DM (#2420).
 *
 * A dismissed check prompt withdraws the check, exactly as a dismissed attack withdraws the
 * attack: the resolution waiting on it skips the action instead of rolling it for the player,
 * so the player's action stays unspent.
 */
export function settleCombatCheckRoll(
  rollId: string,
  d20: number | null,
  options: { cancelled?: boolean } = {},
): boolean {
  return settleCombatPlayerRoll(
    rollId,
    options.cancelled ? { d20: null, cancelled: true } : { d20 },
  );
}

function settleCombatPlayerRoll(rollId: string, outcome: PlayerRollOutcome): boolean {
  const settle = settlers.get(rollId);
  if (!settle) return false;
  settlers.delete(rollId);
  settle(outcome);
  return true;
}

function isInitiativeSpec(spec: PlayerRollSpec): spec is PlayerInitiativeRollSpec {
  return 'initiativeModifier' in spec;
}

function isDeathSaveSpec(spec: PlayerRollSpec): spec is PlayerDeathSaveRollSpec {
  return 'deathSave' in spec;
}

/** SRD 5.1: a death saving throw is a bare d20; 10 or higher is a success. */
export const DEATH_SAVE_DC = 10;
export const DEATH_SAVE_ROLL_DESCRIPTION = 'Death saving throw — roll a d20';
