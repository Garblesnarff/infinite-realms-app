import React from 'react';
import { useNavigate } from 'react-router-dom';

import { planHasPaidFeatures } from '../../../shared/plan-features';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { trpc } from '@/infrastructure/api';

interface ChronicleViewerProps {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}

const ChronicleViewer: React.FC<ChronicleViewerProps> = ({ sessionId, open, onClose }) => {
  const { userPlan } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: chronicle, isLoading } = trpc.chronicles.getBySessionId.useQuery(
    { sessionId: sessionId ?? '' },
    {
      enabled: open && !!sessionId,
      refetchInterval: (data) => (data?.status === 'generating' ? 3000 : false),
    },
  );

  const isPro = planHasPaidFeatures(userPlan);

  const handleCopyShareLink = () => {
    if (!chronicle?.share_token) return;
    navigator.clipboard.writeText(`${window.location.origin}/chronicle/${chronicle.share_token}`);
    toast({ title: 'Link copied!' });
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          Loading chronicle...
        </div>
      );
    }

    if (!chronicle) {
      return (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          No chronicle yet.
        </div>
      );
    }

    if (chronicle.status === 'generating') {
      return (
        <div className="flex items-center justify-center py-10">
          <p className="text-amber-500 animate-pulse text-base">
            Your chronicle is being written... ✨
          </p>
        </div>
      );
    }

    if (chronicle.status === 'failed') {
      return (
        <div className="flex items-center justify-center py-10">
          <p className="text-destructive">Chronicle generation failed.</p>
        </div>
      );
    }

    if (chronicle.status === 'ready') {
      if (isPro) {
        return (
          <div className="space-y-4">
            {chronicle.illustration_url && (
              <img
                src={chronicle.illustration_url}
                alt={chronicle.chapter_title ?? 'Chronicle illustration'}
                className="w-full rounded-lg object-cover"
                style={{ maxHeight: '250px' }}
              />
            )}
            {chronicle.chapter_title && (
              <h2 className="font-serif text-2xl font-bold text-amber-400 leading-tight">
                {chronicle.chapter_title}
              </h2>
            )}
            {chronicle.prose && (
              <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground">
                {chronicle.prose}
              </p>
            )}
            {chronicle.share_token && (
              <Button size="sm" variant="outline" onClick={handleCopyShareLink} className="mt-2">
                Share ↗
              </Button>
            )}
          </div>
        );
      }

      // Free plan: show summary + upgrade CTA
      return (
        <div className="space-y-4">
          {chronicle.summary && (
            <p className="text-base leading-relaxed text-foreground">{chronicle.summary}</p>
          )}
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Upgrade to Pro for illustrated novel-style chronicles, voiced recaps, and shareable
              links.
            </p>
            <Button size="sm" onClick={() => navigate('/account')}>
              Upgrade to Pro
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        No chronicle yet.
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Session Chronicle</DialogTitle>
          <DialogDescription>Review the story recorded in this session.</DialogDescription>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
};

export default ChronicleViewer;
