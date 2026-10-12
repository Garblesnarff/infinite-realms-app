import React, { useState } from 'react';

import { RestActionButtons } from './RestActionButtons';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { applyRestResultToCharacter, restApi } from '@/services/rest-api';

interface SheetRestControlsProps {
  character: Character;
  /** Persist the rest-applied character; resolves true when saved. */
  onUpdate: CharacterSheetUpdateFn;
}

/**
 * #264: the sheet's rest buttons, shared by the Main tab and the Features tab so both
 * paths offer hit dice the same way. A short rest expands an inline hit-dice prompt when
 * the character has dice to spend (2014 PHB: roll the die + CON modifier per die, minimum
 * 0 each); with no dice available the rest applies directly, as before.
 *
 * The prompt is inline rather than a modal: a Radix Dialog here added seconds to the
 * sheet's integration tests (#224) in this environment, and a small inline stepper
 * interrupts the flow less than a modal.
 */
export const SheetRestControls: React.FC<SheetRestControlsProps> = ({ character, onUpdate }) => {
  const { toast } = useToast();
  const [promptOpen, setPromptOpen] = useState(false);
  const [diceToSpend, setDiceToSpend] = useState('0');
  const [resting, setResting] = useState(false);

  const hitDice = character.hitDice;
  const diceAvailable = hitDice ? Math.max(0, hitDice.remaining) : 0;

  const completeRest = async (restType: 'short' | 'long', spent: number): Promise<void> => {
    if (!character.id || resting) return;
    setResting(true);
    try {
      const result =
        restType === 'short'
          ? await restApi.shortRest(character.id, spent)
          : await restApi.longRest(character.id);
      const saved = await onUpdate(applyRestResultToCharacter(character, result));
      if (!saved) return;
      toast({
        title: restType === 'short' ? 'Short rest complete' : 'Long rest complete',
        description:
          restType === 'short' && result.hpRestored > 0
            ? `Restored ${result.hpRestored} HP (${result.hitDiceSpent ?? 0} hit dice spent).`
            : undefined,
      });
      logger.info(`Completed ${restType} rest`, result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to complete ${restType} rest`, error);
      toast({
        title: 'Rest failed',
        description: reason,
        variant: 'destructive',
      });
    } finally {
      setResting(false);
    }
  };

  const handleRest = (restType: 'short' | 'long'): void => {
    // A short rest with dice to spend offers them first; everything else applies directly.
    if (restType === 'short' && diceAvailable > 0) {
      setDiceToSpend('0');
      setPromptOpen(true);
      return;
    }
    void completeRest(restType, 0);
  };

  const confirmShortRest = (): void => {
    const parsed = Number.parseInt(diceToSpend, 10);
    const spent = Number.isNaN(parsed) ? 0 : Math.min(Math.max(0, parsed), diceAvailable);
    setPromptOpen(false);
    void completeRest('short', spent);
  };

  return (
    <div className="space-y-2">
      <RestActionButtons onRest={handleRest} />
      {promptOpen && (
        <div
          role="group"
          aria-label="Spend hit dice on a short rest"
          className="rounded-md border p-3 space-y-3"
        >
          <p className="text-sm text-muted-foreground">
            You have {diceAvailable} of {hitDice?.total ?? 0} hit dice ({hitDice?.type ?? 'd8'})
            remaining. Roll each die and add your Constitution modifier (minimum 0 per die) to
            regain hit points. The rest restores your short-rest resources either way.
          </p>
          <div className="flex items-center gap-3">
            <Label htmlFor="hit-dice-to-spend">Hit dice to spend</Label>
            <Input
              id="hit-dice-to-spend"
              type="number"
              min={0}
              max={diceAvailable}
              value={diceToSpend}
              onChange={(e) => setDiceToSpend(e.target.value)}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">of {diceAvailable} available</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPromptOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmShortRest} disabled={resting}>
              Take Short Rest
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
