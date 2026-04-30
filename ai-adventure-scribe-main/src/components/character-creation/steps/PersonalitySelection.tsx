import { Shuffle, Heart, Crown, Shield, Zap, Sparkles } from 'lucide-react';
import React from 'react';

import { usePersonalitySelection } from './personality/use-personality-selection';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAutoScroll } from '@/hooks/use-auto-scroll';

/**
 * PersonalitySelection component for character creation
 * Handles input of personality traits, ideals, bonds, and flaws with randomization
 */
const PersonalitySelection: React.FC = () => {
  const {
    state,
    selectedBackground,
    handlePersonalityTraitsChange,
    handleIdealChange,
    handleBondChange,
    handleFlawChange,
    handleRandomize,
    handleRandomizeAll,
  } = usePersonalitySelection();
  const { scrollToNavigation: _scrollToNavigation } = useAutoScroll();

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center space-x-3">
          <div className="p-3 bg-gradient-to-br from-infinite-purple to-infinite-gold rounded-full shadow-lg">
            <Heart className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-infinite-purple to-infinite-gold bg-clip-text text-transparent">
              Define Your Character
            </h2>
            <p className="text-muted-foreground">
              {selectedBackground
                ? `Shape your ${selectedBackground.name}'s personality with traits, ideals, bonds, and flaws`
                : "Shape your character's personality with traits, ideals, bonds, and flaws"}
            </p>
          </div>
        </div>
      </div>

      {/* Background Info */}
      {selectedBackground && (
        <Card className="glass rounded-2xl border-2 border-infinite-teal/20">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 mb-2">
              <Crown className="w-4 h-4 text-infinite-teal" />
              <h3 className="font-semibold">{selectedBackground.name} Background</h3>
            </div>
            <p className="text-sm text-muted-foreground">{selectedBackground.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Randomize All Button - Standalone */}
      <div className="flex justify-center">
        <Button
          onClick={handleRandomizeAll}
          variant="outline"
          size="lg"
          className="bg-gradient-to-r from-purple-500 to-amber-500 text-white hover:from-purple-600 hover:to-amber-600 border-0 shadow-lg"
        >
          <Sparkles className="mr-2 h-5 w-5" />
          Randomize All Personality Fields
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personality Traits */}
        <Card className="glass rounded-2xl hover-lift border-2 border-infinite-purple/20">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center space-x-2">
              <Zap className="w-5 h-5 text-infinite-purple" />
              <h3 className="text-lg font-semibold">Personality Traits</h3>
            </div>

            <p className="text-sm text-muted-foreground">
              Choose 2 personality traits that define how your character acts and speaks.
            </p>

            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="trait-1" className="text-xs text-muted-foreground">
                    Trait 1
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRandomize('traits', 0)}
                    className="h-6 px-2 text-xs"
                  >
                    <Shuffle className="w-3 h-3 mr-1" />
                    Random
                  </Button>
                </div>
                <Textarea
                  id="trait-1"
                  placeholder="e.g., I idolize a particular hero of my faith..."
                  value={state.character?.personalityTraits?.[0] || ''}
                  onChange={(e) =>
                    handlePersonalityTraitsChange([
                      e.target.value,
                      state.character?.personalityTraits?.[1] || '',
                    ])
                  }
                  className="min-h-[60px] transition-all duration-200 focus:ring-2 focus:ring-infinite-purple focus:border-infinite-purple"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="trait-2" className="text-xs text-muted-foreground">
                    Trait 2
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRandomize('traits', 1)}
                    className="h-6 px-2 text-xs"
                  >
                    <Shuffle className="w-3 h-3 mr-1" />
                    Random
                  </Button>
                </div>
                <Textarea
                  id="trait-2"
                  placeholder="e.g., I can find common ground between enemies..."
                  value={state.character?.personalityTraits?.[1] || ''}
                  onChange={(e) =>
                    handlePersonalityTraitsChange([
                      state.character?.personalityTraits?.[0] || '',
                      e.target.value,
                    ])
                  }
                  className="min-h-[60px] transition-all duration-200 focus:ring-2 focus:ring-infinite-purple focus:border-infinite-purple"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Ideal */}
        <Card className="glass rounded-2xl hover-lift border-2 border-infinite-gold/20">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Crown className="w-5 h-5 text-infinite-gold" />
                <h3 className="text-lg font-semibold">Ideal</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRandomize('ideals')}
                className="h-6 px-2 text-xs"
              >
                <Shuffle className="w-3 h-3 mr-1" />
                Random
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              Choose 1 ideal that drives your character's goals and motivations.
            </p>

            <Textarea
              id="ideal"
              placeholder="e.g., Freedom. Tyrants must not be allowed to oppress people."
              value={state.character?.ideals?.[0] || ''}
              onChange={(e) => handleIdealChange(e.target.value)}
              className="min-h-[100px] transition-all duration-200 focus:ring-2 focus:ring-infinite-gold focus:border-infinite-gold"
            />
          </CardContent>
        </Card>

        {/* Bond */}
        <Card className="glass rounded-2xl hover-lift border-2 border-infinite-teal/20">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Heart className="w-5 h-5 text-infinite-teal" />
                <h3 className="text-lg font-semibold">Bond</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRandomize('bonds')}
                className="h-6 px-2 text-xs"
              >
                <Shuffle className="w-3 h-3 mr-1" />
                Random
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              Choose 1 bond that connects your character to people, places, or events.
            </p>

            <Textarea
              id="bond"
              placeholder="e.g., I owe my life to the priest who took me in..."
              value={state.character?.bonds?.[0] || ''}
              onChange={(e) => handleBondChange(e.target.value)}
              className="min-h-[100px] transition-all duration-200 focus:ring-2 focus:ring-infinite-teal focus:border-infinite-teal"
            />
          </CardContent>
        </Card>

        {/* Flaw */}
        <Card className="glass rounded-2xl hover-lift border-2 border-infinite-purple/20">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-infinite-teal" />
                <h3 className="text-lg font-semibold">Flaw</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRandomize('flaws')}
                className="h-6 px-2 text-xs"
              >
                <Shuffle className="w-3 h-3 mr-1" />
                Random
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              Choose 1 flaw that could be exploited or cause your character trouble.
            </p>

            <Textarea
              id="flaw"
              placeholder="e.g., I judge others harshly, and myself even more severely."
              value={state.character?.flaws?.[0] || ''}
              onChange={(e) => handleFlawChange(e.target.value)}
              className="min-h-[100px] transition-all duration-200 focus:ring-2 focus:ring-infinite-purple focus:border-infinite-purple"
            />
          </CardContent>
        </Card>
      </div>

      {/* Help Text */}
      <Card className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200 dark:border-amber-800">
        <div className="flex items-start space-x-3">
          <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-amber-600 dark:text-amber-400 text-sm">💡</span>
          </div>
          <div className="space-y-1">
            <h4 className="font-medium text-amber-900 dark:text-amber-100">Personality Tips</h4>
            <p className="text-sm text-amber-700 dark:text-amber-200">
              Use the randomize buttons to get inspiration from official D&D backgrounds, or write
              your own unique personality elements. These will shape how your character interacts
              with the world and other players.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default PersonalitySelection;
