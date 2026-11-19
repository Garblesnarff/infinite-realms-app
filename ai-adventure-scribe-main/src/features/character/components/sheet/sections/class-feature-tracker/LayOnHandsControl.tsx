import React, { useState } from 'react';

import { refusalToastText } from './refusal-toast-text';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIsInCombatOptional } from '@/contexts/in-combat-flag';
import { useSheetHitPointsOptional } from '@/contexts/sheet-hit-points';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

interface LayOnHandsControlProps {
  characterId: string;
  /** The pool's remaining points, as the sheet shows them. */
  pool: number;
}

/**
 * #1554: Lay on Hands out of combat. Heal the paladin from the pool, or cure a poison or disease
 * for 5 points. The engine draws the pool; this control only names the amount.
 */
export const LayOnHandsControl: React.FC<LayOnHandsControlProps> = ({ characterId, pool }) => {
  const { toast } = useToast();
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState(false);
  // In combat the Lay on Hands is an Action: the sheet control steps aside for the combat chips.
  const inCombat = useIsInCombatOptional();
  // #1643: at full HP a heal is refused, so Heal self is disabled with the reason beside it.
  const hitPoints = useSheetHitPointsOptional();
  const atFullHealth = hitPoints !== null && hitPoints.current >= hitPoints.maximum;
  const parsed = Math.trunc(Number(amount));
  const validAmount = Number.isInteger(parsed) && parsed >= 1 && parsed <= pool;

  const run = async (body: { amount?: number; cure?: 'disease' | 'poison' }) => {
    setBusy(true);
    try {
      const result = await userDataApi.layOnHands(characterId, body);
      toast({ title: 'Lay on Hands', description: result.message });
      window.dispatchEvent(new CustomEvent('character-state-updated'));
    } catch (error) {
      logger.error('Lay on Hands failed', error);
      toast({
        title: 'Lay on Hands',
        description: refusalToastText(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  if (inCombat) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        In combat, use Lay on Hands from the combat actions.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2" aria-label="Lay on Hands controls">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={pool}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-label="Lay on Hands points to spend"
          className="h-8 w-24"
        />
        <Button
          size="sm"
          disabled={busy || !validAmount || atFullHealth}
          onClick={() => run({ amount: parsed })}
        >
          Heal self
        </Button>
      </div>
      {atFullHealth && (
        <p className="text-xs text-muted-foreground">You are already at full health.</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || pool < 5}
          onClick={() => run({ cure: 'poison' })}
        >
          Cure poison (5)
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || pool < 5}
          onClick={() => run({ cure: 'disease' })}
        >
          Cure disease (5)
        </Button>
      </div>
    </div>
  );
};
