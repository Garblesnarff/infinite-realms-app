import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { shareChronicle } from './chronicleShareApi';
import { planHasPaidFeatures } from '../../../../../../shared/plan-features';

import './chronicle.css';

import { chronicleRefetchInterval } from '@/components/chronicles/ChronicleViewer';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { trpc } from '@/infrastructure/api';

interface ChronicleDialogProps {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}

function splitParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const ChronicleDialog: React.FC<ChronicleDialogProps> = ({ sessionId, open, onClose }) => {
  const { userPlan } = useAuth();
  const navigate = useNavigate();
  const [shareStatus, setShareStatus] = useState('');
  const [sharing, setSharing] = useState(false);

  const {
    data: chronicle,
    isLoading,
    refetch,
  } = trpc.chronicles.getBySessionId.useQuery(
    { sessionId: sessionId ?? '' },
    {
      enabled: open && !!sessionId,
      refetchInterval: chronicleRefetchInterval,
    },
  );

  const generateMutation = trpc.chronicles.generate.useMutation();

  useEffect(() => {
    setShareStatus('');
    setSharing(false);
  }, [sessionId, open]);

  const isPro = planHasPaidFeatures(userPlan);
  const title = chronicle?.chapterTitle ?? null;
  const sessionNumber = chronicle?.sessionNumber ?? null;
  const eyebrow =
    sessionNumber != null ? `SESSION CHRONICLE · SESSION ${sessionNumber}` : 'SESSION CHRONICLE';
  const paragraphs = splitParagraphs(chronicle?.chronicleText);

  const handleShare = async (): Promise<void> => {
    if (!chronicle?.id || sharing) return;
    setSharing(true);
    setShareStatus('');
    try {
      const token = await shareChronicle(chronicle.id);
      const url = `${window.location.origin}/chronicle/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        setShareStatus('Link copied!');
      } catch {
        setShareStatus(`Copy this link: ${url}`);
      }
      void refetch();
    } catch (error) {
      if ((error as { status?: number } | undefined)?.status === 409) {
        setShareStatus('Write the full chronicle before sharing.');
      } else {
        setShareStatus('Could not share. Try again.');
      }
    } finally {
      setSharing(false);
    }
  };

  const handleWriteFull = (): void => {
    const targetSessionId = sessionId ?? chronicle?.sessionId;
    if (!targetSessionId) return;
    setShareStatus('');
    generateMutation.mutate({ sessionId: targetSessionId });
    void refetch();
  };

  const renderContent = (): React.ReactNode => {
    if (isLoading) {
      return <div className="ir-chronicle-state">Loading chronicle...</div>;
    }

    if (!chronicle) {
      return <div className="ir-chronicle-state">No chronicle yet.</div>;
    }

    if (chronicle.status === 'generating') {
      return <div className="ir-chronicle-state">Your chronicle is being written... ✨</div>;
    }

    if (chronicle.status === 'failed') {
      return <div className="ir-chronicle-state">Chronicle generation failed.</div>;
    }

    if (chronicle.status === 'ready') {
      if (isPro) {
        if (chronicle.chapterTitle == null) {
          return (
            <div>
              {chronicle.illustrationUrl ? (
                <figure className="ir-chronicle-figure mt-4 overflow-hidden rounded-md">
                  <img
                    src={chronicle.illustrationUrl}
                    alt={`Illustration for ${title ?? 'Chronicle'}.`}
                    className="block h-auto w-full max-h-[230px] object-cover"
                  />
                </figure>
              ) : null}
              {paragraphs.map((paragraph, index) => (
                <p key={index} className="ir-chronicle-story mt-4 text-base leading-relaxed">
                  {paragraph}
                </p>
              ))}
              <div className="ir-chronicle-share-row">
                <button
                  type="button"
                  onClick={handleWriteFull}
                  disabled={generateMutation.isPending}
                  className="ir-chronicle-write inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  Write the full chronicle
                </button>
                <span
                  role="status"
                  aria-live="polite"
                  className="ir-chronicle-status text-sm font-semibold"
                >
                  {shareStatus}
                </span>
              </div>
            </div>
          );
        }

        return (
          <div>
            {chronicle.illustrationUrl ? (
              <figure className="ir-chronicle-figure mt-4 overflow-hidden rounded-md">
                <img
                  src={chronicle.illustrationUrl}
                  alt={`Illustration for ${title ?? 'Chronicle'}.`}
                  className="block h-auto w-full max-h-[230px] object-cover"
                />
              </figure>
            ) : null}
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="ir-chronicle-story mt-4 text-base leading-relaxed">
                {paragraph}
              </p>
            ))}
            <div className="ir-chronicle-share-row">
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="ir-chronicle-share inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Share this chronicle
              </button>
              <span
                role="status"
                aria-live="polite"
                className="ir-chronicle-status text-sm font-semibold"
              >
                {shareStatus}
              </span>
            </div>
            <div className="ir-chronicle-privacy mt-3 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
              Anyone with the link can read this chronicle. They see the story and the art. They do
              not see your notes or your sheet. You can turn the link off in the campaign menu.
            </div>
          </div>
        );
      }

      return (
        <div>
          {chronicle.illustrationUrl ? (
            <figure className="ir-chronicle-figure mt-4 overflow-hidden rounded-md">
              <img
                src={chronicle.illustrationUrl}
                alt={`Illustration for ${title ?? 'Chronicle'}.`}
                className="block h-auto w-full max-h-[230px] object-cover"
              />
            </figure>
          ) : null}
          {paragraphs[0] ? (
            <p className="ir-chronicle-story mt-4 text-base leading-relaxed">{paragraphs[0]}</p>
          ) : null}
          <div className="ir-chronicle-upgrade mt-5 flex flex-wrap items-center justify-between gap-4 rounded-md border border-border p-4">
            <div className="ir-chronicle-upgrade-text">
              <div className="ir-chronicle-upgrade-title">Read the full chronicle</div>
              <p className="ir-chronicle-upgrade-copy">
                The Pro plan writes the full story of each session, with an illustration, and lets
                you share it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/account')}
              className="ir-chronicle-upgrade-button inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              Upgrade to Pro
            </button>
          </div>
        </div>
      );
    }

    return <div className="ir-chronicle-state">No chronicle yet.</div>;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="ir-chronicle-dialog max-h-[80vh] overflow-y-auto">
        <div className="ir-chronicle-topbar">
          <div className="ir-chronicle-eyebrow text-xs font-bold tracking-widest text-muted-foreground">
            {eyebrow}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ir-chronicle-close inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-semibold"
          >
            Close
          </button>
        </div>
        <DialogTitle className="ir-chronicle-title text-2xl font-semibold">
          {title ?? 'Session Chronicle'}
        </DialogTitle>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
};

export default ChronicleDialog;
