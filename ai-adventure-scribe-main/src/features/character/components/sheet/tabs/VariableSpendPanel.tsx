import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';

import {
  FLEXIBLE_CASTING_CREATE_COSTS,
  METAMAGIC_COSTS,
  METAMAGIC_OPTION_LABELS,
} from '../../../../../../shared/limited-feature-counts';
import { slotOrdinal } from '../../../../../../shared/slot-ordinal';

import type { Character } from '@/types/character';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import {
  type CharacterFeatureRow,
  type UseCharacterFeatureBody,
  spendCharacterFeature,
} from '@/services/class-features-api';

interface VariableSpendPanelProps {
  characterId: string;
  rows: CharacterFeatureRow[];
  spellSlots?: Character['spellSlots'];
  /** The game session the sheet runs in, when it does; the route then posts the engine row. */
  sessionId?: string;
  /** Called after a spend lands, so the sheet reloads the slot counts it shows. */
  onSpent?: () => void;
}

/** One choice the player can pick, with the exact body the use route takes for it (#1233). */
interface SpendOption {
  value: string;
  label: string;
  body: UseCharacterFeatureBody;
}

const slotLevels = (spellSlots: Character['spellSlots'], minLevel: number, maxLevel: number) =>
  Array.from({ length: maxLevel - minLevel + 1 }, (_, index) => minLevel + index).filter(
    (level) => (spellSlots?.[level]?.current ?? 0) > 0,
  );

/**
 * The picker options for one variable-cost feature row, or null when the row is not one
 * of the three features (#1233). Divine Smite offers only slot levels the character has
 * slots for; a Metamagic option and a Flexible Casting direction carry their option name
 * or slot level as the use route's `option`.
 */
export const variableSpendOptions = (
  row: CharacterFeatureRow,
  spellSlots: Character['spellSlots'],
): SpendOption[] | null => {
  const feature = row.feature;
  if (!feature) return null;
  const name = feature.featureName.toLowerCase();

  if (feature.className.toLowerCase() === 'paladin' && name === 'divine smite') {
    return slotLevels(spellSlots, 1, 9).map((level) => ({
      value: String(level),
      label: `${slotOrdinal(level)}-level slot`,
      body: { slotLevel: level },
    }));
  }

  if (feature.className.toLowerCase() === 'sorcerer' && name === 'metamagic') {
    return Object.keys(METAMAGIC_COSTS).map((option) => ({
      value: option,
      label: `${METAMAGIC_OPTION_LABELS[option]} (${METAMAGIC_COSTS[option]} SP)`,
      body: { option },
    }));
  }

  if (
    feature.className.toLowerCase() === 'sorcerer' &&
    name === 'flexible casting: creating spell slots'
  ) {
    return Object.keys(FLEXIBLE_CASTING_CREATE_COSTS).map((level) => ({
      value: level,
      label: `Create a ${slotOrdinal(Number(level))}-level slot (${FLEXIBLE_CASTING_CREATE_COSTS[Number(level)]} SP)`,
      body: { option: level },
    }));
  }

  if (
    feature.className.toLowerCase() === 'sorcerer' &&
    name === 'flexible casting: converting spell slot'
  ) {
    return slotLevels(spellSlots, 1, 9).map((level) => ({
      value: String(level),
      label: `Convert a ${slotOrdinal(level)}-level slot into ${level} SP`,
      body: { option: String(level) },
    }));
  }

  return null;
};

/**
 * Spend a variable-cost class feature (Divine Smite, Metamagic, Flexible Casting) through
 * the use route, sending the slot level or option the player picked (#1233). The use route
 * is the authority for the spend; this panel only chooses the body.
 */
export const VariableSpendPanel: React.FC<VariableSpendPanelProps> = ({
  characterId,
  rows,
  spellSlots,
  sessionId,
  onSpent,
}) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  const panels = rows.flatMap((row) => {
    const options = variableSpendOptions(row, spellSlots);
    return options ? [{ row, options }] : [];
  });
  if (panels.length === 0) return null;

  const spend = async (row: CharacterFeatureRow, options: SpendOption[]) => {
    const picked = options.find((option) => option.value === choice[row.featureId]);
    if (!picked) return;
    setPending(row.featureId);
    try {
      const body = sessionId ? { ...picked.body, sessionId } : picked.body;
      const result = await spendCharacterFeature(characterId, row.featureId, body);
      await queryClient.invalidateQueries({ queryKey: ['class-features', characterId] });
      if (result.success) onSpent?.();
      toast({ title: result.success ? 'Feature used' : 'Not spent', description: result.message });
    } catch (error) {
      logger.error('Failed to spend class feature', error);
      toast({
        title: 'Spend failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      {panels.map(({ row, options }) => (
        <div key={row.featureId} className="border-l-4 border-infinite-teal pl-4 space-y-2">
          <h4 className="font-semibold">{row.feature?.featureName}</h4>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">No spell slots left to spend.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={choice[row.featureId] ?? ''}
                onValueChange={(value) =>
                  setChoice((prev) => ({ ...prev, [row.featureId]: value }))
                }
              >
                <SelectTrigger className="w-64" aria-label={`${row.feature?.featureName} choice`}>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!choice[row.featureId] || pending === row.featureId}
                onClick={() => void spend(row, options)}
              >
                Spend
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default VariableSpendPanel;
