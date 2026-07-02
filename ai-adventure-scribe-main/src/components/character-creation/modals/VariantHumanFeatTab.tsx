import { CheckCircle2, Circle } from 'lucide-react';
import React from 'react';

import { FEAT_OPTIONS, FEAT_CATEGORIES } from './variant-human-options';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';

interface VariantHumanFeatTabProps {
  selectedFeat: string | null;
  featCategory: string;
  onFeatCategoryChange: (category: string) => void;
  onSelectFeat: (featId: string) => void;
}

export const VariantHumanFeatTab: React.FC<VariantHumanFeatTabProps> = ({
  selectedFeat,
  featCategory,
  onFeatCategoryChange,
  onSelectFeat,
}) => {
  const filteredFeats =
    featCategory === 'all'
      ? FEAT_OPTIONS
      : FEAT_OPTIONS.filter((feat) => feat.category === featCategory);

  return (
    <TabsContent value="feat" className="space-y-4 mt-4">
      {/* Feat Category Filters */}
      <div className="flex flex-wrap gap-2">
        {FEAT_CATEGORIES.map((category) => (
          <Button
            key={category.id}
            variant={featCategory === category.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => onFeatCategoryChange(category.id)}
          >
            {category.label}
          </Button>
        ))}
      </div>

      {/* Feat Selection Grid */}
      <div className="grid grid-cols-1 gap-3">
        {filteredFeats.map((feat) => {
          const selected = selectedFeat === feat.id;

          return (
            <Card
              key={feat.id}
              className={`p-4 cursor-pointer transition-all duration-200 ${
                selected
                  ? 'border-purple-500 bg-purple-50'
                  : 'hover:border-purple-300 hover:bg-purple-50/50'
              }`}
              onClick={() => onSelectFeat(feat.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    {selected ? (
                      <CheckCircle2 className="w-5 h-5 text-purple-600" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-400" />
                    )}
                    <h4 className="font-semibold">{feat.name}</h4>
                    <Badge variant="outline" className="text-xs capitalize">
                      {feat.category}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground ml-7">{feat.description}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Feat Selection Status */}
      <div className="text-center text-sm text-muted-foreground">
        {!selectedFeat && 'Select one feat to gain at 1st level'}
        {selectedFeat && (
          <span className="text-green-600 font-medium">
            ✓ {FEAT_OPTIONS.find((f) => f.id === selectedFeat)?.name} selected
          </span>
        )}
      </div>
    </TabsContent>
  );
};
