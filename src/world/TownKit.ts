import * as THREE from 'three';
import { T, cyl, roundBox, ellipsoid, lathe, beam } from '../render/GeoBuilder';
import { mulberry32 } from '../core/math';
import { Placer, PAL, crate, barrelAt, sack, cannonGeo, lantern, barrel } from '../models/Props';
import type { StallType } from '../game/Economy';

/**
 * Geometry-only building blocks for the explorable ports. Everything is built in the
 * local space of a Placer (front = +Z) and merged into a few big meshes by the town builder.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Market stalls
// ---------------------------------------------------------------------------
export const STALL_W = 3.8;

/** Counter + posts + striped awning. Vendor stands at z = -1.25, customers at z = +1.7. */
export function stallGeo(pl: Placer, type: StallType, color: string, seed: number, style: 'wood' | 'bamboo' | 'fancy' = 'wood') {
  const rng = mulberry32(seed);
  const w = STALL_W;
  const post = style === 'bamboo' ? '#c9a45a' : style === 'fancy' ? '#f4efe4' : PAL.woodDark;
  const top = style === 'fancy' ? '#f4efe4' : PAL.woodLight;
  for (const sx of [-1, 1]) {
    pl.add(cyl(0.1, 0.12, 3.0, 7), post, T((sx * w) / 2, 1.5, 0.75));
    pl.add(cyl(0.1, 0.12, 3.3, 7), post, T((sx * w) / 2, 1.65, -1.0));
    if (style === 'fancy') pl.add(new THREE.SphereGeometry(0.16, 8, 6), PAL.gold, T((sx * w) / 2, 3.08, 0.75));
  }
  // counter
  pl.add(new THREE.BoxGeometry(w - 0.1, 0.95, 1.05), style === 'fancy' ? '#2c3e50' : PAL.wood, T(0, 0.48, 0.3));
  pl.add(new THREE.BoxGeometry(w + 0.2, 0.12, 1.3), top, T(0, 1.0, 0.32));
  // front panel planks / cloth
  if (style === 'fancy') pl.add(new THREE.BoxGeometry(w - 0.2, 0.7, 0.04), color, T(0, 0.5, 0.86));
  else for (let i = 0; i < 4; i++) pl.add(new THREE.BoxGeometry(0.05, 0.85, 0.04), PAL.woodDark, T(-w / 2 + 0.5 + i * ((w - 1) / 3), 0.48, 0.84));
  // back shelf
  pl.add(new THREE.BoxGeometry(w - 0.3, 0.1, 0.5), PAL.woodLight, T(0, 1.55, -1.05));
  // striped awning (sloped towards the customer) with a scalloped valance
  const aw = new THREE.BoxGeometry(w + 0.7, 0.1, 2.6, 10, 1, 1);
  pl.add(aw, (c) => (Math.floor((c.x + 20) * 1.35) % 2 ? color : PAL.white), T(0, 3.05, -0.1, 0.2, 0, 0));
  for (let i = 0; i < 9; i++) {
    const x = -w / 2 - 0.3 + i * ((w + 0.6) / 8);
    pl.add(new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), i % 2 ? color : PAL.white, T(x, 2.84, 1.16, 0, 0, 0, 1, 0.9, 0.35));
  }
  stallGoods(pl, type, rng);
}

