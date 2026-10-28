/**
 * diceShapes — builds three.js meshes + cannon-es convex bodies for every die
 * type, with numbered faces and a face→value map. Used by PhysicsDiceBox.
 *
 * Approach (uniform for all polyhedral dice):
 *  - Use a three geometry (built-ins for d4/d6/d8/d12/d20; generated for d10).
 *  - Group the geometry's triangles into real faces by shared normal
 *    (so a d12 yields 12 pentagon faces, not 36 triangles).
 *  - Drop a gold number plane on each face; record {normal, value} so we can
 *    read whichever face ends up on top after a physics roll.
 *  - Build a cannon-es ConvexPolyhedron from the deduped vertices for physics.
 */
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

// The prototype's default Brass theme (#93): warm metal dice with dark ink.
const BRASS_FACE = 0xcfa862;
const BRASS_INK = '#2a1a0c';
const FACE_BG = '#11203a';

function numberTexture(label: string, withBg: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  if (!x) return new THREE.CanvasTexture(c);
  if (withBg) {
    x.fillStyle = FACE_BG;
    x.fillRect(0, 0, 128, 128);
  }
  x.fillStyle = BRASS_INK;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,.5)';
  x.shadowBlur = 4;
  x.font = `bold ${label.length > 1 ? 62 : 78}px Cinzel, serif`;
  x.fillText(label, 64, 70);
  if (label === '6' || label === '9') {
    x.font = 'bold 26px Cinzel, serif';
    x.fillText('.', 64, 104);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Pentagonal-trapezohedron geometry for a d10 (10 kite faces). */
function makeD10Geometry(radius = 1): THREE.BufferGeometry {
  const sides = 10;
  const verts: number[] = [];
  // two apexes
  verts.push(0, 0, 1, 0, 0, -1);
  // 10 equatorial vertices, alternating slightly up / down
  for (let i = 0; i < sides; i++) {
    const b = (i * Math.PI * 2) / sides;
    verts.push(Math.cos(b), Math.sin(b), 0.105 * (i % 2 ? 1 : -1));
  }
  const faces: number[][] = [];
  // top + bottom kite fans
  for (let i = 0; i < sides; i++) {
    const a = 2 + i;
    const bnext = 2 + ((i + 1) % sides);
    if (i % 2 === 0) faces.push([0, a, bnext]);
    else faces.push([1, bnext, a]);
  }
  const pos: number[] = [];
  faces.forEach((f) => {
    for (const idx of f) {
      pos.push(verts[idx * 3] * radius, verts[idx * 3 + 1] * radius, verts[idx * 3 + 2] * radius);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function baseGeometry(type: DieType, r: number): THREE.BufferGeometry {
  switch (type) {
    case 'd4':
      return new THREE.TetrahedronGeometry(r * 1.2);
    case 'd6':
      return new THREE.BoxGeometry(r * 1.15, r * 1.15, r * 1.15);
    case 'd8':
      return new THREE.OctahedronGeometry(r * 1.1);
    case 'd10':
    case 'd100':
      return makeD10Geometry(r * 1.05);
    case 'd12':
      return new THREE.DodecahedronGeometry(r);
    case 'd20':
    default:
      return new THREE.IcosahedronGeometry(r);
  }
}

interface FaceInfo {
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
}

/** Group a (non-indexed) geometry's triangles into faces by shared normal. */
function groupFaces(geo: THREE.BufferGeometry): FaceInfo[] {
  const source = geo.index ? geo.toNonIndexed() : geo;
  const pos = source.attributes.position;
  const tris: { n: THREE.Vector3; c: THREE.Vector3 }[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i);
    const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    const cen = new THREE.Vector3()
      .add(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    tris.push({ n, c: cen });
  }
  const groups: { n: THREE.Vector3; cs: THREE.Vector3[] }[] = [];
  tris.forEach((t) => {
    const g = groups.find((gr) => gr.n.dot(t.n) > 0.97);
    if (g) gr_push(g, t);
    else groups.push({ n: t.n.clone(), cs: [t.c.clone()] });
  });
  function gr_push(
    g: { n: THREE.Vector3; cs: THREE.Vector3[] },
    t: { n: THREE.Vector3; c: THREE.Vector3 },
  ) {
    g.cs.push(t.c.clone());
  }
  return groups.map((g) => {
    const centroid = g.cs
      .reduce((acc, v) => acc.add(v), new THREE.Vector3())
      .multiplyScalar(1 / g.cs.length);
    return { normal: g.n.clone().normalize(), centroid };
  });
}

/** Build a cannon-es convex polyhedron from a three geometry (deduped verts). */
function toConvex(geo: THREE.BufferGeometry): CANNON.ConvexPolyhedron {
  const pos = geo.attributes.position;
  const verts: CANNON.Vec3[] = [];
  const map = new Map<string, number>();
  const idx: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const k = v
      .toArray()
      .map((x) => x.toFixed(3))
      .join(',');
    if (!map.has(k)) {
      map.set(k, verts.length);
      verts.push(new CANNON.Vec3(v.x, v.y, v.z));
    }
    idx.push(map.get(k)!);
  }
  const faces: number[][] = [];
  for (let i = 0; i < idx.length; i += 3) faces.push([idx[i], idx[i + 1], idx[i + 2]]);
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}

const SIDES: Record<DieType, number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 10 };

export interface Die {
  type: DieType;
  tens: boolean;
  mesh: THREE.Mesh;
  shape: CANNON.ConvexPolyhedron;
  /** center height when resting flat on a face (≈ inradius) */
  rest: number;
  faces: { normal: THREE.Vector3; value: number }[];
  /** Unit directions used by the symmetry mapper and result reader. */
  directions: THREE.Vector3[];
  /** result face given an orientation quaternion */
  readResult: (q: THREE.Quaternion) => number;
  /** Convert an engine value into the corresponding numbered face. */
  faceIndexForValue: (value: number) => number;
}

export interface TopFace {
  idx: number;
  dot: number;
}

/** Read the face direction nearest the table normal after a physics frame. */
export function topIndex(die: Pick<Die, 'type' | 'directions'>, q: THREE.Quaternion): TopFace {
  const sign = die.type === 'd4' ? -1 : 1;
  let best = -Infinity;
  let idx = 0;
  die.directions.forEach((direction, i) => {
    const transformed = direction.clone().applyQuaternion(q);
    const dot = transformed.y * sign;
    if (dot > best) {
      best = dot;
      idx = i;
    }
  });
  return { idx, dot: best };
}

function frameMatrix(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const first = a.clone().normalize();
  const second = b.clone().addScaledVector(first, -first.dot(b)).normalize();
  const third = new THREE.Vector3().crossVectors(first, second);
  return new THREE.Matrix4().makeBasis(first, second, third);
}

/**
 * Return a rotation of the solid that carries face `from` to face `to`.
 * It is deliberately validated against every direction: an arbitrary
 * shortest-arc rotation would carry the selected face but change the die.
 */
export function symmetry(die: Pick<Die, 'directions'>, from: number, to: number): THREE.Quaternion {
  if (from === to) return new THREE.Quaternion();
  const directions = die.directions;
  const source = directions[from];
  const destination = directions[to];
  let neighbor: THREE.Vector3 | null = null;
  let best = -Infinity;
  directions.forEach((candidate, i) => {
    if (i === from) return;
    const score = candidate.dot(source);
    if (score < 0.999 && score > best) {
      best = score;
      neighbor = candidate;
    }
  });
  if (!neighbor) {
    throw new Error(`No solid symmetry neighbor for face ${from}`);
  }

  const sourceFrame = frameMatrix(source, neighbor).transpose();
  const targetSpacing = source.dot(neighbor);
  for (const candidate of directions) {
    if (Math.abs(destination.dot(candidate) - targetSpacing) > 1e-4) continue;
    const rotation = frameMatrix(destination, candidate).multiply(sourceFrame);
    const preservesSolid = directions.every((direction) => {
      const mapped = direction.clone().applyMatrix4(rotation);
      return directions.some((other) => other.dot(mapped) > 0.9999);
    });
    if (preservesSolid) return new THREE.Quaternion().setFromRotationMatrix(rotation);
  }
  throw new Error(`No solid symmetry maps face ${from} to ${to}`);
}

/**
 * Build a die. `r` is the circumradius (visual size, world units).
 * For d10/d100 the printed label can be 0-9 (units) or 00-90 (tens).
 */
export function makeDie(type: DieType, r = 1, tens = false): Die {
  const geo = baseGeometry(type, r);
  const faceInfos = groupFaces(geo);
  const sides = SIDES[type];

  // material with a subtle navy body
  const bodyMat = new THREE.MeshStandardMaterial({
    color: BRASS_FACE,
    roughness: 0.34,
    metalness: 0.82,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, bodyMat);
  mesh.castShadow = true;

  const faces: { normal: THREE.Vector3; value: number }[] = [];
  faceInfos.slice(0, sides).forEach((f, i) => {
    // value/label per face
    let value = i + 1;
    let label = String(value);
    if (type === 'd10') {
      value = tens ? i * 10 : i; // 00,10,...,90 or 0-9
      label = tens ? (i === 0 ? '00' : String(i * 10)) : String(i);
    } else if (type === 'd100') {
      value = i * 10; // 00,10,...,90
      label = (i * 10).toString().padStart(2, '0');
    }
    faces.push({ normal: f.normal.clone(), value });

    const planeSize = r * (type === 'd6' ? 0.9 : type === 'd12' ? 0.78 : 0.85);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeSize, planeSize),
      new THREE.MeshBasicMaterial({ map: numberTexture(label, false), transparent: true }),
    );
    plane.position.copy(f.centroid.clone().multiplyScalar(1.02));
    plane.lookAt(f.centroid.clone().multiplyScalar(2));
    mesh.add(plane);
  });

  const rest = faceInfos.slice(0, sides).reduce((s, f) => s + f.centroid.dot(f.normal), 0) / sides;

  const directions = faces.map((face) => face.normal.clone().normalize());

  return {
    type,
    tens,
    mesh,
    shape: toConvex(geo),
    rest: Math.max(0.4, Math.abs(rest)),
    faces,
    directions,
    readResult(q: THREE.Quaternion) {
      return faces[topIndex({ type, directions }, q).idx]?.value ?? 1;
    },
    faceIndexForValue(value: number) {
      const normalized = type === 'd10' && !tens && value === 10 ? 0 : value;
      const index = faces.findIndex((face) => face.value === normalized);
      if (index < 0) {
        throw new Error(`No ${type}${tens ? ' tens' : ''} face for value ${value}`);
      }
      return index;
    },
  };
}

export { SIDES };
