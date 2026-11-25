import React from 'react';

import { PlaceCard } from './PlaceCard';
import { PlaceList } from './PlaceList';
import { RegionMap } from './RegionMap';
import { closeStoryMap, requestTravel } from './story-map-state';
import { useStoryMap, type StoryMapPlaceView } from './useStoryMap';

type Tab = 'map' | 'places';

/**
 * #1754: the region map and the place list (design §9). In the rail (desktop) the map sits
 * on top and the list under it; in the phone sheet they are two tabs.
 */
export const StoryMapPanel: React.FC<{
  campaignId: string;
  layout: 'rail' | 'sheet';
}> = ({ campaignId, layout }) => {
  const result = useStoryMap(campaignId);
  const [tab, setTab] = React.useState<Tab>('map');
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const baseId = React.useId();

  React.useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const view = result.view;
  const selected = view?.places.find((place) => place.key === selectedKey) ?? null;
  const onTravel = (place: StoryMapPlaceView): void => requestTravel(place.name);
  const card = selected && view && (
    <PlaceCard
      place={selected}
      zoneName={view.zones.find((zone) => zone.key === (selected.zoneKey ?? ''))?.name ?? null}
      onTravel={onTravel}
      onClose={() => setSelectedKey(null)}
    />
  );
  const map = view && (
    <RegionMap view={view} selectedKey={selectedKey} onSelectPlace={setSelectedKey} />
  );
  const list = view && <PlaceList view={view} onSelectPlace={setSelectedKey} onTravel={onTravel} />;

  let body: React.ReactNode;
  if (result.status === 'loading') body = <p className="text-sm">Loading the map…</p>;
  else if (result.status === 'error') body = <p className="text-sm">The map could not load.</p>;
  else if (layout === 'rail')
    body = (
      <>
        {map}
        {card}
        {list}
      </>
    );
  else
    body = (
      <>
        <div role="tablist" aria-label="Map views" className="flex gap-2">
          {(['map', 'places'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${baseId}-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`${baseId}-panel-${key}`}
              className={`min-h-11 flex-1 rounded border border-[#d5b070] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8] ${
                tab === key ? 'bg-[#d5b070] font-semibold text-[#0e1a36]' : 'text-[#f6e3b8]'
              }`}
              onClick={() => setTab(key)}
            >
              {key === 'map' ? 'Map' : 'Places'}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${baseId}-panel-${tab}`}
          aria-labelledby={`${baseId}-tab-${tab}`}
          className="flex flex-col gap-3"
        >
          {tab === 'map' ? (
            <>
              {map}
              {card}
            </>
          ) : (
            <>
              {card}
              {list}
            </>
          )}
        </div>
      </>
    );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label="Region map"
      tabIndex={-1}
      data-testid={`story-map-${layout}`}
      className="flex flex-col gap-3 rounded-xl border border-[#d5b070] bg-[#0e1a36] p-3 text-[#f6e3b8] outline-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          closeStoryMap();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="ir-display font-bold">Region map</h2>
        <button
          type="button"
          className="min-h-11 rounded px-3 text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]"
          onClick={closeStoryMap}
        >
          Close map
        </button>
      </div>
      {body}
    </div>
  );
};
