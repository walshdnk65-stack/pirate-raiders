import * as THREE from 'three';
import { fbm2, mulberry32, smoothstep, clamp } from '../core/math';

/** Half size of the playable world (units). */
export const WORLD_HALF = 1500;
/**
 * Ships are eased back once they sail this far out along x or z. The world (and its map) is a
 * square, so the edge is too – the hidden treasure isles sit out in its corners.
 */
export const WORLD_SOFT_EDGE = 1350;
/** Inside the sailable square, with an optional margin from the edge. */
export const insideWorld = (x: number, z: number, margin = 0) => Math.max(Math.abs(x), Math.abs(z)) < WORLD_SOFT_EDGE - margin;

export type IslandKind = 'pirate' | 'port' | 'jungle' | 'rocky' | 'sandy' | 'hidden' | 'volcano';

export interface Flatten {
  x: number;
  z: number;
  r: number;
  h: number;
}

export interface IslandDef {
  name: string;
  x: number;
  z: number;
  r: number;
  hill: number;
  kind: IslandKind;
  seed: number;
  flatten?: Flatten[];
  /** Fourier coefficients for the irregular coastline (computed). */
  coef?: { a: number; k: number; p: number }[];
  maxR?: number;
}

export type PortKind = 'pirate' | 'merchant' | 'fishing' | 'rich' | 'remote';

export interface PortDef {
  id: string;
  name: string;
  kind: PortKind;
  island: string;
  /** lawful ports refuse to let wanted pirates dock */
  lawful: boolean;
  blurb: string;
  /** Town frame: origin on the shore at the main pier root, plus the seaward direction. */
  ox: number;
  oz: number;
  fx: number;
  fz: number;
  /** Where ships berth (dock point) and the heading they face when docked. */
  berth: THREE.Vector3;
  berthHeading: number;
  /** Harbour exit point – start/end of merchant routes. */
  exit: THREE.Vector3;
}

export const ISLANDS: IslandDef[] = [
  {
    name: 'Skull Cove',
    x: 0,
    z: 0,
    r: 80,
    hill: 22,
    kind: 'pirate',
    seed: 11,
    flatten: [
      { x: 0, z: 52, r: 34, h: 1.6 },
      { x: -30, z: 40, r: 20, h: 2.2 },
      { x: 30, z: 42, r: 20, h: 2.0 },
    ],
  },
  { name: 'Port Royal', x: 720, z: 520, r: 72, hill: 16, kind: 'port', seed: 21, flatten: [{ x: 698, z: 492, r: 40, h: 1.8 }] },
  { name: 'Saltmarsh', x: -770, z: 380, r: 62, hill: 12, kind: 'port', seed: 31, flatten: [{ x: -743, z: 364, r: 36, h: 1.6 }] },
  { name: 'Goldhaven', x: 180, z: -830, r: 68, hill: 18, kind: 'port', seed: 41, flatten: [{ x: 168, z: -798, r: 38, h: 1.7 }] },

  { name: 'Coconut Key', x: 270, z: 190, r: 34, hill: 9, kind: 'sandy', seed: 101 },
  { name: 'Parrot Isle', x: -270, z: 260, r: 32, hill: 10, kind: 'jungle', seed: 102 },
  { name: 'Barnacle Rock', x: 390, z: -260, r: 42, hill: 20, kind: 'rocky', seed: 103 },
  { name: 'Smuggler Isle', x: -430, z: -290, r: 48, hill: 18, kind: 'jungle', seed: 104 },
  { name: 'Turtle Shoal', x: 90, z: 440, r: 24, hill: 5, kind: 'sandy', seed: 105 },
  { name: 'Gull Island', x: -150, z: -430, r: 28, hill: 9, kind: 'sandy', seed: 106 },
  { name: 'Ember Peak', x: 640, z: -80, r: 40, hill: 34, kind: 'volcano', seed: 107 },
  { name: 'Mango Isle', x: -640, z: -40, r: 32, hill: 11, kind: 'jungle', seed: 108 },
  { name: 'Lonely Palm', x: 900, z: 140, r: 22, hill: 6, kind: 'sandy', seed: 109 },
  { name: 'Shipwreck Bay', x: -960, z: -520, r: 38, hill: 12, kind: 'rocky', seed: 110 },
  { name: 'Mermaid Isle', x: 330, z: 860, r: 50, hill: 14, kind: 'port', seed: 111, flatten: [{ x: 322, z: 830, r: 30, h: 1.5 }] },
  { name: 'Bones Atoll', x: -390, z: 780, r: 30, hill: 9, kind: 'sandy', seed: 112 },
  { name: 'Fiddler Key', x: 560, z: 300, r: 20, hill: 6, kind: 'sandy', seed: 113 },
  { name: 'Crab Island', x: -560, z: 580, r: 26, hill: 8, kind: 'jungle', seed: 114 },
  { name: 'Cutlass Isle', x: 40, z: -520, r: 32, hill: 12, kind: 'rocky', seed: 115 },
  { name: 'Rumrunner Key', x: -160, z: 700, r: 22, hill: 6, kind: 'sandy', seed: 116 },

  // Hidden islands with buried treasure
  { name: 'Secret Isle', x: 1200, z: 980, r: 15, hill: 5, kind: 'hidden', seed: 201 },
  { name: 'Forgotten Key', x: -1230, z: 960, r: 14, hill: 5, kind: 'hidden', seed: 202 },
  { name: 'Ghost Atoll', x: -1170, z: -1060, r: 16, hill: 5, kind: 'hidden', seed: 203 },
  { name: "Davy's Rest", x: 1260, z: -330, r: 14, hill: 5, kind: 'hidden', seed: 204 },
];

