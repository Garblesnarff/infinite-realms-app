import type { Tables, TablesInsert, TablesUpdate } from './common';

export type Campaign = Tables<'campaigns'>;
export type CampaignInsert = TablesInsert<'campaigns'>;
export type CampaignUpdate = TablesUpdate<'campaigns'>;

// @ts-expect-error #192 'campaign_members' is missing from the generated Database type
export type CampaignMember = Tables<'campaign_members'>;
// @ts-expect-error #192 'campaign_members' is missing from the generated Database type
export type CampaignMemberInsert = TablesInsert<'campaign_members'>;
// @ts-expect-error #192 'campaign_members' is missing from the generated Database type
export type CampaignMemberUpdate = TablesUpdate<'campaign_members'>;
