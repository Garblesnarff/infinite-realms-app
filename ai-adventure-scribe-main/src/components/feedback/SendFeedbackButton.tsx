import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { SendFeedbackModal } from './SendFeedbackModal';

import { Button, type ButtonProps } from '@/components/ui/button';

interface SendFeedbackButtonProps extends Omit<ButtonProps, 'onClick'> {
  campaignSlug?: string;
  sessionId?: string;
}

/** A button that opens the Send feedback modal for the current route. */
export const SendFeedbackButton: React.FC<SendFeedbackButtonProps> = ({
  campaignSlug,
  sessionId,
  children,
  variant = 'outline',
  size = 'sm',
  ...buttonProps
}) => {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        {...buttonProps}
        onClick={() => setOpen(true)}
      >
        {children ?? 'Send feedback'}
      </Button>
      <SendFeedbackModal
        open={open}
        onOpenChange={setOpen}
        page={pathname}
        campaignSlug={campaignSlug}
        sessionId={sessionId}
      />
    </>
  );
};
