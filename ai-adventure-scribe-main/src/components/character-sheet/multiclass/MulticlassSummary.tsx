import { Users, Shield, BookOpen, Plus, ArrowUp } from 'lucide-react';
import React from 'react';

import type { MulticlassSummaryProps } from './types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';


/**
 * MulticlassSummary component displays the summary information for a multiclass character,
 * including overview, spellcasting, proficiencies, and hit points.
 */
export const MulticlassSummary: React.FC<MulticlassSummaryProps> = ({
  totalLevel,
  proficiencyBonus,
  classLevels,
  onLevelUpClass,
  isProcessing,
  isMulticlassed,
  availableClasses,
  onAddClass,
  validationResult,
  isSpellcaster,
  spellcasting,
  proficiencies,
  hitPoints,
}) => {
  return (
    <>
      {/* Multiclass Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-500" />
            Multiclass Character
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold">{totalLevel}</div>
              <div className="text-xs text-muted-foreground">Total Level</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold">{classLevels.length}</div>
              <div className="text-xs text-muted-foreground">Classes</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold">+{proficiencyBonus}</div>
              <div className="text-xs text-muted-foreground">Proficiency Bonus</div>
            </div>
          </div>

          {/* Class Level Breakdown */}
          <div className="mt-4">
            <h4 className="font-medium mb-3">Class Levels</h4>
            <div className="flex flex-wrap gap-2">
              {classLevels.map((cls) => (
                <Badge
                  key={cls.classId}
                  variant="outline"
                  className="px-3 py-1 flex items-center gap-1"
                >
                  {cls.className} {cls.level}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-4 w-4 p-0 ml-1"
                        onClick={() => onLevelUpClass(cls.classId)}
                        disabled={isProcessing}
                        aria-label={`Level up ${cls.className}`}
                        type="button"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Level up {cls.className}</TooltipContent>
                  </Tooltip>
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add New Class (if not already multiclassed or if there are available classes) */}
      {!isMulticlassed() && availableClasses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-green-500" />
              Add New Class
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Multiclass by adding levels in a different class
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {availableClasses
                .filter((cls) => !classLevels.some((existing) => existing.className === cls.name))
                .map((cls) => (
                  <div
                    key={cls.id}
                    className="p-3 border rounded-lg cursor-pointer hover:border-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple"
                    onClick={() => onAddClass(cls)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onAddClass(cls);
                      }
                    }}
                    aria-label={`Add class: ${cls.name}`}
                  >
                    <div className="font-medium capitalize">{cls.name}</div>
                    <div className="text-sm text-muted-foreground">{cls.hitDie}-sided hit die</div>
                  </div>
                ))}
            </div>

            {validationResult && !validationResult.canMulticlass && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                <strong>Cannot Multiclass:</strong>{' '}
                {validationResult.missingRequirements.join(', ')}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Spell Slot Progression (if applicable) */}
      {isSpellcaster && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-500" />
              Multiclass Spellcasting
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Combined spell slot progression from multiple spellcasting classes
            </p>
            <div className="mb-4">
              <div className="text-sm font-medium">
                Combined Caster Level: {spellcasting.combinedCasterLevel}
              </div>
              <div className="text-xs text-muted-foreground">
                {spellcasting.spellcastingClasses
                  .map((cls) => `${cls.className} (${cls.level})`)
                  .join(', ')}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {spellcasting.spellSlots.map((slots, level) => (
                <div key={level} className="text-center p-2 border rounded">
                  <div className="text-sm font-medium">{level + 1}</div>
                  <div className="text-lg font-bold">{slots}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Proficiencies Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-500" />
            Combined Proficiencies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {proficiencies.armor.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Armor</h4>
                <div className="text-sm">{proficiencies.armor.join(', ')}</div>
              </div>
            )}
            {proficiencies.weapons.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Weapons</h4>
                <div className="text-sm">{proficiencies.weapons.join(', ')}</div>
              </div>
            )}
            {proficiencies.tools.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Tools</h4>
                <div className="text-sm">{proficiencies.tools.join(', ')}</div>
              </div>
            )}
            {proficiencies.savingThrows.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Saving Throws</h4>
                <div className="text-sm">
                  {proficiencies.savingThrows
                    .map((st) => st.charAt(0).toUpperCase() + st.slice(1))
                    .join(', ')}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Hit Points Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-500" />
            Hit Points Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center mb-4">
            <div className="text-3xl font-bold">{hitPoints}</div>
            <div className="text-sm text-muted-foreground">Maximum Hit Points</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {classLevels.map((cls) => (
              <div key={cls.classId} className="text-center p-3 border rounded">
                <div className="text-lg font-bold">
                  {cls.level}d{cls.hitDie}
                </div>
                <div className="text-xs text-muted-foreground">{cls.className}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
};
