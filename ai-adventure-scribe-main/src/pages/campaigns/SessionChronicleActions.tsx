import React from 'react';

import { type SessionListItem } from './SessionCard';

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
  const isPro = userPlan && userPlan !== 'free';

  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      {chronicle?.status === 'ready' ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            className="text-amber-600 hover:text-amber-700 h-7 px-2 text-xs"
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
        <p className="text-xs text-amber-500 animate-pulse">✨ Writing your chronicle...</p>
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
