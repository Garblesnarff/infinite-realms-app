import { Dice1, TrendingUp } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface HitPointsMethodCardProps {
  method: 'roll' | 'average';
  hitDie: number;
  averagePerLevel: number;
  onMethodChange: (method: 'roll' | 'average') => void;
}

export const HitPointsMethodCard: React.FC<HitPointsMethodCardProps> = ({
  method,
  hitDie,
  averagePerLevel,
  onMethodChange,
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Hit Point Method</CardTitle>
      <p className="text-sm text-muted-foreground">
        Choose how to determine hit points for levels beyond 1st
      </p>
    </CardHeader>
    <CardContent>
      <RadioGroup value={method} onValueChange={onMethodChange}>
        <div className="space-y-3">
          <div className="flex items-center space-x-2 p-3 border rounded">
            <RadioGroupItem value="average" id="average" />
            <div className="flex-1">
              <Label htmlFor="average" className="flex items-center gap-2 cursor-pointer">
                <TrendingUp className="w-4 h-4" />
                <div>
                  <div className="font-medium">Take Average</div>
                  <div className="text-sm text-muted-foreground">
                    Reliable: {averagePerLevel} + Con modifier per level
                  </div>
                </div>
              </Label>
            </div>
            <Badge variant="secondary">Consistent</Badge>
          </div>

          <div className="flex items-center space-x-2 p-3 border rounded">
            <RadioGroupItem value="roll" id="roll" />
            <div className="flex-1">
              <Label htmlFor="roll" className="flex items-center gap-2 cursor-pointer">
                <Dice1 className="w-4 h-4" />
                <div>
                  <div className="font-medium">Roll Hit Dice</div>
                  <div className="text-sm text-muted-foreground">
                    Risky: Roll d{hitDie} + Con modifier per level
                  </div>
                </div>
              </Label>
            </div>
            <Badge variant="outline">Variable</Badge>
          </div>
        </div>
      </RadioGroup>
    </CardContent>
  </Card>
);
