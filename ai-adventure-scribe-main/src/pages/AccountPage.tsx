import { Settings } from 'lucide-react';
import React from 'react';

import { AccountInfoCard } from './account/AccountInfoCard';
import { AccountPlanCard } from './account/AccountPlanCard';
import { AccountUsageCard } from './account/AccountUsageCard';
import { planHasPaidFeatures } from '../../shared/plan-features';

import { Z_INDEX } from '@/constants/z-index';
import { useAuth } from '@/contexts/AuthContext';
import { ACCOUNT_UPGRADE_PRICE, useAccountBilling } from '@/hooks/use-account-billing';

/**
 * Account page for subscription management
 */
const AccountPage: React.FC = () => {
  const { user, userPlan, refreshUserPlan } = useAuth();
  const { subscription, quota, loading, handleUpgrade, handleManageSubscription } =
    useAccountBilling(userPlan, refreshUserPlan);

  const isPro = planHasPaidFeatures(userPlan);
  const isTester = userPlan === 'tester';

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
        <AccountPlanCard
          isPro={isPro}
          isTester={isTester}
          subscription={subscription}
          loading={loading}
          upgradePriceLabel={ACCOUNT_UPGRADE_PRICE.label}
          onUpgrade={handleUpgrade}
          onManageSubscription={handleManageSubscription}
        />

        {quota && <AccountUsageCard quota={quota} />}

        <AccountInfoCard email={user?.email} userPlan={userPlan} subscription={subscription} />
      </div>
    </div>
  );
};

export default AccountPage;