function stallGoods(pl: Placer, type: StallType, rng: () => number) {
  const w = STALL_W - 0.6;
  const y = 1.06;
  const row = (n: number, fn: (x: number, i: number) => void) => {
    for (let i = 0; i < n; i++) fn(-w / 2 + 0.3 + (i / Math.max(1, n - 1)) * (w - 0.6), i);
  };
  switch (type) {
    case 'food':
      // fish on ice, fruit pyramids, hams, grain sacks
      pl.add(new THREE.BoxGeometry(1.1, 0.12, 0.8), '#dff3ff', T(-1.0, y + 0.02, 0.35));
      for (let i = 0; i < 5; i++) pl.add(ellipsoid(0.08, 0.06, 0.28, 8, 6), i % 2 ? '#9fb6c8' : '#c7d6e2', T(-1.35 + i * 0.17, y + 0.12, 0.35, 0, 0.3 * (i % 2 ? 1 : -1), 0));
      for (let i = 0; i < 6; i++) pl.add(new THREE.IcosahedronGeometry(0.16, 1), ['#ffcc33', '#ff8a3d', '#7bd05a'][i % 3], T(0.15 + (i % 3) * 0.3, y + 0.15 + (i > 2 ? 0.25 : 0), 0.3 + (i > 2 ? 0 : 0.12)));
      pl.add(ellipsoid(0.18, 0.28, 0.18, 10, 8), '#b5532e', T(1.25, y + 0.3, 0.3, 0.4, 0, 0.3));
      for (let i = 0; i < 3; i++) pl.add(ellipsoid(0.12, 0.2, 0.12, 8, 6), '#a0482a', T(-1.2 + i * 0.5, 2.2, -0.95, 0, 0, 0.1));
      for (let i = 0; i < 2; i++) sack(pl, 1.0 + i * 0.6, 0, 1.25, 0.9);
      break;
    case 'spice': {
      // bowls heaped with coloured powder + jars
      const cols = ['#d63031', '#e17055', '#fdcb6e', '#a0522d', '#e84393', '#6ab04c'];
      row(6, (x, i) => {
        pl.add(lathe([[0, 0], [0.24, 0.02], [0.28, 0.14], [0, 0.14]], 10), '#8a5a33', T(x, y, 0.3 + (i % 2) * 0.12));
        pl.add(new THREE.ConeGeometry(0.24, 0.24, 10), cols[i], T(x, y + 0.24, 0.3 + (i % 2) * 0.12));
      });
      row(5, (x, i) => pl.add(cyl(0.1, 0.1, 0.32, 8), ['#f6e58d', '#ffbe76', '#badc58', '#ff7979', '#c7ecee'][i], T(x, 1.75, -1.05)));
      for (let i = 0; i < 3; i++) pl.add(ellipsoid(0.08, 0.3, 0.08, 6, 6), '#c0392b', T(-1.2 + i * 0.25, 2.25, -0.95));
      sack(pl, -1.3, 0, 1.3, 0.85);
      sack(pl, 1.4, 0, 1.25, 0.8);
      break;
    }
    case 'textile': {
      const cols = ['#e84393', '#6c5ce7', '#00b894', '#fdcb6e', '#0984e3', '#d63031'];
      // bolts of cloth lying on the counter
      row(4, (x, i) => pl.add(cyl(0.16, 0.16, 0.9, 10), cols[i], T(x, y + 0.16, 0.3, Math.PI / 2, 0, 0)));
      // drapes hanging from the awning
      for (let i = 0; i < 5; i++) pl.add(new THREE.BoxGeometry(0.55, 1.2, 0.03, 1, 4, 1), cols[(i + 2) % cols.length], T(-1.4 + i * 0.7, 2.15, -1.12, 0, 0, Math.sin(i) * 0.03));
      // folded clothes stack
      for (let i = 0; i < 4; i++) pl.add(roundBox(0.3, 0.05, 0.22, 3, 8, 4), cols[(i * 2) % cols.length], T(1.4, y + 0.05 + i * 0.1, 0.4));
      break;
    }
    case 'material':
      // logs, ingots, rope coils
      for (let i = 0; i < 3; i++) pl.add(cyl(0.14, 0.14, 1.2, 8), i % 2 ? '#a0522d' : '#8a5a33', T(-1.0, y + 0.14 + (i === 2 ? 0.24 : 0), 0.2 + (i === 2 ? 0.13 : i * 0.26), 0, 0, Math.PI / 2));
      for (let i = 0; i < 5; i++) pl.add(roundBox(0.18, 0.06, 0.08, 4, 8, 4), i < 3 ? '#9aa4ad' : '#c8813a', T(0.25 + (i % 3) * 0.38, y + 0.06 + (i > 2 ? 0.12 : 0), 0.35));
      for (let i = 0; i < 2; i++) pl.add(new THREE.TorusGeometry(0.22, 0.08, 6, 14), PAL.rope, T(1.3, y + 0.08 + i * 0.13, 0.3, Math.PI / 2, 0, 0));
      for (let i = 0; i < 3; i++) pl.add(new THREE.BoxGeometry(0.14, 1.9, 0.14), PAL.woodLight, T(1.95, 0.95, -0.4 + i * 0.25, 0, 0, -0.2));
      crate(pl, -1.4, 0, 1.4, 0.8, 0.2);
      break;
    case 'luxury':
      // velvet cloth with goblets, gem piles and a small chest
      pl.add(new THREE.BoxGeometry(STALL_W - 0.3, 0.03, 1.15), '#6c1f4f', T(0, y + 0.0, 0.32));
      row(4, (x, i) => {
        pl.add(lathe([[0, 0], [0.12, 0], [0.04, 0.05], [0.03, 0.2], [0.14, 0.32], [0.12, 0.36], [0, 0.3]], 10), PAL.gold, T(x, y + 0.02, 0.15 + (i % 2) * 0.2));
      });
      for (let i = 0; i < 7; i++) pl.add(new THREE.OctahedronGeometry(0.07, 0), ['#e84393', '#00cec9', '#fdcb6e', '#6c5ce7', '#55efc4'][i % 5], T(-0.6 + i * 0.18, y + 0.08, 0.6));
      pl.add(roundBox(0.3, 0.18, 0.2, 5), '#8b4f24', T(1.4, y + 0.18, 0.35));
      pl.add(roundBox(0.31, 0.06, 0.21, 3), PAL.gold, T(1.4, y + 0.38, 0.35));
      row(3, (x) => pl.add(new THREE.SphereGeometry(0.12, 10, 8), PAL.gold, T(x, 1.75, -1.05)));
      break;
    case 'general':
    case 'black':
      crate(pl, -1.2, y, 0.3, 0.5, 0.3);
      barrelAt(pl, -0.4, y, 0.35, 0.5);
      sack(pl, 0.3, y, 0.35, 0.6);
      for (let i = 0; i < 4; i++) pl.add(new THREE.IcosahedronGeometry(0.14, 1), ['#ffcc33', '#e74c3c', '#7bd05a', '#a560d8'][i], T(0.9 + (i % 2) * 0.3, y + 0.15, 0.25 + Math.floor(i / 2) * 0.3));
      pl.add(cyl(0.1, 0.1, 0.32, 8), '#c8813a', T(-1.0, 1.75, -1.05));
      pl.add(cyl(0.1, 0.1, 0.32, 8), '#7f8c8d', T(-0.6, 1.75, -1.05));
      pl.add(new THREE.TorusGeometry(0.2, 0.07, 6, 12), PAL.rope, T(0.8, 1.66, -1.05, Math.PI / 2, 0, 0));
      crate(pl, 1.5, 0, 1.4, 0.75, 0.4);
      barrelAt(pl, -1.6, 0, 1.3, 0.8);
      break;
  }
  void rng;
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------
export function roundTable(pl: Placer, glow: Placer, rng: () => number) {
  pl.add(cyl(0.95, 0.95, 0.12, 14), PAL.woodLight, T(0, 0.92, 0));
  pl.add(cyl(0.12, 0.16, 0.86, 8), PAL.woodDark, T(0, 0.45, 0));
  pl.add(cyl(0.5, 0.55, 0.08, 10), PAL.woodDark, T(0, 0.04, 0));
  // mugs, plate, candle
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    pl.add(cyl(0.09, 0.08, 0.2, 8), '#8a5a33', T(Math.cos(a) * 0.55, 1.08, Math.sin(a) * 0.55));
    pl.add(cyl(0.075, 0.075, 0.02, 8), '#fff3c8', T(Math.cos(a) * 0.55, 1.19, Math.sin(a) * 0.55));
  }
  pl.add(cyl(0.25, 0.2, 0.04, 12), '#eef2f5', T(-0.15, 1.0, 0.1));
  pl.add(cyl(0.05, 0.05, 0.2, 6), '#f6efe2', T(0.1, 1.08, -0.2));
  glow.add(new THREE.ConeGeometry(0.05, 0.12, 6), '#ffffff', T(0.1, 1.24, -0.2));
}

