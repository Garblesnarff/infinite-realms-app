import { Shield, Zap, Clock } from 'lucide-react';
import React, { useId } from 'react';


import CombatVitals from './components/CombatVitals';

import type { Character } from '@/types/character';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DiceRoller from '@/components/ui/dice-roller';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCombatState } from '@/features/character/hooks/use-combat-state';

interface MainTabProps {
  character: Character;
  onUpdate: () => void;
}

/**
 * Main character sheet tab with core stats and combat tracking
 * Includes HP management, AC, initiative, and death saves
 *
 * Refactored: Logic moved to useCombatState hook, UI moved to CombatVitals component.
 */
const MainTab: React.FC<MainTabProps> = ({ character }) => {
  const damageId = useId();
  const healingId = useId();
  const descriptionId = useId();

  // Calculate max HP (simplified formula)
  const maxHp = Math.max(
    1,
    character.level * (character.class?.hitDie || 8) +
      character.abilityScores.constitution.modifier * character.level,
  );

  const {
    combatState,
    damageInput,
    setDamageInput,
    healingInput,
    setHealingInput,
    applyDamage,
    applyHealing,
    resetDeathSaves,
    updateDeathSave,
  } = useCombatState(maxHp);

  // Proficiency bonus calculation
  const proficiencyBonus = Math.floor((character.level - 1) / 4) + 2;

  // Armor Class calculation with unarmored defense support
  let armorClass = 10 + character.abilityScores.dexterity.modifier;

  // Check for unarmored defense (Barbarian/monk without armor)
  const hasUnarmoredDefense =
    character.class &&
    (character.class.name.toLowerCase() === 'barbarian' ||
      character.class.name.toLowerCase() === 'monk');

  const isWearingArmor = character.equippedArmor !== undefined && character.equippedArmor !== '';

  // If character has unarmored defense and is not wearing armor, use unarmored AC
  if (hasUnarmoredDefense && !isWearingArmor) {
    switch (character.class!.name.toLowerCase()) {
      case 'barbarian':
        armorClass =
          10 +
          character.abilityScores.dexterity.modifier +
          character.abilityScores.constitution.modifier;
        break;
      case 'monk':
        armorClass =
          10 + character.abilityScores.dexterity.modifier + character.abilityScores.wisdom.modifier;
        break;
    }
  }

  // Initiative modifier
  const initiativeModifier = character.abilityScores.dexterity.modifier;

  // Passive Perception
  const passivePerception =
    10 +
    character.abilityScores.wisdom.modifier +
    (character.personalityTraits.includes('Perception') ? proficiencyBonus : 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Combat Vitals */}
      <CombatVitals
        character={character}
        maxHp={maxHp}
        combatState={combatState}
        damageInput={damageInput}
        setDamageInput={setDamageInput}
        healingInput={healingInput}
        setHealingInput={setHealingInput}
        applyDamage={applyDamage}
        applyHealing={applyHealing}
        resetDeathSaves={resetDeathSaves}
        updateDeathSave={updateDeathSave}
        damageId={damageId}
        healingId={healingId}
      />

      {/* Core Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            Core Stats
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* AC, Initiative, Speed */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-2 bg-blue-100 rounded-full">
                <Shield className="w-6 h-6 text-blue-600" />
              </div>
              <div className="text-2xl font-bold">{armorClass}</div>
              <div className="text-xs text-muted-foreground">Armor Class</div>
            </div>

            <div className="text-center">
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-2 bg-yellow-100 rounded-full">
                <Zap className="w-6 h-6 text-yellow-600" />
              </div>
              <DiceRoller
                dice="1d20"
                modifier={initiativeModifier}
                label={`+${initiativeModifier}`}
              />
              <div className="text-xs text-muted-foreground mt-1">Initiative</div>
            </div>

            <div className="text-center">
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-2 bg-green-100 rounded-full">
                <Clock className="w-6 h-6 text-green-600" />
              </div>
              <div className="text-2xl font-bold">{character.race?.speed || 30}</div>
              <div className="text-xs text-muted-foreground">Speed (ft)</div>
            </div>
          </div>

          {/* Proficiency Bonus and Passive Perception */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-lg font-bold">+{proficiencyBonus}</div>
              <div className="text-xs text-muted-foreground">Proficiency Bonus</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{passivePerception}</div>
              <div className="text-xs text-muted-foreground">Passive Perception</div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-2 pt-4 border-t">
            <h4 className="text-sm font-medium">Quick Rolls</h4>
            <div className="flex flex-wrap gap-2">
              <DiceRoller
                dice="1d20"
                modifier={character.abilityScores.strength.modifier}
                label="STR"
              />
              <DiceRoller
                dice="1d20"
                modifier={character.abilityScores.dexterity.modifier}
                label="DEX"
              />
              <DiceRoller
                dice="1d20"
                modifier={character.abilityScores.constitution.modifier}
                label="CON"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Character Description */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Character Description</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor={descriptionId} className="sr-only">
            Character description
          </Label>
          <Textarea
            id={descriptionId}
            value={character.description || ''}
            placeholder="Describe your character's appearance, personality, and background..."
            className="min-h-[100px] resize-none"
            readOnly
          />

          {/* Background and Alignment */}
          <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Background</label>
              <p className="text-sm">{character.background?.name || 'None'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Alignment</label>
              <p className="text-sm">{character.alignment || 'Unaligned'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MainTab;