export const PORTS: PortDef[] = [
  {
    id: 'skull',
    name: 'Skull Cove',
    kind: 'pirate',
    island: 'Skull Cove',
    lawful: false,
    blurb: 'Pirate haven · black market · cheap rum',
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 1,
    berth: new THREE.Vector3(10, 0, 98),
    berthHeading: 0,
    exit: new THREE.Vector3(0, 0, 160),
  },
  {
    id: 'royal',
    name: 'Port Royal',
    kind: 'merchant',
    island: 'Port Royal',
    lawful: true,
    blurb: 'Busy merchant port · big markets · cheap cloth',
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 1,
    berth: new THREE.Vector3(640, 0, 420),
    berthHeading: Math.PI * 1.25,
    exit: new THREE.Vector3(600, 0, 380),
  },
  {
    id: 'salt',
    name: 'Saltmarsh',
    kind: 'fishing',
    island: 'Saltmarsh',
    lawful: false,
    blurb: 'Fishing village · cheap fish & meat',
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 1,
    berth: new THREE.Vector3(-690, 0, 300),
    berthHeading: Math.PI * 0.75,
    exit: new THREE.Vector3(-660, 0, 270),
  },
  {
    id: 'gold',
    name: 'Goldhaven',
    kind: 'rich',
    island: 'Goldhaven',
    lawful: true,
    blurb: 'Rich port · luxury goods · fancy shops',
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 1,
    berth: new THREE.Vector3(150, 0, -730),
    berthHeading: 0.1,
    exit: new THREE.Vector3(150, 0, -680),
  },
  {
    id: 'lagoon',
    name: 'Mermaid Lagoon',
    kind: 'remote',
    island: 'Mermaid Isle',
    lawful: false,
    blurb: 'Remote island · rare spices · hidden traders',
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 1,
    berth: new THREE.Vector3(320, 0, 790),
    berthHeading: Math.PI,
    exit: new THREE.Vector3(320, 0, 760),
  },
];

export const portById = (id: string) => PORTS.find((p) => p.id === id)!;

/** Town ground: how far inland the flat town area is centred, its radius and height. */
const TOWN_FLAT: Record<string, { inland: number; r: number; h: number }> = {
  royal: { inland: 24, r: 46, h: 1.8 },
  salt: { inland: 20, r: 40, h: 1.6 },
  gold: { inland: 24, r: 46, h: 2.0 },
  lagoon: { inland: 15, r: 32, h: 1.5 },
};

