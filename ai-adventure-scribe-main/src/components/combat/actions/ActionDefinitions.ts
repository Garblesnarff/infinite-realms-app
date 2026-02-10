
import {
  Sword,
  Shield,
  Zap,
  Wind,
  Eye,
  Heart,
  Clock,
  Search,
  Package,
  UserX,
} from 'lucide-react';

import type { ActionType } from '@/types/combat';
import type React from 'react';

// ===========================
// Action Definitions
// ===========================

// Special management panel (not a combat action)
export interface ManagementAction {
  type: string;
  name: string;
  icon: React.ComponentType<unknown>;
  description: string;
}

export const MANAGEMENT_ACTIONS: ManagementAction[] = [
  {
    type: 'manage_conditions',
    name: 'Manage Conditions',
    icon: UserX,
    description: 'Apply, remove, or manage D&D conditions',
  },
];

export interface ActionDefinition {
  type: ActionType;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  actionRequired: boolean; // Uses action slot
  bonusAction: boolean; // Uses bonus action slot
  quickAction: boolean; // Can be done without detailed input
}

export const COMBAT_ACTIONS: ActionDefinition[] = [
  {
    type: 'attack',
    name: 'Attack',
    icon: Sword,
    description: 'Make a weapon or unarmed attack',
    actionRequired: true,
    bonusAction: false,
    quickAction: false,
  },
  {
    type: 'cast_spell',
    name: 'Cast Spell',
    icon: Zap,
    description: 'Cast a spell or use a magical ability',
    actionRequired: true,
    bonusAction: false,
    quickAction: false,
  },
  {
    type: 'dash',
    name: 'Dash',
    icon: Wind,
    description: 'Move up to your speed again',
    actionRequired: true,
    bonusAction: false,
    quickAction: true,
  },
  {
    type: 'dodge',
    name: 'Dodge',
    icon: Shield,
    description: 'Focus entirely on avoiding attacks',
    actionRequired: true,
    bonusAction: false,
    quickAction: true,
  },
  {
    type: 'help',
    name: 'Help',
    icon: Heart,
    description: 'Give an ally advantage on their next ability check or attack',
    actionRequired: true,
    bonusAction: false,
    quickAction: false,
  },
  {
    type: 'hide',
    name: 'Hide',
    icon: Eye,
    description: 'Attempt to hide from enemies',
    actionRequired: true,
    bonusAction: false,
    quickAction: false,
  },
  {
    type: 'ready',
    name: 'Ready',
    icon: Clock,
    description: 'Prepare an action for later',
    actionRequired: true,
    bonusAction: false,
    quickAction: false,
  },
  {
    type: 'search',
    name: 'Search',
    icon: Search,
    description: 'Look for hidden objects, creatures, or other details',
    actionRequired: true,
    bonusAction: false,
    quickAction: false,
  },
  {
    type: 'use_object',
    name: 'Use Object',
    icon: Package,
    description: 'Interact with an object or use an item',
    actionRequired: true,
    bonusAction: false,
    quickAction: false,
  },
];
