import { Sword, Shield, Zap, Heart, Skull, Target, Dice6 } from 'lucide-react';
import React from 'react';

import { type CombatMessageData } from '@/utils/combat/ai-narration-utils';

/**
 * Visual utility helpers for CombatMessage components
 * Extracted from CombatMessage.tsx
 */

export const getTypeIcon = (type: string): React.ReactElement => {
  switch (type) {
    case 'attack_roll':
      return <Sword className="w-4 h-4" />;
    case 'damage_roll':
      return <Zap className="w-4 h-4" />;
    case 'saving_throw':
      return <Shield className="w-4 h-4" />;
    case 'skill_check':
      return <Target className="w-4 h-4" />;
    case 'initiative':
      return <Dice6 className="w-4 h-4" />;
    case 'death_save':
      return <Skull className="w-4 h-4" />;
    case 'concentration_save':
      return <Heart className="w-4 h-4" />;
    default:
      return <Dice6 className="w-4 h-4" />;
  }
};

export const getTypeColor = (data: CombatMessageData): string => {
  switch (data.type) {
    case 'attack_roll':
      return data.critical ? 'bg-red-500' : data.success ? 'bg-green-500' : 'bg-gray-500';
    case 'damage_roll':
      return 'bg-orange-500';
    case 'saving_throw':
      return data.success ? 'bg-blue-500' : 'bg-red-500';
    case 'skill_check':
      return data.success ? 'bg-purple-500' : 'bg-gray-500';
    case 'initiative':
      return 'bg-yellow-500';
    case 'death_save':
      return data.success ? 'bg-green-600' : 'bg-red-600';
    case 'concentration_save':
      return data.success ? 'bg-electricCyan' : 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
};

export const getBorderClass = (data: CombatMessageData): string => {
  switch (data.type) {
    case 'attack_roll':
      return data.critical
        ? 'border-l-red-500'
        : data.success
          ? 'border-l-green-500'
          : 'border-l-gray-500';
    case 'damage_roll':
      return 'border-l-orange-500';
    case 'saving_throw':
      return data.success ? 'border-l-blue-500' : 'border-l-red-500';
    case 'skill_check':
      return data.success ? 'border-l-purple-500' : 'border-l-gray-500';
    case 'initiative':
      return 'border-l-yellow-500';
    case 'death_save':
      return data.success ? 'border-l-green-600' : 'border-l-red-600';
    case 'concentration_save':
      return data.success ? 'border-l-electricCyan' : 'border-l-red-500';
    default:
      return 'border-l-gray-500';
  }
};
