import { ArrowLeft } from 'lucide-react';
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useOptionalCampaign } from '@/contexts/CampaignContext';
import { useOptionalCharacter } from '@/contexts/CharacterContext';

export type CampaignEndMode = 'fallen' | 'complete';

export type CampaignRunSummary = {
  turns: number | null;
  fights: number | null;
  monstersDefeated: number | null;
  rounds: number | null;
  fatalRoll: string | null;
};

export interface CampaignEndStateProps {
  mode: CampaignEndMode;
  characterName?: string | null;
  campaignName?: string | null;
  chooseHeroHref: string;
  chooseHeroPending?: boolean;
  finalLines?: string[];
  summary?: string | null;
  storyContent?: React.ReactNode;
  portraitUrl?: string | null;
  chapter?: string | null;
  epitaph?: string | null;
  narration?: string | null;
  runSummary?: CampaignRunSummary | null;
}

export const displayFinalLine = (line: string): string =>
  line.replace(/^⚙\uFE0F?\s*Engine:\s*/, '');

function isKnownRunSummary(
  summary: CampaignRunSummary | null | undefined,
): summary is CampaignRunSummary {
  return Boolean(
    summary && Object.values(summary).some((value) => value !== null && value !== undefined),
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number | string | null;
}): React.ReactElement | null {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-left">
      <dt className="ir-display text-xs uppercase tracking-[1.5px] text-white/55">{label}</dt>
      <dd className="ir-display mt-1 text-lg font-semibold text-infinite-gold-light">{value}</dd>
    </div>
  );
}

