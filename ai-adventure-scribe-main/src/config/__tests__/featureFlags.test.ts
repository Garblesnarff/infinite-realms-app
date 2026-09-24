import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  featureFlags,
  isCampaignCharacterFlowEnabled,
  isCustomCampaignsEnabled,
  isMultiplayerInvitesEnabled,
  isWorldBuilderEnabled,
} from '@/config/featureFlags';

const FLAG_ENV = {
  VITE_ENABLE_WORLD_BUILDER: isWorldBuilderEnabled,
  VITE_ENABLE_CAMPAIGN_CHARACTER_FLOW: isCampaignCharacterFlowEnabled,
  VITE_ENABLE_MULTIPLAYER_INVITES: isMultiplayerInvitesEnabled,
  VITE_ENABLE_CUSTOM_CAMPAIGNS: isCustomCampaignsEnabled,
} as const;

describe('feature flag getters', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stays false when the env var is unset', () => {
    for (const name of Object.keys(FLAG_ENV)) {
      vi.stubEnv(name, undefined);
    }

    expect(isWorldBuilderEnabled()).toBe(false);
    expect(isCampaignCharacterFlowEnabled()).toBe(false);
    expect(isMultiplayerInvitesEnabled()).toBe(false);
    expect(isCustomCampaignsEnabled()).toBe(false);
    expect(featureFlags.worldBuilder).toBe(false);
    expect(featureFlags.campaignCharacterFlow).toBe(false);
    expect(featureFlags.multiplayerInvites).toBe(false);
    expect(featureFlags.customCampaigns).toBe(false);
  });

  it('reads vi.stubEnv values', () => {
    vi.stubEnv('VITE_ENABLE_WORLD_BUILDER', 'true');
    vi.stubEnv('VITE_ENABLE_CAMPAIGN_CHARACTER_FLOW', '1');
    vi.stubEnv('VITE_ENABLE_MULTIPLAYER_INVITES', 'yes');
    vi.stubEnv('VITE_ENABLE_CUSTOM_CAMPAIGNS', 'on');

    expect(isWorldBuilderEnabled()).toBe(true);
    expect(isCampaignCharacterFlowEnabled()).toBe(true);
    expect(isMultiplayerInvitesEnabled()).toBe(true);
    expect(isCustomCampaignsEnabled()).toBe(true);
    expect(featureFlags.customCampaigns).toBe(true);

    vi.stubEnv('VITE_ENABLE_WORLD_BUILDER', 'false');
    vi.stubEnv('VITE_ENABLE_CAMPAIGN_CHARACTER_FLOW', '0');
    vi.stubEnv('VITE_ENABLE_MULTIPLAYER_INVITES', 'no');
    vi.stubEnv('VITE_ENABLE_CUSTOM_CAMPAIGNS', '');

    expect(isWorldBuilderEnabled()).toBe(false);
    expect(isCampaignCharacterFlowEnabled()).toBe(false);
    expect(isMultiplayerInvitesEnabled()).toBe(false);
    expect(isCustomCampaignsEnabled()).toBe(false);
  });
});
