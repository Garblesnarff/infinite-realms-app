import { MousePointer2, Hand, Ruler, Pen, Circle, Box, Eye } from 'lucide-react';

import type { ToolType } from '@/stores/useBattleMapStore';
import type React from 'react';

export interface ToolConfig {
  id: ToolType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  description: string;
  category: 'navigation' | 'drawing' | 'gm';
  gmOnly?: boolean;
}

export const TOOLS: ToolConfig[] = [
  // Navigation Tools
  {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    shortcut: 'S',
    description: 'Select and move tokens',
    category: 'navigation',
  },
  {
    id: 'pan',
    label: 'Pan',
    icon: Hand,
    shortcut: 'P',
    description: 'Pan the view',
    category: 'navigation',
  },
  {
    id: 'measure',
    label: 'Measure',
    icon: Ruler,
    shortcut: 'M',
    description: 'Measure distance',
    category: 'navigation',
  },

  // Drawing Tools
  {
    id: 'draw',
    label: 'Draw',
    icon: Pen,
    shortcut: 'D',
    description: 'Draw freehand',
    category: 'drawing',
  },
  {
    id: 'move',
    label: 'AoE',
    icon: Circle,
    shortcut: 'A',
    description: 'Area of Effect templates',
    category: 'drawing',
  },

  // GM Tools
  {
    id: 'wall',
    label: 'Wall',
    icon: Box,
    shortcut: 'W',
    description: 'Draw walls and doors',
    category: 'gm',
    gmOnly: true,
  },
  {
    id: 'fog-brush',
    label: 'Fog',
    icon: Eye,
    shortcut: 'F',
    description: 'Reveal/hide fog of war',
    category: 'gm',
    gmOnly: true,
  },
];
