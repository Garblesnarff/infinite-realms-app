import React from 'react';

import {
  centreView,
  FULL_VIEW,
  MAP_H,
  MAP_W,
  panView,
  zoomView,
  regionMapLabel,
  type ViewBox,
} from './region-map-view';
import { PLACE_STATE_WORDS, type StoryMapPlaceView, type StoryMapView } from './useStoryMap';

const NAVY = '#0e1a36';
const GOLD = '#d5b070';
const CREAM = '#f6e3b8';
const ZONE_PAD = 0.07;

function Pin({
  place,
  labelled,
}: {
  place: StoryMapPlaceView;
  labelled: boolean;
}): React.ReactElement {
  const cx = place.x * MAP_W;
  const cy = place.y * MAP_H;
  const visited = place.state === 'visited';
  return (
    <g data-testid={`pin-${place.key}`} data-state={place.state}>
      {place.isCurrent && (
        <circle cx={cx} cy={cy} r={12} fill="none" stroke={CREAM} strokeWidth={1.5} />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={7}
        fill={visited ? GOLD : NAVY}
        stroke={GOLD}
        strokeWidth={2}
        strokeDasharray={visited ? undefined : '3 2'}
      />
      {!visited && (
        <text
          x={cx}
          y={cy + 3.5}
          textAnchor="middle"
          fontSize={9}
          fill={CREAM}
          className="ir-display"
        >
          ?
        </text>
      )}
      {labelled && (
        <text
          x={cx}
          y={cy + 20}
          textAnchor="middle"
          fontSize={10}
          fill={CREAM}
          stroke={NAVY}
          strokeWidth={3}
          paintOrder="stroke"
          className="ir-display"
        >
          {place.name}
        </text>
      )}
    </g>
  );
}

/**
 * #1754: the drawn region map (design §8–§10). The drawing is one role="img"; the pins are
 * real buttons laid over it in list order, so Tab reaches them and they stay 44 px.
 */
export const RegionMap: React.FC<{
  view: StoryMapView;
  selectedKey: string | null;
  onSelectPlace: (key: string) => void;
}> = ({ view, selectedKey, onSelectPlace }) => {
  const [box, setBox] = React.useState<ViewBox>(FULL_VIEW);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const moved = React.useRef(false);

  const frameRect = (): DOMRect | null => frameRef.current?.getBoundingClientRect() ?? null;

  const onPointerDown = (event: React.PointerEvent): void => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) moved.current = false;
  };
  const onPointerMove = (event: React.PointerEvent): void => {
    const prev = pointers.current.get(event.pointerId);
    const rect = frameRect();
    if (!prev || !rect || rect.width === 0) return;
    const next = { x: event.clientX, y: event.clientY };
    if (pointers.current.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (!moved.current && Math.hypot(dx, dy) < 4) return;
      moved.current = true;
      setBox((current) => panView(current, dx, dy, rect.width));
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (!other) return;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0) {
        moved.current = true;
        const fx = ((next.x + other.x) / 2 - rect.left) / rect.width;
        const fy = ((next.y + other.y) / 2 - rect.top) / rect.height;
        setBox((current) => zoomView(current, after / before, fx, fy));
      }
    }
    pointers.current.set(event.pointerId, next);
  };
  const onPointerEnd = (event: React.PointerEvent): void => {
    pointers.current.delete(event.pointerId);
  };

  const toFrame = (x: number, y: number): { left: string; top: string } => ({
    left: `${((x * MAP_W - box.x) / box.w) * 100}%`,
    top: `${((y * MAP_H - box.y) / box.h) * 100}%`,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {view.current && (
          <button
            type="button"
            className="min-h-11 rounded border border-[#d5b070] bg-[#0e1a36] px-3 text-sm text-[#f6e3b8] hover:bg-[#d5b070]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]"
            onClick={() => {
              const here = view.current;
              if (here) setBox((current) => centreView(current, here));
            }}
          >
            You are here
          </button>
        )}
      </div>
      <div
        ref={frameRef}
        data-testid="region-map-frame"
        className="relative aspect-[4/3] w-full touch-none select-none overflow-hidden rounded border border-[#d5b070] bg-[#0e1a36]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        onClickCapture={(event) => {
          // A drag that ends on a pin is a pan, not a tap.
          if (moved.current) {
            event.stopPropagation();
            moved.current = false;
          }
        }}
      >
        <svg
          role="img"
          aria-label={regionMapLabel(view)}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          className="absolute inset-0 h-full w-full"
          data-testid="region-map"
        >
          <rect x={0} y={0} width={MAP_W} height={MAP_H} fill={NAVY} />
          {view.zones.map((zone) => {
            if (!zone.bounds) return null;
            const known = zone.places.length > 0;
            const x = (zone.bounds.minX - ZONE_PAD) * MAP_W;
            const y = (zone.bounds.minY - ZONE_PAD) * MAP_H;
            const w = (zone.bounds.maxX - zone.bounds.minX + ZONE_PAD * 2) * MAP_W;
            const h = (zone.bounds.maxY - zone.bounds.minY + ZONE_PAD * 2) * MAP_H;
            return (
              <g key={zone.key} data-testid={`zone-${zone.key}`}>
                {known && (
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    rx={18}
                    fill={CREAM}
                    fillOpacity={0.08}
                    stroke={GOLD}
                    strokeOpacity={0.35}
                  />
                )}
                <text
                  x={known ? x + 8 : x + w / 2}
                  y={known ? y + 13 : y + h / 2}
                  textAnchor={known ? 'start' : 'middle'}
                  fontSize={10}
                  fill={GOLD}
                  fillOpacity={known ? 1 : 0.55}
                  className="ir-display"
                >
                  {zone.name}
                </text>
              </g>
            );
          })}
          {view.routes.map((route) => (
            <line
              key={`${route.from.key}-${route.to.key}`}
              data-testid={`route-${route.from.key}-${route.to.key}`}
              x1={route.from.x * MAP_W}
              y1={route.from.y * MAP_H}
              x2={route.to.x * MAP_W}
              y2={route.to.y * MAP_H}
              stroke={GOLD}
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={0.8}
            />
          ))}
          {view.places.map((place) => (
            <Pin
              key={place.key}
              place={place}
              labelled={place.state === 'visited' || place.key === selectedKey}
            />
          ))}
        </svg>
        {view.places.map((place) => (
          <button
            key={place.key}
            type="button"
            data-testid={`pin-button-${place.key}`}
            aria-label={`${place.name}, ${PLACE_STATE_WORDS[place.state]}${place.isCurrent ? ', you are here' : ''}`}
            aria-pressed={place.key === selectedKey}
            className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]"
            style={toFrame(place.x, place.y)}
            onClick={() => onSelectPlace(place.key)}
          />
        ))}
      </div>
    </div>
  );
};
