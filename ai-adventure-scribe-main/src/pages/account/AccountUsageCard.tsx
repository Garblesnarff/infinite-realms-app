import { Zap } from 'lucide-react';
import React, { useId } from 'react';

import type { QuotaEntry, QuotaStatus } from '@/hooks/use-account-billing';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface AccountUsageCardProps {
  quota: QuotaStatus;
}

const QuotaRow: React.FC<{ label: string; entry: QuotaEntry; unit?: string }> = ({
  label,
  entry,
  unit,
}) => {
  const labelId = useId();
  const suffix = unit ? ` ${unit}` : '';

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span id={labelId}>{label}</span>
        <span>
          {/* No plan is unlimited; when the limit is unknown (-1), show
              the usage count alone rather than a made-up word (#2343 C6). */}
          {entry.limit === -1
            ? `${entry.used}${suffix}`
            : `${entry.used} / ${entry.limit}${suffix} — ${entry.remaining} remaining`}
        </span>
      </div>
      {entry.limit !== -1 ? (
        <Progress
          value={entry.limit > 0 ? Math.min((entry.used / entry.limit) * 100, 100) : 100}
          className="h-2"
          indicatorClassName="bg-gradient-to-r from-infinite-purple to-infinite-gold"
          aria-labelledby={labelId}
        />
      ) : (
        <Progress
          value={100}
          className="h-2"
          indicatorClassName="bg-gradient-to-r from-infinite-gold to-infinite-purple"
          aria-labelledby={labelId}
        />
      )}
    </div>
  );
};

export const AccountUsageCard: React.FC<AccountUsageCardProps> = ({ quota }) => (
  <Card className="mb-8 shadow-lg">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Zap className="h-5 w-5" />
        Today's Usage
      </CardTitle>
      <CardDescription>Your AI quotas reset once a day</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        <QuotaRow label="AI Messages" entry={quota.quotas.llm} />
        <QuotaRow label="AI Images" entry={quota.quotas.image} />
        {quota.quotas.voice.limit === 0 ? (
          // No premium voice on this plan; a character count would read as
          // a broken quota, so say what unlocks it instead (#2510).
          <p className="text-sm">Premium voice: Legend only</p>
        ) : (
          <QuotaRow label="Premium Voice" entry={quota.quotas.voice} unit="characters" />
        )}
        <p className="text-xs text-muted-foreground">
          Resets at: {new Date(quota.resetAt).toLocaleString()}
        </p>
      </div>
    </CardContent>
  </Card>
);
