import { Zap } from 'lucide-react';
import React, { useId } from 'react';

import type { QuotaStatus } from '@/hooks/use-account-billing';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface AccountUsageCardProps {
  quota: QuotaStatus;
}

export const AccountUsageCard: React.FC<AccountUsageCardProps> = ({ quota }) => {
  const quotaLabelId = useId();

  return (
    <Card className="mb-8 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Today's Usage
        </CardTitle>
        <CardDescription>Your AI message quota resets once a day</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span id={quotaLabelId}>AI Messages</span>
              <span>
                {/* No plan is unlimited; when the limit is unknown (-1), show
                    the usage count alone rather than a made-up word (#2343 C6). */}
                {quota.limit === -1 ? `${quota.used}` : `${quota.used} / ${quota.limit}`}
              </span>
            </div>
            {quota.limit !== -1 ? (
              <Progress
                value={Math.min((quota.used / quota.limit) * 100, 100)}
                className="h-2"
                indicatorClassName="bg-gradient-to-r from-infinite-purple to-infinite-gold"
                aria-labelledby={quotaLabelId}
              />
            ) : (
              <Progress
                value={100}
                className="h-2"
                indicatorClassName="bg-gradient-to-r from-infinite-gold to-infinite-purple"
                aria-labelledby={quotaLabelId}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Resets at: {new Date(quota.resetAt).toLocaleString()}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
