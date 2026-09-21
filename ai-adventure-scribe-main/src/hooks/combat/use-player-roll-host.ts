import { useEffect, useState } from 'react';

import type {
  PlayerAttackRollSpec,
  PlayerInitiativeRollSpec,
  PlayerRollOutcome,
  PlayerRollSpec,
} from '@/services/combat/player-roll-bridge';
import type { DiceRollRequest } from '@/types/combat';

import { useGame } from '@/contexts/GameContext';
import { setPlayerRollHost, settlePendingPlayerRoll } from '@/services/combat/player-roll-bridge';

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
  const [pendingRollId, setPendingRollId] = useState<string | null>(null);

  useEffect(() => {
    setPlayerRollHost({
      present: (spec: PlayerRollSpec, settle: (outcome: PlayerRollOutcome) => void) => {
        const request = isInitiativeSpec(spec)
          ? {
              requestType: 'initiative' as const,
              description: describeInitiativeRoll(spec),
              rollConfig: { dieType: 20, count: 1, modifier: spec.initiativeModifier },
              combatInitiativeRoll: true,
            }
          : {
              requestType: 'attack' as const,
              description: describeAttackRoll(spec),
              rollConfig: {
                dieType: 20,
                count: 1,
                modifier: attackModifierForRoll(spec),
                advantage: spec.advantage,
                disadvantage: spec.disadvantage,
              },
              ...(spec.kind === 'spell-attack' || spec.targetAc <= 0 ? {} : { ac: spec.targetAc }),
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
    });
    return () => {
      // An unmounted message list cannot answer the queue. Settle before releasing the host so
      // the initiative timer is cleared and the awaiting entry pipeline falls back safely.
      settlePendingPlayerRoll({ d20: null });
      setPendingRollId(null);
      setPlayerRollHost(null);
    };
  }, [requestDiceRoll, cancelDiceRoll]);

  return pendingRollId;
}

/** "Longsword attack vs Sentient Glaze — 1d20+7 vs AC 15 (advantage)" */
export function describeAttackRoll(spec: PlayerAttackRollSpec): string {
  const edge = spec.advantage ? ' (advantage)' : spec.disadvantage ? ' (disadvantage)' : '';
  if (spec.kind === 'spell-attack') {
    return `${spec.weaponName} spell attack vs ${spec.targetLabel}${edge}`;
  }
  const modifier = attackModifierForRoll(spec);
  const sign = modifier >= 0 ? '+' : '';
  return (
    `${spec.weaponName} attack vs ${spec.targetLabel} — ` +
    `1d20${sign}${modifier} vs AC ${spec.targetAc}${edge}`
  );
}

/** The popup text and displayed total must use the exact modifier sent to the roll queue. */
export function attackModifierForRoll(spec: PlayerAttackRollSpec): number {
  return spec.attackBonus;
}

/** "Initiative for The Seeker — 1d20+2" */
export function describeInitiativeRoll(spec: PlayerInitiativeRollSpec): string {
  const sign = spec.initiativeModifier >= 0 ? '+' : '';
  return `Initiative for ${spec.actorLabel} — 1d20${sign}${spec.initiativeModifier}`;
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
 */
export function settleCombatAttackRoll(rollId: string, d20: number | null): boolean {
  return settleCombatPlayerRoll(rollId, d20);
}

/** Hands an initiative d20 back to the entry flow instead of sending it to the DM. */
export function settleCombatInitiativeRoll(rollId: string, d20: number | null): boolean {
  return settleCombatPlayerRoll(rollId, d20);
}

function settleCombatPlayerRoll(rollId: string, d20: number | null): boolean {
  const settle = settlers.get(rollId);
  if (!settle) return false;
  settlers.delete(rollId);
  settle({ d20 });
  return true;
}

function isInitiativeSpec(spec: PlayerRollSpec): spec is PlayerInitiativeRollSpec {
  return 'initiativeModifier' in spec;
}
