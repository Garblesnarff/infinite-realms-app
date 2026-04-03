/**
 * Shortcut Information Types and Data
 */

export interface ShortcutInfo {
  /** Shortcut keys */
  keys: string[];
  /** Action description */
  description: string;
  /** Category */
  category: string;
  /** GM only */
  gmOnly?: boolean;
  /** Additional notes */
  notes?: string;
}

export const SHORTCUTS: ShortcutInfo[] = [
  // Tools
  {
    keys: ['S'],
    description: 'Select tool',
    category: 'Tools',
  },
  {
    keys: ['P'],
    description: 'Pan tool',
    category: 'Tools',
  },
  {
    keys: ['M'],
    description: 'Measure tool',
    category: 'Tools',
  },
  {
    keys: ['D'],
    description: 'Draw tool',
    category: 'Tools',
  },
  {
    keys: ['A'],
    description: 'AoE tool',
    category: 'Tools',
  },
  {
    keys: ['W'],
    description: 'Wall tool',
    category: 'Tools',
    gmOnly: true,
  },
  {
    keys: ['F'],
    description: 'Fog tool',
    category: 'Tools',
    gmOnly: true,
  },

  // Actions
  {
    keys: ['Esc'],
    description: 'Cancel/Clear selection',
    category: 'Actions',
  },
  {
    keys: ['Del'],
    description: 'Delete selected',
    category: 'Actions',
  },
  {
    keys: ['Ctrl', 'Z'],
    description: 'Undo',
    category: 'Actions',
  },
  {
    keys: ['Ctrl', 'Shift', 'Z'],
    description: 'Redo',
    category: 'Actions',
    notes: 'Also Ctrl+Y',
  },
  {
    keys: ['Q'],
    description: 'Quick action menu',
    category: 'Actions',
  },
  {
    keys: ['?'],
    description: 'Show/hide hotkey guide',
    category: 'Actions',
  },

  // View
  {
    keys: ['+'],
    description: 'Zoom in',
    category: 'View',
  },
  {
    keys: ['-'],
    description: 'Zoom out',
    category: 'View',
  },
  {
    keys: ['0'],
    description: 'Reset view',
    category: 'View',
  },
  {
    keys: ['C'],
    description: 'Center on selection',
    category: 'View',
  },
  {
    keys: ['Space', 'Drag'],
    description: 'Pan view (hold space)',
    category: 'View',
  },

  // Layers
  {
    keys: ['G'],
    description: 'Toggle grid',
    category: 'Layers',
  },
  {
    keys: ['Alt', 'F'],
    description: 'Toggle fog visibility',
    category: 'Layers',
    gmOnly: true,
  },
  {
    keys: ['Alt', 'W'],
    description: 'Toggle walls visibility',
    category: 'Layers',
    gmOnly: true,
  },
  {
    keys: ['Alt', 'T'],
    description: 'Toggle tokens visibility',
    category: 'Layers',
  },

  // Tokens
  {
    keys: ['['],
    description: 'Rotate token left',
    category: 'Tokens',
  },
  {
    keys: [']'],
    description: 'Rotate token right',
    category: 'Tokens',
  },
  {
    keys: ['Alt', '↑'],
    description: 'Elevate token up',
    category: 'Tokens',
  },
  {
    keys: ['Alt', '↓'],
    description: 'Elevate token down',
    category: 'Tokens',
  },
  {
    keys: ['Shift', 'Click'],
    description: 'Multi-select tokens',
    category: 'Tokens',
  },
  {
    keys: ['Ctrl', 'A'],
    description: 'Select all tokens',
    category: 'Tokens',
  },

  // Drawing
  {
    keys: ['Shift', 'Drag'],
    description: 'Constrain line angle',
    category: 'Drawing',
  },
  {
    keys: ['Ctrl', 'Drag'],
    description: 'Draw from center',
    category: 'Drawing',
  },
  {
    keys: ['Enter'],
    description: 'Finish drawing',
    category: 'Drawing',
  },
  {
    keys: ['Backspace'],
    description: 'Remove last point',
    category: 'Drawing',
  },

  // Measurement
  {
    keys: ['Shift', 'M'],
    description: 'Cone measurement',
    category: 'Measurement',
  },
  {
    keys: ['Ctrl', 'M'],
    description: 'Radius measurement',
    category: 'Measurement',
  },
];

export const CATEGORY_ORDER = [
  'Tools',
  'Actions',
  'View',
  'Layers',
  'Tokens',
  'Drawing',
  'Measurement',
];