function Portrait({ name, portraitUrl }: { name: string; portraitUrl?: string | null }) {
  const [hasError, setHasError] = React.useState(false);
  React.useEffect(() => setHasError(false), [portraitUrl]);
  if (!portraitUrl || hasError) {
    return (
      <div
        role="img"
        aria-label={`${name} portrait unavailable`}
        className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-infinite-gold/55 bg-infinite-gold/10 md:h-32 md:w-32"
      >
        <span aria-hidden="true" className="ir-display text-4xl text-infinite-gold/80">
          ✦
        </span>
        <span className="sr-only">Portrait unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={portraitUrl}
      alt={name}
      onError={() => setHasError(true)}
      className="h-24 w-24 shrink-0 rounded-full border-2 border-infinite-gold/55 object-cover md:h-32 md:w-32"
    />
  );
}

export const CampaignEndState: React.FC<CampaignEndStateProps> = (props) => {
  const navigate = useNavigate();
  const optionalCharacter = useOptionalCharacter();
  const optionalCampaign = useOptionalCampaign();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const [view, setView] = React.useState<'end' | 'story'>('end');

  const character = optionalCharacter?.state.character;
  const campaign = optionalCampaign?.state.campaign;
  const name = props.characterName?.trim() || character?.name?.trim() || 'Your character';
  const campaignName = props.campaignName?.trim() || campaign?.name?.trim() || 'this campaign';
  const portraitUrl = props.portraitUrl ?? character?.image_url ?? character?.avatar_url ?? null;
  const identity = [
    character?.race?.name,
    character?.class?.name,
    character?.level ? `Level ${character.level}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const isFallen = props.mode === 'fallen';
  const screenLabel = isFallen ? `${name} has fallen` : 'Adventure complete';
  const staticFinalLine = `${name} is dead.`;
  const finalLines = props.finalLines?.length
    ? props.finalLines
    : isFallen
      ? [staticFinalLine]
      : [];
  const hasSummary = Boolean(props.summary?.trim());
  const experience = typeof character?.experience === 'number' ? character.experience : null;
  const runSummary = isKnownRunSummary(props.runSummary) ? props.runSummary : null;

  React.useEffect(() => {
    document.title = isFallen
      ? `${name} has fallen — Infinite Realms`
      : 'Adventure complete — Infinite Realms';
    headingRef.current?.focus();
  }, [isFallen, name]);

  if (view === 'story' && props.storyContent) {
    return (
      <main
        data-testid={`${isFallen ? 'death' : 'completion'}-screen-story`}
        className="flex h-full min-h-0 flex-col bg-infinite-dark text-foreground"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          <Button
            data-testid={`${isFallen ? 'death' : 'completion'}-screen-story-back`}
            variant="ghost"
            size="sm"
            className="min-h-11 text-foreground hover:bg-white/10 hover:text-infinite-gold-light"
            onClick={() => setView('end')}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <h1 tabIndex={-1} className="ir-display text-sm font-medium text-infinite-gold-light">
            {name} — {isFallen ? 'fallen' : 'adventure complete'}
          </h1>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto max-w-2xl">{props.storyContent}</div>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid={isFallen ? 'death-screen' : 'completion-screen'}
      className="ir-end-state flex h-full min-h-0 w-full flex-1 overflow-y-auto bg-infinite-dark text-foreground"
    >
      <div className="mx-auto flex w-full max-w-[640px] flex-col px-4 pb-28 pt-6 sm:px-6 md:justify-center md:pb-8 md:pt-10">
        <div className="space-y-6 rounded-[13px] border border-white/10 bg-[linear-gradient(180deg,#111726_0%,#0e1422_100%)] p-5 shadow-2xl sm:p-8">
          <header className="space-y-4 text-center">
            <p className="ir-display text-xs font-semibold uppercase tracking-[2px] text-infinite-gold">
              {campaignName}
            </p>
            <div className="flex justify-center">
              <Portrait name={name} portraitUrl={portraitUrl} />
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="ir-display break-words text-3xl font-semibold leading-tight text-foreground outline-none sm:text-4xl"
            >
              {screenLabel}
            </h1>
            {identity && <p className="text-sm text-white/65">{identity}</p>}
            {props.chapter && <p className="text-sm text-white/65">{props.chapter}</p>}
            {props.epitaph && (
              <p className="ir-narr text-base italic text-white/75">{props.epitaph}</p>
            )}
            <div className="ir-display text-xl text-infinite-gold" aria-hidden="true">
              ───── ✦ ─────
            </div>
            <p className="text-base leading-relaxed text-white/75">
              {isFallen
                ? 'Their tale ends here. The campaign does not.'
                : `${name} has finished ${campaignName}. The story is complete.`}
            </p>
          </header>

          {isFallen && (props.narration || finalLines.length > 0) && (
            <section aria-labelledby="how-they-fell" className="space-y-3 text-left">
              <h2
                id="how-they-fell"
                className="ir-display text-xs font-semibold uppercase tracking-[1.5px] text-infinite-gold"
              >
                How they fell
              </h2>
              {props.narration && (
                <p className="ir-narr rounded-md border-l-[5px] border-infinite-gold/60 bg-black/20 px-4 py-3 text-sm leading-relaxed text-white/80">
                  {props.narration}
                </p>
              )}
              <div data-testid="death-screen-final-lines" className="space-y-2">
                {finalLines.map((line, index) => (
                  <p
                    key={`${line}-${index}`}
                    className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm leading-relaxed text-white/75"
                  >
                    {displayFinalLine(line)}
                  </p>
                ))}
              </div>
            </section>
          )}

          {runSummary && (
            <section aria-labelledby="run-summary" className="space-y-3 text-left">
              <h2
                id="run-summary"
                className="ir-display text-xs font-semibold uppercase tracking-[1.5px] text-infinite-gold"
              >
                The run
              </h2>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Turns" value={runSummary.turns} />
                <Stat label="Fights" value={runSummary.fights} />
                <Stat label="Monsters defeated" value={runSummary.monstersDefeated} />
                <Stat label="Rounds" value={runSummary.rounds} />
                <Stat label="Fatal roll" value={runSummary.fatalRoll} />
              </dl>
            </section>
          )}

          {hasSummary && !isFallen && (
            <section
              data-testid="completion-screen-summary"
              className="border-l-[5px] border-infinite-gold/60 bg-black/20 px-4 py-3 text-left text-sm leading-relaxed text-white/80"
            >
              {props.summary}
            </section>
          )}

          {!isFallen && experience !== null && (
            <p
              data-testid="completion-screen-experience"
              className="ir-display text-center text-sm text-infinite-gold-light"
            >
              {experience.toLocaleString()} XP
            </p>
          )}

          <div className="space-y-3 text-left">
            {props.storyContent && (
              <Button
                data-testid={`${isFallen ? 'death' : 'completion'}-screen-read-story`}
                variant="outline"
                className="min-h-11 w-full border-white/20 bg-transparent text-foreground hover:border-infinite-gold/60 hover:bg-infinite-gold/10 hover:text-infinite-gold-light"
                onClick={() => setView('story')}
              >
                Read the story so far
              </Button>
            )}
            <div className="sticky bottom-0 -mx-1 space-y-1 rounded-lg bg-infinite-dark/95 p-1 backdrop-blur md:static md:bg-transparent md:p-0">
              <Button
                data-testid={`${isFallen ? 'death' : 'completion'}-screen-${isFallen ? 'new-character' : 'new-character'}`}
                className="ir-gold-button min-h-11 w-full"
                onClick={() => navigate(props.chooseHeroHref)}
                disabled={props.chooseHeroPending}
              >
                {isFallen ? 'Choose a new hero' : 'Begin again with a new hero'}
              </Button>
              <p className="text-center text-xs leading-relaxed text-white/60">
                Begin {campaignName} again with a new hero. {name}&rsquo;s story is kept.
              </p>
            </div>
            <Button
              data-testid={`${isFallen ? 'death' : 'completion'}-screen-explore`}
              variant="ghost"
              className="min-h-11 w-full text-white/75 hover:bg-white/10 hover:text-infinite-gold-light"
              onClick={() => navigate('/explore')}
            >
              Explore other campaigns
            </Button>
            <Link
              to="/app"
              className="block min-h-11 py-3 text-center text-sm text-white/65 underline-offset-4 hover:text-infinite-gold-light hover:underline"
            >
              Back to your realm
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
};