export function chair(pl: Placer) {
  pl.add(new THREE.BoxGeometry(0.6, 0.08, 0.6), PAL.wood, T(0, 0.48, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pl.add(new THREE.BoxGeometry(0.07, 0.48, 0.07), PAL.woodDark, T(sx * 0.25, 0.24, sz * 0.25));
  pl.add(new THREE.BoxGeometry(0.6, 0.6, 0.07), PAL.wood, T(0, 0.85, -0.27));
}

export function stool(pl: Placer) {
  pl.add(cyl(0.28, 0.28, 0.08, 10), PAL.woodLight, T(0, 0.68, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    pl.add(cyl(0.04, 0.05, 0.68, 5), PAL.woodDark, T(Math.cos(a) * 0.16, 0.34, Math.sin(a) * 0.16, Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12));
  }
}

/** Bar counter along local X (length L), bartender side at -Z. */
export function barCounter(pl: Placer, glow: Placer, L: number, rng: () => number) {
  pl.add(new THREE.BoxGeometry(L, 1.1, 0.9), '#7a4422', T(0, 0.55, 0));
  pl.add(new THREE.BoxGeometry(L + 0.3, 0.12, 1.15), PAL.woodLight, T(0, 1.16, 0.05));
  pl.add(new THREE.BoxGeometry(L, 0.1, 0.12), PAL.brass, T(0, 0.2, 0.5));
  for (let i = 0; i < Math.floor(L / 0.9); i++) pl.add(new THREE.BoxGeometry(0.06, 0.9, 0.04), '#5a3018', T(-L / 2 + 0.45 + i * 0.9, 0.55, 0.47));
  // taps + mugs
  for (let i = 0; i < 3; i++) {
    pl.add(cyl(0.04, 0.04, 0.35, 6), PAL.brass, T(-L / 2 + 1 + i * 0.35, 1.38, -0.15));
    pl.add(cyl(0.09, 0.08, 0.2, 8), '#8a5a33', T(L / 2 - 1.2 + i * 0.3, 1.32, 0.15 - rng() * 0.2));
  }
  void glow;
}

export function bottleShelf(pl: Placer, glow: Placer, L: number, rng: () => number) {
  for (let r = 0; r < 3; r++) {
    pl.add(new THREE.BoxGeometry(L, 0.08, 0.4), PAL.woodDark, T(0, 1.4 + r * 0.7, 0));
    for (let i = 0; i < Math.floor(L / 0.32); i++) {
      if (rng() < 0.2) continue;
      const col = ['#2e8b57', '#8b2e2e', '#c8a24a', '#4a6ab0', '#6b3e1e'][Math.floor(rng() * 5)];
      const x = -L / 2 + 0.2 + i * 0.32;
      pl.add(cyl(0.07, 0.08, 0.3, 7), col, T(x, 1.6 + r * 0.7, 0));
      pl.add(cyl(0.025, 0.03, 0.12, 5), col, T(x, 1.81 + r * 0.7, 0));
      if (rng() < 0.12) glow.add(new THREE.SphereGeometry(0.06, 6, 4), '#ffffff', T(x, 1.62 + r * 0.7, 0.02));
    }
  }
}

/** Stone fireplace against a wall (front = +Z). Returns the local fire position. */
export function fireplace(stone: Placer, glow: Placer) {
  stone.add(new THREE.BoxGeometry(2.6, 2.6, 1.0), '#8d8580', T(0, 1.3, -0.1), true);
  stone.add(new THREE.BoxGeometry(3.0, 0.3, 1.3), '#6d6560', T(0, 2.7, 0), true);
  stone.add(new THREE.BoxGeometry(1.6, 1.3, 0.6), '#2a2220', T(0, 0.8, 0.2));
  for (let i = 0; i < 3; i++) stone.add(cyl(0.1, 0.1, 1.0, 6), '#6b3e1e', T(-0.3 + i * 0.3, 0.35, 0.4, 0, 0.4 * i, Math.PI / 2));
  glow.add(new THREE.ConeGeometry(0.35, 0.8, 7), '#ffffff', T(-0.15, 0.75, 0.45));
  glow.add(new THREE.ConeGeometry(0.28, 0.6, 7), '#ffffff', T(0.25, 0.65, 0.45));
  return V(0, 0.8, 0.6);
}

/** Notice board with pinned contracts (front = +Z). */
export function noticeBoard(pl: Placer, wallMounted = false) {
  if (!wallMounted) for (const sx of [-1, 1]) pl.add(cyl(0.09, 0.1, 2.6, 6), PAL.woodDark, T(sx * 0.95, 1.3, 0));
  pl.add(new THREE.BoxGeometry(2.1, 1.4, 0.12), '#8a5a33', T(0, 1.75, 0));
  pl.add(new THREE.BoxGeometry(2.3, 0.14, 0.18), PAL.woodDark, T(0, 2.5, 0));
  const papers = ['#f6efe2', '#fff3c8', '#f2e2c0', '#fbe9d0', '#efe3cc'];
  for (let i = 0; i < 5; i++) pl.add(new THREE.BoxGeometry(0.42, 0.52, 0.02), papers[i], T(-0.75 + (i % 3) * 0.72, 1.95 - Math.floor(i / 3) * 0.6, 0.08, 0, 0, (i % 2 ? 1 : -1) * 0.06));
  for (let i = 0; i < 5; i++) pl.add(new THREE.SphereGeometry(0.03, 5, 4), '#c0392b', T(-0.75 + (i % 3) * 0.72, 2.17 - Math.floor(i / 3) * 0.6, 0.1));
  if (!wallMounted) pl.add(new THREE.ConeGeometry(1.5, 0.5, 4), '#7a2a1e', T(0, 2.85, 0, 0, Math.PI / 4, 0, 1, 1, 0.45));
}

export function cannonballPile(pl: Placer, x: number, z: number) {
  const r = 0.18;
  for (let lv = 0; lv < 3; lv++)
    for (let i = 0; i < 3 - lv; i++)
      for (let j = 0; j < 3 - lv; j++) pl.add(new THREE.SphereGeometry(r, 8, 6), PAL.ironDark, T(x + (i - (2 - lv) / 2) * r * 2, r + lv * r * 1.6, z + (j - (2 - lv) / 2) * r * 2));
}

export function weaponRack(pl: Placer) {
  pl.add(new THREE.BoxGeometry(2.4, 0.12, 0.2), PAL.woodDark, T(0, 1.9, 0));
  pl.add(new THREE.BoxGeometry(2.4, 0.12, 0.2), PAL.woodDark, T(0, 0.9, 0));
  for (let i = 0; i < 5; i++) {
    const x = -0.9 + i * 0.45;
    pl.add(new THREE.BoxGeometry(0.07, 1.1, 0.02), '#dfe6ee', T(x, 1.45, 0.12, 0, 0, 0.08));
    pl.add(new THREE.BoxGeometry(0.22, 0.05, 0.06), PAL.gold, T(x - 0.04, 2.0, 0.12));
  }
}

export function powderKeg(pl: Placer, x: number, z: number, s = 0.8) {
  barrelAt(pl, x, 0, z, s);
  pl.add(new THREE.BoxGeometry(0.06, 0.3, 0.02), '#d63031', T(x, s * 0.55, z + s * 0.53, 0, 0, 0.7));
  pl.add(new THREE.BoxGeometry(0.06, 0.3, 0.02), '#d63031', T(x, s * 0.55, z + s * 0.53, 0, 0, -0.7));
}

export function rug(pl: Placer, w: number, d: number, a: string, b: string) {
  pl.add(new THREE.BoxGeometry(w, 0.03, d, 8, 1, 6), (c) => (Math.abs(c.x) > w / 2 - 0.25 || Math.abs(c.z) > d / 2 - 0.25 ? b : Math.floor((c.x + c.z + 20) * 1.2) % 2 ? a : new THREE.Color(a).multiplyScalar(0.85)), T(0, 0.02, 0));
}

// ---------------------------------------------------------------------------
// Shipwright
// ---------------------------------------------------------------------------
/** Ship ribs on a slipway (bow toward +Z). */
export function hullFrame(pl: Placer, len = 9) {
  pl.add(new THREE.BoxGeometry(0.35, 0.35, len), '#7a4a2a', T(0, 0.6, 0));
  for (let i = 0; i < 7; i++) {
    const z = -len / 2 + 0.8 + i * ((len - 1.6) / 6);
    const k = 1 - Math.pow(Math.abs(z) / (len / 2), 2) * 0.55;
    pl.add(new THREE.TorusGeometry(1.6 * k, 0.1, 5, 12, Math.PI), '#a0683a', T(0, 2.35 * k + 0.4, z, Math.PI, 0, 0, 1, 1.3, 1));
  }
  // a few hull planks already fitted
  for (let r = 0; r < 3; r++)
    for (const sx of [-1, 1]) pl.add(new THREE.BoxGeometry(0.1, 0.28, len * 0.75), r % 2 ? '#b07a4a' : '#9a6a40', T(sx * (0.7 + r * 0.32), 0.85 + r * 0.33, 0, 0, 0, sx * (0.6 - r * 0.15)));
  // supports
  for (const sx of [-1, 1]) for (const z of [-len * 0.3, 0, len * 0.3]) pl.add(new THREE.BoxGeometry(0.15, 1.6, 0.15), PAL.woodDark, T(sx * 1.6, 0.8, z, 0, 0, sx * 0.4));
}

export function sawHorse(pl: Placer) {
  for (const sx of [-1, 1]) {
    pl.add(new THREE.BoxGeometry(0.08, 0.95, 0.08), PAL.woodDark, T(sx * 0.6, 0.45, 0.18, -0.25, 0, 0));
    pl.add(new THREE.BoxGeometry(0.08, 0.95, 0.08), PAL.woodDark, T(sx * 0.6, 0.45, -0.18, 0.25, 0, 0));
  }
  pl.add(new THREE.BoxGeometry(1.5, 0.12, 0.12), PAL.wood, T(0, 0.9, 0));
  pl.add(new THREE.BoxGeometry(2.2, 0.08, 0.35), PAL.woodLight, T(0.2, 1.0, 0, 0, 0.1, 0));
}

export function workbench(pl: Placer) {
  pl.add(new THREE.BoxGeometry(2.6, 0.15, 1.0), PAL.woodLight, T(0, 1.0, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pl.add(new THREE.BoxGeometry(0.12, 1.0, 0.12), PAL.woodDark, T(sx * 1.15, 0.5, sz * 0.4));
  pl.add(new THREE.BoxGeometry(2.4, 0.08, 0.8), PAL.woodDark, T(0, 0.3, 0));
  // tools
  pl.add(new THREE.BoxGeometry(0.5, 0.04, 0.12), '#c9c9cf', T(-0.6, 1.1, 0.1, 0, 0.3, 0));
  pl.add(cyl(0.03, 0.03, 0.35, 6), PAL.woodLight, T(0.3, 1.1, -0.1, 0, 0, Math.PI / 2));
  pl.add(roundBox(0.06, 0.06, 0.12, 4, 8, 6), PAL.iron, T(0.5, 1.12, -0.1));
  for (let i = 0; i < 3; i++) pl.add(cyl(0.1, 0.1, 0.18, 8), ['#d63031', '#0984e3', '#fdcb6e'][i], T(0.9 + i * 0.22, 1.17, 0.25));
}

export function anchorGeo(pl: Placer) {
  pl.add(cyl(0.08, 0.08, 2.0, 8), PAL.ironDark, T(0, 1.0, 0));
  pl.add(new THREE.TorusGeometry(0.22, 0.06, 6, 12), PAL.ironDark, T(0, 2.15, 0));
  pl.add(new THREE.TorusGeometry(0.75, 0.09, 6, 16, Math.PI), PAL.ironDark, T(0, 0.75, 0, Math.PI, 0, 0));
  pl.add(new THREE.BoxGeometry(1.1, 0.12, 0.12), PAL.ironDark, T(0, 1.7, 0));
  for (const sx of [-1, 1]) pl.add(new THREE.ConeGeometry(0.16, 0.35, 4), PAL.ironDark, T(sx * 0.75, 0.88, 0, 0, 0, sx * 0.6));
}

export function ropeCoil(pl: Placer, x: number, y: number, z: number, s = 1) {
  for (let i = 0; i < 3; i++) pl.add(new THREE.TorusGeometry(0.32 * s, 0.07 * s, 5, 14), PAL.rope, T(x, y + 0.07 * s + i * 0.1 * s, z, Math.PI / 2, 0, 0, 1 - i * 0.12));
}

// ---------------------------------------------------------------------------
// Waterfront & fishing
// ---------------------------------------------------------------------------
/** Little rowing boat (bow toward +Z), sitting at y = 0. */
export function rowboat(pl: Placer, color = '#3f7fd0', oars = true) {
  const hull = lathe([[0, -0.45], [0.55, -0.35], [0.75, 0], [0.8, 0.12], [0, 0.12]], 14);
  pl.add(hull, (c) => (c.y > -0.05 ? color : '#f4efe4'), T(0, 0.45, 0, 0, 0, 0, 1, 1, 2.4));
  pl.add(new THREE.BoxGeometry(1.2, 0.06, 0.3), PAL.woodLight, T(0, 0.45, 0.3));
  pl.add(new THREE.BoxGeometry(1.0, 0.06, 0.3), PAL.woodLight, T(0, 0.45, -0.9));
  pl.add(cyl(0.6, 0.6, 0.06, 12), '#8a5a33', T(0, 0.12, 0, 0, 0, 0, 1, 1, 2.3));
  if (oars)
    for (const sx of [-1, 1]) {
      pl.add(cyl(0.035, 0.035, 2.0, 5), PAL.woodLight, T(sx * 0.55, 0.62, -0.1, Math.PI / 2 - 0.15, 0, sx * 0.25));
      pl.add(new THREE.BoxGeometry(0.2, 0.03, 0.55), PAL.woodLight, T(sx * 0.62, 0.48, -1.0, 0.1, 0, 0));
    }
}

/** Fishing net draped between two poles (front = +Z), width w. */
export function netGeo(pl: Placer, w = 3, h = 1.8) {
  for (const sx of [-1, 1]) pl.add(cyl(0.07, 0.08, h + 0.6, 6), PAL.woodDark, T((sx * w) / 2, (h + 0.6) / 2, 0));
  const nx = Math.round(w / 0.3);
  const ny = Math.round(h / 0.3);
  const sag = (x: number) => Math.sin((x / w + 0.5) * Math.PI) * 0.25;
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (i / nx) * w;
    pl.add(beam(V(x, h + 0.5 - sag(x), 0), V(x, 0.5, 0.05), 0.012, 3), '#6d8f86');
  }
  for (let j = 0; j <= ny; j++) {
    const y = 0.5 + (j / ny) * h;
    for (let i = 0; i < nx; i++) {
      const x0 = -w / 2 + (i / nx) * w;
      const x1 = -w / 2 + ((i + 1) / nx) * w;
      const k = (y - 0.5) / h;
      pl.add(beam(V(x0, y - sag(x0) * k, 0.02), V(x1, y - sag(x1) * k, 0.02), 0.012, 3), '#6d8f86');
    }
  }
  // floats
  for (let i = 0; i < 4; i++) pl.add(new THREE.SphereGeometry(0.1, 6, 5), '#ff7043', T(-w / 2 + 0.4 + i * ((w - 0.8) / 3), h + 0.45 - sag(-w / 2 + 0.4 + i * ((w - 0.8) / 3)), 0.05));
}

export function dryingRack(pl: Placer, w = 3) {
  for (const sx of [-1, 1]) {
    pl.add(new THREE.BoxGeometry(0.1, 2.2, 0.1), PAL.woodDark, T((sx * w) / 2, 1.1, 0.3, -0.15, 0, 0));
    pl.add(new THREE.BoxGeometry(0.1, 2.2, 0.1), PAL.woodDark, T((sx * w) / 2, 1.1, -0.3, 0.15, 0, 0));
  }
  pl.add(cyl(0.05, 0.05, w + 0.3, 6), PAL.wood, T(0, 2.05, 0, 0, 0, Math.PI / 2));
  const n = Math.round(w / 0.35);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.2 + i * ((w - 0.4) / (n - 1));
    pl.add(beam(V(x, 2.05, 0), V(x, 1.75, 0), 0.01, 3), PAL.rope);
    pl.add(ellipsoid(0.07, 0.26, 0.04, 8, 6), i % 2 ? '#a9b8c4' : '#c9d3db', T(x, 1.52, 0));
    pl.add(new THREE.ConeGeometry(0.08, 0.14, 4), '#8fa2b0', T(x, 1.22, 0, Math.PI, 0, 0, 1, 1, 0.4));
  }
}

export function fishBasket(pl: Placer, x: number, z: number) {
  pl.add(lathe([[0, 0], [0.32, 0], [0.38, 0.35], [0.36, 0.38], [0, 0.38]], 10), '#c9a45a', T(x, 0, z));
  for (let i = 0; i < 4; i++) pl.add(ellipsoid(0.06, 0.05, 0.22, 6, 5), '#b0c4d4', T(x - 0.15 + i * 0.1, 0.4, z, 0, i, 0.3));
}

// ---------------------------------------------------------------------------
// Town decoration
// ---------------------------------------------------------------------------
export function fountain(stone: Placer, glow: Placer, gold = false) {
  stone.add(lathe([[0, 0], [2.6, 0], [2.7, 0.2], [2.7, 0.75], [2.45, 0.8], [2.4, 0.3], [0, 0.3]], 24), '#d9d2c5', T(0, 0, 0), true);
  stone.add(cyl(2.38, 2.38, 0.05, 24), '#5fc9d6', T(0, 0.62, 0));
  stone.add(cyl(0.35, 0.5, 1.8, 10), '#cfc8bb', T(0, 1.2, 0), true);
  stone.add(lathe([[0, 0], [1.1, 0.05], [1.2, 0.3], [0, 0.25]], 18), '#d9d2c5', T(0, 2.0, 0), true);
  stone.add(cyl(1.0, 1.0, 0.04, 16), '#5fc9d6', T(0, 2.26, 0));
  stone.add(new THREE.SphereGeometry(0.32, 10, 8), gold ? PAL.gold : '#cfc8bb', T(0, 2.55, 0));
  void glow;
}

export function well(pl: Placer, stone: Placer) {
  stone.add(lathe([[0.75, 0], [0.95, 0], [0.95, 0.85], [0.75, 0.85]], 14), '#9c9088', T(0, 0, 0), true);
  stone.add(cyl(0.76, 0.76, 0.05, 14), '#1d3b4a', T(0, 0.6, 0));
  for (const sx of [-1, 1]) pl.add(new THREE.BoxGeometry(0.15, 2.2, 0.15), PAL.woodDark, T(sx * 0.85, 1.1, 0));
  pl.add(cyl(0.08, 0.08, 2.0, 6), PAL.wood, T(0, 1.85, 0, 0, 0, Math.PI / 2));
  pl.add(new THREE.ConeGeometry(1.4, 0.8, 4), '#a0482a', T(0, 2.6, 0, 0, Math.PI / 4, 0, 1, 1, 0.7));
  pl.add(lathe([[0, 0], [0.18, 0], [0.2, 0.28], [0, 0.28]], 8), '#8a5a33', T(0.3, 1.2, 0));
}

export function planter(pl: Placer, leaves: Placer, w = 2.2, seed = 1) {
  const rng = mulberry32(seed);
  pl.add(new THREE.BoxGeometry(w, 0.6, 0.8), '#e9dfcf', T(0, 0.3, 0));
  pl.add(new THREE.BoxGeometry(w + 0.1, 0.1, 0.9), PAL.gold, T(0, 0.62, 0));
  for (let i = 0; i < Math.round(w * 2); i++) {
    const x = -w / 2 + 0.25 + i * 0.5;
    leaves.add(new THREE.IcosahedronGeometry(0.32, 1), PAL.leaf, T(x, 0.85, 0, 0, 0, 0, 1, 0.8, 1), true);
    leaves.add(new THREE.IcosahedronGeometry(0.1, 0), ['#ff6f91', '#ffd34d', '#ffffff', '#c56cf0'][Math.floor(rng() * 4)], T(x + 0.1, 1.12, 0.12), true);
  }
}

export function lampPost(pl: Placer, glow: Placer, fancy = false) {
  pl.add(cyl(0.1, 0.14, 3.4, 8), fancy ? '#2c3e50' : PAL.woodDark, T(0, 1.7, 0));
  pl.add(cyl(0.22, 0.26, 0.25, 8), fancy ? '#2c3e50' : PAL.ironDark, T(0, 0.12, 0));
  lantern(pl, glow, 0, 3.75, 0, 1.15);
  if (fancy) pl.add(new THREE.SphereGeometry(0.1, 8, 6), PAL.gold, T(0, 4.4, 0));
}

export function tikiTorch(pl: Placer, glow: Placer, h = 2.4) {
  pl.add(cyl(0.07, 0.09, h, 6), '#a07a3a', T(0, h / 2, 0));
  pl.add(lathe([[0, 0], [0.16, 0.0], [0.22, 0.28], [0, 0.28]], 8), '#5a3a1a', T(0, h, 0));
  glow.add(new THREE.ConeGeometry(0.16, 0.45, 7), '#ffffff', T(0, h + 0.5, 0));
}

/** Little coloured flag triangles strung between two points. */
export function bunting(leaves: Placer, a: THREE.Vector3, b: THREE.Vector3, seed = 1) {
  const n = Math.max(3, Math.round(a.distanceTo(b) / 0.8));
  const cols = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#ffffff', '#9b59b6'];
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.25, 0, 0, 0.25, 0, 0, 0, -0.5, 0], 3));
  tri.computeVertexNormals();
  const dir = b.clone().sub(a);
  const yaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * 0.6;
    leaves.add(tri, cols[(i + seed) % cols.length], T(p.x, p.y, p.z, 0, yaw, 0));
  }
  leaves.add(beam(a, a.clone().lerp(b, 0.5).setY((a.y + b.y) / 2 - 0.62), 0.015, 3), PAL.rope);
  leaves.add(beam(a.clone().lerp(b, 0.5).setY((a.y + b.y) / 2 - 0.62), b, 0.015, 3), PAL.rope);
}

