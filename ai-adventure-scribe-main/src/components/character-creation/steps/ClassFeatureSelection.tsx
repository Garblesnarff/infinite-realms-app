import { Crown } from 'lucide-react';
import React, { useState, useEffect } from 'react';

import { ClassFeatureChoiceCard } from './ClassFeatureChoiceCard';

import type { CharacterClass } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCharacter } from '@/contexts/CharacterContext';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useToast } from '@/hooks/use-toast';

/**
 * ClassFeatureSelection component for choosing level 1 class features
 * Handles features like Fighting Styles, Divine Domains, etc.
 */
const ClassFeatureSelection: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const { scrollToNavigation } = useAutoScroll();
  const character = state.character;
  const currentClass = character?.class as CharacterClass | undefined;

  const [selectedFeatures, setSelectedFeatures] = useState<Record<string, string>>({});

  // Get class features that require choices
  const featuresWithChoices =
    currentClass?.classFeatures.filter((feature) => feature.choices) || [];

  // Note: No early returns before hooks to satisfy rules-of-hooks

  /**
   * Updates character class features in context
   */
  const updateClassFeatures = () => {
    // Validate all required choices are made
    const missingChoices = featuresWithChoices.filter((feature) => !selectedFeatures[feature.id]);

    if (missingChoices.length > 0) {
      toast({
        title: 'Incomplete Selection',
        description: `Please select ${missingChoices.map((f) => f.name).join(', ')}.`,
        variant: 'destructive',
      });
      return;
    }

    // Build class features object
    const classFeatures: Record<string, { name: string; description: string; choice?: string }> =
      {};

    // Add automatic features
    currentClass?.classFeatures.forEach((feature) => {
      if (!feature.choices) {
        classFeatures[feature.id] = {
          name: feature.name,
          description: feature.description,
        };
      }
    });

    // Add selected features
    const fightingStyles: string[] = [];
    Object.entries(selectedFeatures).forEach(([featureId, choice]) => {
      const feature = featuresWithChoices.find((f) => f.id === featureId);
      if (feature) {
        classFeatures[featureId] = {
          name: feature.name,
          description: feature.description,
          choice: choice,
        };

        // If this is a fighting style, add it to the fighting styles array
        if (featureId === 'fighting-style') {
          const [styleName] = choice.split(': ');
          fightingStyles.push(styleName.toLowerCase().replace(/\s+/g, '_'));
        }
      }
    });

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        classFeatures,
        fightingStyles,
      },
    });

    toast({
      title: 'Class Features Selected',
      description: 'Your level 1 class features have been applied.',
    });

    // Auto-scroll to navigation to proceed to next step
    scrollToNavigation();
  };

  // Auto-update when all selections are made
  useEffect(() => {
    if (featuresWithChoices.length > 0) {
      const allSelected = featuresWithChoices.every((feature) => selectedFeatures[feature.id]);
      if (allSelected) {
        updateClassFeatures();
      }
    }
  }, [selectedFeatures]);

  return featuresWithChoices.length === 0 ? (
    <div className="text-center space-y-4">
      <Crown className="w-16 h-16 mx-auto text-muted-foreground" />
      <h2 className="text-2xl font-bold">Class Features Acquired</h2>
      <p className="text-muted-foreground">
        Your {currentClass?.name} class features have been automatically applied.
      </p>
      {currentClass?.classFeatures && currentClass.classFeatures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Level 1 Features</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentClass.classFeatures.map((feature, index) => (
              <div key={index} className="border-l-4 border-primary pl-4">
                <h4 className="font-semibold">{feature.name}</h4>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  ) : (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Choose Class Features</h2>
        <p className="text-muted-foreground">
          Select your {currentClass?.name} specializations and abilities
        </p>
      </div>

      {/* Feature Selection Cards */}
      {featuresWithChoices.map((feature) => (
        <ClassFeatureChoiceCard
          key={feature.id}
          feature={feature}
          selectedValue={selectedFeatures[feature.id] || ''}
          onValueChange={(value) => {
            setSelectedFeatures((prev) => ({
              ...prev,
              [feature.id]: value,
            }));
          }}
        />
      ))}

      {/* Selection Summary */}
      {Object.keys(selectedFeatures).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Selected Features</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(selectedFeatures).map(([featureId, choice]) => {
                const feature = featuresWithChoices.find((f) => f.id === featureId);
                const [choiceName] = choice.split(': ');

                return (
                  <div
                    key={featureId}
                    className="flex items-center justify-between p-2 bg-accent/30 rounded"
                  >
                    <span className="font-medium">{feature?.name}</span>
                    <Badge variant="outline">{choiceName}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Update Button (fallback) */}
      {featuresWithChoices.length > 0 && (
        <div className="flex justify-center">
          <Button onClick={updateClassFeatures} className="mt-4">
            Confirm Class Features
          </Button>
        </div>
      )}
    </div>
  );
};

export default ClassFeatureSelection;
