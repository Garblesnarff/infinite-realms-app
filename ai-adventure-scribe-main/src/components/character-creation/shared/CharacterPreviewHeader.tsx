import { Sparkles } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { type Character } from '@/types/character';

interface CharacterPreviewHeaderProps {
  character: Character;
  totalLevel: number;
}

export const CharacterPreviewHeader: React.FC<CharacterPreviewHeaderProps> = ({
  character,
  totalLevel,
}) => {
  return (
    <div className="text-center space-y-3">
      <div className="relative">
        <div className="w-20 h-20 mx-auto bg-gradient-to-br from-infinite-purple to-infinite-gold rounded-full flex items-center justify-center border-4 border-infinite-gold/40 shadow-lg">
          {character.avatar_url ? (
            <img
              src={character.avatar_url}
              alt={character.name || 'Character'}
              className="w-full h-full object-cover rounded-full"
            />
          ) : (
            <Sparkles className="w-10 h-10 text-white" />
          )}
        </div>
        {character.name && (
          <Badge className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-infinite-dark-lighter text-infinite-gold border-2 border-infinite-purple/30">
            Level {totalLevel}
          </Badge>
        )}
      </div>

      <div>
        <h3 className="ir-display font-semibold text-xl text-foreground">
          {character.name || 'Unnamed Hero'}
        </h3>
        <div className="flex flex-wrap gap-2 justify-center mt-2">
          {character.race && (
            <Badge
              variant="secondary"
              className="bg-infinite-teal/15 text-infinite-teal border border-infinite-teal/30"
            >
              {character.subrace
                ? `${character.subrace.name} (${character.race.name})`
                : character.race.name}
            </Badge>
          )}
          {character.class && (
            <Badge
              variant="secondary"
              className="bg-infinite-purple/15 text-infinite-purple border border-infinite-purple/30"
            >
              {character.class.name}
            </Badge>
          )}
          {character.background && (
            <Badge
              variant="secondary"
              className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
            >
              {character.background.name}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
};
