/**
 * PhysicsDiceBox — one real shared physics throw, then a symmetry rotation.
 *
 * The DiceEngine result is authoritative. We give cannon-es every engine face
 * before the throw, record the shared world, and rotate each finished die by a
 * symmetry of its solid so the recorded tumble lands on that face without a
 * snap or a second per-die simulation.
 */
import * as CANNON from 'cannon-es';
import { Howl } from 'howler';
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import { makeDie, symmetry, topIndex, type DieType, type Die } from './diceShapes';

import type { DiceRollResult } from '@/services/dice/DiceEngine';

import logger from '@/lib/logger';

interface Props {
  result: DiceRollResult | null;
  isRolling: boolean;
  showAnimation: boolean;
  height?: number;
  /** Test seam for proving the text fallback when a tray never settles flat. */
  simulate?: (specs: RollSpec[]) => Promise<Simulation>;
}

const SIDES_TO_TYPE: Record<number, DieType> = {
  4: 'd4',
  6: 'd6',
  8: 'd8',
  10: 'd10',
  12: 'd12',
  20: 'd20',
};

const DIE_R = 0.95;
const BOUND = 3.4;
const STEP = 1 / 60;
const MAX_STEPS = 720;
const MAX_FLAT_ATTEMPTS = 8;

interface Frame {
  p: [number, number, number];
  q: [number, number, number, number];
}

interface RollSpec {
  die: Die;
  target: number;
  itemIndex: number;
  useInTotal: boolean;
}

interface Simulation {
  frames: Frame[][];
  flat: boolean;
}

type SliceObserver = (durationMs: number) => void;

