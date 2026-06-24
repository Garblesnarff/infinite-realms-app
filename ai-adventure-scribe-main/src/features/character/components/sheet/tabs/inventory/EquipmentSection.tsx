import { Sword, Shield, Star, Package, Info, Loader2 } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface EquipmentSectionProps {
  character: Character;
  isAttuning: boolean;
  toggleEquipped: (itemId: string) => void;
  handleAttuneToggle: (itemId: string) => Promise<void>;
}

/**
 * Displays the list of character equipment
 */
export const EquipmentSection: React.FC<EquipmentSectionProps> = ({
  character,
  isAttuning,
  toggleEquipped,
  handleAttuneToggle,
}) => {
  const getItemIcon = (type: string) => {
    switch (type) {
      case 'weapon':
        return <Sword className="w-4 h-4" />;
      case 'armor':
        return <Shield className="w-4 h-4" />;
      case 'magic':
        return <Star className="w-4 h-4 text-purple-500" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {character.inventory && character.inventory.length > 0 ? (
            character.inventory.map((item) => {
              const attunementStatus = {
                canAttune: !item.isAttuned && item.requiresAttunement,
                isAttuned: item.isAttuned || false,
              };

              return (
                <div
                  key={item.itemId}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3 flex-1">
                    {getItemIcon(item.isMagic ? 'magic' : 'default')}

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.itemId}</span>
                        {item.equipped && (
                          <Badge variant="secondary" className="text-xs">
                            Equipped
                          </Badge>
                        )}
                        {item.isAttuned && (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-purple-100 text-purple-800"
                          >
                            Attuned
                          </Badge>
                        )}
                        {item.isMagic && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-purple-50 text-purple-700 border-purple-300"
                          >
                            Magic
                          </Badge>
                        )}
                        {item.magicItemRarity && item.magicItemRarity !== 'common' && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {item.magicItemRarity.replace('_', ' ')}
                          </Badge>
                        )}
                      </div>

                      <div className="text-sm text-muted-foreground">
                        Qty: {item.quantity || 1}
                      </div>

                      {item.isMagic && (
                        <div className="mt-2 text-xs">
                          {item.magicBonus !== 0 && (
                            <div className="text-purple-600 font-medium">
                              Bonus: +{item.magicBonus}
                            </div>
                          )}
                          {item.magicProperties && item.magicProperties.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.magicProperties.map((prop, i) => (
                                <Badge
                                  key={i}
                                  variant="outline"
                                  className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                                >
                                  {prop}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {item.attunementRequirements && (
                            <div className="flex items-center gap-1 mt-1 text-muted-foreground">
                              <Info className="w-3 h-3" />
                              <span>Requires attunement: {item.attunementRequirements}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant={item.equipped ? 'default' : 'outline'}
                        onClick={() => toggleEquipped(item.itemId)}
                        aria-pressed={item.equipped}
                        title={item.equipped ? 'Unequip item' : 'Equip item'}
                      >
                        {item.equipped ? 'Unequip' : 'Equip'}
                      </Button>

                      {item.isMagic && item.requiresAttunement && (
                        <Button
                          size="sm"
                          variant={item.isAttuned ? 'secondary' : 'outline'}
                          onClick={() => handleAttuneToggle(item.itemId)}
                          className="text-xs"
                          disabled={isAttuning || !item.equipped || (!item.isAttuned && !attunementStatus.canAttune)}
                          aria-pressed={item.isAttuned}
                          title={
                            !item.equipped
                              ? 'Must be equipped to attune'
                              : item.isAttuned
                                ? 'Remove attunement'
                                : attunementStatus.canAttune
                                  ? 'Attune to item'
                                  : 'Attunement slots full'
                          }
                        >
                          {isAttuning ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : null}
                          {item.isAttuned ? 'Unattune' : 'Attune'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-muted-foreground">No equipment found</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
