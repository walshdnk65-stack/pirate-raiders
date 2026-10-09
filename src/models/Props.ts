import * as THREE from 'three';
import { GeoBuilder, T, cyl, ellipsoid, lathe, rockGeo, roundBox, beam, ColorArg } from '../render/GeoBuilder';
import { mulberry32 } from '../core/math';

export const PAL = {
  wood: '#8a5a33',
  woodDark: '#5a3820',
  woodLight: '#b9834f',
  woodRed: '#9b3b2c',
  plank: '#c18f5a',
  rope: '#cfae76',
  iron: '#3b414b',
  ironDark: '#25292f',
  gold: '#f4c24c',
  brass: '#d9a441',
  sand: '#f5d896',
  wetSand: '#e2bf7a',
  grass: '#79c95a',
  grassDark: '#5cae46',
  grassLight: '#98da6c',
  rock: '#9c9088',
  rockDark: '#7c7068',
  leaf: '#3faa4a',
  leafLight: '#5ec45a',
  leafDark: '#2f8a3e',
  trunk: '#94653a',
  trunkDark: '#7a5030',
  white: '#f7f3ea',
  cream: '#efe2c4',
  red: '#d9443a',
  blue: '#3f7fd0',
  canvas: '#f3ead6',
};

/** Builder with a base transform, so props can be placed then composed. */
export class Placer {
  constructor(
    public gb: GeoBuilder,
    public base: THREE.Matrix4 = new THREE.Matrix4(),
  ) {}
  add(geo: THREE.BufferGeometry, color: ColorArg, local?: THREE.Matrix4, flat = false) {
    const m = local ? this.base.clone().multiply(local) : this.base;
    this.gb.add(geo, color, m, { flat });
    return this;
  }
  child(local: THREE.Matrix4) {
    return new Placer(this.gb, this.base.clone().multiply(local));
  }
}

// ---------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------

