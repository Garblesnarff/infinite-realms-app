import React from 'react';

import { TabsList, TabsTrigger } from '@/components/ui/tabs';

export const CampaignHubTabsList: React.FC = () => {
  return (
    <TabsList className="grid w-full grid-cols-5 bg-muted backdrop-blur-sm border border-white/20 rounded-2xl p-1 mb-4">
      <TabsTrigger
        value="overview"
        className="rounded-xl data-[state=active]:bg-infinite-purple data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300 font-medium"
      >
        📜 Overview
      </TabsTrigger>
      <TabsTrigger
        value="characters"
        className="rounded-xl data-[state=active]:bg-infinite-gold data-[state=active]:text-infinite-dark data-[state=active]:shadow-lg transition-all duration-300 font-medium"
      >
        ⚔️ Characters
      </TabsTrigger>
      <TabsTrigger
        value="sessions"
        className="rounded-xl data-[state=active]:bg-infinite-teal data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300 font-medium"
      >
        📖 Sessions
      </TabsTrigger>
      <TabsTrigger
        value="world"
        className="rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-emerald-700 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300 font-medium"
      >
        🌍 World
      </TabsTrigger>
      <TabsTrigger
        value="settings"
        className="rounded-xl data-[state=active]:bg-infinite-dark data-[state=active]:text-infinite-gold data-[state=active]:shadow-lg transition-all duration-300 font-medium"
      >
        ⚙️ Settings
      </TabsTrigger>
    </TabsList>
  );
};
