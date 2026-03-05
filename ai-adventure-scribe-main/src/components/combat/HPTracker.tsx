import { Heart, Shield, PlusCircle, MinusCircle } from 'lucide-react';
import React, { useState, useId } from 'react';

import type { CombatParticipant } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { getHPColor } from '@/utils/hp-utils';

interface HPTrackerProps {
  participant: CombatParticipant;
  onDamage?: (participantId: string, damage: number, damageType: string) => void;
  onHeal?: (participantId: string, healingAmount: number) => void;
  showHPDetails?: boolean;
  isInteractive?: boolean;
}

const HPTracker: React.FC<HPTrackerProps> = ({
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
      <CardContent className="p-4 space-y-4">
        <div className="flex justify-between items-center">
          <span className="font-semibold">{participant.name}</span>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-sm">
              <Shield className="w-4 h-4" />
              <span>AC: {armorClass}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center text-sm mb-1">
            <span className="flex items-center gap-1">
              <Heart className="w-4 h-4" />
              HP
            </span>
            {showHPDetails ? (
              <span>
                {currentHitPoints} / {maxHitPoints}
                {temporaryHitPoints > 0 && (
                  <span className="text-blue-500"> + {temporaryHitPoints}</span>
                )}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Status Unknown</span>
            )}
          </div>
          <Progress
            value={hpPercent}
            className="h-2"
            indicatorClassName={getHPColor(hpPercent)}
            aria-label={`${participant.name} health: ${currentHitPoints} / ${maxHitPoints} HP`}
            title={`${currentHitPoints} / ${maxHitPoints} HP`}
          />
        </div>

        {isInteractive && (
          <div className="flex gap-2">
            <div className="flex-1 flex gap-1">
              <Label htmlFor={damageInputId} className="sr-only">
                Damage Amount
              </Label>
              <Input
                id={damageInputId}
                type="number"
                placeholder="Damage"
                value={damageAmount}
                onChange={(e) => setDamageAmount(e.target.value)}
                className="h-8"
                aria-label="Damage amount"
              />
              <Button
                onClick={handleDamage}
                size="sm"
                variant="destructive"
                className="h-8"
                aria-label="Apply damage"
                title="Apply damage"
              >
                <MinusCircle className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 flex gap-1">
              <Label htmlFor={healInputId} className="sr-only">
                Healing Amount
              </Label>
              <Input
                id={healInputId}
                type="number"
                placeholder="Heal"
                value={healAmount}
                onChange={(e) => setHealAmount(e.target.value)}
                className="h-8"
                aria-label="Healing amount"
              />
              <Button
                onClick={handleHeal}
                size="sm"
                variant="secondary"
                className="h-8"
                aria-label="Apply healing"
                title="Apply healing"
              >
                <PlusCircle className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default HPTracker;