/** A drooping palm frond in local space, pointing along +X. */
function frondGeo(len: number, width: number, droop: number) {
  const S = 7;
  const pos: number[] = [];
  const pts: THREE.Vector3[][] = [];
  for (let i = 0; i <= S; i++) {
    const t = i / S;
    const x = t * len;
    const y = Math.sin(t * Math.PI * 0.55) * len * 0.22 - t * t * len * droop;
    const w = Math.pow(Math.sin(Math.PI * Math.min(t * 1.08, 1)), 0.7) * width;
    pts.push([new THREE.Vector3(x, y - w * 0.25, -w), new THREE.Vector3(x, y + w * 0.12, 0), new THREE.Vector3(x, y - w * 0.25, w)]);
  }
  for (let i = 0; i < S; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    for (let k = 0; k < 2; k++) {
      pos.push(...a[k].toArray(), ...b[k].toArray(), ...a[k + 1].toArray());
      pos.push(...a[k + 1].toArray(), ...b[k].toArray(), ...b[k + 1].toArray());
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function palmTree(trunk: Placer, leaves: Placer, height: number, seed: number) {
  const rng = mulberry32(seed);
  const segs = 7;
  const bendDir = rng() * Math.PI * 2;
  const bend = 0.12 + rng() * 0.25;
  let p = new THREE.Vector3(0, -0.5, 0);
  let r = 0.42 * (height / 9);
  for (let i = 0; i < segs; i++) {
    const t = (i + 1) / segs;
    const off = bend * t * t * height;
    const np = new THREE.Vector3(Math.cos(bendDir) * off, (height * (i + 1)) / segs, Math.sin(bendDir) * off);
    const g = beam(p, np, r, 7);
    // fat ring at the base of each segment
    trunk.add(g, i % 2 ? PAL.trunk : PAL.trunkDark, undefined, true);
    const ring = cyl(r * 1.18, r * 1.05, 0.25, 7);
    const dir = np.clone().sub(p).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    trunk.add(ring, PAL.trunkDark, new THREE.Matrix4().compose(p.clone().addScaledVector(dir, 0.15), q, new THREE.Vector3(1, 1, 1)), true);
    p = np;
    r *= 0.93;
  }
  const top = p;
  // coconuts
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng();
    trunk.add(ellipsoid(0.32, 0.36, 0.32, 8, 6), '#6b4423', T(top.x + Math.cos(a) * 0.35, top.y - 0.35, top.z + Math.sin(a) * 0.35));
  }
  // fronds
  const n = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.4;
    const len = height * (0.42 + rng() * 0.12);
    const g = frondGeo(len, len * 0.16, 0.42 + rng() * 0.2);
    const tilt = 0.1 + rng() * 0.35;
    const col = rng() < 0.5 ? PAL.leaf : rng() < 0.5 ? PAL.leafLight : PAL.leafDark;
    leaves.add(g, (c) => (Math.floor(c.length() * 1.5) % 2 ? col : new THREE.Color(col).multiplyScalar(0.86)), T(top.x, top.y + 0.1, top.z, 0, a, tilt));
  }
}

/** Puffy cartoon jungle tree. */
export function jungleTree(trunk: Placer, leaves: Placer, height: number, seed: number) {
  const rng = mulberry32(seed);
  trunk.add(cyl(0.35, 0.55, height, 7), PAL.trunkDark, T(0, height / 2 - 0.5, 0), true);
  const blobs = 4 + Math.floor(rng() * 3);
  const base = height * 0.95;
  const cols = [PAL.leaf, PAL.leafDark, PAL.grassDark, '#4cb850'];
  for (let i = 0; i < blobs; i++) {
    const a = rng() * Math.PI * 2;
    const d = i === 0 ? 0 : 1.2 + rng() * 1.2;
    const r = (i === 0 ? 2.6 : 1.6 + rng() * 1.0) * (height / 7);
    leaves.add(
      new THREE.IcosahedronGeometry(r, 1),
      cols[Math.floor(rng() * cols.length)],
      T(Math.cos(a) * d, base + rng() * 1.5 - (i === 0 ? -0.6 : 0.3), Math.sin(a) * d, rng(), rng(), 0, 1, 0.85, 1),
      true,
    );
  }
}

export function bush(pl: Placer, size: number, seed: number) {
  const rng = mulberry32(seed);
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = size * (0.5 + rng() * 0.5);
    pl.add(new THREE.IcosahedronGeometry(r, 1), rng() < 0.5 ? PAL.grassDark : PAL.leaf, T(Math.cos(a) * size * 0.6, r * 0.5, Math.sin(a) * size * 0.6, 0, 0, 0, 1, 0.75, 1), true);
  }
  if (rng() < 0.5) {
    // little flowers
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2;
      pl.add(new THREE.IcosahedronGeometry(size * 0.16, 0), rng() < 0.5 ? '#ff6f91' : '#ffd34d', T(Math.cos(a) * size * 0.7, size * 0.75, Math.sin(a) * size * 0.7), true);
    }
  }
}

