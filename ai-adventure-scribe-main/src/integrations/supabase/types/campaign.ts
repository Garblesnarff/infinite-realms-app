import type { Tables, TablesInsert, TablesUpdate } from './common';

export type Campaign = Tables<'campaigns'>;
export type CampaignInsert = TablesInsert<'campaigns'>;
export type CampaignUpdate = TablesUpdate<'campaigns'>;

export type CampaignMember = Tables<'campaign_members'>;
export type CampaignMemberInsert = TablesInsert<'campaign_members'>;
export type CampaignMemberUpdate = TablesUpdate<'campaign_members'>;
