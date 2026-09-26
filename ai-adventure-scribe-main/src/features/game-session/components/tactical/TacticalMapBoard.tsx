import { Maximize2, Minimize2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { type Point, type TacticalEntity } from './tactical-map-state';
import { TacticalMapCanvas } from './TacticalMapCanvas';
import { useTacticalMapContext, type TacticalMapState } from './TacticalMapProvider';
import { useTacticalMap } from './useTacticalMap';

import { Button } from '@/components/ui/button';
import { useCombat } from '@/contexts/CombatContext';
import { cn } from '@/lib/utils';

type Props = {
  sessionId: string;
  /** Canvas height classes; the rail is narrower than the sheet. */
  canvasClassName?: string;
  className?: string;
};
type MoveResponse = {
  result?: {
    applied: boolean;
    path?: Point[];
    refusal?: { reason?: string; needsFeet?: number; hasFeet?: number };
  };
};

/**
 * Reads the shared map from TacticalMapProvider when one is mounted (the game layout), so
 * moving the board between the rail and the sheet keeps its state. Without a provider it
 * owns the map itself.
 */
export function TacticalMapBoard(props: Props): JSX.Element {
  const shared = useTacticalMapContext();
  return shared ? (
    <TacticalMapBoardView {...props} tactical={shared} />
  ) : (
    <StandaloneTacticalMapBoard {...props} />
  );
}

function StandaloneTacticalMapBoard(props: Props): JSX.Element {
  const tactical = useTacticalMap(props.sessionId);
  return <TacticalMapBoardView {...props} tactical={tactical} />;
}

function TacticalMapBoardView({
  tactical,
  canvasClassName,
  className,
}: Props & { tactical: TacticalMapState }): JSX.Element | null {
  const { map, animation, request, degradeLine, aoeTemplate, setAoeTemplate } = tactical;
  const { state: combatState } = useCombat();
  const currentTurnId = combatState.activeEncounter?.currentTurnParticipantId;
  const [collapsed, setCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moves, setMoves] = useState<Point[]>([]);
  const [hovered, setHovered] = useState<Point | null>(null);
  const [lineOfSight, setLineOfSight] = useState<{
    from: TacticalEntity;
    to: TacticalEntity;
    distanceFeet: number;
    cover: number;
    hasLineOfSight: boolean;
  } | null>(null);
  const activePlayer = useMemo(
    () =>
      map?.entities.find((entity) => entity.id === currentTurnId && entity.type === 'pc') ?? null,
    [map, currentTurnId],
  );
  const selected = map?.entities.find((entity) => entity.id === selectedId) ?? null;
  const previewPath =
    activePlayer && hovered && moves.some((move) => move.x === hovered.x && move.y === hovered.y)
      ? [{ x: activePlayer.x, y: activePlayer.y }, hovered]
      : [];

  if (!map) return null;
  const cell = hovered ? map.cells[hovered.y]?.[hovered.x] : null;
  const click = async (point: Point) => {
    const occupant = map.entities.find(
      (entity) =>
        point.x >= entity.x &&
        point.x <
          entity.x +
            { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }[entity.size] &&
        point.y >= entity.y &&
        point.y <
          entity.y +
            { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }[entity.size],
    );
    if (occupant && occupant.id === activePlayer?.id) {
      const response = await request<{ moves: Point[] }>(
        `/valid-moves/${encodeURIComponent(occupant.id)}`,
      );
      if (response.ok) {
        setSelectedId(occupant.id);
        setMoves(response.data.moves);
        setLineOfSight(null);
      }
      return;
    }
    if (occupant && activePlayer) {
      const response = await request<{
        distanceFeet: number;
        cover: number;
        hasLineOfSight: boolean;
      }>(`/check/${encodeURIComponent(activePlayer.id)}/${encodeURIComponent(occupant.id)}`);
      if (response.ok) setLineOfSight({ from: activePlayer, to: occupant, ...response.data });
      return;
    }
    if (
      !selected ||
      selected.id !== activePlayer?.id ||
      !moves.some((move) => move.x === point.x && move.y === point.y)
    )
      return;
    const response = await request<MoveResponse>('/move', {
      method: 'POST',
      body: JSON.stringify({ entityId: selected.id, x: point.x, y: point.y }),
    });
    const result = response.data.result;
    if (!response.ok || !result?.applied) {
      const refusal = result?.refusal;
      toast.error(
        refusal?.reason === 'insufficient_movement'
          ? `Need ${refusal.needsFeet} ft; ${refusal.hasFeet} ft remains.`
          : (refusal?.reason ?? 'That move is not available.'),
      );
      return;
    }
    setMoves([]);
    setSelectedId(null);
  };

  const confirmAoE = async () => {
    if (aoeTemplate?.state !== 'player-pending') return;
    const response = await request<{ delta?: unknown; error?: string }>('/aoe-cast', {
      method: 'POST',
      body: JSON.stringify({
        phase: 'resolve',
        actorId: aoeTemplate.actorId,
        spellId: aoeTemplate.spellId,
        origin: aoeTemplate.geometry.origin,
        direction: aoeTemplate.geometry.direction,
        slotLevel: aoeTemplate.slotLevel,
      }),
    });
    if (!response.ok) toast.error(response.data.error ?? 'The spell could not be resolved.');
  };

  return (
    <section
      className={cn(
        'shrink-0 rounded-lg border border-infinite-gold/25 bg-infinite-dark/40',
        className,
      )}
      aria-label="Tactical combat"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-infinite-gold">
        <span className="font-display">
          Initiative · round {map.round}
          {activePlayer ? ' · your turn' : ''}
        </span>
        <div className="flex gap-2">
          {aoeTemplate?.state === 'player-pending' && (
            <Button size="sm" onClick={confirmAoE}>
              Confirm spell area
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label={collapsed ? 'Expand tactical map' : 'Collapse tactical map'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div className="relative px-3 pb-3">
          <TacticalMapCanvas
            className={canvasClassName}
            map={map}
            reachable={moves}
            path={previewPath}
            animation={animation}
            los={lineOfSight}
            aoeTemplate={aoeTemplate}
            onAoeOriginChange={(origin) =>
              setAoeTemplate((current) =>
                current?.state === 'player-pending'
                  ? (() => {
                      const dx = origin.x - current.geometry.origin.x;
                      const dy = origin.y - current.geometry.origin.y;
                      return {
                        ...current,
                        geometry: {
                          ...current.geometry,
                          origin,
                          // A translated template remains exactly the same cell shape;
                          // the server recomputes and authorizes it on confirmation.
                          cells: current.geometry.cells
                            .map((cell) => ({ x: cell.x + dx, y: cell.y + dy }))
                            .filter(
                              (cell) =>
                                cell.x >= 0 &&
                                cell.y >= 0 &&
                                cell.x < map.width &&
                                cell.y < map.height,
                            ),
                        },
                      };
                    })()
                  : current,
              )
            }
            onCellClick={click}
            onCellHover={setHovered}
          />
          {degradeLine && (
            <p role="status" className="mt-2 text-xs text-infinite-gold">
              {degradeLine}
            </p>
          )}
          {cell && hovered && (
            <div className="pointer-events-none absolute bottom-5 left-5 rounded bg-infinite-dark/95 px-2 py-1 text-xs text-white shadow">
              {cell.terrain.replace('_', ' ')} · cover {cell.cover}
              {cell.terrain === 'difficult' ? ' · difficult terrain' : ''}
              {map.entities.find((entity) => entity.x === hovered.x && entity.y === hovered.y)?.name
                ? ` · ${map.entities.find((entity) => entity.x === hovered.x && entity.y === hovered.y)?.name}`
                : ''}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
