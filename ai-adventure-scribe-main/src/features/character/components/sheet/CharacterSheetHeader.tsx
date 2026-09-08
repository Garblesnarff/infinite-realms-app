import { Heart, Shield, Sword } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';

import { IRPanel, IRThumb } from '@/components/ui/ir-primitives';
import { calculateProficiencyBonus } from '@/utils/character/basic-math';
import {
  formatCharacterSheetHitPoints,
  getCharacterSheetHitPoints,
} from '@/utils/character/character-sheet-hit-points';

interface CharacterSheetHeaderProps {
  character: Character;
}

function calculateArmorClass(character: Character): number {
  const abilityScores = character.abilityScores || {
    dexterity: { modifier: 0 },
    constitution: { modifier: 0 },
    wisdom: { modifier: 0 },
  };
  let armorClass = 10 + abilityScores.dexterity.modifier;

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
        armorClass = 10 + abilityScores.dexterity.modifier + abilityScores.constitution.modifier;
        break;
      case 'monk':
        armorClass = 10 + abilityScores.dexterity.modifier + abilityScores.wisdom.modifier;
        break;
    }
  }

  return armorClass;
}

export const CharacterSheetHeader: React.FC<CharacterSheetHeaderProps> = ({ character }) => {
  const portraitUrl = character.image_url ?? character.avatar_url;
  const hitPoints = getCharacterSheetHitPoints(character);

  return (
    <IRPanel className="mb-6 p-4">
      <div className="flex items-center gap-4">
        {/* Character Portrait/Avatar */}
        <div className="flex-shrink-0">
          {portraitUrl ? (
            <IRThumb
              src={portraitUrl}
              alt={`${character.name || 'Character'} avatar`}
              size={64}
              className="rounded-full"
            />
          ) : (
            <div
              className="w-16 h-16 rounded-full bg-infinite-gold text-infinite-dark flex items-center justify-center text-xl font-bold ir-display"
              aria-hidden="true"
            >
              {character.name?.charAt(0).toUpperCase() || '?'}
            </div>
          )}
        </div>

        {/* Character Title */}
        <div className="flex-1">
          <h1 className="ir-display text-2xl font-semibold text-foreground">
            {character.name || 'Unnamed Character'}
          </h1>
          <p className="text-muted-foreground">
            Level {character.level || 1} {character.race?.name || 'Unknown Race'}{' '}
            {character.class?.name || 'Unknown Class'}
          </p>
        </div>

        {/* Quick Stats */}
        <div className="hidden md:flex items-center gap-4 text-sm">
          <div className="text-center">
            <div className="flex items-center gap-1 text-red-600">
              <Heart className="w-4 h-4" />
              <span className="font-bold">{formatCharacterSheetHitPoints(hitPoints)}</span>
            </div>
            <div className="text-xs text-muted-foreground">HP</div>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-1 text-infinite-teal">
              <Shield className="w-4 h-4" />
              <span className="font-bold">{calculateArmorClass(character)}</span>
            </div>
            <div className="text-xs text-muted-foreground">AC</div>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-1 text-emerald-500">
              <Sword className="w-4 h-4" />
              <span className="font-bold">+{calculateProficiencyBonus(character.level || 1)}</span>
            </div>
            <div className="text-xs text-muted-foreground">PROF</div>
          </div>
        </div>
      </div>
    </IRPanel>
  );
};
