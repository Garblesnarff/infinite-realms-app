const parseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'on', 'enabled'].includes(normalized);
};

/*
 * `semanticMemories` / VITE_ENABLE_SEMANTIC_MEMORIES was removed in #1822.
 * Nothing reads it. Do not set it. Similarity recall is server-side (#2282).
 *
 * It gated a storage write, not a UI affordance, and Vite inlines import.meta.env at build
 * time, so it was never a runtime toggle either: the shipped bundle simply had the embedding
 * write compiled out. It was off in production for the entire life of the memories table —
 * 4530 rows, 0 embeddings, nine months, no error anywhere. Embedding is now unconditional and
 * happens on the server (server-bun MemoryService.insert), so there is nothing left to gate.
 */
// Read at call time. Vite inlines `import.meta.env.VITE_*` in the production bundle;
// in tests, `vi.stubEnv` updates the same names. A missing value stays false.
const worldBuilderEnabled = (): boolean => parseBoolean(import.meta.env.VITE_ENABLE_WORLD_BUILDER);
const campaignCharacterFlowEnabled = (): boolean =>
  parseBoolean(import.meta.env.VITE_ENABLE_CAMPAIGN_CHARACTER_FLOW);
const multiplayerInvitesEnabled = (): boolean =>
  parseBoolean(import.meta.env.VITE_ENABLE_MULTIPLAYER_INVITES);
const customCampaignsEnabled = (): boolean =>
  parseBoolean(import.meta.env.VITE_ENABLE_CUSTOM_CAMPAIGNS);

export const featureFlags = {
  get worldBuilder(): boolean {
    return worldBuilderEnabled();
  },
  get campaignCharacterFlow(): boolean {
    return campaignCharacterFlowEnabled();
  },
  get multiplayerInvites(): boolean {
    return multiplayerInvitesEnabled();
  },
  get customCampaigns(): boolean {
    return customCampaignsEnabled();
  },
};

export const isWorldBuilderEnabled = (): boolean => featureFlags.worldBuilder;
export const isCampaignCharacterFlowEnabled = (): boolean => featureFlags.campaignCharacterFlow;
export const isMultiplayerInvitesEnabled = (): boolean => featureFlags.multiplayerInvites;
export const isCustomCampaignsEnabled = (): boolean => featureFlags.customCampaigns;
