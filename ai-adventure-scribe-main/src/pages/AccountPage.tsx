import { Settings } from 'lucide-react';
import React from 'react';

import { AccountInfoCard } from './account/AccountInfoCard';
import { AccountPlanCard } from './account/AccountPlanCard';
import { AccountUsageCard } from './account/AccountUsageCard';
import { planHasPaidFeatures } from '../../shared/plan-features';

import { SendFeedbackButton } from '@/components/feedback/SendFeedbackButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useAuth } from '@/contexts/AuthContext';
import { ACCOUNT_UPGRADE_PRICE, useAccountBilling } from '@/hooks/use-account-billing';

/**
 * Account page for subscription management
 *
 * #351: the plan card never shows "Free Tier" for an unknown plan. While the
 * plan is loading (or the fetch failed and no plan was ever learned) a
 * neutral state renders instead — no plan label at all.
 */
const AccountPage: React.FC = () => {
  const { user, userPlan, userPlanError, refreshUserPlan } = useAuth();
  const { subscription, quota, loading, handleUpgrade, handleManageSubscription } =
    useAccountBilling(userPlan, refreshUserPlan);

  const isPro = planHasPaidFeatures(userPlan);
  const isTester = userPlan === 'tester';
  const planUnknown = userPlan === null;

  return (
    <div className="min-h-screen bg-[image:var(--gradient-cosmic)]">
      {/* Header */}
      <div className="bg-gradient-to-br from-infinite-dark/70 via-infinite-purple/20 to-infinite-dark/70 py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Settings className="h-8 w-8" />
            Account Settings
          </h1>
          <p className="text-white/80 mt-2">Manage your subscription and account preferences</p>
        </div>
      </div>

      <div
        className="max-w-4xl mx-auto px-4 py-8 -mt-6 relative"
        style={{ zIndex: Z_INDEX.DROPDOWN }}
      >
        {planUnknown ? (
          userPlanError ? (
            <Card
              className="mb-8 shadow-lg border-2 border-infinite-purple/20"
              data-testid="plan-unavailable"
            >
              <CardContent className="py-10 text-center space-y-4">
                <p className="text-muted-foreground">Plan unavailable — retry</p>
                <Button onClick={() => void refreshUserPlan()} variant="outline">
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card
              className="mb-8 shadow-lg border-2 border-infinite-purple/20"
              data-testid="plan-loading"
            >
              <CardContent className="py-10">
                <p className="text-center text-muted-foreground">Loading plan…</p>
              </CardContent>
            </Card>
          )
        ) : (
          <AccountPlanCard
            isPro={isPro}
            isTester={isTester}
            subscription={subscription}
            loading={loading}
            upgradePriceLabel={ACCOUNT_UPGRADE_PRICE.label}
            onUpgrade={handleUpgrade}
            onManageSubscription={handleManageSubscription}
          />
        )}

        {quota && <AccountUsageCard quota={quota} />}

        <AccountInfoCard email={user?.email} userPlan={userPlan} subscription={subscription} />

        <div className="mt-6 flex justify-end">
          <SendFeedbackButton />
        </div>
      </div>
    </div>
  );
};

export default AccountPage;