export function rockPile(pl: Placer, size: number, seed: number) {
  const rng = mulberry32(seed);
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const r = size * (i === 0 ? 1 : 0.4 + rng() * 0.4);
    pl.add(rockGeo(r, seed + i * 13, 0, 0.75), rng() < 0.5 ? PAL.rock : PAL.rockDark, T(i === 0 ? 0 : (rng() - 0.5) * size * 2, r * 0.3, i === 0 ? 0 : (rng() - 0.5) * size * 2, rng(), rng() * 6, 0), true);
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export function barrel(pl: Placer, s = 1) {
  const g = lathe(
    [
      [0, 0],
      [0.42, 0],
      [0.5, 0.25],
      [0.54, 0.55],
      [0.5, 0.85],
      [0.42, 1.1],
      [0, 1.1],
    ].map(([r, y]) => [r * s, y * s] as [number, number]),
    12,
  );
  pl.add(g, (c) => {
    const y = c.y;
    const yy = y / s;
    return Math.abs(yy - 0.18) < 0.06 || Math.abs(yy - 0.92) < 0.06 ? PAL.iron : Math.abs(yy - 0.55) < 0.05 ? PAL.iron : PAL.woodLight;
  });
}

/** Barrel built in its own local frame (placer base should hold position). */
export function barrelAt(pl: Placer, x: number, y: number, z: number, s = 1, lying = false) {
  const c = pl.child(T(x, y, z, lying ? Math.PI / 2 : 0, 0, 0));
  barrel(c, s);
}

export function crate(pl: Placer, x: number, y: number, z: number, s = 1, ry = 0, color = PAL.woodLight) {
  const c = pl.child(T(x, y + s / 2, z, 0, ry, 0, s));
  c.add(new THREE.BoxGeometry(1, 1, 1), color);
  const e = 0.12;
  const dk = PAL.woodDark;
  // frame edges
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) c.add(new THREE.BoxGeometry(e, 1.02, e), dk, T(sx * 0.47, 0, sz * 0.47));
  for (const sy of [-1, 1]) {
    c.add(new THREE.BoxGeometry(1.02, e, e), dk, T(0, sy * 0.47, 0.47));
    c.add(new THREE.BoxGeometry(1.02, e, e), dk, T(0, sy * 0.47, -0.47));
    c.add(new THREE.BoxGeometry(e, e, 1.02), dk, T(0.47, sy * 0.47, 0));
    c.add(new THREE.BoxGeometry(e, e, 1.02), dk, T(-0.47, sy * 0.47, 0));
  }
  // diagonal brace
  c.add(new THREE.BoxGeometry(0.1, 1.25, 0.04), dk, T(0, 0, 0.5, 0, 0, Math.PI / 4));
}

export function sack(pl: Placer, x: number, y: number, z: number, s = 1) {
  pl.add(roundBox(0.45 * s, 0.35 * s, 0.35 * s, 2.2, 10, 8), '#d8c08a', T(x, y + 0.33 * s, z));
  pl.add(cyl(0.12 * s, 0.18 * s, 0.2 * s, 6), '#c4aa72', T(x, y + 0.72 * s, z));
}

export function lanternPost(pl: Placer, glow: Placer, x: number, y: number, z: number, h = 3.2) {
  pl.add(cyl(0.12, 0.16, h, 6), PAL.woodDark, T(x, y + h / 2, z));
  pl.add(new THREE.BoxGeometry(0.9, 0.12, 0.12), PAL.woodDark, T(x + 0.35, y + h - 0.1, z));
  lantern(pl, glow, x + 0.7, y + h - 0.65, z);
}

export function lantern(pl: Placer, glow: Placer, x: number, y: number, z: number, s = 1) {
  pl.add(cyl(0.18 * s, 0.25 * s, 0.12 * s, 6), PAL.ironDark, T(x, y + 0.32 * s, z));
  pl.add(cyl(0.22 * s, 0.22 * s, 0.08 * s, 6), PAL.ironDark, T(x, y - 0.25 * s, z));
  glow.add(cyl(0.17 * s, 0.17 * s, 0.45 * s, 6), '#ffffff', T(x, y + 0.02 * s, z));
  pl.add(new THREE.TorusGeometry(0.1 * s, 0.03 * s, 4, 8), PAL.ironDark, T(x, y + 0.48 * s, z));
}

export function flagPole(pl: Placer, x: number, y: number, z: number, h: number) {
  pl.add(cyl(0.1, 0.16, h, 6), PAL.woodDark, T(x, y + h / 2, z));
  pl.add(new THREE.SphereGeometry(0.22, 8, 6), PAL.gold, T(x, y + h + 0.1, z));
}

export function treasureChest(pl: Placer, x: number, y: number, z: number, ry = 0, open = false) {
  const c = pl.child(T(x, y, z, 0, ry, 0));
  c.add(roundBox(0.9, 0.42, 0.6, 5), '#8b4f24', T(0, 0.42, 0));
  c.add(roundBox(0.92, 0.3, 0.62, 3), '#a35f2c', open ? T(0, 0.95, -0.5, -1.2, 0, 0) : T(0, 0.86, 0, 0, 0, 0, 1, 1, 1));
  for (const sx of [-0.55, 0, 0.55]) c.add(new THREE.BoxGeometry(0.12, 1.25, 1.28), PAL.gold, T(sx, 0.6, 0));
  c.add(new THREE.BoxGeometry(0.28, 0.3, 0.1), PAL.gold, T(0, 0.6, 0.64));
  if (open) {
    for (let i = 0; i < 9; i++) c.add(cyl(0.16, 0.16, 0.05, 10), PAL.gold, T((i % 3) * 0.4 - 0.4, 0.86 + (i % 2) * 0.05, Math.floor(i / 3) * 0.25 - 0.25, 0.3 * (i % 2), 0, 0.2));
  }
}

