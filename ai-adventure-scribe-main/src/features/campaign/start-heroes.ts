import { userDataApi } from '@/services/user-data-api';

/**
 * Heroes a player can start a starter campaign with: that campaign's own
 * premade templates, and nothing else. Both entry points read them here: the
 * /app campaign modal (use-character-selection) and the /explore page
 * (use-starter-character-templates). The account's other characters belong
 * to other campaigns and are not offered (#1740).
 */
export const listStartableHeroRows = (
  starterCampaignId: string,
): ReturnType<typeof userDataApi.listStarterCharacterTemplates> =>
  userDataApi.listStarterCharacterTemplates(starterCampaignId);
