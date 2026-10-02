import React from 'react';

import { type SessionListItem } from './SessionCard';
import { planHasPaidFeatures } from '../../../shared/plan-features';

import { Button } from '@/components/ui/button';

interface SessionChronicleActionsProps {
  session: SessionListItem;
  userPlan?: string;
  onViewChronicle?: (sessionId: string) => void;
  onGenerateChronicle?: (sessionId: string) => void;
}

export const SessionChronicleActions: React.FC<SessionChronicleActionsProps> = ({
  session,
  userPlan,
  onViewChronicle,
  onGenerateChronicle,
}) => {
  const chronicle = session.session_chronicles?.[0];
  const isPro = planHasPaidFeatures(userPlan);

  return (
    <div className="mt-3 pt-3 border-t border-border">
      {chronicle?.status === 'ready' ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            className="text-infinite-gold hover:text-infinite-gold/80 h-7 px-2 text-xs"
            onClick={() => onViewChronicle?.(session.id)}
          >
            📖 Read Chronicle
          </Button>
          {chronicle.share_token && isPro && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-7 px-2 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(
                  `${window.location.origin}/chronicle/${chronicle.share_token}`,
                );
              }}
            >
              Share ↗
            </Button>
          )}
        </div>
      ) : chronicle?.status === 'generating' ? (
        <p className="text-xs text-infinite-gold animate-pulse">✨ Writing your chronicle...</p>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground h-7 px-2 text-xs"
          onClick={() => onGenerateChronicle?.(session.id)}
        >
          {isPro ? '✨ Generate Chronicle' : '📝 Generate Summary'}
        </Button>
      )}
    </div>
  );
};
