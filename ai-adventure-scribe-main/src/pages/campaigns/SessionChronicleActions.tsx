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
  const [revoked, setRevoked] = React.useState(false);
  const [isMutating, setIsMutating] = React.useState(false);

  const handleShareLink = async (): Promise<void> => {
    if (!chronicle || isMutating) return;
    setIsMutating(true);
    try {
      const token = await shareChronicle(chronicle.id);
      await navigator.clipboard.writeText(`${window.location.origin}/chronicle/${token}`);
      setShareStatus('Link copied!');
    } catch (error) {
      if ((error as { status?: number } | undefined)?.status === 409) {
        setShareStatus('Write the full chronicle before sharing.');
      } else {
        setShareStatus('Could not share. Try again.');
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleTurnLinkOff = async (): Promise<void> => {
    if (!chronicle || isMutating) return;
    setIsMutating(true);
    try {
      await unshareChronicle(chronicle.id);
      setRevoked(true);
      setShareStatus('Link turned off');
    } catch {
      setShareStatus('Could not turn the link off. Try again.');
    } finally {
      setIsMutating(false);
    }
  };

  const showShare = isPro;
  const showTurn = !revoked && (isPro || !!chronicle?.share_token);

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
          {showShare && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-11 px-2 text-xs"
              onClick={handleShareLink}
              disabled={isMutating}
            >
              Share link
            </Button>
          )}
          {showTurn && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-11 px-2 text-xs"
              onClick={handleTurnLinkOff}
              disabled={isMutating}
            >
              Turn link off
            </Button>
          )}
          {(showShare || showTurn || shareStatus) && (
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
