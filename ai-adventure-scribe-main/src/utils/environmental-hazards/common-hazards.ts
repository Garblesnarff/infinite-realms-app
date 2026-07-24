import type { EnvironmentalHazard } from '@/types/environmentalHazards';

/**
 * Common environmental hazards data for D&D 5e
 */
export const commonHazards: EnvironmentalHazard[] = [
  {
    id: 'acid_pool',
    name: 'Acid Pool',
    type: 'acid_pool',
    description: 'A pool of bubbling acid that causes chemical burns.',
    isHidden: true,
    detectDC: 15,
    detectSkill: 'perception',
    saveDC: 15,
    saveAbility: 'dex',
    damage: {
      dice: '2d6',
      type: 'acid',
      onFail: 'full',
      onSuccess: 'half',
    },
    trigger: 'enter',
  },
  {
    id: 'spiked_pit',
    name: 'Spiked Pit',
    type: 'spiked_pit',
    description: 'A concealed pit trap with sharp spikes at the bottom.',
    isHidden: true,
    detectDC: 12,
    detectSkill: 'perception',
    saveDC: 15,
    saveAbility: 'dex',
    damage: {
      dice: '3d6',
      type: 'piercing',
      onFail: 'full',
      onSuccess: 'none',
    },
    conditions: [
      {
        name: 'prone',
        duration: 1,
      },
    ],
    trigger: 'enter',
  },
  {
    id: 'extreme_heat',
    name: 'Extreme Heat',
    type: 'extreme_heat',
    description: 'An area of intense heat that causes exhaustion.',
    isAreaEffect: true,
    areaOfEffect: {
      shape: 'sphere',
      size: 20,
    },
    saveDC: 15,
    saveAbility: 'con',
    damage: {
      dice: '1d6',
      type: 'fire',
      onFail: 'full',
      onSuccess: 'none',
    },
    exhaustionLevel: 1,
    trigger: 'end_turn',
  },
  {
    id: 'poisonous_spores',
    name: 'Poisonous Spores',
    type: 'poisonous_spores',
    description: 'Cloud of toxic spores that cause poisoning.',
    isAreaEffect: true,
    areaOfEffect: {
      shape: 'cone',
      size: 15,
    },
    saveDC: 13,
    saveAbility: 'con',
    conditions: [
      {
        name: 'poisoned',
        duration: 1,
        saveEnds: true,
      },
    ],
    trigger: 'enter',
  },
  {
    id: 'slippery_ice',
    name: 'Slippery Ice',
    type: 'slippery_ice',
    description: 'A patch of icy ground that is difficult to traverse.',
    saveDC: 10,
    saveAbility: 'dex',
    conditions: [
      {
        name: 'prone',
        duration: 1,
      },
    ],
    movementModifier: 0.5,
    trigger: 'move',
  },
];
