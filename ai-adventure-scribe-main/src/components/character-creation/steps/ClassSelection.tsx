import { Sword, Check, BookOpen } from 'lucide-react';
import React, { useState } from 'react';

import { ClassSelectionCard } from './ClassSelectionCard';

import type { CharacterClass } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useCharacter } from '@/contexts/CharacterContext';
import { classes } from '@/data/classOptions';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';

const ClassSelection: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const { scrollToNavigation } = useAutoScroll();
  const [hoveredClassId, setHoveredClassId] = useState<string | null>(null);

  const handleClassSelect = (characterClass: CharacterClass) => {
    logger.info('🎯 handleClassSelect called with:', characterClass);
    logger.debug('🎯 Current character state before dispatch:', state.character);
    logger.debug('🎯 Character class before update:', state.character?.class);

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { class: characterClass },
    });

    logger.debug('🎯 Dispatched UPDATE_CHARACTER with payload:', { class: characterClass });

    // Add a small delay to check if state updated
    setTimeout(() => {
      logger.debug('🎯 Character state after dispatch (with delay):', state.character);
      logger.debug('🎯 Character class after update:', state.character?.class);
    }, 100);

    toast({
      title: 'Class Selected',
      description: `You have chosen the ${characterClass.name} class.`,
      duration: 1000,
    });

    // Auto-scroll to navigation to proceed to next step
    scrollToNavigation();
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center space-x-3">
          <div className="p-3 bg-gradient-to-br from-infinite-gold to-infinite-gold-dark rounded-full shadow-lg">
            <Sword className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-infinite-gold to-infinite-gold-dark bg-clip-text text-transparent">
              Choose Your Class
            </h2>
            <p className="text-muted-foreground">
              Select the path that defines your abilities and playstyle
            </p>
          </div>
        </div>
      </div>

      {/* Info Card */}
      <Card className="glass rounded-2xl border-2 border-infinite-gold/20">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <div className="p-2 bg-infinite-gold/20 rounded-full">
              <BookOpen className="w-4 h-4 text-infinite-gold" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">
                <strong>Choose wisely!</strong> Your class determines your combat abilities, skills,
                and role in the party. Each class has unique features and progression paths.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Class Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {classes.map((characterClass) => {
          const isSelected = state.character?.class?.id === characterClass.id;
          const isHovered = hoveredClassId === characterClass.id;

          logger.debug(`Class ${characterClass.id} selected:`, isSelected);

          return (
            <ClassSelectionCard
              key={characterClass.id}
              characterClass={characterClass}
              isSelected={isSelected}
              isHovered={isHovered}
              onSelect={handleClassSelect}
              onHoverStart={setHoveredClassId}
              onHoverEnd={() => setHoveredClassId(null)}
            />
          );
        })}
      </div>

      {/* Selected Class Summary */}
      {state.character?.class && (
        <Card className="bg-infinite-gold/5 border-2 border-infinite-gold/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-infinite-gold/10 rounded-lg">
                  <Check className="w-5 h-5 text-infinite-gold" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Selected Class</p>
                  <p className="text-xl font-bold">{state.character.class.name}</p>
                </div>
              </div>
              <Badge variant="default" className="text-sm px-4 py-2">
                Ready to Continue
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ClassSelection;
