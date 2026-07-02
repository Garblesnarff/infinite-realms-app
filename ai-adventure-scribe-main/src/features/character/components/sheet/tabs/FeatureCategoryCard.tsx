import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface FeatureCategoryItem {
  name: string;
  description: string;
  level?: number;
  uses?: {
    total: number;
    used: number;
    recharge: 'short' | 'long' | 'dawn' | 'manual';
  };
}

interface FeatureCategoryCardProps {
  title: string;
  icon: React.ReactNode;
  borderColorClass: string;
  badgeColorClass: string;
  features: FeatureCategoryItem[];
  badgeLabel: (feature: FeatureCategoryItem) => React.ReactNode;
  showUsage?: boolean;
}

function rechargeLabel(recharge: 'short' | 'long' | 'dawn' | 'manual'): string {
  switch (recharge) {
    case 'short':
      return 'Short Rest';
    case 'long':
      return 'Long Rest';
    case 'dawn':
      return 'Dawn';
    default:
      return 'Manual';
  }
}

export const FeatureCategoryCard: React.FC<FeatureCategoryCardProps> = ({
  title,
  icon,
  borderColorClass,
  badgeColorClass,
  features,
  badgeLabel,
  showUsage = false,
}) => {
  if (features.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {features.map((feature, index) => (
          <div key={index} className={`border-l-4 ${borderColorClass} pl-4`}>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">{feature.name}</h4>
              <Badge variant="secondary" className={badgeColorClass}>
                {badgeLabel(feature)}
              </Badge>
              {showUsage && feature.uses && (
                <Badge
                  variant={feature.uses.used >= feature.uses.total ? 'destructive' : 'outline'}
                  className="ml-auto"
                >
                  {feature.uses.total - feature.uses.used} / {feature.uses.total}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
            {showUsage && feature.uses && (
              <div className="text-xs text-muted-foreground mt-1">
                Recharge: {rechargeLabel(feature.uses.recharge)}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