export function cannonGeo(pl: Placer, s = 1, barrelColor: string = PAL.iron, withCarriage = true) {
  const g = lathe(
    [
      [0, -0.95],
      [0.16, -0.95],
      [0.2, -0.85],
      [0.3, -0.75],
      [0.3, -0.45],
      [0.26, -0.4],
      [0.24, 0.6],
      [0.29, 0.66],
      [0.29, 0.78],
      [0.2, 0.8],
      [0.16, 0.7],
      [0.0, 0.7],
    ].map(([r, y]) => [r * s, y * s] as [number, number]),
    12,
  );
  pl.add(g, barrelColor, T(0, 0.55 * s, 0, Math.PI / 2, 0, 0));
  pl.add(new THREE.SphereGeometry(0.13 * s, 8, 6), barrelColor, T(0, 0.55 * s, -1.0 * s));
  if (withCarriage) {
    pl.add(new THREE.BoxGeometry(0.75 * s, 0.32 * s, 1.2 * s), PAL.woodRed, T(0, 0.3 * s, -0.2 * s));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) pl.add(cyl(0.17 * s, 0.17 * s, 0.1 * s, 10), PAL.woodDark, T(sx * 0.42 * s, 0.17 * s, (sz * 0.42 - 0.2) * s, 0, 0, Math.PI / 2));
  }
}

export function rope(pl: Placer, a: THREE.Vector3, b: THREE.Vector3, r = 0.04) {
  pl.add(beam(a, b, r, 4), PAL.rope);
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface HouseOpts {
  w: number;
  d: number;
  h: number;
  wall: string;
  roof: string;
  trim?: string;
  floors?: number;
  sign?: string;
  stone?: boolean;
  seed?: number;
}

/** Gable-roofed cartoon house with timber frame, door, glowing windows. */
export function house(pl: Placer, glow: Placer, o: HouseOpts) {
  const rng = mulberry32(o.seed ?? 1);
  const { w, d, h } = o;
  const trim = o.trim ?? PAL.woodDark;
  // foundation
  pl.add(new THREE.BoxGeometry(w + 0.5, 0.6, d + 0.5), o.stone ? '#8d8580' : '#7d6a58', T(0, 0.1, 0), true);
  // walls (slightly wonky)
  pl.add(roundBox(w / 2, h / 2, d / 2, 8, 12, 8), o.wall, T(0, h / 2 + 0.3, 0, 0, 0, (rng() - 0.5) * 0.03));
  // timber frame corners + band
  if (!o.stone) {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) pl.add(new THREE.BoxGeometry(0.28, h, 0.28), trim, T(sx * (w / 2), h / 2 + 0.3, sz * (d / 2)));
    pl.add(new THREE.BoxGeometry(w + 0.1, 0.22, d + 0.1), trim, T(0, h * 0.5 + 0.3, 0));
  }
  // roof: triangular prism
  const rh = Math.min(w, d) * 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.6, 0);
  shape.lineTo(w / 2 + 0.6, 0);
  shape.lineTo(0, rh);
  shape.closePath();
  const roof = new THREE.ExtrudeGeometry(shape, { depth: d + 1.0, bevelEnabled: false });
  roof.translate(0, 0, -(d + 1.0) / 2);
  pl.add(roof, (c, n) => (n.y > 0.1 ? (Math.floor((c.y + 10) * 2.2) % 2 ? o.roof : new THREE.Color(o.roof).multiplyScalar(0.85)) : o.wall), T(0, h + 0.3, 0), true);
  // chimney
  if (rng() < 0.6) pl.add(new THREE.BoxGeometry(0.7, rh + 0.8, 0.7), '#a06a52', T(w * 0.25, h + 0.3 + rh * 0.6, d * 0.2), true);
  // door
  pl.add(roundBox(0.6, 0.95, 0.12, 4), PAL.woodDark, T(0, 1.25, d / 2 + 0.05));
  pl.add(new THREE.SphereGeometry(0.07, 6, 4), PAL.gold, T(0.35, 1.2, d / 2 + 0.18));
  // windows
  const floors = o.floors ?? 1;
  for (let f = 0; f < floors; f++) {
    const y = 0.3 + (h / floors) * (f + 0.55);
    for (const sx of [-1, 1]) {
      if (f === 0 && Math.abs(sx * w * 0.3) < 0.9) continue;
      const wx = sx * w * 0.3;
      glow.add(new THREE.BoxGeometry(0.75, 0.85, 0.1), '#ffffff', T(wx, y, d / 2 + 0.04));
      pl.add(new THREE.BoxGeometry(0.95, 0.12, 0.16), trim, T(wx, y - 0.48, d / 2 + 0.08));
      pl.add(new THREE.BoxGeometry(0.1, 0.85, 0.14), trim, T(wx, y, d / 2 + 0.08));
      // shutters
      pl.add(new THREE.BoxGeometry(0.32, 0.85, 0.06), o.roof, T(wx - 0.58, y, d / 2 + 0.06));
      pl.add(new THREE.BoxGeometry(0.32, 0.85, 0.06), o.roof, T(wx + 0.58, y, d / 2 + 0.06));
    }
    // side window
    glow.add(new THREE.BoxGeometry(0.1, 0.8, 0.7), '#ffffff', T(w / 2 + 0.04, y, 0));
  }
}

