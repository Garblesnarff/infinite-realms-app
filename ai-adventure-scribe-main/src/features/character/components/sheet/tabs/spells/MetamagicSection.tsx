import { Star } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface MetamagicOption {
  id: string;
  name: string;
  description: string;
  sorceryPointCost: number;
}

interface MetamagicSectionProps {
  sorceryPoints: { current: number; maximum: number };
  longRest: () => void;
  availableMetamagic: MetamagicOption[];
  spendSorceryPoints: (points: number) => void;
}

const MetamagicSection: React.FC<MetamagicSectionProps> = ({
  sorceryPoints,
  longRest,
  availableMetamagic,
  spendSorceryPoints,
}) => {
  return (
    <div className="space-y-4">
      {/* Sorcery Points */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="w-5 h-5 text-infinite-gold" aria-hidden="true" />
            Sorcery Points
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Progress
                value={(sorceryPoints.current / sorceryPoints.maximum) * 100}
                className="w-full h-4"
                aria-label={`Sorcery Points: ${sorceryPoints.current} of ${sorceryPoints.maximum} remaining`}
              />
              <div className="text-sm text-muted-foreground mt-1">
                {sorceryPoints.current} / {sorceryPoints.maximum} points remaining
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  onClick={longRest}
                  aria-label="Recover all spell slots and sorcery points"
                >
                  Long Rest
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Recover all spell slots and sorcery points</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardContent>
      </Card>

      {/* Metamagic Options */}
      <Card>
        <CardHeader>
          <CardTitle>Available Metamagic</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {availableMetamagic.map((option) => (
              <div key={option.id} className="p-3 border rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium">{option.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {option.sorceryPointCost} SP
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{option.description}</p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => spendSorceryPoints(option.sorceryPointCost)}
                        disabled={sorceryPoints.current < option.sorceryPointCost}
                        aria-label={`Use ${option.name} metamagic`}
                      >
                        Use
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Use {option.name} metamagic</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MetamagicSection;
