import { useEffect } from 'react';

import type { PlayerAttackRollSpec, PlayerRollOutcome } from '@/services/combat/player-roll-bridge';
import type { DiceRollRequest } from '@/types/combat';

import { useGame } from '@/contexts/GameContext';
import { setPlayerRollHost } from '@/services/combat/player-roll-bridge';

/**
 * Mounts the dice popup as the place combat goes to ask the player for an attack die.
 *
 * The bridge deliberately knows nothing about React: combat resolves inside plain service code
 * during a DM turn, and reaching into a context from there would mean threading the whole dice
 * queue through the resolution pipeline. Instead this hook registers the queue as a host for as
 * long as it is mounted, and unregisters on unmount so a request made after teardown falls back
 * to an engine roll rather than awaiting a popup that no longer exists.
 *
 * The queued request is tagged `combatAttackRoll`, which is what stops the ordinary dice
 * handler from also sending the result to the DM as a chat message — the attack it belongs to
 * is already mid-resolution, and narrating the die as a fresh player utterance would put the
 * same attack through the engine twice.
 */
export function usePlayerRollHost(): void {
  const { requestDiceRoll, cancelDiceRoll } = useGame();

  useEffect(() => {
    setPlayerRollHost({
      present: (spec: PlayerAttackRollSpec, settle: (outcome: PlayerRollOutcome) => void) => {
        const rollId = requestDiceRoll({
          requestType: 'attack',
          description: describeAttackRoll(spec),
          // The engine adds its own bonus to the natural die it is sent, so the popup shows the
          // bonus for the player's benefit and submits the raw face. Putting the modifier in
          // `rollConfig` as well would add it twice.
          rollConfig: {
            dieType: 20,
            count: 1,
            modifier: 0,
            advantage: spec.advantage,
            disadvantage: spec.disadvantage,
          },
          ac: spec.targetAc,
          combatAttackRoll: true,
        } as Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>);

        registerSettler(rollId, settle);
        return () => {
          unregisterSettler(rollId);
          cancelDiceRoll(rollId);
        };
      },
    });
    return () => setPlayerRollHost(null);
  }, [requestDiceRoll, cancelDiceRoll]);
}

/** "Longsword attack vs Sentient Glaze — 1d20+7 vs AC 15 (advantage)" */
export function describeAttackRoll(spec: PlayerAttackRollSpec): string {
  const sign = spec.attackBonus >= 0 ? '+' : '';
  const edge = spec.advantage ? ' (advantage)' : spec.disadvantage ? ' (disadvantage)' : '';
  return (
    `${spec.weaponName} attack vs ${spec.targetLabel} — ` +
    `1d20${sign}${spec.attackBonus} vs AC ${spec.targetAc}${edge}`
  );
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
  const settle = settlers.get(rollId);
  if (!settle) return false;
  settlers.delete(rollId);
  settle({ d20 });
  return true;
}
