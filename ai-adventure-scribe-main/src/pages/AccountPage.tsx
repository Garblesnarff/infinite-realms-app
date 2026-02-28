import { Crown, CreditCard, Settings, Zap, Shield, Sparkles } from 'lucide-react';
import React, { useState, useEffect, useId } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAuth, type UserPlan } from '@/contexts/AuthContext';

interface SubscriptionStatus {
  plan: string;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  status: string;
}

interface QuotaStatus {
  plan: UserPlan;
  type: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

const API_URL = (import.meta as any).env?.VITE_API_URL || '';

/**
 * Account page for subscription management
 */
const AccountPage: React.FC = () => {
  const PRICE = {
    label: '$15/month',
    priceId: 'price_1SjvhgAKOXZDug1mTxPZdKnK',
  } as const;

  const currentPrice = PRICE;
  const quotaLabelId = useId();
  const { user, userPlan, refreshUserPlan } = useAuth();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);

  // Check for success/cancel params from Stripe redirect
  useEffect(() => {
    const success = searchParams.get('success');
    const canceled = searchParams.get('canceled');

    if (success === 'true') {
      toast.success('Welcome to Legend tier! Your subscription is now active.');
      refreshUserPlan();
    } else if (canceled === 'true') {
      toast.info('Subscription checkout was canceled.');
    }
  }, [searchParams, refreshUserPlan]);

  // Fetch subscription status
  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const token = localStorage.getItem('workos_access_token');
        if (!token) return;

        const response = await fetch(`${API_URL}/v1/billing/subscription`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setSubscription(data);
        }
      } catch (error) {
        console.error('Failed to fetch subscription:', error);
      }
    };

    fetchSubscription();
  }, [userPlan]);

  // Fetch quota status
  useEffect(() => {
    const fetchQuota = async () => {
      try {
        const token = localStorage.getItem('workos_access_token');
        if (!token) return;

        const response = await fetch(`${API_URL}/v1/llm/quota`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setQuota(data);
        }
      } catch (error) {
        console.error('Failed to fetch quota:', error);
      }
    };

    fetchQuota();
  }, []);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('workos_access_token');
      if (!token) {
        toast.error('Please sign in to upgrade');
        return;
      }

      const response = await fetch(`${API_URL}/v1/billing/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          priceId: currentPrice.priceId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create checkout session');
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Upgrade error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to start upgrade');
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('workos_access_token');
      if (!token) {
        toast.error('Please sign in');
        return;
      }

      const response = await fetch(`${API_URL}/v1/billing/portal-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to open billing portal');
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Portal error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to open billing portal');
    } finally {
      setLoading(false);
    }
  };

  const isPro = userPlan === 'pro' || userPlan === 'enterprise';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-indigo-100">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 via-purple-900/40 to-indigo-900 py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Settings className="h-8 w-8" />
            Account Settings
          </h1>
          <p className="text-white/80 mt-2">Manage your subscription and account preferences</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 -mt-6 relative z-10">
        {/* Current Plan Card */}
        <Card className="mb-8 shadow-lg border-2 border-infinite-purple/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl flex items-center gap-2">
                  {isPro ? (
                    <>
                      <Crown className="h-6 w-6 text-amber-500" />
                      Legend Tier
                    </>
                  ) : (
                    <>
                      <Shield className="h-6 w-6 text-slate-500" />
                      Free Tier
                    </>
                  )}
                </CardTitle>
                <CardDescription>
                  {isPro
                    ? 'You have unlimited access to all features'
                    : 'Upgrade to unlock unlimited adventures'}
                </CardDescription>
              </div>
              {isPro && subscription?.status && (
                <span className="px-3 py-1 text-sm rounded-full bg-green-100 text-green-700 font-medium">
                  {subscription.status === 'active' ? 'Active' : subscription.status}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!isPro ? (
              <div className="space-y-6">
                {/* Benefits List */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
                    <Zap className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-amber-900">Unlimited AI Messages</h4>
                      <p className="text-sm text-amber-700">No daily limits on your adventures</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-purple-50 border border-purple-200">
                    <Sparkles className="h-5 w-5 text-purple-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-purple-900">Unlimited Image Generation</h4>
                      <p className="text-sm text-purple-700">Bring your world to life visually</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
                    <Crown className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-blue-900">Priority Support</h4>
                      <p className="text-sm text-blue-700">Get help when you need it</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
                    <Shield className="h-5 w-5 text-green-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-green-900">Early Access</h4>
                      <p className="text-sm text-green-700">Be first to try new features</p>
                    </div>
                  </div>
                </div>

                {/* Upgrade Button */}
                <div className="flex flex-col items-center pt-4">
                  <Button
                    onClick={handleUpgrade}
                    disabled={loading}
                    className="px-8 py-6 text-lg font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-gray-900 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all"
                  >
                    <Crown className="h-5 w-5 mr-2" />
                    {loading ? 'Loading...' : `Upgrade to Legend - ${currentPrice.label}`}
                  </Button>
                  <p className="text-sm text-muted-foreground mt-2">
                    Cancel anytime. No commitments.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Thank you for being a Legend! You have full access to all features.
                </p>
                <Button
                  onClick={handleManageSubscription}
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

        {/* Usage Card */}
        {quota && (
          <Card className="mb-8 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Today's Usage
              </CardTitle>
              <CardDescription>Your AI message quota resets daily at midnight UTC</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span id={quotaLabelId}>AI Messages</span>
                    <span>
                      {quota.used} / {quota.limit === -1 ? 'Unlimited' : quota.limit}
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
                      indicatorClassName="bg-gradient-to-r from-amber-400 to-amber-500"
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
        )}

        {/* Account Info Card */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div className="flex justify-between py-2 border-b">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium">{user?.email}</dd>
              </div>
              <div className="flex justify-between py-2 border-b">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AccountPage;
