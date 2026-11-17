import React from 'react';

import SessionCard, { type SessionListItem } from './SessionCard';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface CampaignSessionsContentProps {
  isLoading: boolean;
  error: unknown;
  sessions: SessionListItem[];
  openStartSession: () => void;
  isSessionExpired: (session: SessionListItem) => boolean;
  handleContinue: (session: SessionListItem) => void;
  continuingId: string | null;
  onViewChronicle: (id: string) => void;
  onGenerateChronicle: (id: string) => void;
  userPlan?: string;
  hasNextPage?: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export const CampaignSessionsContent: React.FC<CampaignSessionsContentProps> = ({
  isLoading,
  error,
  sessions,
  openStartSession,
  isSessionExpired,
  handleContinue,
  continuingId,
  onViewChronicle,
  onGenerateChronicle,
  userPlan,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Skeleton key={idx} className="h-36 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : 'Failed to load sessions.';
    return (
      <Card className="p-6">
        <p className="text-destructive">{message}</p>
      </Card>
    );
  }

  if (sessions.length === 0) {
    return (
      <Card className="p-6 text-center space-y-3">
        <h3 className="text-lg font-semibold">No sessions yet</h3>
        <p className="text-sm text-muted-foreground">
          Start your first session to begin chronicling this campaign.
        </p>
        <Button onClick={openStartSession} className="mt-2">
          Start New Session
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          expired={isSessionExpired(session) || session.status === 'expired'}
          onContinue={handleContinue}
          continuing={continuingId === session.id}
          onViewChronicle={onViewChronicle}
          onGenerateChronicle={onGenerateChronicle}
          userPlan={userPlan}
        />
      ))}
      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button onClick={fetchNextPage} disabled={isFetchingNextPage} variant="outline">
            {isFetchingNextPage ? 'Loading...' : 'Load More Sessions'}
          </Button>
        </div>
      )}
    </div>
  );
};
