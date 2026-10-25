/**
 * Starter Character Selection Page — retired (#89).
 *
 * Route: /explore/:slug/choose-character
 *
 * Choosing a hero now happens on the campaign page itself ("Choose your
 * hero"); this route redirects there, to the heroes section. The route
 * itself is kept so older links — including the game-over screen's
 * restart link — land on a valid restart path instead of a dead page.
 * Note the redirect drops ?campaignId=: the campaign page re-resolves the
 * instance by starter title, which is the same resolution the old detail
 * page performed — valid, but not the identical instance if a user somehow
 * holds two campaigns with the same title.
 */

import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

const StarterCharacterSelectionPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={`/explore/${slug}#heroes`} replace />;
};

export default StarterCharacterSelectionPage;
