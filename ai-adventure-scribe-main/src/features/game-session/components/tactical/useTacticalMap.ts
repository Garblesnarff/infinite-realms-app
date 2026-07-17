import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyTacticalDelta,
  type AoETemplate,
  type Point,
  type TacticalDelta,
  type TacticalMap,
} from './tactical-map-state';

import { getAuthHeaders } from '@/services/auth/TokenService';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';
const headers = () => getAuthHeaders({ includeEmptyToken: true });

export function useTacticalMap(sessionId: string) {
  const [map, setMap] = useState<TacticalMap | null>(null);
  const [animation, setAnimation] = useState<{
    entityId: string;
    path: Point[];
    step: number;
    forced?: boolean;
    mode?: 'shove' | 'pull' | 'teleport';
  } | null>(null);
  const [queuedDeltas, setQueuedDeltas] = useState<TacticalDelta[]>([]);
  const [degradeLine, setDegradeLine] = useState<string | null>(null);
  const [aoeTemplate, setAoeTemplate] = useState<AoETemplate | null>(null);
  const frameRef = useRef<number>();

  const applyDelta = useCallback((delta: TacticalDelta) => {
    setMap((current) => applyTacticalDelta(current, delta));
    if (delta.type === 'entity_moved' && delta.path.length > 1)
      setAnimation({
        entityId: delta.entityId,
        path: delta.path,
        step: 0,
        forced: delta.forced,
        mode: delta.mode,
      });
  }, []);

  useEffect(() => {
    if (animation || !queuedDeltas.length) return;
    const [next, ...rest] = queuedDeltas;
    setQueuedDeltas(rest);
    applyDelta(next);
  }, [animation, applyDelta, queuedDeltas]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map`, {
      headers: headers(),
    })
      .then(async (response) => (response.ok ? (response.json() as Promise<TacticalMap>) : null))
      .then((next) => {
        if (!cancelled && next) setMap(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (
        event as CustomEvent<
          | TacticalDelta
          | { type: 'tactical_action_queue'; actions: TacticalDelta[] }
          | { type: 'tactical_degraded'; text: string }
          | { type: 'aoe_preview'; state: 'player-pending' | 'hostile-telegraph'; actorId: string; spellId: string; slotLevel: number | null; geometry: AoETemplate['geometry'] }
          | { type: 'aoe_cast'; state: 'player-confirmed' | 'hostile-telegraph'; actorId: string; spellId: string; geometry: AoETemplate['geometry']; forcedMoves: Array<{ entityId: string; path: Point[] }> }
        >
      ).detail;
      if (detail.type === 'tactical_action_queue')
        setQueuedDeltas((current) => [...current, ...detail.actions]);
      else if (detail.type === 'tactical_degraded') setDegradeLine(detail.text);
      else if (detail.type === 'aoe_preview') setAoeTemplate(detail);
      else if (detail.type === 'aoe_cast') {
        setAoeTemplate({ ...detail, slotLevel: null });
        for (const move of detail.forcedMoves) {
          const delta: TacticalDelta = {
            type: 'entity_moved',
            entityId: move.entityId,
            path: move.path,
            forced: true,
            mode: 'shove',
          };
          applyDelta(delta);
        }
      }
      else applyDelta(detail);
    };
    window.addEventListener('tactical-map-delta', listener);
    return () => window.removeEventListener('tactical-map-delta', listener);
  }, [applyDelta]);

  useEffect(() => {
    if (aoeTemplate?.state !== 'player-confirmed') return;
    const timeout = window.setTimeout(() => setAoeTemplate(null), 900);
    return () => window.clearTimeout(timeout);
  }, [aoeTemplate]);

  useEffect(() => {
    if (!animation) return;
    let started = 0;
    const tick = (now: number) => {
      if (!started) started = now;
      const step = Math.min(animation.path.length - 1, Math.floor((now - started) / 80));
      setAnimation((current) =>
        current && current.step === step ? current : { ...animation, step },
      );
      if (step < animation.path.length - 1) frameRef.current = requestAnimationFrame(tick);
      else {
        frameRef.current = undefined;
        setAnimation(null);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [animation?.entityId, animation?.path]);

  const request = useCallback(
    async <T>(path: string, init?: RequestInit) => {
      const response = await fetch(
        `${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map${path}`,
        {
          ...init,
          headers: { ...headers(), 'Content-Type': 'application/json', ...init?.headers },
        },
      );
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, data: data as T };
    },
    [sessionId],
  );

  return { map, animation, applyDelta, request, degradeLine, aoeTemplate, setAoeTemplate };
}