/** Extra jetties per town, in town-local coords (a = along shore, b = seaward). */
export const TOWN_PIERS: Record<string, { a: number; b: number; hw: number; hl: number; rot?: number }[]> = {
  royal: [{ a: -30, b: 7, hw: 2.4, hl: 9 }],
  salt: [
    { a: -26, b: 6, hw: 2.0, hl: 10 },
    { a: 28, b: 5, hw: 2.0, hl: 8 },
  ],
  gold: [{ a: -26, b: 6, hw: 2.6, hl: 7 }],
  lagoon: [{ a: -18, b: 4, hw: 1.8, hl: 7 }],
};

/** Town-local (a, b) to world xz. */
export function townToWorld(port: PortDef, a: number, b: number, out = new THREE.Vector3()) {
  // right vector R = (fz, -fx); seaward F = (fx, fz)
  return out.set(port.ox + port.fz * a + port.fx * b, 0, port.oz - port.fx * a + port.fz * b);
}

/** Shipping lanes between merchant ports (waypoints avoid islands). */
export const ROUTES: THREE.Vector3[][] = [
  // Saltmarsh <-> Port Royal (passes south of Skull Cove – easy pickings!)
  [
    [-660, 270],
    [-430, 220],
    [-180, 190],
    [120, 230],
    [400, 290],
    [600, 380],
  ],
  // Port Royal <-> Goldhaven
  [
    [600, 380],
    [470, 350],
    [470, 150],
    [520, -120],
    [420, -440],
    [260, -640],
    [150, -680],
  ],
  // Goldhaven <-> Saltmarsh
  [
    [150, -680],
    [-80, -580],
    [-280, -420],
    [-330, -210],
    [-560, -120],
    [-560, 120],
    [-660, 270],
  ],
  // Inner loop near Skull Cove
  [
    [-200, 130],
    [180, 120],
    [200, -150],
    [-50, -260],
    [-260, -140],
    [-200, 130],
  ],
  // Luxury lane through dangerous waters
  [
    [150, -680],
    [520, -620],
    [820, -520],
    [960, -280],
    [820, 60],
    [600, 380],
  ],
].map((r) => r.map(([x, z]) => new THREE.Vector3(x, 0, z)));

export interface RockDef {
  x: number;
  z: number;
  r: number;
  h: number;
}

export interface Zone {
  name: string;
  x: number;
  z: number;
  r: number;
  kind: 'danger' | 'patrol';
}

export const ZONES: Zone[] = [
  { name: "Kraken's Teeth", x: 900, z: -720, r: 260, kind: 'danger' },
  { name: 'Royal Waters', x: 640, z: 420, r: 260, kind: 'patrol' },
  { name: 'Saltmarsh Waters', x: -690, z: 300, r: 240, kind: 'patrol' },
  { name: 'Goldhaven Waters', x: 150, z: -700, r: 240, kind: 'patrol' },
];

/** Sea stacks – lots in the dangerous waters, a few scattered elsewhere. */
export const ROCKS: RockDef[] = (() => {
  const rng = mulberry32(777);
  const out: RockDef[] = [];
  const danger = ZONES[0];
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * danger.r;
    out.push({ x: danger.x + Math.cos(a) * d, z: danger.z + Math.sin(a) * d, r: 4 + rng() * 9, h: 6 + rng() * 22 });
  }
  const scattered: [number, number][] = [
    [150, 60],
    [-120, 150],
    [230, -60],
    [-330, 60],
    [470, 520],
    [-520, 230],
    [700, -300],
    [-260, -620],
    [260, 560],
    [-820, 120],
  ];
  for (const [x, z] of scattered) out.push({ x, z, r: 3 + rng() * 5, h: 5 + rng() * 10 });
  return out;
})();

/** Extra circular obstacles (landmarks) that ships collide with. */
export const OBSTACLES: { x: number; z: number; r: number }[] = [];

/** Pier rectangles that ships collide with (centre, half extents, axis aligned to rotation). */
export interface PierDef {
  x: number;
  z: number;
  hw: number;
  hl: number;
  rot: number;
  port?: string;
}
export const PIERS: PierDef[] = [
  { x: 0, z: 88, hw: 3.2, hl: 18, rot: 0 },
  { x: -26, z: 82, hw: 2.6, hl: 10, rot: 0.25 },
  { x: 28, z: 81, hw: 2.6, hl: 10, rot: -0.3 },
];

// ---------------------------------------------------------------------------
// Island shape maths
// ---------------------------------------------------------------------------

