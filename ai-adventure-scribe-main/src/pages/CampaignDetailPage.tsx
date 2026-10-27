/**
 * Campaign Detail Page (#89)
 *
 * Starter campaign overview with the hero list inline: "Play as …" starts
 * the game in one click (resolve-or-create the campaign, seed the chosen
 * premade, navigate to the game). The retired /choose-character route
 * redirects here, to #heroes.
 *
 * Route: /explore/:slug
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  computeServerArmorClass,
  withStartingPackageEquipped,
} from '../../shared/creation-armor-class';
import { computeMaxHitPointsForLevel } from '../../shared/level-1-hit-points';

import type { StarterCharacterTemplate } from '@/hooks/use-starter-character-templates';

import { CAMPAIGN_ARTWORK_PLACEHOLDER } from '@/components/campaigns/campaign-artwork';
import { StarterCharacterPortrait } from '@/components/campaigns/StarterCharacterPortrait';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useStarterCampaign } from '@/hooks/use-starter-campaigns';
import { useStarterCharacterTemplates } from '@/hooks/use-starter-character-templates';
import logger from '@/lib/logger';
import {
  getAbilityScores,
  seedStarterCharacter,
  transformStarterEquipment,
} from '@/services/character/starter-character-seeding';
import { resolveOrCreateStarterCampaign } from '@/services/starter-campaign-bootstrap';
import { userDataApi } from '@/services/user-data-api';
import { previewCampaignOverview } from '@/utils/campaign/preview-campaign-overview';
import { formatStarterCampaignLength } from '@/utils/campaign/starter-campaign-length';
import { formatStarterLevelRange } from '@/utils/campaign/starter-level-range';

/** Session key for the hero a signed-out visitor picked before signing in. */
const PENDING_HERO_KEY = 'ir-pending-starter-hero';

/**
 * A pending hero older than this is dead: the sign-in round trip it was
 * stored for takes minutes, not a tab session. Without a TTL, a return that
 * never lands leaves the entry for the rest of the tab, and a later visit
 * to the same campaign while signed in would silently start a campaign and
 * a character with no click.
 */
const PENDING_HERO_TTL_MS = 10 * 60 * 1000;

/** A request error carrying an HTTP status (user-data-api errors do). */
function isUnauthorizedError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 401;
}

/**
 * Cut a preview at the last sentence end so the details story never ends
 * mid-sentence. A preview with no sentence end keeps its truncation marker.
 * Dots inside an authorial ellipsis ("paused... then left") are not sentence
 * ends, so an ellipsis tail is never cut off mid-thought.
 */
function cutAtSentenceEnd(text: string): string {
  const withoutEllipsis = text.replace(/\.{3}\s*$/, '');
  const matches = [...withoutEllipsis.matchAll(/[.!?](?=\s|$)/g)].filter((match) => {
    const index = match.index ?? 0;
    return withoutEllipsis[index - 1] !== '.' && withoutEllipsis[index + 1] !== '.';
  });
  if (matches.length === 0) return text;
  const last = matches[matches.length - 1];
  return withoutEllipsis.slice(0, (last.index ?? 0) + 1);
}

/**
 * The HP/AC the in-game sheet will show for this template. HP and AC are
 * server-computed (#620), so this calls the same shared helpers over the
 * same seed inputs the server sees (ability scores, class, level, subclass
 * for Draconic, equipped kit) — never invented numbers.
 */
function templateVitals(template: StarterCharacterTemplate): { hp: number; ac: number } {
  const scores = getAbilityScores(template);
  const level = Math.max(1, template.level || 1);
  const draconicBloodline = template.subclass === 'Draconic Bloodline';
  const hp = computeMaxHitPointsForLevel(
    template.class,
    scores.constitution,
    template.subrace,
    level,
    { draconicBloodline },
  );
  const worn = withStartingPackageEquipped(
    transformStarterEquipment(template.equipment || []).map((item) => ({
      item_name: item.item_name,
      item_type: item.item_type,
      equipped: item.equipped,
    })),
  );
  const ac = computeServerArmorClass(
    template.class,
    {
      dexterity: scores.dexterity,
      constitution: scores.constitution,
      wisdom: scores.wisdom,
    },
    worn.map((item) => ({
      item_name: typeof item.item_name === 'string' ? item.item_name : null,
      item_type: typeof item.item_type === 'string' ? item.item_type : null,
      equipped: Boolean(item.equipped),
    })),
    undefined,
    draconicBloodline,
  );
  return { hp, ac };
}

