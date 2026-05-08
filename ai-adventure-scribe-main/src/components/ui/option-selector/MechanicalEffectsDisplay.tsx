import React from 'react';
import { Separator } from '@/components/ui/separator';
import type { EnhancementOption } from '@/types/enhancement-options';

interface MechanicalEffectsDisplayProps {
  option: EnhancementOption<any>;
  showMechanicalEffects?: boolean;
}

/**
 * Component for displaying mechanical and campaign effects of an enhancement option.
 * Extracted from OptionSelector.
 */
export const MechanicalEffectsDisplay: React.FC<MechanicalEffectsDisplayProps> = ({
  option,
  showMechanicalEffects = true,
}) => {
  if (!showMechanicalEffects) return null;

  const effects = option.mechanicalEffects;
  const campaignEffects = option.campaignEffects;

  if (!effects && !campaignEffects) return null;

  return (
    <div className="space-y-2">
      <Separator />
      <div className="text-sm">
        <h4 className="font-medium text-muted-foreground mb-2">Effects:</h4>

        {effects && (
          <div className="space-y-1">
            {effects.abilityBonus && (
              <p>
                • Ability Bonuses:{' '}
                {Object.entries(effects.abilityBonus)
                  .map(([ability, bonus]) => `${ability} +${bonus}`)
                  .join(', ')}
              </p>
            )}
            {effects.skillBonus && effects.skillBonus.length > 0 && (
              <p>• Skill Bonuses: {effects.skillBonus.join(', ')}</p>
            )}
            {effects.traits && effects.traits.length > 0 && (
              <p>• Traits: {effects.traits.join(', ')}</p>
            )}
            {effects.languages && effects.languages.length > 0 && (
              <p>• Languages: {effects.languages.join(', ')}</p>
            )}
            {effects.resistances && effects.resistances.length > 0 && (
              <p>• Resistances: {effects.resistances.join(', ')}</p>
            )}
            {effects.expertise && effects.expertise.length > 0 && (
              <p>• Expertise: {effects.expertise.join(', ')}</p>
            )}
          </div>
        )}

        {campaignEffects && (
          <div className="space-y-1">
            {campaignEffects.atmosphere && campaignEffects.atmosphere.length > 0 && (
              <p>• Atmosphere: {campaignEffects.atmosphere.join(', ')}</p>
            )}
            {campaignEffects.themes && campaignEffects.themes.length > 0 && (
              <p>• Themes: {campaignEffects.themes.join(', ')}</p>
            )}
            {campaignEffects.hooks && campaignEffects.hooks.length > 0 && (
              <p>• Story Hooks: {campaignEffects.hooks.join(', ')}</p>
            )}
            {campaignEffects.worldLaws && campaignEffects.worldLaws.length > 0 && (
              <p>• World Laws: {campaignEffects.worldLaws.join(', ')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