interface Track {
  die: Die;
  frames: Frame[];
  rotation: THREE.Quaternion;
  itemIndex: number;
  useInTotal: boolean;
  t: number;
  done: boolean;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface SimWorld {
  world: CANNON.World;
  dieMaterial: CANNON.Material;
}

function makeSimWorld(): SimWorld {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -40, 0) });
  world.allowSleep = true;

  const dieMaterial = new CANNON.Material('dice');
  const feltMaterial = new CANNON.Material('felt');
  const wallMaterial = new CANNON.Material('wood');
  world.addContactMaterial(
    new CANNON.ContactMaterial(dieMaterial, feltMaterial, { friction: 0.32, restitution: 0.3 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(dieMaterial, wallMaterial, { friction: 0.05, restitution: 0.55 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(dieMaterial, dieMaterial, { friction: 0.08, restitution: 0.42 }),
  );

  const floor = new CANNON.Body({ mass: 0, material: feltMaterial, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);

  const wall = (x: number, z: number, rotationY: number) => {
    const body = new CANNON.Body({ mass: 0, material: wallMaterial, shape: new CANNON.Plane() });
    body.position.set(x, 0, z);
    body.quaternion.setFromEuler(0, rotationY, 0);
    world.addBody(body);
  };
  wall(-BOUND, 0, Math.PI / 2);
  wall(BOUND, 0, -Math.PI / 2);
  wall(0, -BOUND, 0);
  wall(0, BOUND, Math.PI);
  return { world, dieMaterial };
}

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

function makeBodies(
  specs: RollSpec[],
  world: CANNON.World,
  dieMaterial: CANNON.Material,
): CANNON.Body[] {
  return specs.map((spec, index) => {
    const body = new CANNON.Body({
      mass: 1,
      material: dieMaterial,
      shape: spec.die.shape,
      linearDamping: 0.18,
      angularDamping: 0.18,
    });
    const columns = Math.max(1, Math.min(specs.length, Math.floor((BOUND * 2 - 1) / 2.4)));
    const column = index % columns;
    const row = Math.floor(index / columns);
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.25;
    body.sleepTimeLimit = 0.08;
    body.position.set(
      (column - (columns - 1) / 2) * 2.4 + randomBetween(-0.3, 0.3),
      3.4 + row * 2.8,
      BOUND - 1.1 - randomBetween(0, 0.4),
    );
    body.quaternion.setFromEuler(
      randomBetween(0, Math.PI * 2),
      randomBetween(0, Math.PI * 2),
      randomBetween(0, Math.PI * 2),
    );
    body.velocity.set(randomBetween(-3.5, 3.5), randomBetween(1, 4), -randomBetween(5, 10));
    body.angularVelocity.set(
      randomBetween(-24, 24),
      randomBetween(-24, 24),
      randomBetween(-24, 24),
    );
    world.addBody(body);
    return body;
  });
}

function simulationResult(specs: RollSpec[], frames: Frame[][]): Simulation {
  const last = frames[frames.length - 1] ?? [];
  const flat = specs.every((spec, index) => {
    const q = new THREE.Quaternion(...last[index].q);
    return topIndex(spec.die, q).dot > 0.985;
  });
  return { frames, flat };
}

function bodyFrame(body: CANNON.Body): Frame {
  return {
    p: [body.position.x, body.position.y, body.position.z],
    q: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
  };
}

/**
 * Browser version of the pre-sim. Cannon steps are yielded in short slices so
 * a twelve-die roll never monopolizes the main thread while React and input
 * remain responsive. The physics world and the recorded result are unchanged.
 */
function simulateOnceAsync(specs: RollSpec[], observeSlice?: SliceObserver): Promise<Simulation> {
  const { world, dieMaterial } = makeSimWorld();
  const bodies = makeBodies(specs, world, dieMaterial);
  const frames: Frame[][] = [];
  let step = 0;
  let still = 0;

  return new Promise((resolve) => {
    const runSlice = () => {
      const started = performance.now();
      while (step < MAX_STEPS && performance.now() - started < 6) {
        world.step(STEP);
        frames.push(bodies.map(bodyFrame));
        const calm = bodies.every(
          (body) =>
            body.sleepState === CANNON.Body.SLEEPING ||
            (body.velocity.length() < 0.15 && body.angularVelocity.length() < 0.15),
        );
        still = calm ? still + 1 : 0;
        step += 1;
        if (step > 20 && still > 4) break;
      }
      observeSlice?.(performance.now() - started);
      if (step >= MAX_STEPS || (step > 20 && still > 4)) {
        resolve(simulationResult(specs, frames));
      } else {
        window.setTimeout(runSlice, 0);
      }
    };
    runSlice();
  });
}

export async function simulateTrayAsync(
  specs: RollSpec[],
  observeSlice?: SliceObserver,
): Promise<Simulation> {
  let simulation = await simulateOnceAsync(specs, observeSlice);
  for (let attempt = 1; attempt < MAX_FLAT_ATTEMPTS && !simulation.flat; attempt += 1) {
    simulation = await simulateOnceAsync(specs, observeSlice);
  }
  return simulation;
}

function expandRolls(result: DiceRollResult): RollSpec[] {
  return result.rolls.flatMap((roll, itemIndex) => {
    if (roll.dice === 100) {
      const percentile = roll.value === 100 ? 0 : roll.value % 100;
      return [
        {
          die: makeDie('d10', DIE_R, true),
          target: Math.floor(percentile / 10) * 10,
          itemIndex,
          useInTotal: roll.useInTotal !== false,
        },
        {
          die: makeDie('d10', DIE_R, false),
          target: percentile % 10,
          itemIndex,
          useInTotal: roll.useInTotal !== false,
        },
      ];
    }
    const type = SIDES_TO_TYPE[roll.dice];
    if (!type) return [];
    return [
      {
        die: makeDie(type, DIE_R),
        target: type === 'd10' && roll.value === 10 ? 0 : roll.value,
        itemIndex,
        useInTotal: roll.useInTotal !== false,
      },
    ];
  });
}

function placeTrack(track: Track, frame: Frame, next: Frame, fraction: number) {
  track.die.mesh.position.set(
    frame.p[0] + (next.p[0] - frame.p[0]) * fraction,
    frame.p[1] + (next.p[1] - frame.p[1]) * fraction,
    frame.p[2] + (next.p[2] - frame.p[2]) * fraction,
  );
  const qa = new THREE.Quaternion(...frame.q);
  const qb = new THREE.Quaternion(...next.q);
  qa.slerp(qb, fraction).multiply(track.rotation);
  track.die.mesh.quaternion.copy(qa);
}

export function settleTrack(
  track: Pick<Track, 'die' | 'frames' | 'rotation' | 't' | 'done'>,
): void {
  const last = track.frames[track.frames.length - 1];
  placeTrack(track as Track, last, last, 0);
  track.done = true;
}

export const PhysicsDiceBox: React.FC<Props> = ({
  result,
  isRolling: _isRolling,
  showAnimation,
  height = 220,
  simulate,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const tracksRef = useRef<Track[]>([]);
  const rafRef = useRef<number>(0);
  const lastResult = useRef<DiceRollResult | null>(null);
  const pendingResult = useRef<DiceRollResult | null>(null);
  const soundRef = useRef<Howl | null>(null);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [muted, setMuted] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const [physicsFallback, setPhysicsFallback] = useState('');
  const reducedMotionRef = useRef(reducedMotion);
  const mutedRef = useRef(muted);
  reducedMotionRef.current = reducedMotion;
  mutedRef.current = muted;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      logger.warn('[dice] WebGL unavailable, using text result', error);
      setWebglAvailable(false);
      return;
    }
    const width = mount.clientWidth || 320;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 8.5, 5.5);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0x46506b, 0.95));
    const key = new THREE.DirectionalLight(0xf3deb0, 1.6);
    key.position.set(-4, 10, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x5fa1dd, 0.45);
    rim.position.set(6, 5, -5);
    scene.add(rim);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x0c1426, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    soundRef.current = new Howl({
      src: ['/sounds/dice-roll.mp3', '/sounds/dice-roll.ogg'],
      volume: 0.45,
    });

    const onResize = () => {
      const nextWidth = mount.clientWidth || 320;
      renderer.setSize(nextWidth, height);
      camera.aspect = nextWidth / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    let previousTime: number | null = null;
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (previousTime === null) previousTime = now;
      const dt = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      tracksRef.current.forEach((track) => {
        if (track.done) return;
        track.t += dt / STEP;
        const index = Math.min(Math.floor(track.t), track.frames.length - 1);
        const frame = track.frames[index];
        const next = track.frames[Math.min(index + 1, track.frames.length - 1)];
        placeTrack(track, frame, next, track.t - index);
        if (index >= track.frames.length - 1) track.done = true;
      });
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      disposeTracks(tracksRef.current, scene);
      sceneRef.current = null;
      lastResult.current = null;
      pendingResult.current = null;
      renderer.dispose();
      if (renderer.domElement.parentNode)
        renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [height, showAnimation]);

  useEffect(() => {
    if (!reducedMotion || tracksRef.current.length === 0) return;
    tracksRef.current.forEach(settleTrack);
  }, [reducedMotion]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!result || !showAnimation || !scene) return;
    if (result === lastResult.current) return;
    if (result === pendingResult.current) return;
    const specs = expandRolls(result);
    setAnnouncement(
      `Dice result ${result.total}: ${result.rolls.map((roll) => roll.value).join(', ')}`,
    );
    setPhysicsFallback('');
    if (specs.length === 0) return;
    pendingResult.current = result;

    disposeTracks(tracksRef.current, scene);
    tracksRef.current = [];
    let cancelled = false;
    let watcher: number | undefined;

    void (simulate ?? simulateTrayAsync)(specs).then((simulation) => {
      if (cancelled) return;
      pendingResult.current = null;
      lastResult.current = result;
      if (!simulation.flat) {
        setPhysicsFallback(
          `Physics preview unavailable; the rules-engine result is ${result.total}.`,
        );
        return;
      }
      const finalFrames = simulation.frames[simulation.frames.length - 1] ?? [];
      const tracks = specs.map((spec, index) => {
        const physicsQuaternion = new THREE.Quaternion(...finalFrames[index].q);
        const observedIndex = topIndex(spec.die, physicsQuaternion).idx;
        const targetIndex = spec.die.faceIndexForValue(spec.target);
        const rotation = symmetry(spec.die, targetIndex, observedIndex);
        scene.add(spec.die.mesh);
        return {
          die: spec.die,
          frames: simulation.frames.map((frame) => frame[index]),
          rotation,
          itemIndex: spec.itemIndex,
          useInTotal: spec.useInTotal,
          t: 0,
          done: false,
        };
      });
      tracksRef.current = tracks;

      const finish = () => {
        tracks.forEach((track) => {
          if (track.useInTotal) return;
          track.die.mesh.traverse((object) => {
            const mesh = object as THREE.Mesh;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => {
              material.transparent = true;
              material.opacity = 0.38;
              material.needsUpdate = true;
            });
          });
        });
      };
      if (reducedMotionRef.current) {
        tracks.forEach(settleTrack);
        finish();
        return;
      }
      if (!mutedRef.current) {
        try {
          soundRef.current?.play();
        } catch {
          // Sound is optional and must never block the result.
        }
      }
      watcher = window.setInterval(() => {
        if (tracks.every((track) => track.done)) {
          if (watcher !== undefined) window.clearInterval(watcher);
          finish();
        }
      }, 50);
    });

    return () => {
      cancelled = true;
      if (pendingResult.current === result) pendingResult.current = null;
      if (watcher !== undefined) window.clearInterval(watcher);
    };
  }, [height, result, showAnimation, simulate]);

  if (!showAnimation) return null;
  return (
    <div ref={mountRef} style={{ width: '100%', height, position: 'relative' }}>
      {webglAvailable && (
        <button
          type="button"
          onClick={() => setMuted((value) => !value)}
          aria-label={muted ? 'Unmute dice sounds' : 'Mute dice sounds'}
          style={{ position: 'absolute', right: 8, top: 8, minWidth: 44, minHeight: 44, zIndex: 2 }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      )}
      {!webglAvailable && result && (
        <p role="status" className="p-4 text-sm text-gray-300">
          This browser cannot draw 3D here. The rules-engine result is {result.total}.
        </p>
      )}
      {physicsFallback && (
        <p role="status" className="p-4 text-sm text-gray-300">
          {physicsFallback}
        </p>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
};

function disposeTracks(tracks: Track[], scene: THREE.Scene) {
  tracks.forEach((track) => {
    scene.remove(track.die.mesh);
    track.die.mesh.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else if (material) disposeMaterial(material);
    });
  });
}

function disposeMaterial(material: THREE.Material) {
  const withMap = material as THREE.Material & { map?: THREE.Texture };
  withMap.map?.dispose();
  material.dispose();
}

export { expandRolls };
export default PhysicsDiceBox;
