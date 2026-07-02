import React from 'react';

export const CampaignOverviewSkeleton: React.FC = () => {
  return (
    <div className="space-y-8">
      {/* Hero Skeleton */}
      <div className="relative h-64 sm:h-80 rounded-2xl bg-gradient-to-br from-infinite-dark-lighter via-infinite-purple/20 to-infinite-dark animate-pulse">
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/25 to-black/40 rounded-2xl"></div>
        <div className="absolute bottom-6 left-6 right-6">
          <div className="h-8 bg-white/20 rounded-lg w-1/3 mb-4"></div>
          <div className="flex gap-2">
            <div className="h-6 bg-white/20 rounded-full w-16"></div>
            <div className="h-6 bg-white/20 rounded-full w-20"></div>
            <div className="h-6 bg-white/20 rounded-full w-18"></div>
          </div>
        </div>
      </div>

      {/* Content Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-strong rounded-2xl p-8">
            <div className="h-8 bg-white/20 rounded-lg w-1/4 mb-6"></div>
            <div className="space-y-4">
              <div className="h-4 bg-white/10 rounded w-full"></div>
              <div className="h-4 bg-white/10 rounded w-5/6"></div>
              <div className="h-4 bg-white/10 rounded w-4/5"></div>
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="glass-strong rounded-2xl p-6">
            <div className="h-6 bg-white/20 rounded-lg w-1/2 mb-4"></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="h-4 bg-white/10 rounded"></div>
              <div className="h-4 bg-white/10 rounded"></div>
              <div className="h-4 bg-white/10 rounded"></div>
              <div className="h-4 bg-white/10 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
