import { Package, Weight, Minus } from 'lucide-react';
import React from 'react';

import type { Equipment } from '@/data/equipmentOptions';
import type { InventoryItem } from '@/features/character/hooks/use-inventory-manager';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

interface InventoryTabContentProps {
  inventory: InventoryItem[];
  showShop: boolean;
  setShowShop: (show: boolean) => void;
  toggleEquipped: (id: string) => void;
  sellItem: (item: InventoryItem) => void;
  removeFromInventory: (id: string) => void;
  getItemIcon: (category: Equipment['category'] | 'custom') => React.ReactNode;
}

export const InventoryTabContent: React.FC<InventoryTabContentProps> = ({
  inventory,
  showShop,
  setShowShop,
  toggleEquipped,
  sellItem,
  removeFromInventory,
  getItemIcon,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="w-5 h-5 text-green-500" />
          Inventory ({inventory.length} items)
          {showShop && <span className="text-xs ml-2 text-muted-foreground">(Shop Active)</span>}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowShop(!showShop)}
          className="w-fit"
        >
          {showShop ? 'Hide Shop' : 'Show Shop'}
        </Button>
      </CardHeader>
      <CardContent>
        {inventory.length > 0 ? (
          <div className="space-y-3">
            {inventory.map((item) => (
              <div
                key={`${item.id}-${item.quantity}`}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    {getItemIcon(item.category as Equipment['category'] | 'custom')}
                    <Checkbox
                      checked={item.equipped}
                      onCheckedChange={() => toggleEquipped(item.id)}
                      disabled={item.category === 'consumable'}
                      aria-label={item.equipped ? `Unequip ${item.name}` : `Equip ${item.name}`}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${item.equipped ? 'text-primary' : ''}`}>
                        {item.name}
                      </span>
                      {item.equipped && (
                        <Badge variant="default" className="text-xs">
                          Equipped
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {item.category === 'trinket' || (item.category as string) === 'custom'
                          ? 'Trinket'
                          : item.category}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">{item.description}</div>
                    {item.weight && (
                      <div className="text-xs text-muted-foreground">
                        <Weight className="w-3 h-3 inline mr-1" />
                        {item.weight * item.quantity} lbs
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{item.quantity}x</Badge>
                  <Button variant="outline" size="sm" onClick={() => sellItem(item)}>
                    Sell
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeFromInventory(item.id)}
                    aria-label="Remove from inventory"
                    title="Remove from inventory"
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">Empty Inventory</h3>
            <p className="text-sm">Add items from the Equipment Shop tab.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
