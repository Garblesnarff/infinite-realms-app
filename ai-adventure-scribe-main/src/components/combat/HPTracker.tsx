import { Heart, Shield, PlusCircle, MinusCircle } from 'lucide-react';
import React, { useState, useId } from 'react';

import type { CombatParticipant } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getHPColor, getHPStatusDescription } from '@/utils/hp-utils';

interface HPTrackerProps {
  participant: CombatParticipant;
  onDamage?: (participantId: string, damage: number, damageType: string) => void;
  onHeal?: (participantId: string, healingAmount: number) => void;
  showHPDetails?: boolean;
  isInteractive?: boolean;
}

/**
 * ⚡ Bolt: Wrapped in React.memo to prevent unnecessary re-renders when
 * the participant's status hasn't changed, which is common in busy combat encounters.
 */
const HPTracker: React.FC<HPTrackerProps> = React.memo(({
  participant,
  onDamage,
  onHeal,
  showHPDetails = true,
  isInteractive = true,
}) => {
  const damageInputId = useId();
  const healInputId = useId();
  const [damageAmount, setDamageAmount] = useState('');
  const [healAmount, setHealAmount] = useState('');

  const {
    currentHitPoints = 0,
    maxHitPoints = 1,
    temporaryHitPoints = 0,
    armorClass = 10,
  } = participant;
  const hpPercent = maxHitPoints > 0 ? (currentHitPoints / maxHitPoints) * 100 : 0;
  const hpString = `${currentHitPoints} / ${maxHitPoints} HP${
    temporaryHitPoints > 0 ? ` (+${temporaryHitPoints} temporary)` : ''
  }`;

  const handleDamage = (): void => {
    const damage = parseInt(damageAmount, 10);
    if (onDamage && !isNaN(damage) && damage > 0) {
      onDamage(participant.id, damage, 'slashing'); // Defaulting damage type for simplicity
      setDamageAmount('');
    }
  };

  const handleHeal = (): void => {
    const heal = parseInt(healAmount, 10);
    if (onHeal && !isNaN(heal) && heal > 0) {
      onHeal(participant.id, heal);
      setHealAmount('');
    }
  };

  return (
    <Card>
      <TooltipProvider>
        <CardContent className="p-4 space-y-4">
          <div className="flex justify-between items-center">
            <span className="font-semibold">{participant.name}</span>
            <div className="flex items-center gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="flex items-center gap-1 text-sm cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    aria-label={`Armor Class: ${armorClass}`}
                    tabIndex={0}
                  >
                    <Shield className="w-4 h-4" aria-hidden="true" />
                    <span>AC: {armorClass}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Armor Class: {armorClass}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

        <div>
          <div className="flex justify-between items-center text-sm mb-1">
            <span className="flex items-center gap-1">
              <Heart className="w-4 h-4" aria-hidden="true" />
              HP
            </span>
            {showHPDetails ? (
              <span aria-live="polite">
                {currentHitPoints} / {maxHitPoints}
                {temporaryHitPoints > 0 && (
                  <span className="text-blue-500"> + {temporaryHitPoints}</span>
                )}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {getHPStatusDescription(hpPercent)}
              </span>
            )}
          </div>
          <Progress
            value={hpPercent}
            className="h-2"
            indicatorClassName={getHPColor(hpPercent)}
            aria-label={
              showHPDetails
                ? `${participant.name} health: ${hpString}`
                : `${participant.name} health: ${getHPStatusDescription(hpPercent)}`
            }
            title={showHPDetails ? hpString : getHPStatusDescription(hpPercent)}
          />
        </div>

        {isInteractive && (
          <div className="flex gap-2">
            <div className="flex-1 flex gap-1">
              <Label htmlFor={damageInputId} className="sr-only">
                Damage amount for {participant.name}
              </Label>
              <Input
                id={damageInputId}
                type="number"
                placeholder="Damage"
                value={damageAmount}
                onChange={(e) => setDamageAmount(e.target.value)}
                className="h-8"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onClick={handleDamage}
                    size="sm"
                    variant="destructive"
                    className="h-8"
                    aria-label={`Apply damage to ${participant.name}`}
                  >
                    <MinusCircle className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Apply damage to {participant.name}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex-1 flex gap-1">
              <Label htmlFor={healInputId} className="sr-only">
                Healing amount for {participant.name}
              </Label>
              <Input
                id={healInputId}
                type="number"
                placeholder="Heal"
                value={healAmount}
                onChange={(e) => setHealAmount(e.target.value)}
                className="h-8"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onClick={handleHeal}
                    size="sm"
                    variant="secondary"
                    className="h-8"
                    aria-label={`Apply healing to ${participant.name}`}
                  >
                    <PlusCircle className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Apply healing to {participant.name}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
        </CardContent>
      </TooltipProvider>
    </Card>
  );
});

HPTracker.displayName = 'HPTracker';

export default HPTracker;
