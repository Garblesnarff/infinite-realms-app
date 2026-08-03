import { Sword, Sparkles, Crown } from 'lucide-react';
import React, { useId } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { type ClassFeature } from '@/types/character';

interface ClassFeatureChoiceCardProps {
  feature: ClassFeature;
  selectedValue: string;
  onValueChange: (value: string) => void;
}

function getFeatureIcon(featureId: string) {
  switch (featureId) {
    case 'fighting-style':
      return <Sword className="w-5 h-5 text-red-500" />;
    case 'divine-domain':
      return <Crown className="w-5 h-5 text-yellow-500" />;
    default:
      return <Sparkles className="w-5 h-5 text-purple-500" />;
  }
}

export const ClassFeatureChoiceCard: React.FC<ClassFeatureChoiceCardProps> = ({
  feature,
  selectedValue,
  onValueChange,
}) => {
  const titleId = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2">
          {getFeatureIcon(feature.id)}
          {feature.name}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{feature.description}</p>
        {feature.choices?.description && (
          <p className="text-sm text-blue-600">{feature.choices.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <RadioGroup value={selectedValue} onValueChange={onValueChange} aria-labelledby={titleId}>
          <div className="grid gap-3">
            {feature.choices?.options.map((option, index) => {
              const [optionName, ...descriptionParts] = option.split(': ');
              const optionDescription = descriptionParts.join(': ');

              return (
                <div
                  key={index}
                  className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <RadioGroupItem value={option} id={`${feature.id}-${index}`} className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor={`${feature.id}-${index}`} className="cursor-pointer block">
                      <div className="font-medium">{optionName}</div>
                      {optionDescription && (
                        <div className="text-sm text-muted-foreground mt-1">
                          {optionDescription}
                        </div>
                      )}
                    </Label>
                  </div>
                </div>
              );
            })}
          </div>
        </RadioGroup>
      </CardContent>
    </Card>
  );
};
