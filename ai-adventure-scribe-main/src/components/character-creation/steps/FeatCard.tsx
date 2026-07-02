import { Sword, Sparkles, Users, Lightbulb, Award } from 'lucide-react';
import React from 'react';

import type { Feat } from '@/data/featOptions';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function getCategoryIcon(category: string): React.ReactNode {
  switch (category) {
    case 'combat':
      return <Sword className="w-4 h-4" />;
    case 'magic':
      return <Sparkles className="w-4 h-4" />;
    case 'social':
      return <Users className="w-4 h-4" />;
    case 'utility':
      return <Lightbulb className="w-4 h-4" />;
    default:
      return <Award className="w-4 h-4" />;
  }
}

interface FeatCardProps {
  feat: Feat;
  isSelected: boolean;
  onSelect: (featId: string) => void;
}

export const FeatCard: React.FC<FeatCardProps> = ({ feat, isSelected, onSelect }) => (
  <Card
    className={`cursor-pointer transition-all hover:shadow-md border-2 ${
      isSelected ? 'border-primary bg-primary/5' : 'border-muted'
    }`}
    onClick={() => onSelect(feat.id)}
  >
    <CardHeader className="pb-2">
      <CardTitle className="flex items-center gap-2 text-lg">
        {getCategoryIcon(feat.category)}
        {feat.name}
      </CardTitle>
      <div className="flex gap-1">
        <Badge variant="outline" className="text-xs">
          {feat.category}
        </Badge>
        {feat.abilityScoreIncrease && (
          <Badge variant="secondary" className="text-xs">
            +1 Ability Score
          </Badge>
        )}
      </div>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground mb-2">{feat.description}</p>
      {feat.prerequisites && (
        <p className="text-xs text-orange-600 mb-2">
          <strong>Prerequisites:</strong> {feat.prerequisites}
        </p>
      )}
      <div className="space-y-1">
        {feat.benefits.map((benefit, index) => (
          <p key={index} className="text-xs text-muted-foreground">
            • {benefit}
          </p>
        ))}
      </div>
    </CardContent>
  </Card>
);