/** Flat tiled paving (lies on y = 0). */
export function paving(gb: Placer, w: number, d: number, a: string, b: string, tile = 1.2, round = false) {
  const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / tile)), Math.max(1, Math.round(d / tile)));
  g.rotateX(-Math.PI / 2);
  if (round) {
    // clip to an ellipse by squashing outer vertices in
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / (w / 2);
      const z = p.getZ(i) / (d / 2);
      const r = Math.hypot(x, z);
      if (r > 1) {
        p.setX(i, p.getX(i) / r);
        p.setZ(i, p.getZ(i) / r);
      }
    }
  }
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  const tmp = new THREE.Color();
  gb.add(g, (c) => {
    const ix = Math.floor((c.x + w) / tile);
    const iz = Math.floor((c.z + d) / tile);
    const h = Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453;
    const n = h - Math.floor(h);
    return tmp.copy((ix + iz) % 2 ? ca : cb).multiplyScalar(0.92 + n * 0.12);
  });
}

/** Wooden boardwalk deck (top at y = 0). */
export function boardwalk(pl: Placer, w: number, d: number) {
  for (let x = -w / 2; x < w / 2 - 0.01; x += 0.55) {
    const i = Math.round(x / 0.55);
    pl.add(new THREE.BoxGeometry(0.52, 0.14, d), i % 3 === 0 ? PAL.woodLight : i % 3 === 1 ? PAL.plank : '#a77447', T(x + 0.27, -0.07, 0));
  }
  for (const sz of [-1, 1]) pl.add(new THREE.BoxGeometry(w, 0.25, 0.22), PAL.woodDark, T(0, -0.2, (sz * d) / 2));
}

