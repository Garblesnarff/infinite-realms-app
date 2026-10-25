import React, { useEffect, useState } from 'react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { fetchSessionTrackers, type SessionTracker } from '@/services/session-trackers';

/**
 * #1095: the campaign trackers view for the tracker sheet out of
 * combat. It reads the same GET the DM-turn fallback reads — latest
 * server state, fetched when the panel mounts (the sheet mounts its
 * content only while open, so this fires once per open, never on a
 * poll). The line format matches DMMessage's Story clock line, so the
 * sheet and the chat can never disagree about a tracker's text.
 *
 * Three states, kept distinct: loading (null list), load failure
 * (null from the helper — an error card with a retry, never a false
 * "no trackers"), and a loaded list, which may genuinely be empty.
 */
export const CampaignTrackerPanel: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [trackers, setTrackers] = useState<SessionTracker[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // A session change must not keep showing the previous session's
    // values while the new fetch is in flight.
    setTrackers(null);
    setFailed(false);
    void fetchSessionTrackers(sessionId).then((fetched) => {
      if (cancelled) return;
      if (fetched === null) setFailed(true);
      else setTrackers(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, attempt]);

  if (failed) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Campaign Trackers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load campaign trackers.
          </p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              setTrackers(null);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  if (trackers === null) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Campaign Trackers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading trackers…</p>
        </CardContent>
      </Card>
    );
  }

  if (trackers.length === 0) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Campaign Trackers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No campaign trackers for this campaign.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Campaign Trackers</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {trackers.map((tracker, index) => (
            <li key={`${tracker.name}-${index}`} className="text-sm">
              {tracker.name} Clock: {tracker.value}/{tracker.limit}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

CampaignTrackerPanel.displayName = 'CampaignTrackerPanel';
