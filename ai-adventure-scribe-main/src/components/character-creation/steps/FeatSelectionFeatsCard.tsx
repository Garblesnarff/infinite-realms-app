import React from 'react';

import { FeatCard } from './FeatCard';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { feats, getFeatsByCategory } from '@/data/featOptions';

interface FeatSelectionFeatsCardProps {
  selectedFeat: string;
  onSelectFeat: (featId: string) => void;
}

const CATEGORIES = ['combat', 'magic', 'utility', 'social'] as const;

export const FeatSelectionFeatsCard: React.FC<FeatSelectionFeatsCardProps> = ({
  selectedFeat,
  onSelectFeat,
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Choose a Feat</CardTitle>
      <p className="text-sm text-muted-foreground">
        Select a feat to gain unique abilities and benefits.
      </p>
    </CardHeader>
    <CardContent>
      <Tabs defaultValue="all">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="combat">Combat</TabsTrigger>
          <TabsTrigger value="magic">Magic</TabsTrigger>
          <TabsTrigger value="utility">Utility</TabsTrigger>
          <TabsTrigger value="social">Social</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
            {feats.map((feat) => (
              <FeatCard
                key={feat.id}
                feat={feat}
                isSelected={selectedFeat === feat.id}
                onSelect={onSelectFeat}
              />
            ))}
          </div>
        </TabsContent>

        {CATEGORIES.map((category) => (
          <TabsContent key={category} value={category} className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
              {getFeatsByCategory(category).map((feat) => (
                <FeatCard
                  key={feat.id}
                  feat={feat}
                  isSelected={selectedFeat === feat.id}
                  onSelect={onSelectFeat}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </CardContent>
  </Card>
);
