import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccountInfoCard } from '../AccountInfoCard';

import { APP_BUILD_SHORT, APP_BUILD_VERSION } from '@/services/app-version';

describe('AccountInfoCard build line (#2293)', () => {
  it('shows "build <short>" so a tester can compare it with /version', () => {
    render(<AccountInfoCard email="t@example.test" userPlan="free" subscription={null} />);
    expect(screen.getByTestId('app-build').textContent).toBe(`build ${APP_BUILD_SHORT}`);
    expect(APP_BUILD_SHORT).toBe(APP_BUILD_VERSION.slice(0, 8));
  });
});