export function statuePlinth(stone: Placer) {
  stone.add(new THREE.BoxGeometry(2.2, 0.5, 2.2), '#cfc8bb', T(0, 0.25, 0), true);
  stone.add(new THREE.BoxGeometry(1.6, 1.4, 1.6), '#e2dccf', T(0, 1.2, 0), true);
  stone.add(new THREE.BoxGeometry(1.9, 0.25, 1.9), '#cfc8bb', T(0, 2.0, 0), true);
}

export function totem(pl: Placer) {
  const cols = ['#c0392b', '#f1c40f', '#16a085', '#2e86c1'];
  for (let i = 0; i < 4; i++) {
    pl.add(roundBox(0.45, 0.42, 0.45, 3), cols[i], T(0, 0.45 + i * 0.85, 0));
    pl.add(roundBox(0.12, 0.08, 0.05, 3), '#ffffff', T(-0.16, 0.55 + i * 0.85, 0.44));
    pl.add(roundBox(0.12, 0.08, 0.05, 3), '#ffffff', T(0.16, 0.55 + i * 0.85, 0.44));
    pl.add(roundBox(0.22, 0.06, 0.05, 3), '#1d1426', T(0, 0.3 + i * 0.85, 0.44));
  }
  for (const sx of [-1, 1]) pl.add(roundBox(0.6, 0.12, 0.3, 3), '#f39c12', T(sx * 0.7, 3.2, 0, 0, 0, sx * 0.3));
}

