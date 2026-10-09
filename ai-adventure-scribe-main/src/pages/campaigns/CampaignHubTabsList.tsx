import React from 'react';

import { TabsList, TabsTrigger } from '@/components/ui/tabs';

const CAMPAIGN_HUB_TAB_ITEMS = [
  {
    value: 'overview',
    label: '📜 Overview',
    className:
      'rounded-xl data-[state=active]:bg-infinite-purple data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300 font-medium',
  },
  {
    value: 'characters',
    label: '⚔️ Characters',
    className:
      'rounded-xl data-[state=active]:bg-infinite-gold data-[state=active]:text-infinite-dark data-[state=active]:shadow-lg transition-all duration-300 font-medium',
  },
  {
    value: 'sessions',
    label: '📖 Sessions',
    className:
      'rounded-xl data-[state=active]:bg-infinite-teal data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300 font-medium',
  },
  {
    value: 'world',
    label: '🌍 World',
    className:
      'rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-emerald-700 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300 font-medium',
  },
  {
    value: 'settings',
    label: '⚙️ Settings',
    className:
      'rounded-xl data-[state=active]:bg-infinite-dark data-[state=active]:text-infinite-gold data-[state=active]:shadow-lg transition-all duration-300 font-medium',
  },
] as const;

/** Path tabs under /campaigns/:id. Overview is the bare URL, not a segment. */
export const CAMPAIGN_HUB_TABS = new Set<string>(
  CAMPAIGN_HUB_TAB_ITEMS.map((tab) => tab.value).filter((value) => value !== 'overview'),
);

export const CampaignHubTabsList: React.FC = () => {
  return (
    <TabsList className="grid w-full grid-cols-5 bg-muted backdrop-blur-sm border border-white/20 rounded-2xl p-1 mb-4">
      {CAMPAIGN_HUB_TAB_ITEMS.map((tab) => (
        <TabsTrigger key={tab.value} value={tab.value} className={tab.className}>
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
};