for (const isl of ISLANDS) {
  const rng = mulberry32(isl.seed * 7919);
  const amp = isl.kind === 'pirate' ? 0.08 : 0.13;
  isl.coef = [];
  for (let k = 2; k <= 6; k++) isl.coef.push({ k, a: (amp / Math.sqrt(k)) * (0.5 + rng()), p: rng() * Math.PI * 2 });
  let s = 0;
  for (const c of isl.coef) s += c.a;
  isl.maxR = isl.r * (1 + s);
}

export function coastRadius(isl: IslandDef, theta: number) {
  let f = 1;
  for (const c of isl.coef!) f += c.a * Math.sin(c.k * theta + c.p);
  return isl.r * f;
}

/** z of Skull Cove's southern shoreline (x = 0) – the harbour is laid out from here. */
export const SKULL_COAST_Z = coastRadius(ISLANDS[0], Math.PI / 2);
{
  const cz = SKULL_COAST_Z;
  const sideCoast = (x: number) => {
    // find coast z for given x on south side
    let z = cz;
    for (let i = 0; i < 40; i++) {
      const th = Math.atan2(z, x);
      const r = coastRadius(ISLANDS[0], th);
      z = Math.sqrt(Math.max(r * r - x * x, 1));
    }
    return z;
  };
  PIERS[0] = { x: 0, z: cz + 12, hw: 3.2, hl: 22, rot: 0, port: 'skull' };
  // Skull Rock landmark at the harbour mouth (rendered by Port.ts)
  OBSTACLES.push({ x: -66, z: cz + 22, r: 11 });
  const zl = sideCoast(-30);
  const zr = sideCoast(30);
  PIERS[1] = { x: -30, z: zl + 6, hw: 2.6, hl: 11, rot: 0.2, port: 'skull' };
  PIERS[2] = { x: 30, z: zr + 6, hw: 2.6, hl: 11, rot: -0.2, port: 'skull' };
  // merchant harbours: a long pier pointing out from the town toward the open sea
  for (const port of PORTS) {
    if (port.id === 'skull') continue;
    const isl = ISLANDS.find((i) => i.name === port.island)!;
    const f = isl.flatten![0];
    const dx = f.x - isl.x;
    const dz = f.z - isl.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const coast = coastRadius(isl, Math.atan2(uz, ux));
    const cx = isl.x + ux * (coast + 9);
    const cz2 = isl.z + uz * (coast + 9);
    const rot = Math.atan2(ux, uz);
    const hl = port.id === 'lagoon' ? 14 : 18;
    PIERS.push({ x: cx, z: cz2, hw: 3, hl, rot, port: port.id });
    // berth beside the pier
    port.berth.set(cx + Math.cos(rot) * 9, 0, cz2 - Math.sin(rot) * 9);
    port.berthHeading = rot;
    // town frame + flat ground for the town
    port.ox = isl.x + ux * coast;
    port.oz = isl.z + uz * coast;
    port.fx = ux;
    port.fz = uz;
    port.exit.set(port.ox + ux * 70, 0, port.oz + uz * 70);
    const tf = TOWN_FLAT[port.id];
    isl.flatten = [{ x: port.ox - ux * tf.inland, z: port.oz - uz * tf.inland, r: tf.r, h: tf.h }];
  }
  PORTS[0].berth.set(10.5, 0, cz + 22);
  PORTS[0].exit.set(0, 0, cz + 80);
  PORTS[0].ox = 0;
  PORTS[0].oz = cz;
  ISLANDS[0].flatten = [
    { x: 0, z: cz - 26, r: 44, h: 1.9 },
    { x: -34, z: cz - 14, r: 22, h: 2.0 },
    { x: 34, z: cz - 14, r: 22, h: 2.0 },
  ];
  // extra town jetties
  for (const port of PORTS) {
    for (const j of TOWN_PIERS[port.id] ?? []) {
      const c = townToWorld(port, j.a, j.b);
      PIERS.push({ x: c.x, z: c.z, hw: j.hw, hl: j.hl, rot: Math.atan2(port.fx, port.fz) + (j.rot ?? 0), port: port.id });
    }
  }
}