export function campfire(stone: Placer, glow: Placer) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    stone.add(new THREE.IcosahedronGeometry(0.22, 0), '#7c7068', T(Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7), true);
  }
  for (let i = 0; i < 4; i++) stone.add(cyl(0.08, 0.08, 1.0, 6), '#6b3e1e', T(0, 0.25, 0, Math.PI / 2 - 0.3, (i / 4) * Math.PI * 2, 0));
  glow.add(new THREE.ConeGeometry(0.4, 1.0, 7), '#ffffff', T(0, 0.65, 0));
}

export function hammock(pl: Placer, a: THREE.Vector3, b: THREE.Vector3) {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= 0.7;
  pl.add(beam(a, mid, 0.18, 6), '#f39c12');
  pl.add(beam(mid, b, 0.18, 6), '#f39c12');
}

export function barrelStack(pl: Placer, x: number, z: number, rng: () => number) {
  for (let i = 0; i < 3; i++) barrelAt(pl, x + (i - 1) * 0.95, 0, z, 0.85);
  barrelAt(pl, x - 0.45, 0.93, z, 0.85);
  barrelAt(pl, x + 0.45, 0.93, z, 0.85);
  void rng;
}

export function crateStack(pl: Placer, x: number, z: number, rng: () => number, n = 4) {
  for (let i = 0; i < n; i++) {
    const s = 0.85 + rng() * 0.35;
    const lv = i >= 3 ? 1 : 0;
    crate(pl, x + ((i % 3) - 1) * 1.05 * (lv ? 0.5 : 1), lv * 1.0, z + (rng() - 0.5) * 0.3, s, rng() * 0.4);
  }
}

