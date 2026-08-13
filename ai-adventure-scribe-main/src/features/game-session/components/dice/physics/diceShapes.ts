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

const GOLD = '#f3deb0';
const FACE_BG = '#11203a';

function numberTexture(label: string, withBg: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  if (withBg) {
    x.fillStyle = FACE_BG;
    x.fillRect(0, 0, 128, 128);
  }
  x.fillStyle = GOLD;
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
  const pos = geo.attributes.position;
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
  mesh: THREE.Mesh;
  shape: CANNON.ConvexPolyhedron;
  /** center height when resting flat on a face (≈ inradius) */
  rest: number;
  faces: { normal: THREE.Vector3; value: number }[];
  /** result face given an orientation quaternion */
  readResult: (q: THREE.Quaternion) => number;
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
    color: 0x0f1c34,
    roughness: 0.4,
    metalness: 0.35,
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
      value = i; // 0-9
      label = String(i);
    } else if (type === 'd100') {
      value = i * 10; // 00,10,...,90
      label = (i * 10).toString().padStart(2, '0');
    }
    faces.push({ normal: f.normal.clone(), value: tens ? value * 10 : value });

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

  return {
    type,
    mesh,
    shape: toConvex(geo),
    rest: Math.max(0.4, Math.abs(rest)),
    faces,
    readResult(q: THREE.Quaternion) {
      // d4 reads the downward face (resting face); everything else reads up
      const dir = type === 'd4' ? -1 : 1;
      let best = -2;
      let val = faces[0]?.value ?? 1;
      faces.forEach((f) => {
        const d = f.normal.clone().applyQuaternion(q).y * dir;
        if (d > best) {
          best = d;
          val = f.value;
        }
      });
      return val;
    },
  };
}

export { SIDES };