/** Terrain height of a single island at world xz (negative = under water). */
export function islandHeight(isl: IslandDef, x: number, z: number) {
  const dx = x - isl.x;
  const dz = z - isl.z;
  const d = Math.hypot(dx, dz);
  const rr = coastRadius(isl, Math.atan2(dz, dx));
  const s = d / rr;
  let h: number;
  const sb = isl.kind === 'hidden' || isl.kind === 'sandy' ? 0.7 : 0.82;
  if (s >= 1) {
    h = -Math.min((s - 1) * rr * 0.35, 9);
  } else if (s > sb) {
    h = 1.3 * ((1 - s) / (1 - sb));
  } else {
    const u = (sb - s) / sb;
    const n = fbm2(x * 0.03, z * 0.03, isl.seed);
    let hill = isl.hill * Math.pow(smoothstep(0, 1, u), 1.3) * (0.75 + 0.45 * n);
    if (isl.kind === 'volcano') {
      hill = isl.hill * Math.pow(smoothstep(0, 1, u), 1.6);
      if (u > 0.85) hill -= (u - 0.85) * isl.hill * 2.2; // crater
    }
    h = 1.3 + hill + 0.9 * fbm2(x * 0.09, z * 0.09, isl.seed + 3) * smoothstep(0, 0.3, u);
  }
  if (isl.flatten) {
    for (const f of isl.flatten) {
      const fd = Math.hypot(x - f.x, z - f.z);
      const w = 1 - smoothstep(f.r * 0.65, f.r, fd);
      if (w > 0 && s < 1) h = h + (f.h - h) * w;
    }
  }
  return h;
}

/** Highest terrain at world xz (or -10 in open sea). */
export function terrainHeight(x: number, z: number) {
  let best = -10;
  for (const isl of ISLANDS) {
    const dx = x - isl.x;
    const dz = z - isl.z;
    const mr = isl.maxR! * 1.35;
    if (dx * dx + dz * dz > mr * mr) continue;
    const h = islandHeight(isl, x, z);
    if (h > best) best = h;
  }
  for (const r of ROCKS) {
    const d = Math.hypot(x - r.x, z - r.z);
    if (d < r.r) best = Math.max(best, r.h * (1 - (d / r.r) ** 2));
  }
  return best;
}

/**
 * Signed distance (approx.) from world xz to the nearest land/obstacle edge.
 * Negative = inside land. Used for collisions, AI avoidance and the water shader.
 */
let pierRot: { c: number; s: number; reach: number }[] = [];
/**
 * landSDF for hot paths (ship collision, AI steering): out in open water the baked grid answers
 * straight away (accurate to a cell, ~3 m), and only piers need checking. Use it where you only
 * care about distances under ~25 m; it reports "about 27+" for anything further.
 */
export function landSDFFast(x: number, z: number) {
  const g = SDF_GRID;
  if (g) {
    const i = Math.floor(((x + WORLD_HALF) / (WORLD_HALF * 2)) * g.size);
    const j = Math.floor(((z + WORLD_HALF) / (WORLD_HALF * 2)) * g.size);
    if (i >= 0 && j >= 0 && i < g.size && j < g.size) {
      const v = g.data[j * g.size + i];
      if (v > 30) return Math.min(v - 3, pierSDF(x, z, v - 3));
    }
  }
  return landSDF(x, z);
}
function pierSDF(x: number, z: number, best: number) {
  if (pierRot.length !== PIERS.length) pierRot = PIERS.map((p) => ({ c: Math.cos(-p.rot), s: Math.sin(-p.rot), reach: Math.hypot(p.hw, p.hl) }));
  for (let k = 0; k < PIERS.length; k++) {
    const p = PIERS[k];
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.abs(dx) - pierRot[k].reach > best || Math.abs(dz) - pierRot[k].reach > best) continue;
    const { c, s } = pierRot[k];
    const qx = Math.abs(dx * c + dz * s) - p.hw;
    const qz = Math.abs(-dx * s + dz * c) - p.hl;
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
    if (sd < best) best = sd;
  }
  return best;
}

