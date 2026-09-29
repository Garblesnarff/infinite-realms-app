/**
 * Enemy Card Component
 *
 * Displays enemy information during combat encounters.
 * Follows D&D 5e rules where HP is hidden until defeated or DM reveals.
 * Provides attack buttons and visual enemy representation.
 */

import { Sword, Skull, Zap, Target, Heart, Shield } from 'lucide-react';
import React from 'react';

import type { MonsterAttack } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import DiceRoller from '@/components/ui/dice-roller';
import { useCampaignAssetsContext } from '@/contexts/CampaignAssetsContext';
import { useCombat } from '@/contexts/CombatContext';
import { getEnemyHealthTier } from '@/utils/hp-utils';

interface EnemyCardProps {
  enemyId: string;
  className?: string;
  /** Attack buttons show only when a game-master surface passes a handler (#2257). */
  onAttack?: (attack: MonsterAttack) => void;
}

/**
 * ⚡ Bolt: Wrapped in React.memo to prevent unnecessary re-renders during combat
 * state updates when this specific enemy's data hasn't changed.
 */
const EnemyCard: React.FC<EnemyCardProps> = React.memo(({ enemyId, className = '', onAttack }) => {
  const { state } = useCombat();
  const { getAssetImageUrl } = useCampaignAssetsContext();
  const enemy = state.activeEncounter?.participants.find((p) => p.id === enemyId);

  if (!enemy || enemy.participantType !== 'monster') {
    return null;
  }

  // Look up portrait from campaign assets
  const assetKey = enemy.name.toLowerCase().replace(/\s+/g, '-');
  const portraitUrl = enemy.portraitUrl || getAssetImageUrl('monster', assetKey);

  const getChallengeRatingColor = (cr: string) => {
    const numCR = parseFloat(cr);
    if (numCR >= 5) return 'bg-red-600 text-white';
    if (numCR >= 1) return 'bg-orange-500 text-white';
    if (numCR >= 0.25) return 'bg-yellow-500 text-white';
    if (numCR >= 0.125) return 'bg-blue-500 text-white';
    return 'bg-green-500 text-white';
  };

  const renderAttackButton = (attack: MonsterAttack, index: number) => {
    const damageModifier = enemy.monsterData?.attacks?.[index]?.attackBonus || 0;
    const damageType = enemy.monsterData?.attacks?.[index]?.damageType || 'bludgeoning';

    return (
      <Button
        key={index}
        variant="outline"
        size="sm"
        className="w-full mb-1 justify-start"
        onClick={() => onAttack?.(attack)}
      >
        <Sword className="w-3 h-3 mr-2" />
        <span className="text-xs mr-2">{attack.name}</span>
        {attack.damageRoll && (
          <DiceRoller
            dice={attack.damageRoll}
            modifier={damageModifier}
            label=""
            className="flex-shrink-0"
            displayOnly
          />
        )}
        {damageType !== 'none' && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {damageType}
          </Badge>
        )}
      </Button>
    );
  };

  return (
    <Card className={`w-full max-w-sm ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {/* Portrait thumbnail */}
          {portraitUrl ? (
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-red-500/50 shadow-lg flex-shrink-0">
              <img src={portraitUrl} alt={enemy.name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-full bg-red-900/30 border-2 border-red-500/30 flex items-center justify-center flex-shrink-0">
              <Skull className="w-6 h-6 text-red-500" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold text-red-400 flex items-center gap-2">
                {enemy.name}
              </CardTitle>

              {enemy.monsterData?.challengeRating && (
                <Badge
                  className={getChallengeRatingColor(enemy.monsterData.challengeRating)}
                  variant="secondary"
                >
                  CR {enemy.monsterData.challengeRating}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {enemy.monsterData?.type && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Target className="w-3 h-3" />
            <span>{enemy.monsterData.type}</span>
            {enemy.monsterData?.alignment && (
              <span className="ml-2">({enemy.monsterData.alignment})</span>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1">
            <Heart className="w-4 h-4" aria-hidden="true" />
            <span aria-live="polite">
              <span className="sr-only">{enemy.name} health: </span>
              {getEnemyHealthTier(enemy.currentHitPoints, enemy.maxHitPoints)}
            </span>
          </span>
          <span className="flex items-center gap-1" aria-label={`Armor Class: ${enemy.armorClass}`}>
            <Shield className="w-4 h-4" aria-hidden="true" />
            AC: {enemy.armorClass}
          </span>
        </div>

        {enemy.monsterData?.specialAbilities && enemy.monsterData.specialAbilities.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-purple-700 mb-1">
              <Zap className="w-3 h-3" />
              Special Abilities
            </div>
            {enemy.monsterData.specialAbilities.map((ability, index) => (
              <Badge key={index} variant="secondary" className="text-xs w-full justify-start">
                {ability}
              </Badge>
            ))}
          </div>
        )}

        {onAttack && enemy.monsterData?.attacks && enemy.monsterData.attacks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-red-700">
              <Sword className="w-3 h-3" />
              Actions
            </div>
            <div className="space-y-1">
              {enemy.monsterData.attacks.map((attack, index) => renderAttackButton(attack, index))}
            </div>
          </div>
        )}

        {enemy.conditions.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2 border-t">
            {enemy.conditions.map((condition, index) => (
              <Badge key={index} variant="destructive" className="text-xs">
                {condition.name}
                {condition.duration > 0 && ` (${condition.duration})`}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

EnemyCard.displayName = 'EnemyCard';

export default EnemyCard;
