import { ArrowLeft } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { planHasPaidFeatures } from '../../../../../../shared/plan-features';

import { Button } from '@/components/ui/button';
import { useOptionalAuth } from '@/contexts/AuthContext';
import CampaignSelectionModal from '@/features/character/components/list/campaign-selection-modal';

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
  /** #1215: null hides the hero-pick button and its sentence (no campaign to return to). */
  chooseHeroHref: string | null;
  chooseHeroPending?: boolean;
  finalLines?: string[];
  summary?: string | null;
  storyContent?: React.ReactNode;
  portraitUrl?: string | null;
  chapter?: string | null;
  epitaph?: string | null;
  narration?: string | null;
  runSummary?: CampaignRunSummary | null;
  identity?: string | null;
  experience?: number | null;
  /**
   * #1239: character the "take into a new adventure" offer carries. Legend
   * opens the campaign picker only when this is set.
   */
  characterId?: string | null;
  /**
   * #1239: a premade hero. The offer is hidden unless premadeKept. Kept means
   * a copy on the player's roster. There is no keep column; live end screens
   * pass premade false because the character on screen is already that copy.
   */
  premade?: boolean;
  premadeKept?: boolean;
}

export const displayFinalLine = (line: string): string =>
  line.replace(/^⚙\uFE0F?\s*Engine:\s*/, '');

/** #1239: the offer is for a hero the player owns, or a premade they chose to keep. */
function offerTakeHero(premade: boolean | undefined, premadeKept: boolean | undefined): boolean {
  return premade !== true || premadeKept === true;
}

const LEGEND_GATE_SENTENCE = 'Your hero and their story are kept. Legend lets you play them again.';

function TakeHeroOffer({
  name,
  characterId,
  testIdPrefix,
}: {
  name: string;
  characterId?: string | null;
  testIdPrefix: 'death' | 'completion';
}): React.ReactElement {
  const auth = useOptionalAuth();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [gateOpen, setGateOpen] = React.useState(false);
  const paid = planHasPaidFeatures(auth?.userPlan);
  const planLoading = auth?.userPlanLoading === true;
  const planFailed = auth?.userPlanError === true;
  const onTake = (): void => {
    if (paid && characterId) {
      setGateOpen(false);
      setPickerOpen(true);
      return;
    }
    setPickerOpen(false);
    // No provider (the end state can render outside auth in tests) and a
    // known free plan show the gate. A plan that is still loading, or a
    // failed plan fetch, must not be painted as Free (#351) and must not
    // open the picker.
    if (auth == null || (!planLoading && !planFailed && !paid)) {
      setGateOpen(true);
    }
  };
  return (
    <div className="space-y-2">
      <Button
        type="button"
        data-testid={`${testIdPrefix}-screen-take-hero`}
        variant="outline"
        className="min-h-11 w-full border-white/20 bg-transparent text-foreground hover:border-infinite-gold/60 hover:bg-infinite-gold/10 hover:text-infinite-gold-light"
        onClick={onTake}
      >
        Take {name} into a new adventure
      </Button>
      {gateOpen ? (
        <p
          role="status"
          data-testid="take-hero-legend-gate"
          className="text-center text-sm leading-relaxed text-white/75"
        >
          {LEGEND_GATE_SENTENCE}
        </p>
      ) : null}
      {pickerOpen && characterId ? (
        <CampaignSelectionModal
          isOpen
          onClose={() => setPickerOpen(false)}
          characterId={characterId}
        />
      ) : null}
    </div>
  );
}

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
    <div className="min-w-0 px-3 py-2.5 text-left">
      <dt className="ir-end-muted text-[13px] text-white/65">{label}</dt>
      <dd className="ir-display ir-end-title mt-0.5 text-xl font-bold tabular-nums text-foreground">
        {value}
      </dd>
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
        className="ir-end-portrait flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-infinite-gold/55 bg-infinite-gold/10 md:h-32 md:w-32 [body.ir-table-look_&]:h-32 [body.ir-table-look_&]:w-32 [body.ir-table-look_&]:border-transparent [body.ir-table-look_&]:bg-[#0c1220]"
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
      className="ir-end-portrait h-24 w-24 shrink-0 rounded-full border-2 border-infinite-gold/55 object-cover md:h-32 md:w-32 [body.ir-table-look_&]:h-32 [body.ir-table-look_&]:w-32 [body.ir-table-look_&]:border-transparent [body.ir-table-look_&]:grayscale-[.85] [body.ir-table-look_&]:brightness-90"
    />
  );
}

