import React from 'react';

import { TravelButton } from './PlaceCard';
import {
  canTravelTo,
  PLACE_STATE_WORDS,
  type StoryMapPlaceView,
  type StoryMapView,
} from './useStoryMap';

/**
 * #1754: the text form of the region map (design §9). It holds everything the drawing
 * shows, grouped by zone, so a screen reader user never needs the SVG.
 */
export const PlaceList: React.FC<{
  view: StoryMapView;
  onSelectPlace: (key: string) => void;
  onTravel: (place: StoryMapPlaceView) => void;
}> = ({ view, onSelectPlace, onTravel }) => (
  <div data-testid="place-list" className="flex flex-col gap-3 text-[#f6e3b8]">
    {view.zones.map((zone) => (
      <section key={zone.key} aria-labelledby={`zone-heading-${zone.key}`}>
        <h3
          id={`zone-heading-${zone.key}`}
          className="ir-display mb-1 text-sm font-bold text-[#d5b070]"
        >
          {zone.name}
        </h3>
        {zone.places.length === 0 ? (
          <p className="text-sm opacity-80">No places known yet.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {zone.places.map((place) => (
              <li
                key={place.key}
                data-testid={`place-row-${place.key}`}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded border border-[#d5b070]/50 px-3 py-1 text-left hover:bg-[#d5b070]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]"
                  onClick={() => onSelectPlace(place.key)}
                >
                  <span className="ir-display text-sm font-bold">{place.name}</span>
                  <span className="text-xs">
                    {PLACE_STATE_WORDS[place.state]}
                    {place.isCurrent && ' · You are here'}
                  </span>
                </button>
                {canTravelTo(place) && <TravelButton place={place} onTravel={onTravel} />}
              </li>
            ))}
          </ol>
        )}
      </section>
    ))}
  </div>
);
