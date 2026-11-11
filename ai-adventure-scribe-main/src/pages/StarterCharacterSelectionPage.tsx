/**
 * Starter Character Selection Page — retired (#89).
 *
 * Route: /explore/:slug/choose-character
 *
 * Choosing a hero now happens on the campaign page itself ("Choose your
 * hero"); this route redirects there, to the heroes section. The route
 * itself is kept so older links — including the game-over screen's
 * restart link — land on a valid restart path instead of a dead page.
 * The redirect keeps ?campaignId=, so the hero pick plays in the same
 * campaign the player came from.
 */

import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

const StarterCharacterSelectionPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { search } = useLocation();
  return <Navigate to={`/explore/${slug}${search}#heroes`} replace />;
};

export default StarterCharacterSelectionPage;
