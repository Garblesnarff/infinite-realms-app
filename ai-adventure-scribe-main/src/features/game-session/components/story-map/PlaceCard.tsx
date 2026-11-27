import React from 'react';

import { canTravelTo, PLACE_STATE_WORDS, type StoryMapPlaceView } from './useStoryMap';

export const TravelButton: React.FC<{
  place: StoryMapPlaceView;
  onTravel: (place: StoryMapPlaceView) => void;
}> = ({ place, onTravel }) => (
  <button
    type="button"
    aria-label={`Travel here: ${place.name}`}
    className="min-h-11 shrink-0 rounded border border-[#d5b070] bg-[#d5b070] px-3 text-sm font-semibold text-[#0e1a36] hover:bg-[#f6e3b8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]"
    onClick={() => onTravel(place)}
  >
    Travel here
  </button>
);

/** #1754: the card a pin or a list row opens (design §9). */
export const PlaceCard: React.FC<{
  place: StoryMapPlaceView;
  zoneName: string | null;
  onTravel: (place: StoryMapPlaceView) => void;
  onClose: () => void;
}> = ({ place, zoneName, onTravel, onClose }) => {
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, [place.key]);
  const headingId = `place-card-${place.key}`;
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      data-testid="place-card"
      className="flex flex-col gap-2 rounded border border-[#d5b070] bg-[#0e1a36] p-3 text-[#f6e3b8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]"
    >
      <div className="flex items-start gap-3">
        {place.state === 'visited' && place.thumbnailUrl && (
          <img
            src={place.thumbnailUrl}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded border border-[#d5b070] object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="ir-display text-base font-bold">
            {place.name}
          </h3>
          {zoneName && <p className="text-sm text-[#d5b070]">{zoneName}</p>}
          <p className="text-sm">
            {PLACE_STATE_WORDS[place.state]}
            {place.isCurrent && ' · You are here'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canTravelTo(place) && <TravelButton place={place} onTravel={onTravel} />}
        <button
          type="button"
          className="min-h-11 rounded border border-[#d5b070] px-3 text-sm hover:bg-[#d5b070]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]"
          onClick={onClose}
        >
          Close card
        </button>
      </div>
    </section>
  );
};
