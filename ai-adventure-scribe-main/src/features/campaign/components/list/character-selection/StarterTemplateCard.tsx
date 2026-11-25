import { Play, Loader2 } from 'lucide-react';
import React from 'react';

import type { StarterTemplate } from '@/features/campaign/hooks/use-character-selection';
import type { AbilityScoreName } from '@/utils/racialAbilityBonuses';

import { resolveCampaignArtwork } from '@/components/campaigns/campaign-artwork';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { checkHeroName, heroEpithetName } from '@/data/hero-names';
import { HeroNameField } from '@/features/campaigns/table/HeroNameField';

interface StarterTemplateCardProps {
  template: StarterTemplate;
  isCreating: boolean;
  /** #1741: the premade's name, and the typed name when one is given (undefined keeps the title). */
  onSelect: (template: StarterTemplate, heroName?: string) => void;
  getModifier: (score?: number) => string;
}

/**
 * Component for rendering a starter template card in the character selection modal.
 * Extracted from CharacterSelectionModal.
 */
export const StarterTemplateCard: React.FC<StarterTemplateCardProps> = ({
  template,
  isCreating,
  onSelect,
  getModifier,
}) => {
  const abilityScores = template.ability_scores || {};
  // #1741: the typed name. The field sits inside the card, so its clicks and keys stop here.
  const [heroName, setHeroName] = React.useState('');
  const nameCheck = checkHeroName(heroName, template.name);
  const chosenName = nameCheck.ok && nameCheck.name !== template.name ? nameCheck.name : undefined;
  const startWithName = (): void => {
    if (!nameCheck.ok) return;
    onSelect(template, chosenName);
  };
  const cardTitle = `Select character: ${template.name}, Level ${template.level} ${template.race} ${template.class}`;

  // Show the stored scores the sheet shows (#153): the sheet reads the
  // character row's stored scores verbatim (useEffectiveAbilityScores returns
  // them unchanged — racial bonuses are applied once, at creation, never at
  // display), and starter seeding stores the template row's scores verbatim,
  // so the preview shows the template row's scores directly. An earlier
  // version added racial bonuses here via getEffectiveAbilityScores, which
  // made the card disagree with the sheet on 23 of the 36 seeded templates.
  const abilities: AbilityScoreName[] = [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ];
  const storedScores = Object.fromEntries(
    abilities.map((ability) => [
      ability,
      abilityScores[ability as keyof typeof abilityScores] ?? 10,
    ]),
  ) as Record<AbilityScoreName, number>;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => !isCreating && startWithName()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!isCreating) startWithName();
        }
      }}
      aria-label={cardTitle}
      title={cardTitle}
      className="group cursor-pointer hover:shadow-2xl hover:shadow-infinite-purple/40 transition-all duration-500 overflow-hidden border-2 border-border/60 hover:border-infinite-gold/90 hover:scale-[1.02] relative focus-visible:ring-2 focus-visible:ring-infinite-purple focus-visible:outline-none"
    >
      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 shadow-inset-glow-purple" />
      </div>

      <div
        className="relative h-32 bg-cover bg-center transition-all duration-700 ease-out group-hover:scale-105 group-hover:brightness-110"
        style={{
          backgroundImage: `url(${resolveCampaignArtwork(template.portrait_url)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/80 to-background" />
        {template.portrait_url && (
          <div className="absolute -bottom-8 left-4" style={{ zIndex: Z_INDEX.DROPDOWN }}>
            <img
              src={template.portrait_url}
              alt=""
              className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 group-hover:scale-110 group-hover:border-infinite-purple group-hover:shadow-infinite-purple/70"
            />
          </div>
        )}
      </div>
      <CardContent className="p-4 pt-10">
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-lg text-foreground">
              {heroEpithetName(nameCheck.ok ? nameCheck.name : template.name, template.name)}
            </h3>
            <p className="text-sm text-muted-foreground">
              Level {template.level} {template.race} {template.class}
            </p>
            {template.tagline && (
              <p className="text-xs text-muted-foreground italic mt-1">{template.tagline}</p>
            )}
          </div>

          {/* #1741: name the hero. Clicks and keys inside the field do not start the card. */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') e.stopPropagation();
            }}
          >
            <HeroNameField
              hero={template}
              value={heroName}
              onChange={setHeroName}
              disabled={isCreating}
              check={nameCheck}
            />
          </div>

          {/* Ability Scores Grid */}
          <div
            className="grid grid-cols-3 gap-2 text-xs"
            role="group"
            aria-label="Ability modifiers"
          >
            <div
              className="flex flex-col items-center p-2 bg-secondary/20 rounded border border-border shadow-sm"
              aria-label={`Strength modifier: ${getModifier(storedScores.strength)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                STR
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(storedScores.strength)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-secondary/20 rounded border border-border shadow-sm"
              aria-label={`Dexterity modifier: ${getModifier(storedScores.dexterity)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                DEX
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(storedScores.dexterity)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-secondary/20 rounded border border-border shadow-sm"
              aria-label={`Constitution modifier: ${getModifier(storedScores.constitution)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                CON
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(storedScores.constitution)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-secondary/20 rounded border border-border shadow-sm"
              aria-label={`Intelligence modifier: ${getModifier(storedScores.intelligence)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                INT
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(storedScores.intelligence)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-secondary/20 rounded border border-border shadow-sm"
              aria-label={`Wisdom modifier: ${getModifier(storedScores.wisdom)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                WIS
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(storedScores.wisdom)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-secondary/20 rounded border border-border shadow-sm"
              aria-label={`Charisma modifier: ${getModifier(storedScores.charisma)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                CHA
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(storedScores.charisma)}
              </span>
            </div>
          </div>

          <Button
            className="w-full bg-infinite-gold text-infinite-dark hover:bg-infinite-purple"
            disabled={isCreating}
            tabIndex={-1}
            aria-hidden="true"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Start Adventure
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
