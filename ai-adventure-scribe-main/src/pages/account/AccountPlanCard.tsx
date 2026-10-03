import { Crown, CreditCard, Shield, Zap, Sparkles } from 'lucide-react';
import React from 'react';

import type { SubscriptionStatus } from '@/hooks/use-account-billing';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface AccountPlanCardProps {
  isPro: boolean;
  isTester?: boolean;
  subscription: SubscriptionStatus | null;
  loading: boolean;
  upgradePriceLabel: string;
  onUpgrade: () => void;
  onManageSubscription: () => void;
}

export const AccountPlanCard: React.FC<AccountPlanCardProps> = ({
  isPro,
  isTester = false,
  subscription,
  loading,
  upgradePriceLabel,
  onUpgrade,
  onManageSubscription,
}) => (
  <Card className="mb-8 shadow-lg border-2 border-infinite-purple/20">
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="text-2xl flex items-center gap-2">
            {isTester ? (
              <>
                <Crown className="h-6 w-6 text-amber-500" />
                Tester
              </>
            ) : isPro ? (
              <>
                <Crown className="h-6 w-6 text-amber-500" />
                Legend Tier
              </>
            ) : (
              <>
                <Shield className="h-6 w-6 text-muted-foreground" />
                Free Tier
              </>
            )}
          </CardTitle>
          <CardDescription>
            {isTester
              ? 'Playtest account with raised daily limits'
              : isPro
                ? 'You have full access to all features'
                : 'Upgrade for higher daily limits and premium voices'}
          </CardDescription>
        </div>
        {isPro && !isTester && subscription?.status && (
          <span className="px-3 py-1 text-sm rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium">
            {subscription.status === 'active' ? 'Active' : subscription.status}
          </span>
        )}
      </div>
    </CardHeader>
    <CardContent>
      {isTester ? (
        <p className="text-muted-foreground">
          This account is billed internally. There is no subscription to manage.
        </p>
      ) : !isPro ? (
        <div className="space-y-6">
          {/* Benefits List */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-infinite-gold/10 border border-infinite-gold/30">
              <Zap className="h-5 w-5 text-infinite-gold mt-0.5" />
              <div>
                <h4 className="font-medium text-infinite-gold">Legend: More AI Messages</h4>
                <p className="text-sm text-muted-foreground">
                  More DM messages every day on Legend
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-infinite-purple/10 border border-infinite-purple/30">
              <Sparkles className="h-5 w-5 text-infinite-purple mt-0.5" />
              <div>
                <h4 className="font-medium text-infinite-purple">More AI Images</h4>
                <p className="text-sm text-muted-foreground">Bring your world to life visually</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-infinite-teal/10 border border-infinite-teal/30">
              <Crown className="h-5 w-5 text-infinite-teal mt-0.5" />
              <div>
                <h4 className="font-medium text-infinite-teal">Priority Support</h4>
                <p className="text-sm text-muted-foreground">Get help when you need it</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <Shield className="h-5 w-5 text-emerald-400 mt-0.5" />
              <div>
                <h4 className="font-medium text-emerald-400">Early Access</h4>
                <p className="text-sm text-muted-foreground">Be first to try new features</p>
              </div>
            </div>
          </div>

          {/* Upgrade Button */}
          <div className="flex flex-col items-center pt-4">
            <Button
              onClick={onUpgrade}
              disabled={loading}
              className="px-8 py-6 text-lg font-bold bg-infinite-gold hover:bg-infinite-purple text-infinite-dark shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all"
            >
              <Crown className="h-5 w-5 mr-2" />
              {loading ? 'Loading...' : `Upgrade to Legend - ${upgradePriceLabel}`}
            </Button>
            <p className="text-sm text-muted-foreground mt-2">Cancel anytime. No commitments.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Thank you for being a Legend! You have full access to all features.
          </p>
          <Button
            onClick={onManageSubscription}
            disabled={loading}
            variant="outline"
            className="flex items-center gap-2"
          >
            <CreditCard className="h-4 w-4" />
            {loading ? 'Loading...' : 'Manage Subscription'}
          </Button>
        </div>
      )}
    </CardContent>
  </Card>
);
