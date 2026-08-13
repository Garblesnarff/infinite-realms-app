/**
 * PhysicsDiceBox — real 3D dice that tumble and settle on the engine's result.
 *
 * Model (Rob-approved): the DiceEngine result is authoritative (fair RNG).
 * For each die we pre-simulate random cannon-es throws until one *naturally*
 * settles on that die's value, record the per-step transforms, then play the
 * recording back. So the die comes to rest on its own (no snap, no recenter)
 * showing the correct number, and multiple dice never collide-diverge because
 * playback is decoupled from the live sim.
 *
 * Pure three.js (not r3f) for a single, self-managed canvas. Pre-sim is sync on
 * the main thread for now (fine for typical 1–4 dice); it can move to a Web
 * Worker later with no API change.
 */
import * as CANNON from 'cannon-es';
import { Howl } from 'howler';
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

import { makeDie, type DieType, type Die } from './diceShapes';

import type { DiceRollResult } from '@/services/dice/DiceEngine';

import logger from '@/lib/logger';

interface Props {
  result: DiceRollResult | null;
  isRolling: boolean;
  showAnimation: boolean;
  height?: number;
}

const SIDES_TO_TYPE: Record<number, DieType> = {
  4: 'd4',
  6: 'd6',
  8: 'd8',
  10: 'd10',
  12: 'd12',
  20: 'd20',
  100: 'd100',
};

const DIE_R = 0.95;
const BOUND = 3.4;
const STEP = 1 / 60;

function makeSimWorld(): CANNON.World {
  const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
  w.allowSleep = true;
  w.defaultContactMaterial.friction = 0.4;
  w.defaultContactMaterial.restitution = 0.3;
  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  w.addBody(floor);
  const B = BOUND + 0.3;
  const wx = new CANNON.Box(new CANNON.Vec3(0.2, 3, B + 1));
  const wz = new CANNON.Box(new CANNON.Vec3(B + 1, 3, 0.2));
  (
    [
      [-B, 0, 0, wx],
      [B, 0, 0, wx],
      [0, 0, -B, wz],
      [0, 0, B, wz],
    ] as const
  ).forEach(([x, y, z, s]) => {
    const b = new CANNON.Body({ mass: 0, shape: s });
    b.position.set(x, y, z);
    w.addBody(b);
  });
  return w;
}

const rand = (m: number) => (Math.random() * 2 - 1) * m;

interface Frame {
  p: [number, number, number];
  q: [number, number, number, number];
}

/** Pre-simulate one die until it settles on `target`; return recorded frames. */
function simulateToValue(die: Die, target: number, laneX: number): Frame[] | null {
  for (let attempt = 0; attempt < 140; attempt++) {
    const w = makeSimWorld();
    const body = new CANNON.Body({ mass: 1, shape: die.shape });
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.12;
    body.sleepTimeLimit = 0.2;
    body.position.set(laneX + rand(0.6), 5 + Math.random() * 1.2, 1.4 + rand(1));
    body.velocity.set(rand(3), 1 + rand(1), -3 - Math.random() * 2.5);
    body.angularVelocity.set(rand(13), rand(13), rand(13));
    body.quaternion.setFromEuler(rand(3.1), rand(3.1), rand(3.1));
    w.addBody(body);
    const frames: Frame[] = [];
    for (let s = 0; s < 720; s++) {
      w.step(STEP);
      frames.push({
        p: [body.position.x, body.position.y, body.position.z],
        q: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
      });
      if (s > 40 && body.velocity.length() < 0.08 && body.angularVelocity.length() < 0.08) break;
    }
    const last = frames[frames.length - 1];
    const qq = new THREE.Quaternion(last.q[0], last.q[1], last.q[2], last.q[3]);
    if (die.readResult(qq) === target) return frames;
  }
  return null;
}

interface Track {
  die: Die;
  frames: Frame[];
  t: number;
  done: boolean;
}

export const PhysicsDiceBox: React.FC<Props> = ({
  result,
  isRolling: _isRolling,
  showAnimation,
  height = 220,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const tracksRef = useRef<Track[]>([]);
  const rafRef = useRef<number>(0);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const soundRef = useRef<Howl | null>(null);
  const lastResult = useRef<DiceRollResult | null>(null);

  // ---- one-time scene setup ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      logger.warn('[dice] WebGL unavailable, skipping 3D dice', e);
      return;
    }
    const w = mount.clientWidth || 320;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(42, w / height, 0.1, 100);
    camera.position.set(0, 8.5, 5.5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

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
      const ww = mount.clientWidth || 320;
      renderer.setSize(ww, height);
      camera.aspect = ww / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min(clockRef.current.getDelta(), 0.05);
      const tracks = tracksRef.current;
      tracks.forEach((tr) => {
        if (tr.done) return;
        tr.t += dt / STEP; // advance in frame units
        const i = Math.min(Math.floor(tr.t), tr.frames.length - 1);
        const f = tr.frames[i];
        tr.die.mesh.position.set(f.p[0], f.p[1], f.p[2]);
        tr.die.mesh.quaternion.set(f.q[0], f.q[1], f.q[2], f.q[3]);
        if (i >= tr.frames.length - 1) tr.done = true;
      });
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      disposeTracks(tracksRef.current, scene);
      renderer.dispose();
      if (renderer.domElement.parentNode)
        renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [height]);

  // ---- roll when a new result arrives ----
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !result || !showAnimation) return;
    // roll once per distinct result object (a re-roll produces a new object)
    if (result === lastResult.current) return;
    lastResult.current = result;

    disposeTracks(tracksRef.current, scene);
    tracksRef.current = [];

    const playable = result.rolls.filter((r) => SIDES_TO_TYPE[r.dice]);
    const count = playable.length || 1;
    const spacing = Math.min(2.2, (BOUND * 1.6) / count);
    const tracks: Track[] = [];

    playable.forEach((roll, idx) => {
      const type = SIDES_TO_TYPE[roll.dice];
      const die = makeDie(type, DIE_R);
      const laneX = (idx - (count - 1) / 2) * spacing;
      let frames = simulateToValue(die, roll.value, laneX);
      if (!frames) frames = settledFallback(die, roll.value, laneX); // rare: no matching throw
      scene.add(die.mesh);
      tracks.push({ die, frames, t: 0, done: false });
    });

    tracksRef.current = tracks;
    if (soundRef.current) {
      try {
        soundRef.current.play();
      } catch {
        /* sound optional */
      }
    }
  }, [result, showAnimation]);

  return <div ref={mountRef} style={{ width: '100%', height }} aria-hidden />;
};

/** Rare fallback: place the die already at rest showing the value (no tumble). */
function settledFallback(die: Die, value: number, laneX: number): Frame[] {
  const f = die.faces.find((x) => x.value === value) ?? die.faces[0];
  const up = new THREE.Vector3(0, die.type === 'd4' ? -1 : 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(f.normal.clone(), up);
  return [{ p: [laneX, die.rest, 0], q: [q.x, q.y, q.z, q.w] }];
}

function disposeTracks(tracks: Track[], scene: THREE.Scene) {
  tracks.forEach((tr) => {
    scene.remove(tr.die.mesh);
    tr.die.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => disposeMat(x));
      else if (mat) disposeMat(mat);
    });
  });
}
function disposeMat(m: THREE.Material) {
  const mm = m as THREE.MeshStandardMaterial & { map?: THREE.Texture };
  if (mm.map) mm.map.dispose();
  m.dispose();
}

export default PhysicsDiceBox;