interface HeroCardProps {
  template: StarterCharacterTemplate;
  isStarting: boolean;
  startDisabled: boolean;
  signedIn: boolean;
  onPlay: (template: StarterCharacterTemplate) => void;
}

const HeroCard: React.FC<HeroCardProps> = ({
  template,
  isStarting,
  startDisabled,
  signedIn,
  onPlay,
}) => {
  // One template with an unresolvable class must not blank the page: the
  // vitals line degrades away and the hero stays startable (a start then
  // fails honestly on the server side, which throws for the same template).
  let vitals: { hp: number; ac: number } | null = null;
  try {
    vitals = templateVitals(template);
  } catch {
    vitals = null;
  }
  return (
    <article
      className={`grid grid-cols-[64px_minmax(0,1fr)] gap-3 p-3.5 rounded-[13px] border bg-[color:var(--infinite-surface)] ${
        isStarting ? 'border-infinite-gold shadow-glow-gold' : 'border-white/10'
      }`}
    >
      <StarterCharacterPortrait
        name={template.name}
        portraitUrl={template.portraitUrl}
        fallback={<span className="text-2xl text-muted-foreground">{template.name.charAt(0)}</span>}
        className="h-16 w-16 max-[700px]:h-12 max-[700px]:w-12 rounded-[10px] border border-infinite-gold/45"
      />
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-foreground truncate">{template.name}</h3>
        <p className="text-[13px] text-muted-foreground">
          {template.race} {template.class} · Level {template.level}
        </p>
        {template.tagline && (
          <p className="text-sm text-muted-foreground max-[700px]:hidden">{template.tagline}</p>
        )}
        {vitals && (
          <p className="text-sm text-muted-foreground">
            HP <strong className="text-foreground">{vitals.hp}</strong> · AC{' '}
            <strong className="text-foreground">{vitals.ac}</strong>
          </p>
        )}
      </div>
      <div className="col-span-2">
        <Button
          variant="ir-gold"
          disabled={startDisabled}
          onClick={() => onPlay(template)}
          className="w-full min-h-11"
        >
          {signedIn ? `Play as ${template.name}` : `Sign in to play as ${template.name}`}
        </Button>
      </div>
    </article>
  );
};

const CampaignDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { campaign, isLoading: campaignLoading, error: campaignError } = useStarterCampaign(slug);
  const {
    templates,
    isLoading: templatesLoading,
    error: templatesError,
    retry: retryTemplates,
  } = useStarterCharacterTemplates(campaign?.id);
  const [startingTemplate, setStartingTemplate] = React.useState<StarterCharacterTemplate | null>(
    null,
  );
  const [failedTemplate, setFailedTemplate] = React.useState<StarterCharacterTemplate | null>(null);
  const [sessionExpired, setSessionExpired] = React.useState(false);
  // #209: synchronous in-flight guard — the disabled button lags a render
  // behind, so a double-click would otherwise seed two characters.
  const startingRef = React.useRef(false);
  const campaignBannerImage = campaign?.bannerImageUrl || campaign?.coverImageUrl || null;
  const [bannerImage, setBannerImage] = React.useState(
    campaignBannerImage || CAMPAIGN_ARTWORK_PLACEHOLDER,
  );
  const [artworkUnavailable, setArtworkUnavailable] = React.useState(!campaignBannerImage);
  const overviewPreview = campaign?.overview ? previewCampaignOverview(campaign.overview) : '';

  React.useEffect(() => {
    setBannerImage(campaignBannerImage || CAMPAIGN_ARTWORK_PLACEHOLDER);
    setArtworkUnavailable(!campaignBannerImage);
  }, [campaignBannerImage]);

  const handleBannerImageError = (): void => {
    if (bannerImage === CAMPAIGN_ARTWORK_PLACEHOLDER) return;
    setBannerImage(CAMPAIGN_ARTWORK_PLACEHOLDER);
    setArtworkUnavailable(true);
  };

  /**
   * One-click start: resolve-or-create the campaign, seed the chosen
   * premade, navigate to the game. No toast in between. The two client
   * steps run in sequence as the ticket's first cut (no server "start
   * starter campaign" route exists yet).
   */
  const playAs = React.useCallback(
    async (template: StarterCharacterTemplate): Promise<void> => {
      if (!user) {
        try {
          sessionStorage.setItem(
            PENDING_HERO_KEY,
            JSON.stringify({ slug, templateId: template.id, at: Date.now() }),
          );
        } catch {
          // Storage unavailable: sign-in still proceeds, auto-start just
          // cannot resume afterwards.
        }
        const apiUrl = import.meta.env?.VITE_API_URL || '';
        window.location.href = `${apiUrl}/v1/auth/login?returnTo=${encodeURIComponent(`/explore/${slug}#heroes`)}`;
        return;
      }

      if (!campaign || startingRef.current) return;
      startingRef.current = true;
      setStartingTemplate(template);
      setFailedTemplate(null);
      setSessionExpired(false);

      try {
        const campaignId = await resolveOrCreateStarterCampaign(campaign, userDataApi, (message) =>
          logger.info(message),
        );
        const character = await seedStarterCharacter(template, campaignId, (payload) =>
          userDataApi.createCharacter(payload),
        );
        // Same target the retired selection page used.
        navigate(
          `/app/game/${campaignId}?character=${character.id}&starterCampaign=${campaign.id}&new=true`,
        );
      } catch (err) {
        logger.error('Error starting adventure:', err);
        if (isUnauthorizedError(err)) {
          try {
            sessionStorage.setItem(
              PENDING_HERO_KEY,
              JSON.stringify({ slug, templateId: template.id, at: Date.now() }),
            );
          } catch {
            // Ignore: the sign-in banner still offers a manual retry.
          }
          setSessionExpired(true);
        } else {
          setFailedTemplate(template);
        }
      } finally {
        startingRef.current = false;
        setStartingTemplate(null);
      }
    },
    [campaign, navigate, slug, user],
  );

  const playAsRef = React.useRef(playAs);
  playAsRef.current = playAs;

  // #1122: the pending hero is a promise made for one trip, the sign-in round
  // trip. Only the auth callback's navigation back here carries
  // `state.authReturn` (CallbackPage). The marker belongs to that one
  // navigation, not to the mount (the route has no key, so an in-app link to
  // the same slug keeps this component mounted):
  // - On the return, the marker is read and cleared from history at once
  //   (replace, state null), so back/forward/reload of that entry cannot
  //   re-arm it. The replaced entry's key is then the return visit's key.
  // - Any other navigation (a link, a reload, back/forward) ends the return
  //   visit and drops a leftover entry instead of starting a campaign the
  //   player did not just ask for.
  // - The return visit resumes the pending hero at most once.
  const location = useLocation();
  const returnVisitKeyRef = React.useRef<string | null>(null);
  const clearingMarkerRef = React.useRef(false);
  React.useEffect(() => {
    if ((location.state as { authReturn?: unknown } | null)?.authReturn === true) {
      clearingMarkerRef.current = true;
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: null,
      });
      return;
    }
    if (clearingMarkerRef.current) {
      clearingMarkerRef.current = false;
      returnVisitKeyRef.current = location.key;
      return;
    }
    returnVisitKeyRef.current = null;
    try {
      sessionStorage.removeItem(PENDING_HERO_KEY);
    } catch {
      // Storage unavailable: there is no entry to drop either.
    }
    // location.key changes on every navigation, including a same-path one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // Continue the start automatically when a signed-out visitor comes back
  // from sign-in with a pending hero for this campaign. The pending hero
  // survives a failed templates fetch (the retry can still resume it); it
  // is only dropped once the templates load cleanly and the hero is not
  // among them, i.e. genuinely gone rather than transiently missing.
  React.useEffect(() => {
    if (returnVisitKeyRef.current === null || returnVisitKeyRef.current !== location.key) return;
    if (!user || !campaign || templatesLoading) return;
    let pending: unknown = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_HERO_KEY) ?? 'null');
    } catch {
      pending = null;
    }
    if (!pending || typeof pending !== 'object') return;
    const {
      slug: pendingSlug,
      templateId,
      at,
    } = pending as {
      slug?: unknown;
      templateId?: unknown;
      at?: unknown;
    };
    if (pendingSlug !== slug) return;
    // Stale first, before the templates-error early return: a dead entry is
    // removed even when the heroes fetch is failing. An entry without a
    // timestamp is treated as stale (this build always writes one).
    if (typeof at !== 'number' || Date.now() - at > PENDING_HERO_TTL_MS) {
      sessionStorage.removeItem(PENDING_HERO_KEY);
      returnVisitKeyRef.current = null;
      return;
    }
    if (templatesError) return;
    const template = templates.find((candidate) => candidate.id === templateId);
    sessionStorage.removeItem(PENDING_HERO_KEY);
    // Resumed (or found gone) once: an entry the start re-arms (a 401 inside
    // playAs) waits for the next return, never for this visit's next render.
    returnVisitKeyRef.current = null;
    if (template) void playAsRef.current(template);
  }, [user, campaign, templatesLoading, templatesError, templates, slug, location.key]);

  // A sign-in by any path clears a stale session-expired banner and refetches
  // the heroes, so a signed-in user never stares at "Your sign-in has
  // expired." after re-authenticating. A sign-out clears the banner too.
  const userId = user?.id ?? null;
  // undefined = not observed yet: the first run only records, so an
  // already-signed-in mount does not refetch heroes it just loaded.
  const prevUserIdRef = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    const prevUserId = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (prevUserId === undefined || prevUserId === userId) return;
    setSessionExpired(false);
    if (prevUserId === null && userId !== null) retryTemplates();
  }, [userId, retryTemplates]);

  // The retired /choose-character route redirects here with #heroes; scroll
  // to the section once the campaign (and therefore the section) exists.
  React.useEffect(() => {
    if (campaign && window.location.hash === '#heroes') {
      document.getElementById('heroes')?.scrollIntoView();
    }
  }, [campaign]);

  const handleSignIn = React.useCallback((): void => {
    const apiUrl = import.meta.env?.VITE_API_URL || '';
    window.location.href = `${apiUrl}/v1/auth/login?returnTo=${encodeURIComponent(`/explore/${slug}#heroes`)}`;
  }, [slug]);

  const showSessionExpired =
    sessionExpired || (templatesError !== null && isUnauthorizedError(templatesError));
  const showTemplatesError = templatesError !== null && !isUnauthorizedError(templatesError);

  // Loading state
  if (campaignLoading) {
    return (
      <div className="ir-app min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="h-[50vh] bg-white/10 animate-pulse rounded-[13px]" />
          <div className="h-12 bg-white/10 rounded animate-pulse mb-4 mt-8" />
          <div className="h-6 bg-white/10 rounded animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  // Error or not found
  if (campaignError || !campaign) {
    return (
      <div className="ir-app min-h-screen bg-background flex items-center justify-center">
        <div className="text-center px-6">
          <h1 className="text-4xl font-bold text-foreground mb-4">Campaign Not Found</h1>
          <p className="text-muted-foreground mb-8">
            The campaign you&apos;re looking for doesn&apos;t exist or isn&apos;t available yet.
          </p>
          <Link to="/explore" className="text-infinite-gold underline">
            All campaigns
          </Link>
        </div>
      </div>
    );
  }

  // The level segment is omitted when the campaign declares no range: the
  // old page omitted it too, and asserting Level 1 for a range-less campaign
  // would fabricate a fact. (The ticket's "Level 1" is the level-1 case.)
  const metaSegments: React.ReactNode[] = [];
  if (campaign.levelRange) {
    metaSegments.push(
      <span key="level">Level {formatStarterLevelRange(campaign.levelRange)}</span>,
    );
  }
  const sessionsLabel =
    formatStarterCampaignLength(campaign.overview) ??
    (campaign.estimatedSessions ? `${campaign.estimatedSessions} sessions` : null);
  if (sessionsLabel) metaSegments.push(<span key="sessions">{sessionsLabel}</span>);
  if (campaign.tone.length > 0) {
    metaSegments.push(
      <span key="tone" className="capitalize">
        Tone: {campaign.tone.slice(0, 3).join(', ')}
      </span>,
    );
  }

  const premise = campaign.premise?.trim();
  const overviewStory = overviewPreview ? cutAtSentenceEnd(overviewPreview) : '';
  const hasStory = Boolean(premise || overviewStory);

  return (
    <div className="ir-app min-h-screen bg-background">
      <Helmet>
        <title>{campaign.title} | Infinite Realms</title>
        <meta name="description" content={campaign.premise} />
        <meta property="og:title" content={`${campaign.title} | Infinite Realms`} />
        <meta property="og:description" content={campaign.premise} />
        {/* #355: declare the full tag set — react-helmet-async deletes managed
            (data-rh) tags a page does not redeclare, so a partial set would wipe
            the static og:image / twitter cards from index.html. */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`https://infiniterealms.app/explore/${slug}`} />
        <meta
          property="og:image"
          content={campaign.coverImageUrl ?? 'https://infiniterealms.app/og-image.png'}
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${campaign.title} | Infinite Realms`} />
        <meta name="twitter:description" content={campaign.premise} />
        <meta
          name="twitter:image"
          content={campaign.coverImageUrl ?? 'https://infiniterealms.app/og-image.png'}
        />
      </Helmet>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Back link + step hint */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <Link to="/explore" className="text-sm text-infinite-gold hover:underline">
            ← All campaigns
          </Link>
          <p className="text-[13px] text-muted-foreground">
            1 Campaign › <strong className="text-foreground">2 Hero</strong> › 3 Play
          </p>
        </div>

        {/* Header: art + title + hook + meta */}
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6 items-center mb-12">
          <img
            src={bannerImage}
            alt={
              artworkUnavailable
                ? `${campaign.title} artwork coming soon`
                : `${campaign.title} artwork`
            }
            onError={handleBannerImageError}
            className="w-full aspect-video max-[700px]:aspect-[21/9] object-cover rounded-[13px]"
          />
          <div>
            <h1 className="font-heading text-[34px] max-[700px]:text-[26px] leading-tight text-foreground">
              {campaign.title}
            </h1>
            {campaign.tagline && (
              <p className="text-muted-foreground mt-2 line-clamp-3">{campaign.tagline}</p>
            )}
            <p className="text-sm text-muted-foreground mt-3">
              {metaSegments.map((segment, index) => (
                <React.Fragment key={index}>
                  {index > 0 && ' · '}
                  {segment}
                </React.Fragment>
              ))}
            </p>
          </div>
        </div>

        {/* About this campaign: closed by default; story as plain text, cut
            at a sentence end. Hidden when there is no story (#2281). */}
        {hasStory && (
          <details className="mb-12 rounded-[13px] border border-white/10 bg-[color:var(--infinite-surface)] p-4">
            <summary className="cursor-pointer font-heading text-xl text-infinite-gold">
              About this campaign
            </summary>
            <div className="mt-3 space-y-4 text-muted-foreground leading-relaxed">
              {premise && <p className="whitespace-pre-line">{premise}</p>}
              {overviewStory && <p className="whitespace-pre-line">{overviewStory}</p>}
            </div>
          </details>
        )}

        {/* Heroes */}
        <section id="heroes" className="mb-12">
          <h2 className="font-heading text-xl text-infinite-gold mb-1">Choose your hero</h2>
          <p className="text-[13px] text-muted-foreground mb-4">
            You can read the full sheet after you start.
          </p>

          {templatesLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" aria-busy="true">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="p-3.5 rounded-[13px] border border-white/10 bg-[color:var(--infinite-surface)] animate-pulse"
                >
                  <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                    <div className="h-16 w-16 rounded-[10px] bg-white/10" />
                    <div className="space-y-2">
                      <div className="h-4 bg-white/10 rounded w-2/3" />
                      <div className="h-3 bg-white/10 rounded w-1/2" />
                      <div className="h-3 bg-white/10 rounded w-3/4" />
                      <div className="h-3 bg-white/10 rounded w-1/3" />
                    </div>
                  </div>
                  <div className="h-11 bg-white/10 rounded mt-3" />
                </div>
              ))}
            </div>
          ) : showSessionExpired ? (
            <div
              role="alert"
              className="rounded-[13px] border border-infinite-gold/50 bg-infinite-gold/[.07] p-4"
            >
              <p className="font-semibold text-foreground">Your sign-in has expired.</p>
              <p className="text-sm text-muted-foreground mt-1">Sign in again to pick a hero.</p>
              {/* #1122: the return is real now (login carries returnTo; the callback comes back here). */}
              <p className="text-sm text-muted-foreground">You come back to this page.</p>
              <Button variant="ir-gold" onClick={handleSignIn} className="mt-3 min-h-11">
                Sign in
              </Button>
            </div>
          ) : showTemplatesError ? (
            <div
              role="alert"
              className="rounded-[13px] border border-[color:color-mix(in_srgb,var(--ir-hp-bad)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--ir-hp-bad)_7%,transparent)] p-4"
            >
              <p className="font-semibold text-foreground">We could not load the heroes.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Try again. If it keeps failing, pick another campaign.
              </p>
              <Button variant="ir-gold" onClick={retryTemplates} className="mt-3 min-h-11">
                Try again
              </Button>
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-[13px] border border-white/10 bg-[color:var(--infinite-surface)] p-6 text-center">
              <p className="font-semibold text-foreground">
                Heroes for this campaign are not ready yet.
              </p>
              <p className="text-sm text-muted-foreground mt-1">Try one of the other campaigns.</p>
              <Link to="/explore">
                <Button variant="ir-gold" className="mt-3 min-h-11">
                  All campaigns
                </Button>
              </Link>
            </div>
          ) : (
            <>
              {failedTemplate && (
                <div
                  role="alert"
                  className="rounded-[13px] border border-[color:color-mix(in_srgb,var(--ir-hp-bad)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--ir-hp-bad)_7%,transparent)] p-4 mb-4"
                >
                  <p className="font-semibold text-foreground">We could not start the adventure.</p>
                  <p className="text-sm text-muted-foreground mt-1">Nothing was lost. Try again.</p>
                  <Button
                    variant="ir-gold"
                    onClick={() => void playAs(failedTemplate)}
                    className="mt-3 min-h-11"
                  >
                    Try again
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {templates.map((template) => (
                  <HeroCard
                    key={template.id}
                    template={template}
                    isStarting={startingTemplate?.id === template.id}
                    startDisabled={startingTemplate !== null}
                    signedIn={Boolean(user)}
                    onPlay={(candidate) => void playAs(candidate)}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="border-t border-white/10 py-8">
        <div className="max-w-4xl mx-auto px-6 text-center text-muted-foreground text-sm">
          <p>
            <Link to="/" className="hover:text-infinite-gold transition-colors">
              Infinite Realms
            </Link>{' '}
            - Where Every Choice Shapes Destiny
          </p>
        </div>
      </div>

      {/* Starting overlay */}
      {startingTemplate && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[rgba(4,7,13,.8)]"
        >
          <div className="flex gap-2" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-infinite-gold animate-bounce" />
            <span className="h-2.5 w-2.5 rounded-full bg-infinite-gold animate-bounce [animation-delay:150ms]" />
            <span className="h-2.5 w-2.5 rounded-full bg-infinite-gold animate-bounce [animation-delay:300ms]" />
          </div>
          <p className="font-heading text-xl text-infinite-gold">Starting your adventure</p>
          <p className="text-sm text-muted-foreground">
            Setting up {campaign.title} for {startingTemplate.name}…
          </p>
        </div>
      )}
    </div>
  );
};

export default CampaignDetailPage;