export function stall(pl: Placer, w: number, color: string, seed: number) {
  const rng = mulberry32(seed);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) pl.add(cyl(0.1, 0.1, 2.8, 6), PAL.woodDark, T((sx * w) / 2, 1.4, sz * 0.9));
  // striped awning
  const aw = new THREE.BoxGeometry(w + 0.6, 0.12, 2.6, 8, 1, 1);
  pl.add(aw, (c) => (Math.floor((c.x + 20) * 1.4) % 2 ? color : PAL.white), T(0, 2.85, 0, 0.18, 0, 0));
  pl.add(new THREE.BoxGeometry(w, 0.9, 1.6), PAL.wood, T(0, 0.45, 0.1));
  // goods
  const goods = ['#ff7a3d', '#ffd23f', '#7bd05a', '#e8473c', '#a560d8'];
  for (let i = 0; i < 6; i++) pl.add(new THREE.IcosahedronGeometry(0.22, 1), goods[Math.floor(rng() * goods.length)], T(-w / 2 + 0.4 + (i / 5) * (w - 0.8), 1.05, 0.2 + (rng() - 0.5) * 0.6));
}

export function palmHut(pl: Placer, seed: number) {
  pl.add(cyl(2.0, 2.1, 2.6, 10), PAL.woodLight, T(0, 1.3, 0), true);
  pl.add(new THREE.ConeGeometry(3.2, 2.6, 10), (c) => (Math.floor((c.y + 10) * 2.5) % 2 ? '#d8b25a' : '#c49a45'), T(0, 3.8, 0), true);
  pl.add(roundBox(0.55, 0.85, 0.1, 4), PAL.woodDark, T(0, 0.95, 2.05));
}

export function seaRock(pl: Placer, r: number, h: number, seed: number) {
  const rng = mulberry32(seed);
  pl.add(rockGeo(r, seed, 1, h / r), PAL.rock, T(0, 0, 0, 0, rng() * 6, 0), true);
  pl.add(rockGeo(r * 0.6, seed + 1, 0, 1.2), PAL.rockDark, T(r * 0.5, h * 0.2, r * 0.3), true);
  // grassy tuft on top
  if (rng() < 0.5) pl.add(new THREE.IcosahedronGeometry(r * 0.35, 0), PAL.grassDark, T(0, h * 0.82, 0, 0, 0, 0, 1, 0.4, 1), true);
}
