import React from 'react';

import type { SubscriptionStatus } from '@/hooks/use-account-billing';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { APP_BUILD_SHORT, APP_RELEASE_VERSION } from '@/services/app-version';

interface AccountInfoCardProps {
  email: string | undefined;
  userPlan: string | null | undefined;
  subscription: SubscriptionStatus | null;
}

export const AccountInfoCard: React.FC<AccountInfoCardProps> = ({
  email,
  userPlan,
  subscription,
}) => (
  <Card className="shadow-lg">
    <CardHeader>
      <CardTitle>Account Information</CardTitle>
    </CardHeader>
    <CardContent>
      <dl className="space-y-4">
        <div className="flex justify-between py-2 border-b border-border">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-medium">{email}</dd>
        </div>
        <div className="flex justify-between py-2 border-b border-border">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="font-medium capitalize">{userPlan || 'Free'}</dd>
        </div>
        {subscription?.subscriptionId && (
          <div className="flex justify-between py-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium capitalize">{subscription.status}</dd>
          </div>
        )}
      </dl>
      {/* Compare with https://api.infiniterealms.app/version before a playtest (#2293). */}
      <p className="mt-4 text-xs text-muted-foreground" data-testid="app-build">
        {APP_RELEASE_VERSION} · build {APP_BUILD_SHORT}
      </p>
    </CardContent>
  </Card>
);
