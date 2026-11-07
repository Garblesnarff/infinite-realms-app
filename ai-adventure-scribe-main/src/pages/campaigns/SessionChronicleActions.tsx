import React from 'react';

import { type SessionListItem } from './SessionCard';
import { planHasPaidFeatures } from '../../../shared/plan-features';

import { Button } from '@/components/ui/button';
import {
  shareChronicle,
  unshareChronicle,
} from '@/features/game-session/components/game/chronicle/chronicleShareApi';

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
  const [shareStatus, setShareStatus] = React.useState('');

  const handleShareLink = async (): Promise<void> => {
    if (!chronicle) return;
    try {
      const token = await shareChronicle(chronicle.id);
      await navigator.clipboard.writeText(`${window.location.origin}/chronicle/${token}`);
      setShareStatus('Link copied!');
    } catch {
      setShareStatus('Could not share. Try again.');
    }
  };

  const handleTurnLinkOff = async (): Promise<void> => {
    if (!chronicle) return;
    try {
      await unshareChronicle(chronicle.id);
      setShareStatus('Link turned off');
    } catch {
      setShareStatus('Could not turn the link off. Try again.');
    }
  };

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
          {isPro && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-11 px-2 text-xs"
              onClick={handleShareLink}
            >
              Share link
            </Button>
          )}
          {isPro && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-11 px-2 text-xs"
              onClick={handleTurnLinkOff}
            >
              Turn link off
            </Button>
          )}
          {isPro && (
            <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
              {shareStatus}
            </span>
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
