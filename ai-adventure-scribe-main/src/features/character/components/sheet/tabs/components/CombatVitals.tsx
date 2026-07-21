import {
  Heart,
  Shield,
  Plus,
  Minus,
  RotateCcw,
  Skull,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Eye,
  Target,
} from 'lucide-react';
import React from 'react';

import type { CombatState } from '@/features/character/hooks/use-combat-state';
import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { getHPColor } from '@/utils/hp-utils';

interface CombatVitalsProps {
  character: Character;
  maxHp: number;
  combatState: CombatState;
  damageInput: string;
  setDamageInput: (value: string) => void;
  healingInput: string;
  setHealingInput: (value: string) => void;
  applyDamage: () => void;
  applyHealing: () => void;
  resetDeathSaves: () => void;
  updateDeathSave: (type: 'success' | 'failure', increment: boolean) => void;
  damageId: string;
  healingId: string;
}

/**
 * Component for tracking HP, death saves, and combat conditions
 * Extracted from MainTab.tsx
 */
const CombatVitals: React.FC<CombatVitalsProps> = ({
  character,
  maxHp,
  combatState,
  damageInput,
  setDamageInput,
  healingInput,
  setHealingInput,
  applyDamage,
  applyHealing,
  resetDeathSaves,
  updateDeathSave,
  damageId,
  healingId,
}) => {
  const isUnconscious = combatState.currentHp <= 0;
  const isDead = combatState.deathSaves.failures >= 3;
  const isStabilized = combatState.deathSaves.successes >= 3;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-red-500" aria-hidden="true" />
          Combat Vitals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hit Points */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Hit Points</span>
            <Badge variant={isUnconscious ? 'destructive' : 'secondary'}>
              {combatState.currentHp} / {maxHp}
            </Badge>
          </div>

          {/* HP Bar */}
          <Progress
            value={(combatState.currentHp / maxHp) * 100}
            className="h-3"
            indicatorClassName={getHPColor((combatState.currentHp / maxHp) * 100)}
            aria-label={`Hit Points: ${combatState.currentHp} of ${maxHp} remaining`}
          />

          {/* Temp HP */}
          {combatState.tempHp > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-blue-600">Temp HP:</span>
              <Badge variant="outline" className="text-blue-600">
                {combatState.tempHp}
              </Badge>
            </div>
          )}
        </div>

        {/* Damage Resistances, Immunities, and Vulnerabilities */}
        {(character.damageResistances?.length > 0 ||
          character.damageImmunities?.length > 0 ||
          character.damageVulnerabilities?.length > 0) && (
          <div className="border-t pt-3">
            <h4 className="text-sm font-medium mb-2">Damage Characteristics</h4>

            {/* Resistances */}
            {character.damageResistances?.length > 0 && (
              <div className="flex items-start gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <span className="text-xs text-muted-foreground">Resistances:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {character.damageResistances.map((resistance, index) => (
                      <Badge key={index} variant="secondary" className="text-xs py-0.5">
                        {resistance.charAt(0).toUpperCase() + resistance.slice(1)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Immunities */}
            {character.damageImmunities?.length > 0 && (
              <div className="flex items-start gap-2 mb-2">
                <Shield className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <span className="text-xs text-muted-foreground">Immunities:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {character.damageImmunities.map((immunity, index) => (
                      <Badge key={index} variant="default" className="text-xs py-0.5">
                        {immunity.charAt(0).toUpperCase() + immunity.slice(1)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Vulnerabilities */}
            {character.damageVulnerabilities?.length > 0 && (
              <div className="flex items-start gap-2">
                <ShieldX className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <span className="text-xs text-muted-foreground">Vulnerabilities:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {character.damageVulnerabilities.map((vulnerability, index) => (
                      <Badge key={index} variant="destructive" className="text-xs py-0.5">
                        {vulnerability.charAt(0).toUpperCase() + vulnerability.slice(1)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vision and Stealth */}
        {(character.visionTypes?.length > 0 ||
          character.obscurement !== 'clear' ||
          character.isHidden) && (
          <div className="border-t pt-3">
            <h4 className="text-sm font-medium mb-2">Vision & Stealth</h4>

            {/* Vision Types */}
            {character.visionTypes?.length > 0 && (
              <div className="flex items-start gap-2 mb-2">
                <Target className="w-4 h-4 text-infinite-purple mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <span className="text-xs text-muted-foreground">Vision:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {character.visionTypes.map((vision, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="text-xs py-0.5 bg-infinite-purple/15 text-infinite-purple"
                      >
                        {vision.type.charAt(0).toUpperCase() + vision.type.slice(1)} ({vision.range}{' '}
                        ft)
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Obscurement */}
            {character.obscurement && character.obscurement !== 'clear' && (
              <div className="flex items-start gap-2 mb-2">
                <ShieldAlert className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <span className="text-xs text-muted-foreground">Environment:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge
                      variant="outline"
                      className="text-xs py-0.5 border-orange-500/40 text-orange-400"
                    >
                      {character.obscurement
                        .replace('_', ' ')
                        .replace(/\b\w/g, (l) => l.toUpperCase())}
                    </Badge>
                  </div>
                </div>
              </div>
            )}

            {/* Hidden Status */}
            {character.isHidden && (
              <div className="flex items-start gap-2">
                <Eye className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <span className="text-xs text-muted-foreground">Stealth:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant="default" className="text-xs py-0.5 bg-muted text-foreground">
                      Hidden
                    </Badge>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Damage/Healing Controls */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor={damageId} className="sr-only">
              Damage amount
            </Label>
            <Input
              id={damageId}
              type="number"
              placeholder="Damage"
              value={damageInput}
              onChange={(e) => setDamageInput(e.target.value)}
              className="text-sm"
            />
            <Button size="sm" variant="destructive" onClick={applyDamage} className="w-full mt-1">
              <Minus className="w-3 h-3 mr-1" />
              Apply Damage
            </Button>
          </div>
          <div className="flex-1">
            <Label htmlFor={healingId} className="sr-only">
              Healing amount
            </Label>
            <Input
              id={healingId}
              type="number"
              placeholder="Healing"
              value={healingInput}
              onChange={(e) => setHealingInput(e.target.value)}
              className="text-sm"
            />
            <Button
              size="sm"
              variant="default"
              onClick={applyHealing}
              className="w-full mt-1 bg-green-600 hover:bg-green-700"
            >
              <Plus className="w-3 h-3 mr-1" />
              Apply Healing
            </Button>
          </div>
        </div>

        {/* Death Saves (only show when unconscious) */}
        {isUnconscious && !isDead && (
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Death Saves</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={resetDeathSaves}
                aria-label="Reset death saves"
                title="Reset death saves"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-green-600">Successes</span>
                <div className="flex gap-1">
                  {[1, 2, 3].map((i) => (
                    <button
                      key={i}
                      type="button"
                      className={`w-4 h-4 rounded-full border-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        i <= combatState.deathSaves.successes
                          ? 'bg-green-500 border-green-500'
                          : 'border-green-500 hover:bg-green-500/20'
                      }`}
                      onClick={() =>
                        updateDeathSave('success', i > combatState.deathSaves.successes)
                      }
                      aria-label={`Death save success ${i}`}
                      aria-pressed={i <= combatState.deathSaves.successes}
                      title={`Mark death save success ${i}`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-red-600">Failures</span>
                <div className="flex gap-1">
                  {[1, 2, 3].map((i) => (
                    <button
                      key={i}
                      type="button"
                      className={`w-4 h-4 rounded-full border-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        i <= combatState.deathSaves.failures
                          ? 'bg-red-500 border-red-500'
                          : 'border-red-500 hover:bg-red-500/20'
                      }`}
                      onClick={() =>
                        updateDeathSave('failure', i > combatState.deathSaves.failures)
                      }
                      aria-label={`Death save failure ${i}`}
                      aria-pressed={i <= combatState.deathSaves.failures}
                      title={`Mark death save failure ${i}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {isStabilized && (
              <Badge variant="secondary" className="mt-2 w-full justify-center">
                Stabilized
              </Badge>
            )}
          </div>
        )}

        {isDead && (
          <div
            className="text-center p-4 border border-destructive/30 bg-destructive/10 rounded"
            role="status"
          >
            <Skull className="w-8 h-8 text-destructive mx-auto mb-2" aria-hidden="true" />
            <p className="text-destructive font-medium">Dead</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CombatVitals;