export function landSDF(x: number, z: number, piers = true) {
  let best = 1e9;
  for (const isl of ISLANDS) {
    const dx = x - isl.x;
    const dz = z - isl.z;
    const d = Math.hypot(dx, dz);
    if (d - isl.maxR! > best) continue;
    const rr = coastRadius(isl, Math.atan2(dz, dx));
    const sd = d - rr;
    if (sd < best) best = sd;
  }
  for (const r of ROCKS) {
    const sd = Math.hypot(x - r.x, z - r.z) - r.r;
    if (sd < best) best = sd;
  }
  for (const o of OBSTACLES) {
    const sd = Math.hypot(x - o.x, z - o.z) - o.r;
    if (sd < best) best = sd;
  }
  if (piers) for (const p of PIERS) {
    const c = Math.cos(-p.rot);
    const s = Math.sin(-p.rot);
    // world -> pier local (inverse of three.js Y rotation)
    const lx = (x - p.x) * c + (z - p.z) * s;
    const lz = -(x - p.x) * s + (z - p.z) * c;
    const qx = Math.abs(lx) - p.hw;
    const qz = Math.abs(lz) - p.hl;
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
    if (sd < best) best = sd;
  }
  return best;
}

/** Gradient of the SDF (points away from land). */
export function landGradient(x: number, z: number, out = new THREE.Vector2()) {
  const e = 1.5;
  const gx = landSDF(x + e, z) - landSDF(x - e, z);
  const gz = landSDF(x, z + e) - landSDF(x, z - e);
  out.set(gx, gz);
  const l = out.length();
  if (l > 1e-6) out.divideScalar(l);
  return out;
}

export function zoneAt(x: number, z: number, kind?: Zone['kind']) {
  for (const zn of ZONES) {
    if (kind && zn.kind !== kind) continue;
    if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn;
  }
  return null;
}

/** 0..1 how deep into the dangerous waters (drives local storms). */
export function dangerFactor(x: number, z: number) {
  const zn = ZONES[0];
  const d = Math.hypot(x - zn.x, z - zn.z);
  return clamp(1 - (d - zn.r * 0.6) / (zn.r * 0.6), 0, 1);
}

export function islandByName(name: string) {
  return ISLANDS.find((i) => i.name === name)!;
}

/** Baked SDF grid (shared by the ocean shader texture and the minimap). */
export interface SdfGrid {
  size: number;
  data: Float32Array;
}
export let SDF_GRID: SdfGrid | null = null;

/**
 * Bake the SDF into a texture for the ocean shader (shallow water + shore foam).
 * Only texels near each island/rock are evaluated, which keeps loading fast.
 */
export function bakeShoreTexture(size = 1024) {
  const span = WORLD_HALF * 2;
  const cell = span / size;
  const sdf = new Float32Array(size * size).fill(48);
  const toIdx = (w: number) => Math.floor((w + WORLD_HALF) / cell);
  const stamp = (cx: number, cz: number, reach: number, fn: (x: number, z: number) => number) => {
    const i0 = Math.max(0, toIdx(cx - reach));
    const i1 = Math.min(size - 1, toIdx(cx + reach));
    const j0 = Math.max(0, toIdx(cz - reach));
    const j1 = Math.min(size - 1, toIdx(cz + reach));
    for (let j = j0; j <= j1; j++) {
      const z = -WORLD_HALF + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const x = -WORLD_HALF + (i + 0.5) * cell;
        const k = j * size + i;
        const d = fn(x, z);
        if (d < sdf[k]) sdf[k] = d;
      }
    }
  };
  for (const isl of ISLANDS) {
    stamp(isl.x, isl.z, isl.maxR! + 50, (x, z) => {
      const dx = x - isl.x;
      const dz = z - isl.z;
      return Math.hypot(dx, dz) - coastRadius(isl, Math.atan2(dz, dx));
    });
  }
  for (const r of ROCKS) stamp(r.x, r.z, r.r + 50, (x, z) => Math.hypot(x - r.x, z - r.z) - r.r);
  for (const o of OBSTACLES) stamp(o.x, o.z, o.r + 50, (x, z) => Math.hypot(x - o.x, z - o.z) - o.r);
  SDF_GRID = { size, data: sdf };
  const data = new Uint8Array(size * size);
  for (let k = 0; k < sdf.length; k++) data[k] = Math.round(clamp((sdf[k] + 16) / 64, 0, 1) * 255);
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