export const CampaignEndState: React.FC<CampaignEndStateProps> = (props) => {
  const navigate = useNavigate();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const [view, setView] = React.useState<'end' | 'story'>('end');

  const name = props.characterName?.trim() || 'Your character';
  const campaignName = props.campaignName?.trim() || 'this campaign';
  const portraitUrl = props.portraitUrl ?? null;
  const identity = props.identity?.trim() || '';
  const isFallen = props.mode === 'fallen';
  const screenLabel = isFallen ? `${name} has fallen` : 'Adventure complete';
  // How they fell and the run stay empty until the caller has real lines or a
  // run summary. A reload has neither; the screen does not invent a stand-in.
  const finalLines = props.finalLines?.filter((line) => line.trim()) ?? [];
  const narration = props.narration?.trim() || '';
  const showHowTheyFell = isFallen && (narration.length > 0 || finalLines.length > 0);
  const hasSummary = Boolean(props.summary?.trim());
  const experience = typeof props.experience === 'number' ? props.experience : null;
  const runSummary = isKnownRunSummary(props.runSummary) ? props.runSummary : null;
  const prefix = isFallen ? 'death' : 'completion';

  React.useEffect(() => {
    document.title = isFallen
      ? `${name} has fallen — Infinite Realms`
      : 'Adventure complete — Infinite Realms';
    headingRef.current?.focus();
  }, [isFallen, name]);

  if (view === 'story' && props.storyContent) {
    return (
      <main
        data-testid={`${prefix}-screen-story`}
        className="ir-end-screen flex h-full min-h-0 w-full flex-col overflow-x-hidden bg-infinite-dark text-foreground"
      >
        <header className="shrink-0 border-b border-white/10 bg-infinite-dark [body.ir-table-look_&]:border-[rgba(213,176,112,.2)]">
          <div className="mx-auto flex min-w-0 max-w-[640px] items-center gap-1.5 px-2 py-1.5">
            <Button
              data-testid={`${prefix}-screen-story-back`}
              variant="ghost"
              className="ir-end-gbtn min-h-11 shrink-0 gap-1 px-3 text-foreground hover:bg-white/10 hover:text-infinite-gold-light"
              onClick={() => setView('end')}
            >
              <ArrowLeft
                className="h-4 w-4 text-infinite-gold [body.ir-table-look_&]:text-[#d5b070]"
                aria-hidden="true"
              />
              Back
            </Button>
            <h1
              tabIndex={-1}
              className="ir-display ir-end-title m-0 min-w-0 flex-1 break-words text-base text-infinite-gold-light"
            >
              {name} — {isFallen ? 'fallen' : 'adventure complete'}
            </h1>
          </div>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto min-w-0 max-w-[640px] break-words px-4 py-4 md:px-0">
            {props.storyContent}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid={isFallen ? 'death-screen' : 'completion-screen'}
      className="ir-end-screen relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-infinite-dark text-foreground"
    >
      <div aria-hidden="true" className="ir-end-glow pointer-events-none absolute inset-0" />
      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto box-border w-full max-w-[640px] px-4 pb-6 pt-7 md:px-0 md:pt-[72px]">
          <header className="flex flex-col items-center text-center">
            <p className="ir-display ir-end-kicker text-xs font-bold uppercase tracking-[0.2em] text-infinite-gold">
              {campaignName}
            </p>
            <div className="mt-[22px] flex justify-center">
              <Portrait name={name} portraitUrl={portraitUrl} />
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="ir-display ir-end-title mt-5 break-words text-4xl font-bold leading-tight text-foreground outline-none"
            >
              {screenLabel}
            </h1>
            {identity && (
              <p className="ir-end-muted mt-1.5 text-[15px] text-white/65">{identity}</p>
            )}
            {props.chapter && (
              <p className="ir-end-muted mt-1.5 text-[15px] text-white/65">{props.chapter}</p>
            )}
            {props.epitaph && (
              <p className="ir-narr ir-end-body mt-1.5 text-[19px] italic text-white/75">
                {props.epitaph}
              </p>
            )}
            <div aria-hidden="true" className="mt-[18px] flex w-[220px] items-center gap-3">
              <span className="ir-end-rule h-px flex-1 bg-infinite-gold/30" />
              <span className="ir-display text-sm text-infinite-gold">✦</span>
              <span className="ir-end-rule h-px flex-1 bg-infinite-gold/30" />
            </div>
            <p className="ir-end-body mt-3.5 text-base leading-normal text-white/75">
              {isFallen
                ? 'Their tale ends here. The campaign does not.'
                : `${name} has finished ${campaignName}. The story is complete.`}
            </p>
          </header>

          {showHowTheyFell && (
            <section aria-labelledby="how-they-fell" className="mt-[26px] text-left">
              <h2
                id="how-they-fell"
                className="ir-display ir-end-kicker mb-2.5 text-xs font-bold tracking-[0.16em] text-infinite-gold"
              >
                HOW THEY FELL
              </h2>
              {narration && (
                <p className="ir-narr ir-end-body mb-3 border-l-[3px] border-infinite-gold/50 pl-3.5 text-[21px] italic leading-relaxed text-white/90">
                  {narration}
                </p>
              )}
              {finalLines.length > 0 && (
                <div data-testid="death-screen-final-lines" className="space-y-2.5">
                  {finalLines.map((line, index) => (
                    <p
                      key={`${line}-${index}`}
                      className="ir-end-card rounded-xl bg-black/20 px-3.5 py-3 text-[15px] leading-relaxed text-white/75"
                    >
                      {displayFinalLine(line)}
                    </p>
                  ))}
                </div>
              )}
            </section>
          )}

          {runSummary && (
            <section aria-labelledby="run-summary" className="mt-[22px] text-left">
              <h2
                id="run-summary"
                className="ir-display ir-end-kicker mb-2 text-xs font-bold tracking-[0.16em] text-infinite-gold"
              >
                THE RUN
              </h2>
              <dl className="ir-end-card grid grid-cols-2 overflow-hidden rounded-[10px] border border-white/10 bg-black/20 md:grid-cols-4">
                <Stat label="Turns" value={runSummary.turns} />
                <Stat label="Fights" value={runSummary.fights} />
                <Stat label="Monsters defeated" value={runSummary.monstersDefeated} />
                <Stat label="Rounds survived" value={runSummary.rounds} />
              </dl>
              {runSummary.fatalRoll && (
                <div className="ir-end-card mt-2 flex min-w-0 items-baseline gap-3 rounded-[10px] border border-white/10 bg-black/20 px-3 py-2.5">
                  <span className="ir-end-muted shrink-0 text-[13px] text-white/65">Last roll</span>
                  <b className="ir-display ir-end-title min-w-0 break-words text-xl text-foreground">
                    {runSummary.fatalRoll}
                  </b>
                </div>
              )}
            </section>
          )}

          {hasSummary && !isFallen && (
            <section
              data-testid="completion-screen-summary"
              className="ir-narr mt-[22px] border-l-[3px] border-infinite-gold/50 bg-black/20 px-3.5 py-3 text-left text-base leading-relaxed text-white/80"
            >
              {props.summary}
            </section>
          )}

          {!isFallen && experience !== null && (
            <p
              data-testid="completion-screen-experience"
              className="ir-display ir-end-title mt-4 text-center text-sm text-infinite-gold-light"
            >
              {experience.toLocaleString()} XP
            </p>
          )}

          {props.storyContent && (
            <button
              type="button"
              data-testid={`${prefix}-screen-read-story`}
              className="ir-end-gbtn mt-[22px] flex min-h-12 w-full items-center justify-between rounded-[10px] border border-white/20 bg-transparent px-4 text-[15px] font-bold text-foreground"
              onClick={() => setView('story')}
            >
              <span className="inline-flex items-center gap-2.5">
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5C9.5 18 6.5 18 4 19z M12 6v13.5"
                    fill="none"
                    stroke="#d5b070"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
                Read the story so far
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M9 5l7 7-7 7"
                  fill="none"
                  stroke="#aab3cc"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}

          {props.chooseHeroHref !== null && (
            <div className="mt-[26px] max-md:sticky max-md:bottom-0 max-md:z-[2] max-md:-mx-4 max-md:mt-[22px] max-md:border-t max-md:border-white/10 max-md:bg-infinite-dark/95 max-md:px-4 max-md:pb-[calc(14px+env(safe-area-inset-bottom,0px))] max-md:pt-3.5 max-md:[body.ir-table-look_&]:border-[rgba(213,176,112,.25)] max-md:[body.ir-table-look_&]:bg-[linear-gradient(to_top,#070b14_80%,rgba(7,11,20,0))]">
              <button
                type="button"
                data-testid={`${prefix}-screen-new-character`}
                className="ir-end-brass ir-display min-h-[52px] w-full rounded-xl border border-infinite-gold bg-infinite-gold text-lg font-bold tracking-wide text-infinite-dark disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  if (props.chooseHeroHref) navigate(props.chooseHeroHref);
                }}
                disabled={props.chooseHeroPending}
              >
                {isFallen ? 'Choose a new hero' : 'Begin again with a new hero'}
              </button>
              <p className="ir-end-muted mt-2 text-center text-sm leading-snug text-white/60">
                {isFallen
                  ? `${campaignName} goes on. ${name}’s story is kept.`
                  : `Begin ${campaignName} again with a new hero. ${name}’s story is kept.`}
              </p>
            </div>
          )}

          <button
            type="button"
            data-testid={`${prefix}-screen-explore`}
            className="ir-end-gbtn mt-3.5 min-h-12 w-full rounded-[10px] border border-white/20 bg-transparent text-[15px] font-bold text-white/80"
            onClick={() => navigate('/explore')}
          >
            Explore other campaigns
          </button>
          <div className="mt-1.5 text-center">
            <a
              href="/app"
              data-testid={`${prefix}-screen-realm`}
              className="ir-end-link inline-flex min-h-11 items-center px-3.5 text-[15px] font-bold text-infinite-gold underline underline-offset-[3px]"
            >
              Back to your realm
            </a>
          </div>

          {offerTakeHero(props.premade, props.premadeKept) && (
            <div className="mt-4">
              <TakeHeroOffer
                name={name}
                characterId={props.characterId}
                testIdPrefix={isFallen ? 'death' : 'completion'}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
