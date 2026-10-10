import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AccountPage from '@/pages/AccountPage';
import { APP_BUILD_SHORT } from '@/services/app-version';

// The account page only needs the signed-in user and billing state; the real cards render.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'tester@example.test' },
    userPlan: 'free',
    refreshUserPlan: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-account-billing', () => ({
  ACCOUNT_UPGRADE_PRICE: { label: '$5 / month' },
  useAccountBilling: () => ({
    subscription: null,
    quota: null,
    loading: false,
    handleUpgrade: vi.fn(),
    handleManageSubscription: vi.fn(),
  }),
}));

vi.mock('@/components/feedback/SendFeedbackButton', () => ({
  SendFeedbackButton: () => null,
}));

const packageVersion = JSON.parse(
  // Vitest runs from the app directory (the frontend CI job's working directory).
  readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
).version as string;

describe('account page shows the release number (#227)', () => {
  it('renders the package version next to the build hash', () => {
    render(<AccountPage />);

    expect(screen.getByTestId('app-build').textContent).toBe(
      `${packageVersion} · build ${APP_BUILD_SHORT}`,
    );
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
