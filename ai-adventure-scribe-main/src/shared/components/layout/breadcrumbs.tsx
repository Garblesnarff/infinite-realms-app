import { ChevronRight } from 'lucide-react';
import React from 'react';
import { Link, matchRoutes, useLocation } from 'react-router-dom';

import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useEntityLabel } from '@/hooks/use-entity-label';
import { CAMPAIGN_HUB_TABS } from '@/pages/campaigns/CampaignHubTabsList';
import { getAppRoutes } from '@/routes/app-routes';

/** Segments whose own URL is not a route, but which have a real list page. */
const CRUMB_OVERRIDE: Record<string, { label: string; to: string }> = {
  character: { label: 'Characters', to: '/app/characters' },
};

function isRealAppRoute(fullPath: string): boolean {
  const pathname = fullPath.replace(/^\/app/, '') || '/';
  const matches = matchRoutes(getAppRoutes(), pathname);
  const leaf = matches?.at(-1);
  if (!leaf || leaf.route.path === '*') return false;
  if (leaf.route.path === '/campaigns/:id/*') {
    const tab = (leaf.params['*'] ?? '').split('/').filter(Boolean)[0] ?? '';
    if (tab && !CAMPAIGN_HUB_TABS.has(tab)) return false;
  }
  return true;
}

/**
 * Breadcrumbs component for navigation hierarchy
 * Automatically generates breadcrumbs based on current route
 */
const Breadcrumbs: React.FC = () => {
  const location = useLocation();
  const pathSegments = location.pathname.split('/').filter(Boolean);

  // Detect entity ids from path for label resolution
  const campaignId = React.useMemo(() => {
    const campaignIdx = pathSegments.findIndex((s) => s === 'campaign' || s === 'campaigns');
    if (campaignIdx !== -1 && pathSegments[campaignIdx + 1]) return pathSegments[campaignIdx + 1];
    // /app/game/:id is the campaign id. The session id lives in the query string.
    const gameIdx = pathSegments.findIndex((s) => s === 'game');
    if (gameIdx !== -1 && pathSegments[gameIdx + 1]) return pathSegments[gameIdx + 1];
    return null;
  }, [pathSegments]);
  const characterId = React.useMemo(() => {
    const idx = pathSegments.findIndex((s) => s === 'character');
    if (idx !== -1 && pathSegments[idx + 1]) return pathSegments[idx + 1];
    return null;
  }, [pathSegments]);
  const sessionId = React.useMemo(() => {
    const idx = pathSegments.findIndex((s) => s === 'game');
    if (idx !== -1) return new URLSearchParams(location.search).get('session');
    return null;
  }, [location.search, pathSegments]);

  // Try context first, then fallback to lightweight fetch
  const { state: campaignState } = useCampaign();
  const { state: characterState } = useCharacter();
  const campaignNameFromContext =
    campaignState.campaign?.id === campaignId ? campaignState.campaign.name || null : null;
  const characterNameFromContext = characterState.character?.name || null;

  const { label: campaignNameFetched, loading: campaignLoading } = useEntityLabel(
    'campaign',
    campaignId,
  );
  const { label: characterNameFetched, loading: characterLoading } = useEntityLabel(
    'character',
    characterId,
  );
  const { label: sessionLabel, loading: sessionLoading } = useEntityLabel('session', sessionId);

  /**
   * Generates a human-readable label from a URL segment
   * @param segment - URL path segment
   * @returns Formatted string for display
   */
  const getLabel = (segment: string, index: number): string => {
    if (segment === 'app') return '';

    // Entity name resolution for id segments
    const prev = index > 0 ? pathSegments[index - 1] : '';
    if (
      (prev === 'campaign' || prev === 'campaigns' || prev === 'game') &&
      campaignId &&
      segment === campaignId
    ) {
      if (campaignNameFromContext) return campaignNameFromContext;
      if (campaignLoading) return 'Loading…';
      return campaignNameFetched || 'Campaign';
    }
    if (prev === 'character' && characterId && segment === characterId) {
      if (characterNameFromContext) return characterNameFromContext;
      if (characterLoading) return 'Loading…';
      return characterNameFetched || 'Character';
    }
    if (prev === 'game' && sessionId && segment === sessionId) {
      if (sessionLoading) return 'Loading…';
      return sessionLabel || 'Game';
    }

    // Remove any URL parameters
    segment = segment.split('?')[0];
    // Capitalize first letter and add spaces before capital letters
    return segment.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
  };

  /**
   * Builds the complete path up to a specific segment
   * @param index - Index of the current segment
   * @returns Complete path string
   */
  const buildPath = (index: number): string => '/' + pathSegments.slice(0, index + 1).join('/');

  // Hide breadcrumbs on the campaign list. /app/characters shows Home › Characters (#2706).
  if (pathSegments.length === 0 || (pathSegments.length === 1 && pathSegments[0] === 'app'))
    return null;

  return (
    <div id="app-breadcrumbs" className="container mx-auto px-4 py-2">
      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
        <Link to="/app" className="hover:text-infinite-gold transition-colors">
          Home
        </Link>
        {pathSegments.map((segment, index) => {
          if (segment === 'app') return null; // do not render the 'app' segment

          const override = CRUMB_OVERRIDE[segment];
          const to = override?.to ?? buildPath(index);
          if (!override && !isRealAppRoute(to)) return null;
          const pretty = override?.label ?? getLabel(segment, index);
          return (
            <React.Fragment key={index}>
              <ChevronRight className="h-4 w-4" />
              <Link to={to} className="hover:text-infinite-gold transition-colors">
                {pretty}
              </Link>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default Breadcrumbs;
