import * as THREE from 'three';
import { GeoBuilder, T, roundBox, cyl, rockGeo } from '../render/GeoBuilder';
import { M } from '../render/Materials';
import { mulberry32 } from '../core/math';
import { Placer, PAL, crate, barrelAt, sack, treasureChest, flagPole } from '../models/Props';
import { groundHeight } from './Islands';
import { coastRadius, type IslandDef } from './WorldData';
import type { BoxCol, CircleCol } from './TownTypes';
import type { AnimState } from '../models/Character';
import type { LandArea } from './LandArea';

/** What an encounter site looks like. */
export type SiteKind = 'camp' | 'hideout' | 'fort' | 'cave' | 'beach' | 'ruins' | 'clearing';

export interface SitePost {
  pos: THREE.Vector3;
  facing: number;
  anim: AnimState;
}

/** Built scenery + gameplay points for one encounter site. */
export interface SiteGeo {
  group: THREE.Group;
  center: THREE.Vector3;
  /** direction the site opens toward (gate, cave mouth) */
  rot: number;
  radius: number;
  boxes: BoxCol[];
  circles: CircleCol[];
  fires: THREE.Vector3[];
  /** where foes stand / sit while the site is quiet */
  posts: SitePost[];
  chest: THREE.Vector3 | null;
  /** the closed chest (swapped for an open one when looted) */
  chestMesh: THREE.Mesh | null;
  chestRy: number;
}

const STONE = '#a59a8c';
const STONE_D = '#857a6e';

/** Ground height at a point (terrain only: sites sit on open ground). */
const gy = (x: number, z: number) => groundHeight(x, z);

/**
 * Find a flat, clear spot for a site on an island between fractions sMin..sMax of its radius.
 * Prefers spots no tree or rock stands in; returns the flattest candidate.
 */
export function findIslandSpot(isl: IslandDef, sMin: number, sMax: number, radius: number, obstacles: CircleCol[], seed: number) {
  const rng = mulberry32(seed);
  const near = obstacles.filter((o) => Math.hypot(o.x - isl.x, o.z - isl.z) < isl.r * 1.4);
  let best: { p: THREE.Vector3; score: number } | null = null;
  for (let i = 0; i < 160; i++) {
    const th = rng() * Math.PI * 2;
    const s = sMin + rng() * (sMax - sMin);
    const rr = coastRadius(isl, th);
    const x = isl.x + Math.cos(th) * rr * s;
    const z = isl.z + Math.sin(th) * rr * s;
    if (isl.flatten?.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + radius)) continue;
    const h0 = gy(x, z);
    if (h0 < 0.9) continue;
    let lo = h0;
    let hi = h0;
    let wet = false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const h = gy(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
      if (h < 0.45) wet = true;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (wet) continue;
    let clutter = 0;
    for (const o of near) {
      const d = Math.hypot(o.x - x, o.z - z) - o.r;
      if (d < radius) clutter += (radius - d) * 2;
    }
    const score = (hi - lo) * 2 + clutter;
    if (!best || score < best.score) best = { p: new THREE.Vector3(x, h0, z), score };
  }
  return best?.p ?? null;
}

