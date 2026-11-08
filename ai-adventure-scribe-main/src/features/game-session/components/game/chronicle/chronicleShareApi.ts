import {
  CHRONICLE_SHARE_REQUEST,
  CHRONICLE_UNSHARE_REQUEST,
  PUBLIC_CHRONICLE_PATH,
} from '../../../../../../shared/chronicle-share-routes';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export interface PublicChronicle {
  title: string;
  illustrationUrl: string | null;
  story: string;
  campaignName: string | null;
  sessionNumber: number | null;
  publicCampaign: {
    slug: string | null;
    title: string | null;
    tagline: string | null;
    coverImageUrl: string | null;
  } | null;
}

export async function shareChronicle(chronicleId: string): Promise<string> {
  const res = await fetchWithAuth(CHRONICLE_SHARE_REQUEST.path(chronicleId), {
    method: CHRONICLE_SHARE_REQUEST.method,
  });
  if (!res.ok) {
    const error = new Error('Could not share. Try again.') as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  const data = (await res.json()) as { shareToken?: unknown };
  if (typeof data.shareToken !== 'string' || !data.shareToken) {
    throw new Error('Could not share. Try again.');
  }
  return data.shareToken;
}

export async function unshareChronicle(chronicleId: string): Promise<void> {
  const res = await fetchWithAuth(CHRONICLE_UNSHARE_REQUEST.path(chronicleId), {
    method: CHRONICLE_UNSHARE_REQUEST.method,
  });
  if (!res.ok) {
    throw new Error('Could not share. Try again.');
  }
}

export async function fetchPublicChronicle(token: string): Promise<PublicChronicle | null> {
  const res = await fetch(`${API_BASE_URL}${PUBLIC_CHRONICLE_PATH(token)}`, { method: 'GET' });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Could not load chronicle (${res.status})`);
  }
  return (await res.json()) as PublicChronicle;
}
