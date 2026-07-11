import { ShoppingCart, Search, Plus } from 'lucide-react';
import React from 'react';

import type { Equipment } from '@/data/equipmentOptions';
import { currencyToCopper, type Currency } from '@/features/character/hooks/use-inventory-manager';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, convertCurrency } from '@/data/equipmentOptions';

interface EquipmentShopProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  categories: { value: string; label: string }[];
  filteredEquipment: Equipment[];
  currency: Currency;
  purchaseItem: (equipment: Equipment) => void;
  addToInventory: (equipment: Equipment) => void;
  getItemIcon: (category: Equipment['category'] | 'custom') => React.ReactNode;
}

export const EquipmentShop: React.FC<EquipmentShopProps> = ({
  searchTerm,
  setSearchTerm,
  selectedCategory,
  setSelectedCategory,
  categories,
  filteredEquipment,
  currency,
  purchaseItem,
  addToInventory,
  getItemIcon,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-purple-500" />
          Equipment Shop
        </CardTitle>

        {/* Search and Filter */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search equipment..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger
              className="w-48"
              aria-label="Filter by category"
              title="Filter by category"
            >
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.value} value={category.value}>
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
          {filteredEquipment.map((equipment) => (
            <div
              key={equipment.id}
              className="p-4 border rounded-lg hover:border-primary transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getItemIcon(equipment.category)}
                  <div>
                    <h4 className="font-medium">{equipment.name}</h4>
                    <div className="flex gap-1 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {equipment.category === 'trinket' ? 'Trinket' : equipment.category}
                      </Badge>
                      {equipment.weaponType && (
                        <Badge variant="secondary" className="text-xs capitalize">
                          {equipment.weaponType}
                        </Badge>
                      )}
                      {equipment.armorType && (
                        <Badge variant="secondary" className="text-xs capitalize">
                          {equipment.armorType} armor
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-green-600">{formatCurrency(equipment.cost)}</div>
                  {equipment.weight && (
                    <div className="text-xs text-muted-foreground">{equipment.weight} lbs</div>
                  )}
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-3">{equipment.description}</p>

              {/* Equipment Stats */}
              {equipment.damage && (
                <div className="text-xs mb-2">
                  <span className="font-medium">Damage:</span> {equipment.damage.dice}{' '}
                  {equipment.damage.type}
                </div>
              )}
              {equipment.armorClass && (
                <div className="text-xs mb-2">
                  <span className="font-medium">AC:</span> {equipment.armorClass.base}
                  {equipment.armorClass.dexModifier && ' + Dex'}
                  {equipment.armorClass.maxDexModifier !== undefined &&
                    ` (max ${equipment.armorClass.maxDexModifier})`}
                </div>
              )}
              {equipment.properties && equipment.properties.length > 0 && (
                <div className="text-xs mb-3">
                  <span className="font-medium">Properties:</span> {equipment.properties.join(', ')}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={() => purchaseItem(equipment)}
                  className="flex-1"
                  size="sm"
                  disabled={
                    currencyToCopper(currency) <
                    convertCurrency(equipment.cost.amount, equipment.cost.currency, 'cp')
                  }
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Purchase
                </Button>
                <Button onClick={() => addToInventory(equipment)} variant="secondary" size="sm">
                  Add Free
                </Button>
              </div>
            </div>
          ))}
        </div>

        {filteredEquipment.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No Equipment Found</h3>
            <p className="text-sm">Try adjusting your search or filter criteria.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
