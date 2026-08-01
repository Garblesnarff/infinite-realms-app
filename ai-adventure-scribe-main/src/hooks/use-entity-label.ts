import * as React from 'react';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

type EntityType = 'campaign' | 'character' | 'session';

const cache = new Map<string, string>();

/**
 * Resolves a human-readable label for an entity id with simple in-memory caching.
 */
export function useEntityLabel(type: EntityType, id: string | null) {
  const [label, setLabel] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(Boolean(id));

  React.useEffect(() => {
    let cancelled = false;
    const key = id ? `${type}:${id}` : '';
    if (!id) {
      setLabel(null);
      setLoading(false);
      return;
    }
    const entityId = id;

    const inCache = cache.get(key);
    if (inCache) {
      setLabel(inCache);
      setLoading(false);
      return;
    }

    async function fetchLabel() {
      try {
        setLoading(true);
        if (type === 'campaign') {
          const data = await userDataApi.getCampaign(entityId);
          if (cancelled) return;
          const value = data?.name ?? null;
          if (value) cache.set(key, value);
          setLabel(value);
        } else if (type === 'character') {
          try {
            const data = await userDataApi.getCharacter(entityId);
            if (cancelled) return;
            const value = data?.name ?? null;
            if (value) cache.set(key, value);
            setLabel(value);
          } catch (error) {
            logger.warn('[useEntityLabel] Failed to load character label', { id, error });
          }
        } else if (type === 'session') {
          let data: Record<string, unknown> | null = null;
          let error: unknown;
          try {
            data = await userDataApi.getSession(entityId);
          } catch (caught) {
            error = caught;
          }
          if (cancelled) return;
          if (error) {
            logger.warn('[useEntityLabel] Failed to load session label', { id, error });
          } else {
            const n = data?.session_number as number | null | undefined;
            const value = n ? `Session ${n}` : 'Game';
            cache.set(key, value);
            setLabel(value);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLabel();
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  // ⚡ Bolt: Memoize the return object to ensure stable reference identity
  // and prevent redundant downstream re-renders (e.g. in Breadcrumbs component).
  return React.useMemo(() => ({ label, loading }) as const, [label, loading]);
}
