import React, { Suspense } from 'react';

import { RouteLoading } from '@/shared/components/RouteLoading';

/**
 * Wraps a lazily-loaded route element in the standard route-level Suspense
 * boundary with the shared loading fallback.
 */
export function withRouteSuspense(element: React.ReactNode): React.ReactElement {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}
