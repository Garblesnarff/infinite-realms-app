import type { StoryMapView } from './useStoryMap';

/** Map space: places sit at x*W, y*H. The frame keeps the same 4:3 shape at every zoom. */
export const MAP_W = 400;
export const MAP_H = 300;
const MIN_W = MAP_W / 4;

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_VIEW: ViewBox = { x: 0, y: 0, w: MAP_W, h: MAP_H };

function clampView(view: ViewBox): ViewBox {
  const w = Math.min(MAP_W, Math.max(MIN_W, view.w));
  const h = (w * MAP_H) / MAP_W;
  return {
    x: Math.min(MAP_W - w, Math.max(0, view.x)),
    y: Math.min(MAP_H - h, Math.max(0, view.y)),
    w,
    h,
  };
}

/** Drag: move the view by a screen distance, given the frame's width in pixels. */
export function panView(view: ViewBox, dxPx: number, dyPx: number, framePx: number): ViewBox {
  const scale = view.w / framePx;
  return clampView({ ...view, x: view.x - dxPx * scale, y: view.y - dyPx * scale });
}

/** Pinch: scale the view by `factor` (>1 zooms in) about a point given as 0..1 of the frame. */
export function zoomView(view: ViewBox, factor: number, fx = 0.5, fy = 0.5): ViewBox {
  const w = Math.min(MAP_W, Math.max(MIN_W, view.w / factor));
  const h = (w * MAP_H) / MAP_W;
  const px = view.x + fx * view.w;
  const py = view.y + fy * view.h;
  return clampView({ x: px - fx * w, y: py - fy * h, w, h });
}

/** "You are here": the same zoom, centred on the place. */
export function centreView(view: ViewBox, place: { x: number; y: number }): ViewBox {
  return clampView({
    ...view,
    x: place.x * MAP_W - view.w / 2,
    y: place.y * MAP_H - view.h / 2,
  });
}

export function regionMapLabel(view: StoryMapView): string {
  const count = view.places.length;
  const where = view.current ? `You are at ${view.current.name}. ` : '';
  return `Region map. ${where}${count} ${count === 1 ? 'place' : 'places'} known.`;
}
