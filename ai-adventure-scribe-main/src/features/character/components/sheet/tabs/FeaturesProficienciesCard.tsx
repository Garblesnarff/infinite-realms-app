import React from 'react';

import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface FeaturesProficienciesCardProps {
  character: Character;
}

/**
 * Proficiencies card rendering the character's actual proficiencies (#214).
 * Armor and weapons come from the character's class; languages and tools from
 * the stored character record. Empty sections render "None", never placeholders.
 */
export const FeaturesProficienciesCard: React.FC<FeaturesProficienciesCardProps> = ({
  character,
}) => {
  const armor = character.class?.armorProficiencies ?? [];
  const weapons = character.class?.weaponProficiencies ?? [];
  const languages = character.languages ?? [];
  const tools = character.toolProficiencies ?? [];

  const renderBadges = (items: string[]) =>
    items.length > 0 ? (
      items.map((item) => (
        <Badge key={item} variant="outline">
          {item}
        </Badge>
      ))
    ) : (
      <span className="text-sm text-muted-foreground">None</span>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proficiencies</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium mb-2">Armor</h4>
            <div className="flex flex-wrap gap-1">{renderBadges(armor)}</div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Weapons</h4>
            <div className="flex flex-wrap gap-1">{renderBadges(weapons)}</div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Languages</h4>
            <div className="flex flex-wrap gap-1">{renderBadges(languages)}</div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Tools</h4>
            <div className="flex flex-wrap gap-1">{renderBadges(tools)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