export { barrel };

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------
const signCache = new Map<string, THREE.Texture>();
export function signTexture(text: string, icon = '', bg = '#6b3e1e', fg = '#ffe6a8') {
  const key = text + icon + bg + fg;
  let t = signCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(4, 4, 504, 152, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 3;
  for (let y = 40; y < 160; y += 38) {
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.lineTo(502, y);
    ctx.stroke();
  }
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(30,15,5,0.85)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 144, 22);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 62;
  ctx.font = `${size}px "Lilita One", Impact, sans-serif`;
  const label = text;
  const iconW = icon ? 74 : 0;
  while (ctx.measureText(label).width + iconW > 460 && size > 30) {
    size -= 2;
    ctx.font = `${size}px "Lilita One", Impact, sans-serif`;
  }
  const tw = ctx.measureText(label).width + iconW;
  const x0 = 256 - tw / 2;
  if (icon) {
    ctx.font = `58px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.fillText(icon, x0 + 32, 84);
    ctx.font = `${size}px "Lilita One", Impact, sans-serif`;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillText(label, x0 + iconW + (tw - iconW) / 2 + 4, 88);
  ctx.fillStyle = fg;
  ctx.fillText(label, x0 + iconW + (tw - iconW) / 2, 84);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  signCache.set(key, t);
  return t;
}

const signGeo = new THREE.PlaneGeometry(1, 0.3125);
/** Double-sided hanging sign mesh (1 unit wide; scale for size). */
export function signMesh(text: string, icon: string, width: number, bg?: string, fg?: string) {
  const mat = new THREE.MeshStandardMaterial({ map: signTexture(text, icon, bg, fg), roughness: 0.8, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.05, emissiveMap: signTexture(text, icon, bg, fg) });
  const m = new THREE.Mesh(signGeo, mat);
  m.scale.setScalar(width);
  return m;
}

export { cannonGeo };
