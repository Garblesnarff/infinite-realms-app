/**
 * CharacterSheetSkeleton Component
 * Loading skeleton for the character sheet view.
 */
import React from 'react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export const CharacterSheetSkeleton: React.FC = () => {
  return (
    <div
      className="container mx-auto px-4 py-8"
      role="status"
      aria-label="Loading character sheet"
      aria-busy="true"
    >
      <Card className="p-6 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="w-full space-y-6">
          {/* Header Skeleton */}
          <div className="mb-6 p-4 bg-primary/5 rounded-lg border flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
          {/* Tabs Skeleton */}
          <div className="grid w-full grid-cols-4 md:grid-cols-8 h-auto p-2 bg-muted/50 rounded-lg border-2 mb-4 gap-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
          {/* Content Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
            <div className="md:col-span-2 space-y-4">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default CharacterSheetSkeleton;
