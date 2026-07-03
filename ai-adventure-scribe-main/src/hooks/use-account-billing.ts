import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import type { UserPlan } from '@/contexts/AuthContext';

import { analytics } from '@/services/analytics';

export interface SubscriptionStatus {
  plan: string;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  status: string;
}

export interface QuotaStatus {
  plan: UserPlan;
  type: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

export const ACCOUNT_UPGRADE_PRICE = {
  label: '$15/month',
  priceId: 'price_1SjvhgAKOXZDug1mTxPZdKnK',
} as const;

const API_URL = import.meta.env?.VITE_API_URL || '';

export interface UseAccountBillingReturn {
  subscription: SubscriptionStatus | null;
  quota: QuotaStatus | null;
  loading: boolean;
  handleUpgrade: () => Promise<void>;
  handleManageSubscription: () => Promise<void>;
}

/**
 * Handles Stripe checkout/portal actions and loads subscription + quota
 * status for the account page, including reacting to Stripe redirect
 * success/cancel query params.
 */
export function useAccountBilling(
  userPlan: UserPlan | null | undefined,
  refreshUserPlan: () => void,
): UseAccountBillingReturn {
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
      analytics.track('checkout_completed', { source: 'stripe_redirect' });
      refreshUserPlan();
    } else if (canceled === 'true') {
      toast.info('Subscription checkout was canceled.');
      analytics.track('checkout_canceled', { source: 'stripe_redirect' });
    }
  }, [searchParams, refreshUserPlan]);

  // Fetch subscription status
  useEffect(() => {
    const fetchSubscription = async (): Promise<void> => {
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
    const fetchQuota = async (): Promise<void> => {
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

  const handleUpgrade = async (): Promise<void> => {
    setLoading(true);
    analytics.track('upgrade_clicked', {
      price: ACCOUNT_UPGRADE_PRICE.label,
      priceId: ACCOUNT_UPGRADE_PRICE.priceId,
    });
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
          priceId: ACCOUNT_UPGRADE_PRICE.priceId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        analytics.track('checkout_error', { error: error.error || 'unknown' });
        throw new Error(error.error || 'Failed to create checkout session');
      }

      const { url } = await response.json();
      if (url) {
        analytics.track('checkout_redirected', { priceId: ACCOUNT_UPGRADE_PRICE.priceId });
        window.location.href = url;
      }
    } catch (error) {
      console.error('Upgrade error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to start upgrade');
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async (): Promise<void> => {
    setLoading(true);
    analytics.track('manage_subscription_clicked');
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

  return { subscription, quota, loading, handleUpgrade, handleManageSubscription };
}
