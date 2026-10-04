import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

import { ErrorBoundary } from '../ErrorBoundary';

function Bomb(): never {
  throw new Error('kaboom from Bomb');
}

describe('ErrorBoundary client-failure reporting (#2515)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the caught failure to the client-failure endpoint once', () => {
    // React logs the caught error itself; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.reportClientFailure.mockClear();

    render(
      <ErrorBoundary level="component">
        <Bomb />
      </ErrorBoundary>,
    );

    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'react_error_boundary',
      undefined,
      'kaboom from Bomb',
      { component: 'Bomb' },
    );
  });
});
