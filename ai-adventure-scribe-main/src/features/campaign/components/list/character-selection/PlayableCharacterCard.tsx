import { Play } from 'lucide-react';
import React from 'react';

import type { Character } from '@/features/campaign/hooks/use-character-selection';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';

interface PlayableCharacterCardProps {
  character: Character;
  onSelect: (character: Character) => void;
  getModifier: (score?: number) => string;
}

/**
 * Component for rendering an existing character card in the character selection modal.
 * Extracted from CharacterSelectionModal.
 */
export const PlayableCharacterCard: React.FC<PlayableCharacterCardProps> = ({
  character,
  onSelect,
  getModifier,
}) => {
  const stats = character.character_stats;
  const backgroundImage =
    character.background_image || new URL('/card-background.jpeg', import.meta.url).href;
  const cardTitle = `Select character: ${character.name}, Level ${character.level} ${character.race} ${character.class}`;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(character)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(character);
        }
      }}
      aria-label={cardTitle}
      title={cardTitle}
      className="group cursor-pointer hover:shadow-2xl hover:shadow-infinite-purple/40 transition-all duration-500 overflow-hidden border-2 border-border/60 hover:border-infinite-gold/90 hover:scale-[1.02] relative bg-white dark:bg-background focus-visible:ring-2 focus-visible:ring-infinite-purple focus-visible:outline-none"
    >
      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(168,85,247,0.4)]" />
      </div>

      <div
        className="relative h-32 bg-cover bg-center transition-all duration-700 ease-out group-hover:scale-105 group-hover:brightness-110"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/80 to-white/95 dark:from-background/60 dark:via-background/80 dark:to-background/95" />
        {character.avatar_url && (
          <div className="absolute -bottom-8 left-4" style={{ zIndex: Z_INDEX.DROPDOWN }}>
            <img
              src={character.avatar_url}
              alt=""
              className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 group-hover:scale-110 group-hover:border-infinite-purple group-hover:shadow-infinite-purple/70"
            />
          </div>
        )}
      </div>
      <CardContent className="p-4 pt-10 bg-white dark:bg-background">
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-lg text-foreground">{character.name}</h3>
            <p className="text-sm text-muted-foreground">
              Level {character.level} {character.race} {character.class}
            </p>
          </div>

          {stats && (
            <>
              {/* HP and AC */}
              <div className="flex gap-4 text-sm bg-gray-100 dark:bg-muted p-2 rounded-md border border-gray-200 dark:border-border" aria-label="Quick stats">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-foreground">HP:</span>
                  <span className="text-foreground">{stats.max_hit_points || '\u2014'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-foreground">AC:</span>
                  <span className="text-foreground">{stats.armor_class || '\u2014'}</span>
                </div>
              </div>

              {/* Ability Scores Grid */}
              <div className="grid grid-cols-3 gap-2 text-xs" role="group" aria-label="Ability modifiers">
                <div
                  className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm"
                  aria-label={`Strength modifier: ${getModifier(stats.strength)}`}
                >
                  <span className="font-semibold text-muted-foreground" aria-hidden="true">STR</span>
                  <span className="text-lg font-bold text-foreground" aria-hidden="true">
                    {getModifier(stats.strength)}
                  </span>
                </div>
                <div
                  className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm"
                  aria-label={`Dexterity modifier: ${getModifier(stats.dexterity)}`}
                >
                  <span className="font-semibold text-muted-foreground" aria-hidden="true">DEX</span>
                  <span className="text-lg font-bold text-foreground" aria-hidden="true">
                    {getModifier(stats.dexterity)}
                  </span>
                </div>
                <div
                  className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm"
                  aria-label={`Constitution modifier: ${getModifier(stats.constitution)}`}
                >
                  <span className="font-semibold text-muted-foreground" aria-hidden="true">CON</span>
                  <span className="text-lg font-bold text-foreground" aria-hidden="true">
                    {getModifier(stats.constitution)}
                  </span>
                </div>
                <div
                  className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm"
                  aria-label={`Intelligence modifier: ${getModifier(stats.intelligence)}`}
                >
                  <span className="font-semibold text-muted-foreground" aria-hidden="true">INT</span>
                  <span className="text-lg font-bold text-foreground" aria-hidden="true">
                    {getModifier(stats.intelligence)}
                  </span>
                </div>
                <div
                  className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm"
                  aria-label={`Wisdom modifier: ${getModifier(stats.wisdom)}`}
                >
                  <span className="font-semibold text-muted-foreground" aria-hidden="true">WIS</span>
                  <span className="text-lg font-bold text-foreground" aria-hidden="true">
                    {getModifier(stats.wisdom)}
                  </span>
                </div>
                <div
                  className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm"
                  aria-label={`Charisma modifier: ${getModifier(stats.charisma)}`}
                >
                  <span className="font-semibold text-muted-foreground" aria-hidden="true">CHA</span>
                  <span className="text-lg font-bold text-foreground" aria-hidden="true">
                    {getModifier(stats.charisma)}
                  </span>
                </div>
              </div>
            </>
          )}

          <Button className="w-full" tabIndex={-1} aria-hidden="true">
            <Play className="h-4 w-4 mr-2" />
            Start Adventure
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
