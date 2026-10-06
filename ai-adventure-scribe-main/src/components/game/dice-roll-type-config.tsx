import { Dice6, Zap, Target, AlertCircle } from 'lucide-react';
import React from 'react';

export interface DiceRollTypeConfig {
  color: string;
  icon: React.ReactNode;
  label: string;
}

/**
 * ⚡ Bolt: Static roll type configuration moved outside the component to avoid
 * re-allocation and redundant logic execution on every render.
 */
export const ROLL_TYPE_CONFIG: Record<string, DiceRollTypeConfig> = {
  attack: {
    color: 'border-red-200 bg-red-50',
    icon: <Target className="w-4 h-4" />,
    label: 'Attack Roll',
  },
  save: {
    color: 'border-orange-200 bg-orange-50',
    icon: <AlertCircle className="w-4 h-4" />,
    label: 'Saving Throw',
  },
  check: {
    color: 'border-blue-200 bg-blue-50',
    icon: <Dice6 className="w-4 h-4" />,
    label: 'Ability Check',
  },
  skill_check: {
    color: 'border-blue-200 bg-blue-50',
    icon: <Dice6 className="w-4 h-4" />,
    label: 'Skill Check',
  },
  damage: {
    color: 'border-purple-200 bg-purple-50',
    icon: <Dice6 className="w-4 h-4" />,
    label: 'Damage Roll',
  },
  damage_taken: {
    color: 'border-red-300 bg-red-100',
    icon: <AlertCircle className="w-4 h-4 text-red-600" />,
    label: 'Incoming Damage',
  },
  initiative: {
    color: 'border-green-200 bg-green-50',
    icon: <Zap className="w-4 h-4" />,
    label: 'Initiative',
  },
  death_save: {
    color: 'border-red-300 bg-red-100',
    icon: <AlertCircle className="w-4 h-4 text-red-600" />,
    label: 'Death Saving Throw',
  },
};

export const DEFAULT_TYPE_CONFIG: DiceRollTypeConfig = {
  color: 'border-gray-200 bg-gray-50',
  icon: <Dice6 className="w-4 h-4" />,
  label: 'Dice Roll',
};
