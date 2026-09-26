/* eslint-disable max-lines */
import { useEffect, useRef, useState } from 'react';

import {
  entityFootprint,
  type AoETemplate,
  type Point,
  type TacticalEntity,
  type TacticalMap,
} from './tactical-map-state';

import { cn } from '@/lib/utils';

type Props = {
  map: TacticalMap;
  /** Overrides the default canvas height. */
  className?: string;
  reachable?: Point[];
  path?: Point[];
  animation?: {
    entityId: string;
    path: Point[];
    step: number;
    forced?: boolean;
    mode?: 'shove' | 'pull' | 'teleport';
  } | null;
  los?: {
    from: TacticalEntity;
    to: TacticalEntity;
    distanceFeet: number;
    cover: number;
    hasLineOfSight: boolean;
  } | null;
  aoeTemplate?: AoETemplate | null;
  onAoeOriginChange?: (point: Point) => void;
  onCellClick: (point: Point) => void;
  onCellHover?: (point: Point | null) => void;
};

const rgb = (style: CSSStyleDeclaration, token: string, fallback: string) => {
  const channels = style.getPropertyValue(token).trim();
  return channels ? `rgb(${channels})` : fallback;
};
const terrain: Record<string, string> = {
  floor: 'rgba(95,113,168,.22)',
  wall: 'rgba(9,14,25,.9)',
  door_closed: 'rgba(213,176,112,.42)',
  door_open: 'rgba(79,182,196,.22)',
  difficult: 'rgba(120,90,52,.42)',
  water: 'rgba(45,111,145,.5)',
  pit: 'rgba(0,0,0,.75)',
  obscured: 'rgba(90,100,120,.42)',
};
const decoration = (
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
) => {
  ctx.fillStyle = color;
  ctx.font = `${Math.max(10, size * 0.55)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    value.includes('torch')
      ? '✦'
      : value.includes('tree')
        ? '♣'
        : value.includes('table')
          ? '▦'
          : '◆',
    x + size / 2,
    y + size / 2,
  );
};

export function TacticalMapCanvas({
  map,
  className,
  reachable = [],
  path = [],
  animation,
  los,
  aoeTemplate,
  onAoeOriginChange,
  onCellClick,
  onCellHover,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);
  const templateDrag = useRef(false);
  const cellAt = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const size = Math.min(rect.width / map.width, rect.height / map.height) * view.zoom;
    const x = Math.floor((event.clientX - rect.left - view.x) / size),
      y = Math.floor((event.clientY - rect.top - view.y) / size);
    return x >= 0 && y >= 0 && x < map.width && y < map.height ? { x, y } : null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(),
      dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const style = getComputedStyle(canvas);
    const navy = rgb(style, '--c-infinite-dark', '#070b14'),
      gold = rgb(style, '--c-infinite-gold', '#d5b070'),
      teal = rgb(style, '--c-infinite-teal', '#4fb6c4'),
      steel = rgb(style, '--c-infinite-purple', '#5f71a8');
    ctx.fillStyle = navy;
    ctx.fillRect(0, 0, rect.width, rect.height);
    const size = Math.min(rect.width / map.width, rect.height / map.height) * view.zoom;
    const px = view.x,
      py = view.y;
    map.cells.forEach((row, y) =>
      row.forEach((cell, x) => {
        ctx.fillStyle = terrain[cell.terrain] ?? terrain.floor;
        ctx.fillRect(px + x * size, py + y * size, size, size);
      }),
    );
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= map.width; x++) {
      ctx.beginPath();
      ctx.moveTo(px + x * size, py);
      ctx.lineTo(px + x * size, py + map.height * size);
      ctx.stroke();
    }
    for (let y = 0; y <= map.height; y++) {
      ctx.beginPath();
      ctx.moveTo(px, py + y * size);
      ctx.lineTo(px + map.width * size, py + y * size);
      ctx.stroke();
    }
    map.cells.forEach((row, y) =>
      row.forEach(
        (cell, x) =>
          cell.decoration &&
          decoration(ctx, cell.decoration, px + x * size, py + y * size, size, gold),
      ),
    );
    const reachableSet = new Set(reachable.map((p) => `${p.x},${p.y}`));
    reachableSet.forEach((key) => {
      const [x, y] = key.split(',').map(Number);
      ctx.fillStyle = 'rgba(79,182,196,.22)';
      ctx.fillRect(px + x * size, py + y * size, size, size);
    });
    if (path.length) {
      ctx.strokeStyle = gold;
      ctx.lineWidth = Math.max(2, size / 10);
      ctx.beginPath();
      path.forEach((p, i) => {
        const x = px + (p.x + 0.5) * size,
          y = py + (p.y + 0.5) * size;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    if (aoeTemplate) {
      const colors = {
        'player-pending': { fill: 'rgba(79,182,196,.28)', stroke: teal },
        'player-confirmed': { fill: 'rgba(213,176,112,.30)', stroke: gold },
        'hostile-telegraph': { fill: 'rgba(190,72,72,.30)', stroke: 'rgb(245,148,120)' },
      }[aoeTemplate.state];
      const affected = new Set(aoeTemplate.geometry.cells.map((cell) => `${cell.x},${cell.y}`));
      ctx.fillStyle = colors.fill;
      for (const cell of aoeTemplate.geometry.cells)
        ctx.fillRect(px + cell.x * size, py + cell.y * size, size, size);
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = Math.max(2, size * 0.08);
      for (const cell of aoeTemplate.geometry.cells) {
        const left = px + cell.x * size;
        const top = py + cell.y * size;
        const edges = [
          [{ x: cell.x, y: cell.y - 1 }, left, top, left + size, top],
          [{ x: cell.x + 1, y: cell.y }, left + size, top, left + size, top + size],
          [{ x: cell.x, y: cell.y + 1 }, left, top + size, left + size, top + size],
          [{ x: cell.x - 1, y: cell.y }, left, top, left, top + size],
        ] as const;
        for (const [neighbour, x1, y1, x2, y2] of edges) {
          if (affected.has(`${neighbour.x},${neighbour.y}`)) continue;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
      const origin = aoeTemplate.geometry.origin;
      ctx.strokeStyle = colors.stroke;
      ctx.setLineDash(aoeTemplate.state === 'hostile-telegraph' ? [5, 4] : []);
      ctx.strokeRect(
        px + origin.x * size + size * 0.16,
        py + origin.y * size + size * 0.16,
        size * 0.68,
        size * 0.68,
      );
      ctx.setLineDash([]);
    }
    map.entities.forEach((entity) => {
      const animated = animation?.entityId === entity.id ? animation.path[animation.step] : null;
      const pos = animated ?? entity;
      const footprint = entityFootprint(entity.size),
        diameter = size * footprint;
      const cx = px + (pos.x + footprint / 2) * size,
        cy = py + (pos.y + footprint / 2) * size;
      if (animation?.entityId === entity.id && animation.forced) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(10, diameter * 0.5), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgb(245,148,120)';
        ctx.lineWidth = Math.max(2, size * 0.08);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(6, diameter * 0.35), 0, Math.PI * 2);
      ctx.fillStyle =
        entity.type === 'pc' ? teal : entity.type === 'monster' ? 'rgb(190,72,72)' : steel;
      ctx.fill();
      ctx.strokeStyle =
        entity.type === 'pc'
          ? gold
          : entity.type === 'monster'
            ? 'rgb(245,148,120)'
            : 'rgba(255,255,255,.55)';
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.stroke();
      ctx.fillStyle = navy;
      ctx.font = `bold ${Math.max(9, diameter * 0.28)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((entity.name ?? entity.id).slice(0, 2).toUpperCase(), cx, cy);
    });
    if (los) {
      const from = los.from,
        to = los.to;
      ctx.strokeStyle = los.hasLineOfSight ? gold : 'rgb(190,72,72)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + (from.x + 0.5) * size, py + (from.y + 0.5) * size);
      ctx.lineTo(px + (to.x + 0.5) * size, py + (to.y + 0.5) * size);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = gold;
      ctx.font = '12px sans-serif';
      ctx.fillText(
        `${los.distanceFeet} ft · cover ${los.cover}`,
        px + (to.x + 0.5) * size,
        py + (to.y + 0.5) * size - 14,
      );
    }
  }, [map, reachable, path, animation, los, aoeTemplate, view]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Tactical combat map"
      className={cn(
        'h-[min(52vh,520px)] w-full touch-none rounded-md border border-white/10',
        className,
      )}
      onPointerMove={(event) => {
        if (templateDrag.current) {
          const point = cellAt(event);
          if (point) onAoeOriginChange?.(point);
        } else if (drag.current)
          setView((current) => ({
            ...current,
            x: drag.current!.viewX + event.clientX - drag.current!.x,
            y: drag.current!.viewY + event.clientY - drag.current!.y,
          }));
        else onCellHover?.(cellAt(event));
      }}
      onPointerLeave={() => onCellHover?.(null)}
      onPointerUp={(event) => {
        const moved =
          drag.current &&
          Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 6;
        if (templateDrag.current) {
          templateDrag.current = false;
          const point = cellAt(event);
          if (point) onAoeOriginChange?.(point);
          return;
        }
        drag.current = null;
        if (!moved) {
          const point = cellAt(event);
          if (point) onCellClick(point);
        }
      }}
      onWheel={(event) => {
        event.preventDefault();
        setView((current) => ({
          ...current,
          zoom: Math.max(0.75, Math.min(2.5, current.zoom + (event.deltaY > 0 ? -0.1 : 0.1))),
        }));
      }}
      onPointerDown={(event) => {
        (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
        if (aoeTemplate?.state === 'player-pending') {
          templateDrag.current = true;
          const point = cellAt(event);
          if (point) onAoeOriginChange?.(point);
          return;
        }
        if (event.pointerType === 'touch')
          drag.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
      }}
      onTouchStart={(event) => {
        if (event.touches.length === 2) {
          const [a, b] = Array.from(event.touches);
          pinch.current = {
            distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
            zoom: view.zoom,
          };
        }
      }}
      onTouchMove={(event) => {
        if (event.touches.length === 2 && pinch.current) {
          const [a, b] = Array.from(event.touches);
          const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          setView((current) => ({
            ...current,
            zoom: Math.max(
              0.75,
              Math.min(2.5, (pinch.current!.zoom * distance) / pinch.current!.distance),
            ),
          }));
        }
      }}
      onTouchEnd={() => {
        pinch.current = null;
      }}
    />
  );
}
