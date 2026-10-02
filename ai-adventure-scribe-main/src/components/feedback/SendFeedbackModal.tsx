import React, { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { FEEDBACK_MESSAGE_MAX, submitFeedback } from '@/services/feedback-api';

interface SendFeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: string;
  campaignSlug?: string;
  sessionId?: string;
}

export const SendFeedbackModal: React.FC<SendFeedbackModalProps> = ({
  open,
  onOpenChange,
  page,
  campaignSlug,
  sessionId,
}) => {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorText, setErrorText] = useState('');

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setMessage('');
      setStatus('idle');
      setErrorText('');
    }
    onOpenChange(next);
  };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!message.trim() || status === 'sending') return;
    setStatus('sending');
    try {
      await submitFeedback({ message: message.trim(), page, campaignSlug, sessionId });
      setStatus('sent');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not send');
      setStatus('error');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Tell us what happened or what you would change.</DialogDescription>
        </DialogHeader>
        {status === 'sent' ? (
          <>
            <p role="status">Thanks. We read every message.</p>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Textarea
              aria-label="Your feedback"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={FEEDBACK_MESSAGE_MAX}
              rows={6}
              placeholder="Your feedback"
            />
            {status === 'error' && (
              <p role="alert" className="text-sm text-destructive">
                {errorText}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={!message.trim() || status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
