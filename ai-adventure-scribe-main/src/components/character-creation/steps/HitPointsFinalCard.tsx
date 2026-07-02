import { Heart } from 'lucide-react';
import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface HitPointsFinalCardProps {
  maxHPPreview: number;
  level: number;
  hitDie: number;
}

export const HitPointsFinalCard: React.FC<HitPointsFinalCardProps> = ({
  maxHPPreview,
  level,
  hitDie,
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Heart className="w-5 h-5 text-red-500" />
        Final Hit Points
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-center">
        <div className="text-4xl font-bold text-red-600 mb-2">{maxHPPreview}</div>
        <div className="text-sm text-muted-foreground">Maximum Hit Points</div>
        <div className="text-xs text-muted-foreground mt-1">
          Hit Dice: {level}d{hitDie}
        </div>
      </div>
    </CardContent>
  </Card>
);
