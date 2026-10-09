interface LayerConfig {
  id: string;
  name: string;
  type: 'background' | 'grid' | 'tokens' | 'effects' | 'drawings' | 'ui';
  zIndex: number;
}

const LAYER_CONFIGS: LayerConfig[] = [
  { id: 'background', name: 'Background', type: 'background', zIndex: 0 },
  { id: 'grid', name: 'Grid', type: 'grid', zIndex: 1 },
  { id: 'tokens', name: 'Tokens', type: 'tokens', zIndex: 2 },
  { id: 'effects', name: 'Effects', type: 'effects', zIndex: 3 },
  { id: 'drawings', name: 'Drawings', type: 'drawings', zIndex: 4 },
  { id: 'ui', name: 'UI', type: 'ui', zIndex: 5 },
];

export { LAYER_CONFIGS };
export type { LayerConfig };
