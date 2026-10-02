import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { SendFeedbackButton } from '@/components/feedback/SendFeedbackButton';

/**
 * Header "Send feedback" button for the game screen. Reads the campaign and session from the
 * URL (/app/game/:id?session=...), so GameMainContent passes it nothing.
 */
export const GameFeedbackButton: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  return (
    <SendFeedbackButton campaignSlug={id} sessionId={searchParams.get('session') ?? undefined} />
  );
};
