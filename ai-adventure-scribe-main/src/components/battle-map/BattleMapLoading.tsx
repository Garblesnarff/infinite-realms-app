import React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Battle Map Loading Component
 *
 * Extracted from BattleMapPage to handle the loading state of the battle map.
 */
export const BattleMapLoading: React.FC = () => {
  return (
    <div
      className="min-h-screen flex flex-col bg-background"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading battle map...</span>

      {/* Header Skeleton */}
      <div className="h-14 border-b flex items-center justify-between px-4" aria-hidden="true">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Canvas Skeleton */}
      <div className="flex-1 flex items-center justify-center" aria-hidden="true">
        <div className="text-center space-y-4">
          <Skeleton className="h-12 w-12 rounded-full mx-auto" />
          <Skeleton className="h-4 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    </div>
  );
};
