export interface SessionListQuery {
  campaign_id?: string;
  character_id?: string;
  status?: string;
  starter_only?: string;
  limit?: string;
  offset?: string;
}

export interface SessionListFilters {
  campaignId?: string;
  characterId?: string;
  status?: string;
  starterOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function getSessionListRouteResult<T>(
  query: SessionListQuery,
  userId: string,
  listSessions: (filters: SessionListFilters, userId: string) => Promise<T>,
): Promise<T> {
  return listSessions(
    {
      campaignId: query.campaign_id,
      characterId: query.character_id,
      status: query.status,
      starterOnly: query.starter_only === 'true',
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    },
    userId,
  );
}
