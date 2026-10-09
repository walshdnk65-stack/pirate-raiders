import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ColorFn = (centroid: THREE.Vector3, normal: THREE.Vector3) => THREE.ColorRepresentation;
export type ColorArg = THREE.ColorRepresentation | ColorFn;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Compose a transform matrix: position, euler rotation (XYZ), scale. */
export function T(
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_v, _q, _s);
}

export interface AddOpts {
  flat?: boolean;
  bone?: number;
}

/**
 * Accumulates many small geometries (with per-vertex colours) and merges them into
 * one buffer — so a whole ship/island/character renders in a single draw call.
 */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  readonly skinned: boolean;
  constructor(skinned = false) {
    this.skinned = skinned;
  }

  add(geo: THREE.BufferGeometry, color: ColorArg, matrix?: THREE.Matrix4, opts: AddOpts = {}) {
    // colours are evaluated in the part's LOCAL space, then the part is transformed
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (opts.flat || !g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const n = pos.count;
    const cols = new Float32Array(n * 3);
    const c = new THREE.Color();
    if (typeof color === 'function') {
      const cen = new THREE.Vector3();
      const nn = new THREE.Vector3();
      for (let i = 0; i < n; i += 3) {
        cen.set(
          (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
          (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
          (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3,
        );
        nn.set(nor.getX(i), nor.getY(i), nor.getZ(i));
        c.set(color(cen, nn));
        for (let k = 0; k < 3; k++) {
          cols[(i + k) * 3] = c.r;
          cols[(i + k) * 3 + 1] = c.g;
          cols[(i + k) * 3 + 2] = c.b;
        }
      }
    } else {
      c.set(color);
      for (let i = 0; i < n; i++) {
        cols[i * 3] = c.r;
        cols[i * 3 + 1] = c.g;
        cols[i * 3 + 2] = c.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (matrix) g.applyMatrix4(matrix);
    if (this.skinned) {
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      const b = opts.bone ?? 0;
      for (let i = 0; i < n; i++) {
        si[i * 4] = b;
        sw[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    }
    this.parts.push(g);
    return this;
  }

  /** Add an already-built (non-indexed, coloured) geometry, e.g. a cached prop variant. */
  addBuilt(geo: THREE.BufferGeometry, matrix: THREE.Matrix4) {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    this.parts.push(g);
    return this;
  }

  get empty() {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
      return g;
    }
    const merged = mergeGeometries(this.parts, false)!;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged;
  }

  mesh(material: THREE.Material, shadows = true) {
    const m = new THREE.Mesh(this.build(), material);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    return m;
  }
}

// ---------------- Shape helpers ----------------

/** Re-weld vertices and recompute smooth normals (removes UV seams). */
export function smoothNormals(g: THREE.BufferGeometry) {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

/** Super-ellipsoid: a "rounded box" sphere – the chunky cartoon primitive. */
export function roundBox(rx: number, ry: number, rz: number, power = 3, ws = 20, hs = 14) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position as THREE.BufferAttribute;
  const e = 2 / power;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    p.setXYZ(
      i,
      Math.sign(x) * Math.pow(Math.abs(x), e) * rx,
      Math.sign(y) * Math.pow(Math.abs(y), e) * ry,
      Math.sign(z) * Math.pow(Math.abs(z), e) * rz,
    );
  }
  return smoothNormals(g);
}

export function ellipsoid(rx: number, ry: number, rz: number, ws = 18, hs = 12) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return smoothNormals(g);
}

/** Generic vertex deform then smooth normals. */
export function deform(g: THREE.BufferGeometry, fn: (v: THREE.Vector3) => void, smooth = true) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    fn(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  if (smooth) return smoothNormals(g);
  g.computeVertexNormals();
  return g;
}

export function cyl(rt: number, rb: number, h: number, seg = 10, open = false) {
  return new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
}

/** Cylinder spanning two points. */
export function beam(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 5) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Thin box spanning two points (planks/ropes with square section). */
export function plankBetween(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

export function lathe(profile: [number, number][], seg = 14) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

/** Flat-shaded "low-poly rock" (displaced icosahedron). */
export function rockGeo(r: number, seed = Math.random() * 1000, detail = 1, squash = 0.8) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const offs = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = key(v.x, v.y, v.z);
    let o = offs.get(k);
    if (o === undefined) {
      o = 0.78 + 0.4 * Math.abs(Math.sin(seed + v.x * 3.1 + v.y * 5.7 + v.z * 2.3));
      offs.set(k, o);
    }
    v.multiplyScalar(o);
    v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
