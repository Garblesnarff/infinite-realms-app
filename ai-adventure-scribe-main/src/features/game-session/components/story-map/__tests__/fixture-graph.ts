import type { StoryMapGraph } from '../useStoryMap';

/**
 * #1754: a stand-in graph in the shape of design §4 (story_map_places, story_map_edges,
 * story_map_progress, story_map_revealed_edges) until GET /v1/story-map/:campaignId lands
 * (#1753). Only useStoryMap.ts reads it.
 */
export const FIXTURE_STORY_MAP: StoryMapGraph = {
  zones: [
    { key: 'lowmarsh', name: 'The Lowmarsh' },
    { key: 'hollow-hills', name: 'Hollow Hills' },
    { key: 'greywood', name: 'Greywood' },
    { key: 'ashen-coast', name: 'Ashen Coast' },
  ],
  places: [
    { key: 'reedhaven', name: 'Reedhaven', zoneKey: 'lowmarsh', x: 0.18, y: 0.7 },
    { key: 'sunken-chapel', name: 'Sunken Chapel', zoneKey: 'lowmarsh', x: 0.3, y: 0.86 },
    { key: 'toll-bridge', name: 'Old Toll Bridge', zoneKey: 'lowmarsh', x: 0.36, y: 0.62 },
    { key: 'barrow-gate', name: 'Barrow Gate', zoneKey: 'hollow-hills', x: 0.52, y: 0.44 },
    { key: 'shepherds-rest', name: "Shepherd's Rest", zoneKey: 'hollow-hills', x: 0.42, y: 0.3 },
    { key: 'lantern-tor', name: 'Lantern Tor', zoneKey: 'hollow-hills', x: 0.62, y: 0.24 },
    { key: 'woodcutters-camp', name: "Woodcutters' Camp", zoneKey: 'greywood', x: 0.14, y: 0.3 },
    { key: 'heartwood', name: 'The Heartwood', zoneKey: 'greywood', x: 0.22, y: 0.14 },
    { key: 'saltmere', name: 'Saltmere', zoneKey: 'ashen-coast', x: 0.82, y: 0.6 },
    { key: 'wreck-point', name: 'Wreck Point', zoneKey: 'ashen-coast', x: 0.88, y: 0.82 },
  ],
  edges: [
    { from: 'reedhaven', to: 'sunken-chapel', label: 'causeway', hidden: false },
    { from: 'reedhaven', to: 'toll-bridge', label: 'marsh road', hidden: false },
    { from: 'toll-bridge', to: 'barrow-gate', label: 'hill track', hidden: false },
    { from: 'reedhaven', to: 'woodcutters-camp', label: 'logging trail', hidden: false },
    { from: 'barrow-gate', to: 'shepherds-rest', label: null, hidden: false },
    { from: 'barrow-gate', to: 'lantern-tor', label: null, hidden: false },
    { from: 'woodcutters-camp', to: 'heartwood', label: null, hidden: true },
    { from: 'barrow-gate', to: 'saltmere', label: 'coast road', hidden: false },
    { from: 'saltmere', to: 'wreck-point', label: null, hidden: false },
    { from: 'sunken-chapel', to: 'barrow-gate', label: 'drowned tunnel', hidden: true },
  ],
  progress: {
    currentPlaceKey: 'toll-bridge',
    places: [
      { key: 'reedhaven', state: 'visited' },
      { key: 'toll-bridge', state: 'visited' },
      { key: 'sunken-chapel', state: 'known' },
      { key: 'barrow-gate', state: 'known' },
      { key: 'woodcutters-camp', state: 'known' },
    ],
    revealedEdges: [],
  },
};