/** A spot on the edge of a port town (away from streets and shops). */
export function findPortSpot(area: LandArea, center: THREE.Vector3, townR: number, navNodes: THREE.Vector3[], avoid: THREE.Vector3[], radius: number, seed: number) {
  const rng = mulberry32(seed);
  let best: { p: THREE.Vector3; score: number } | null = null;
  for (let i = 0; i < 220; i++) {
    const a = rng() * Math.PI * 2;
    const d = townR * (0.7 + rng() * 0.75);
    const x = center.x + Math.cos(a) * d;
    const z = center.z + Math.sin(a) * d;
    const h0 = area.surface(x, z);
    if (h0 === null || h0 < 0.9 || area.blocked(x, z, radius * 0.7)) continue;
    let lo = h0;
    let hi = h0;
    let bad = false;
    for (let k = 0; k < 8; k++) {
      const aa = (k / 8) * Math.PI * 2;
      const h = area.surface(x + Math.cos(aa) * radius, z + Math.sin(aa) * radius);
      if (h === null || h < 0.5) bad = true;
      else {
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    if (bad) continue;
    let nearNav = Infinity;
    for (const n of navNodes) nearNav = Math.min(nearNav, Math.hypot(n.x - x, n.z - z));
    let nearAvoid = Infinity;
    for (const v of avoid) nearAvoid = Math.min(nearAvoid, Math.hypot(v.x - x, v.z - z));
    if (nearAvoid < radius + 8) continue;
    // outskirts: away from the streets, but not so far it's a trek
    const score = (hi - lo) * 2 + Math.max(0, 10 - nearNav) * 1.5 + Math.abs(d - townR * 1.0) * 0.08;
    if (!best || score < best.score) best = { p: new THREE.Vector3(x, h0, z), score };
  }
  return best?.p ?? null;
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------

/** Canvas A-frame tent opening toward local +z. */
function tent(pl: Placer, color: string, color2: string) {
  const L = 3.2;
  const W = 2.6;
  const H = 2.1;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(0, H);
  shape.lineTo(W / 2, 0);
  shape.lineTo(W / 2 - 0.12, 0);
  shape.lineTo(0, H - 0.16);
  shape.lineTo(-W / 2 + 0.12, 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
  g.translate(0, 0, -L / 2);
  pl.add(g, (c: THREE.Vector3) => (Math.floor((c.x + 5) * 2.2) % 2 ? color : color2));
  // back wall
  const back = new THREE.Shape();
  back.moveTo(-W / 2 + 0.1, 0);
  back.lineTo(0, H - 0.1);
  back.lineTo(W / 2 - 0.1, 0);
  back.closePath();
  pl.add(new THREE.ShapeGeometry(back), color, T(0, 0, -L / 2 + 0.05));
  // poles and a rolled-up flap
  for (const z of [-L / 2, L / 2]) pl.add(cyl(0.06, 0.06, H + 0.3, 5), PAL.woodDark, T(0, (H + 0.3) / 2, z));
  pl.add(cyl(0.12, 0.12, W * 0.48, 6), color2, T(-W * 0.25, H * 0.5, L / 2 + 0.05, 0, 0, Math.PI / 2 - 0.68));
}

function campfire(pl: Placer, glow: Placer) {
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    pl.add(rockGeo(0.22, 70 + i, 0, 0.7), i % 2 ? PAL.rock : PAL.rockDark, T(Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75), true);
  }
  for (let i = 0; i < 4; i++) pl.add(cyl(0.09, 0.11, 1.1, 6), PAL.trunkDark, T(0, 0.28, 0, 0.9, (i / 4) * Math.PI, 0));
  glow.add(new THREE.IcosahedronGeometry(0.32, 0), '#ffffff', T(0, 0.22, 0, 0, 0, 0, 1, 0.5, 1));
}

function logSeat(pl: Placer, len = 1.8) {
  pl.add(cyl(0.24, 0.26, len, 8), PAL.trunk, T(0, 0.24, 0, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) pl.add(new THREE.CircleGeometry(0.24, 8), '#d9b07a', T((s * len) / 2 + s * 0.01, 0.24, 0, 0, (s * Math.PI) / 2, 0));
}

function pirateFlag(pl: Placer, h: number) {
  flagPole(pl, 0, 0, 0, h);
  pl.add(new THREE.PlaneGeometry(1.7, 1.1), '#1a1a1f', T(0.9, h - 0.65, 0, 0, 0, 0));
  pl.add(new THREE.CircleGeometry(0.24, 10), '#f4f0e4', T(0.9, h - 0.55, 0.01));
  pl.add(new THREE.PlaneGeometry(0.5, 0.08), '#f4f0e4', T(0.9, h - 0.88, 0.01, 0, 0, 0.6));
  pl.add(new THREE.PlaneGeometry(0.5, 0.08), '#f4f0e4', T(0.9, h - 0.88, 0.01, 0, 0, -0.6));
}

/** A stone wall run (local +x), with crenellations. */
function wall(pl: Placer, len: number, h: number) {
  pl.add(roundBox(len / 2, h / 2, 0.45, 6, 12, 8), (c: THREE.Vector3) => (Math.floor(c.y * 1.6 + Math.floor(c.x * 0.8) * 0.5) % 2 ? STONE : STONE_D), T(0, h / 2, 0), true);
  for (let x = -len / 2 + 0.5; x < len / 2 - 0.3; x += 1.3) pl.add(new THREE.BoxGeometry(0.7, 0.55, 0.9), STONE, T(x + 0.35, h + 0.27, 0), true);
}

function tower(pl: Placer, r: number, h: number) {
  pl.add(cyl(r, r * 1.08, h, 10), (c: THREE.Vector3) => (Math.floor(c.y * 1.4) % 2 ? STONE : STONE_D), T(0, h / 2, 0), true);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pl.add(new THREE.BoxGeometry(0.55, 0.6, 0.55), STONE, T(Math.cos(a) * r * 0.9, h + 0.3, Math.sin(a) * r * 0.9, 0, -a, 0), true);
  }
}

function torch(pl: Placer, glow: Placer, h = 1.8) {
  pl.add(cyl(0.06, 0.08, h, 5), PAL.woodDark, T(0, h / 2, 0));
  pl.add(cyl(0.14, 0.09, 0.22, 6), PAL.ironDark, T(0, h + 0.05, 0));
  glow.add(new THREE.IcosahedronGeometry(0.16, 0), '#ffffff', T(0, h + 0.26, 0, 0, 0, 0, 1, 1.4, 1));
}

/**
 * Build the scenery for a site at `c` opening toward `rot`. Everything is placed on the terrain,
 * merged into a couple of meshes and returned with its colliders and gameplay points.
 */
export function buildSite(kind: SiteKind, c: THREE.Vector3, rot: number, seed: number): SiteGeo {
  const rng = mulberry32(seed);
  const gb = new GeoBuilder();
  const gl = new GeoBuilder();
  const boxes: BoxCol[] = [];
  const circles: CircleCol[] = [];
  const fires: THREE.Vector3[] = [];
  const posts: SitePost[] = [];
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  // local (x right, z toward the opening) → world
  const W = (lx: number, lz: number) => ({ x: c.x + lx * cs + lz * sn, z: c.z - lx * sn + lz * cs });
  const at = (lx: number, lz: number, ry = 0, dy = 0) => {
    const w = W(lx, lz);
    return T(w.x, gy(w.x, w.z) + dy, w.z, 0, rot + ry, 0);
  };
  const P = (lx: number, lz: number, ry = 0, dy = 0) => new Placer(gb, at(lx, lz, ry, dy));
  const G = (lx: number, lz: number, ry = 0, dy = 0) => new Placer(gl, at(lx, lz, ry, dy));
  const box = (lx: number, lz: number, hx: number, hz: number, ry = 0) => {
    const w = W(lx, lz);
    boxes.push({ x: w.x, z: w.z, hx, hz, rot: rot + ry });
  };
  const circle = (lx: number, lz: number, r: number) => {
    const w = W(lx, lz);
    circles.push({ x: w.x, z: w.z, r });
  };
  const fire = (lx: number, lz: number, dy = 0.35) => {
    const w = W(lx, lz);
    fires.push(new THREE.Vector3(w.x, gy(w.x, w.z) + dy, w.z));
  };
  const post = (lx: number, lz: number, faceLocal: number, anim: AnimState) => {
    const w = W(lx, lz);
    posts.push({ pos: new THREE.Vector3(w.x, gy(w.x, w.z), w.z), facing: rot + faceLocal, anim });
  };
  /** facing (local) from a local point toward another */
  const face = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);
  let chest: { lx: number; lz: number; ry: number } | null = null;
  let radius = 8;

  const clutter = (lx: number, lz: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const ox = lx + (rng() - 0.5) * 2.2;
      const oz = lz + (rng() - 0.5) * 2.2;
      const r = rng();
      if (r < 0.4) crate(P(ox, oz, rng() * 3), 0, 0, 0, 0.75 + rng() * 0.3, 0);
      else if (r < 0.75) barrelAt(P(ox, oz), 0, 0, 0, 0.9, rng() < 0.3);
      else sack(P(ox, oz), 0, 0, 0, 1);
      circle(ox, oz, 0.55);
    }
  };

  switch (kind) {
    case 'camp':
    case 'hideout': {
      radius = 9;
      campfire(P(0, 0), G(0, 0));
      fire(0, 0);
      circle(0, 0, 0.9);
      const seats = [0.4, 2.4, 4.4];
      for (const a of seats) {
        const lx = Math.sin(a) * 2.4;
        const lz = Math.cos(a) * 2.4;
        logSeat(P(lx, lz, a + Math.PI / 2));
        circle(lx, lz, 0.5);
        post(lx * 1.25, lz * 1.25, face(lx, lz, 0, 0), rng() < 0.5 ? 'sitDrink' : 'sit');
      }
      if (kind === 'camp') {
        const tents: [number, number][] = [
          [-5.2, -3.2],
          [4.8, -4.0],
        ];
        tents.forEach(([lx, lz], i) => {
          const ry = face(lx, lz, 0, 0);
          tent(P(lx, lz, ry), i ? '#d9cba7' : '#c9b48a', i ? '#b5392f' : '#3a5a8a');
          box(lx, lz, 1.4, 1.75, ry);
        });
        const f = P(-1.5, -6.2);
        pirateFlag(f, 5);
        circle(-1.5, -6.2, 0.3);
        clutter(6.4, 1.8, 4);
        clutter(-6.6, 1.2, 3);
        chest = { lx: 1.4, lz: -5.8, ry: 0 };
        post(0, 5.2, 0, 'guard');
        post(-3.6, -1.2, face(-3.6, -1.2, 0, 4), 'guard');
      } else {
        // lean-to shack with a table of loot
        const s = P(0, -5.2);
        for (const x of [-2.6, 2.6]) for (const z of [-1.2, 1.4]) s.add(cyl(0.1, 0.12, z > 0 ? 2.6 : 2.0, 5), PAL.woodDark, T(x, (z > 0 ? 2.6 : 2.0) / 2, z));
        s.add(new THREE.BoxGeometry(6, 0.12, 3.4), '#8a6a40', T(0, 2.35, 0.1, -0.19, 0, 0));
        s.add(new THREE.BoxGeometry(5.6, 1.9, 0.12), PAL.woodDark, T(0, 0.95, -1.25));
        s.add(new THREE.BoxGeometry(2.2, 0.1, 1.0), PAL.wood, T(0.6, 0.85, 0.2));
        for (const x of [-0.4, 1.6]) s.add(cyl(0.06, 0.06, 0.8, 5), PAL.woodDark, T(x, 0.4, 0.2));
        box(0, -5.2 - 1.25, 2.9, 0.25);
        circle(0.6, -5.0, 0.8);
        clutter(-4.2, -4.0, 4);
        clutter(4.4, -3.2, 3);
        chest = { lx: -1.6, lz: -5.0, ry: 0 };
        post(3.4, 2.6, face(3.4, 2.6, 0, 6), 'guard');
        post(-3.0, 3.2, face(-3, 3.2, 0, 6), 'guard');
      }
      break;
    }
    case 'fort': {
      radius = 11;
      const hs = 8;
      const h = 3.2;
      // four walls with a gate gap facing +z
      const runs: [number, number, number, number][] = [
        [0, -hs, hs * 2, 0],
        [-hs, 0, hs * 2, Math.PI / 2],
        [hs, 0, hs * 2, Math.PI / 2],
        [-hs * 0.62, hs, hs * 0.76, 0],
        [hs * 0.62, hs, hs * 0.76, 0],
      ];
      for (const [lx, lz, len, ry] of runs) {
        wall(P(lx, lz, ry, -0.4), len, h);
        box(lx, lz, len / 2, 0.5, ry);
      }
      for (const [lx, lz] of [
        [-hs, -hs],
        [hs, -hs],
        [-hs, hs],
        [hs, hs],
      ] as [number, number][]) {
        tower(P(lx, lz, 0, -0.4), 1.5, h + 1.6);
        circle(lx, lz, 1.6);
      }
      // gate posts with torches
      for (const s of [-1, 1]) torch(P(s * 2.1, hs + 0.9), G(s * 2.1, hs + 0.9));
      fire(-2.1, hs + 0.9, 2.05);
      fire(2.1, hs + 0.9, 2.05);
      const fl = P(0, -hs + 1.2);
      pirateFlag(fl, 6.5);
      campfire(P(0, -1), G(0, -1));
      fire(0, -1);
      circle(0, -1, 0.9);
      clutter(-5.6, -5.2, 5);
      clutter(5.4, -5.6, 4);
      clutter(5.6, 3.8, 3);
      chest = { lx: 0, lz: -hs + 1.6, ry: 0 };
      post(0, 2.5, 0, 'guard');
      post(-3.5, -3, face(-3.5, -3, 0, hs), 'guard');
      post(3.5, -2.5, face(3.5, -2.5, 0, hs), 'guard');
      post(-1.8, hs - 1.4, 0, 'guard');
      post(1.8, hs - 1.4, 0, 'guard');
      post(-5, 2, face(-5, 2, 0, -1), 'sit');
      break;
    }
    case 'cave': {
      radius = 10;
      // horseshoe of boulders opening toward +z, with a rock roof over the back
      const n = 13;
      for (let i = 0; i < n; i++) {
        const a = Math.PI * 0.32 + (i / (n - 1)) * Math.PI * 1.36;
        const r = 7.2 + (rng() - 0.5) * 0.8;
        // the gap in the ring (a ≈ 0) is the cave mouth, facing +z
        const lx = Math.sin(a) * r;
        const lz = Math.cos(a) * r;
        const size = 2.2 + rng() * 1.4;
        P(lx, lz, rng() * 6, -0.6).add(rockGeo(size, seed + i * 7, 1, 1.5 + rng() * 0.6), rng() < 0.5 ? '#6e625a' : '#5b514a', undefined, true);
        circle(lx, lz, size * 0.95);
      }
      // overhanging slab and a dark grotto at the back
      P(0, -4.2, 0, 6.2).add(rockGeo(5.6, seed + 99, 1, 0.42), '#5b514a', undefined, true);
      P(0, -7.4, 0, -0.5).add(new THREE.SphereGeometry(4.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#1c1814', T(0, 0, 0, 0, 0, 0, 1.1, 1.2, 0.6), true);
      for (const s of [-1, 1]) {
        torch(P(s * 4.4, 2.6), G(s * 4.4, 2.6), 2.1);
        fire(s * 4.4, 2.6, 2.35);
      }
      // lava glow pool / embers for the volcano boss
      G(0, -5.5, 0, 0.05).add(new THREE.CircleGeometry(1.1, 12), '#ffffff', T(0, 0, 0, -Math.PI / 2, 0, 0, 1, 1, 0.5));
      clutter(-4.4, -3.2, 3);
      clutter(4.2, -3.6, 3);
      chest = { lx: 0, lz: -5.2, ry: 0 };
      post(0, -2.4, 0, 'hips');
      post(-2.6, 2.4, face(-2.6, 2.4, 0, 9), 'guard');
      post(2.8, 1.8, face(2.8, 1.8, 0, 9), 'guard');
      post(-3.4, -1.2, 0.4, 'guard');
      post(3.4, -0.8, -0.4, 'guard');
      break;
    }
    case 'beach': {
      radius = 9;
      // a beached rowboat, a broken mast and a little fire
      const b = P(-3.6, -1.5, 0.5, 0.15);
      b.add(new THREE.CylinderGeometry(1.0, 1.0, 4.4, 10, 1, true, Math.PI / 2, Math.PI), '#8a5a33', T(0, 0.6, 0, Math.PI / 2, 0, Math.PI), false);
      b.add(new THREE.BoxGeometry(1.9, 0.08, 0.3), PAL.woodDark, T(0, 0.55, 0.6));
      b.add(new THREE.BoxGeometry(1.9, 0.08, 0.3), PAL.woodDark, T(0, 0.55, -0.7));
      box(-3.6, -1.5, 1.0, 2.2, 0.5);
      P(3.8, -3.6, 1.2, 0.2).add(cyl(0.22, 0.26, 6.5, 8), PAL.trunkDark, T(0, 0.25, 0, 0, 0, Math.PI / 2 - 0.15));
      circle(2.2, -3.4, 0.6);
      circle(4.6, -3.8, 0.6);
      campfire(P(0, 1.2), G(0, 1.2));
      fire(0, 1.2);
      circle(0, 1.2, 0.9);
      logSeat(P(0, 3.4, 0));
      circle(0, 3.4, 0.5);
      clutter(4.6, 1.6, 4);
      chest = { lx: -1.2, lz: -3.8, ry: 0.3 };
      post(0, 4.1, Math.PI, 'sit');
      post(2.6, 0.6, face(2.6, 0.6, 0, 1.2), 'sitDrink');
      post(-2.2, 3.0, 0, 'guard');
      post(3.2, 4.6, 0, 'guard');
      break;
    }
    case 'ruins': {
      radius = 10;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + rng() * 0.3;
        const r = 6.5 + rng();
        const lx = Math.sin(a) * r;
        const lz = Math.cos(a) * r;
        const h = 1 + rng() * 3.2;
        const p = P(lx, lz, rng() * 6);
        p.add(cyl(0.55, 0.62, h, 8), (cc: THREE.Vector3) => (Math.floor(cc.y * 2) % 2 ? STONE : STONE_D), T(0, h / 2 - 0.1, 0), true);
        if (rng() < 0.4) p.add(new THREE.BoxGeometry(1.5, 0.35, 1.5), STONE, T(0, h, 0), true);
        circle(lx, lz, 0.65);
      }
      wall(P(-3.4, -5.4, 0.3, -0.5), 4.2, 2.2);
      box(-3.4, -5.4, 2.1, 0.5, 0.3);
      P(2.4, 3.2, 1.1).add(new THREE.BoxGeometry(3, 0.6, 0.9), STONE_D, T(0, 0.3, 0, 0, 0, 0.15), true);
      circle(2.4, 3.2, 1.2);
      torch(P(0, -2), G(0, -2), 1.9);
      fire(0, -2, 2.15);
      chest = { lx: 0, lz: -4.2, ry: 0 };
      post(-2.5, 1.5, 0, 'guard');
      post(2.5, -1.0, 0, 'guard');
      post(0, 4.5, Math.PI, 'guard');
      post(-4, -2, 0.8, 'guard');
      break;
    }
    case 'clearing': {
      radius = 7;
      // a castaway's shelter: palm-leaf lean-to and a signal fire
      const s = P(0, -2.8);
      s.add(cyl(0.08, 0.1, 2.2, 5), PAL.woodDark, T(-1.6, 1.1, 0.8));
      s.add(cyl(0.08, 0.1, 2.2, 5), PAL.woodDark, T(1.6, 1.1, 0.8));
      s.add(new THREE.BoxGeometry(3.6, 0.12, 2.4), '#5ea84a', T(0, 1.55, -0.1, -0.55, 0, 0));
      box(0, -2.8, 1.8, 0.9);
      campfire(P(0, 0.8), G(0, 0.8));
      fire(0, 0.8);
      circle(0, 0.8, 0.9);
      clutter(2.6, -1.8, 2);
      post(-1.4, 1.6, 0.5, 'wave');
      post(3, 3, 0, 'guard');
      post(-3, 3, 0, 'guard');
      break;
    }
  }

  let chestPos: THREE.Vector3 | null = null;
  let chestMesh: THREE.Mesh | null = null;
  let chestRy = 0;
  const group = new THREE.Group();
  group.name = `site-${kind}`;
  if (chest) {
    const w = W(chest.lx, chest.lz);
    chestPos = new THREE.Vector3(w.x, gy(w.x, w.z), w.z);
    chestRy = rot + chest.ry;
    const cb = new GeoBuilder();
    treasureChest(new Placer(cb), 0, 0, 0, 0, false);
    chestMesh = new THREE.Mesh(cb.build(), M.vc);
    chestMesh.castShadow = true;
    chestMesh.position.copy(chestPos).setY(chestPos.y - 0.05);
    chestMesh.rotation.y = chestRy;
    group.add(chestMesh);
    circles.push({ x: w.x, z: w.z, r: 0.75 });
  }
  if (!gb.empty) group.add(gb.mesh(M.vc));
  if (!gl.empty) group.add(gl.mesh(M.glow, false));
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o !== chestMesh) o.matrixAutoUpdate = false;
  });
  return { group, center: c.clone().setY(gy(c.x, c.z)), rot, radius, boxes, circles, fires, posts, chest: chestPos, chestMesh, chestRy };
}

/** Swap a site's chest for an open one spilling gold. */
export function openChest(site: SiteGeo) {
  if (!site.chestMesh || !site.chest) return;
  const cb = new GeoBuilder();
  treasureChest(new Placer(cb), 0, 0, 0, 0, true);
  const old = site.chestMesh.geometry;
  site.chestMesh.geometry = cb.build();
  old.dispose();
}

/** Put a site's chest back (camp re-stocked). */
export function closeChest(site: SiteGeo) {
  if (!site.chestMesh) return;
  const cb = new GeoBuilder();
  treasureChest(new Placer(cb), 0, 0, 0, 0, false);
  const old = site.chestMesh.geometry;
  site.chestMesh.geometry = cb.build();
  old.dispose();
}
