import * as THREE from 'three';
import type { BoxCol, CircleCol, Platform } from './TownTypes';
import { groundHeight } from './Islands';

/** Terrain lower than this counts as water (you can't wade out to sea). */
export const SHORE_Y = 0.35;

const CELL = 8;
const key = (i: number, j: number) => i * 100003 + j;

/**
 * Walkable ground + collision for one explorable island: terrain, pier decks, floors and ramps,
 * plus box/circle obstacles (buildings, stalls, trunks…). Shared by the walking player,
 * the NPC navigation grid and the camera.
 */
export class LandArea {
  private grid = new Map<number, { boxes: BoxCol[]; circles: CircleCol[]; plats: Platform[] }>();

  constructor(
    public boxes: BoxCol[],
    public circles: CircleCol[],
    public platforms: Platform[],
  ) {
    for (const b of boxes) this.insert(b.x, b.z, Math.hypot(b.hx, b.hz), (c) => c.boxes.push(b));
    for (const c of circles) this.insert(c.x, c.z, c.r, (cell) => cell.circles.push(c));
    for (const p of platforms) this.insert(p.x, p.z, Math.hypot(p.hx, p.hz), (c) => c.plats.push(p));
  }

  /** Add an obstacle after construction (encounter sites built later). */
  addBox(b: BoxCol) {
    this.boxes.push(b);
    this.insert(b.x, b.z, Math.hypot(b.hx, b.hz), (c) => c.boxes.push(b));
  }
  addCircle(ci: CircleCol) {
    this.circles.push(ci);
    this.insert(ci.x, ci.z, ci.r, (c) => c.circles.push(ci));
  }

  private insert(x: number, z: number, r: number, fn: (c: { boxes: BoxCol[]; circles: CircleCol[]; plats: Platform[] }) => void) {
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const k = key(i, j);
        let c = this.grid.get(k);
        if (!c) this.grid.set(k, (c = { boxes: [], circles: [], plats: [] }));
        fn(c);
      }
  }

  private cell(x: number, z: number) {
    return this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  }

  /** Local coords of a point relative to an oriented rectangle. */
  static local(r: { x: number; z: number; rot: number }, x: number, z: number) {
    const dx = x - r.x;
    const dz = z - r.z;
    const c = Math.cos(r.rot);
    const s = Math.sin(r.rot);
    return { lx: dx * c - dz * s, lz: dx * s + dz * c };
  }

  /** Height of a platform at xz (null if outside). */
  static platformY(p: Platform, x: number, z: number) {
    const { lx, lz } = LandArea.local(p, x, z);
    if (Math.abs(lx) > p.hx || Math.abs(lz) > p.hz) return null;
    if (p.y2 === undefined) return p.y;
    return p.y + ((lz + p.hz) / (2 * p.hz)) * (p.y2 - p.y);
  }

  /**
   * Surface to stand on at xz: the highest one no more than `step` above `fromY`.
   * Returns null over open water.
   */
  surface(x: number, z: number, fromY = 999, step = 0.6): number | null {
    let best: number | null = null;
    const t = groundHeight(x, z);
    if (t >= SHORE_Y && t <= fromY + step) best = t;
    let anyAbove = t >= SHORE_Y && t > fromY + step;
    const c = this.cell(x, z);
    if (c)
      for (const p of c.plats) {
        const y = LandArea.platformY(p, x, z);
        if (y === null) continue;
        if (y <= fromY + step) {
          if (best === null || y > best) best = y;
        } else anyAbove = true;
      }
    if (best === null && anyAbove) return null;
    return best;
  }

  /** Is a circle of radius r overlapping an obstacle? */
  blocked(x: number, z: number, r: number) {
    const c = this.cell(x, z);
    if (!c) return false;
    for (const b of c.boxes) {
      const { lx, lz } = LandArea.local(b, x, z);
      if (Math.abs(lx) < b.hx + r && Math.abs(lz) < b.hz + r) {
        const qx = Math.max(Math.abs(lx) - b.hx, 0);
        const qz = Math.max(Math.abs(lz) - b.hz, 0);
        if (qx * qx + qz * qz < r * r) return true;
      }
    }
    for (const ci of c.circles) {
      const d = Math.hypot(x - ci.x, z - ci.z);
      if (d < ci.r + r) return true;
    }
    return false;
  }

  /** Walkable for a person standing here (dry land or deck, not inside an obstacle). */
  walkable(x: number, z: number, r = 0.4) {
    return this.surface(x, z) !== null && !this.blocked(x, z, r);
  }

  /** Clear straight line between two points (sampled). */
  clearLine(a: THREE.Vector3, b: THREE.Vector3, r = 0.35, stepLen = 0.6) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / stepLen));
    let prevY = a.y;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (this.blocked(x, z, r)) return false;
      const y = this.surface(x, z, prevY, 0.7);
      if (y === null || Math.abs(y - prevY) > 0.7) return false;
      prevY = y;
    }
    return true;
  }

  /** Push a circle out of every obstacle it overlaps (2D). */
  resolve(pos: THREE.Vector3, r: number, extra: CircleCol[] = []) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const c = this.cell(pos.x, pos.z);
      if (c) {
        for (const b of c.boxes) if (this.pushBox(pos, b, r)) moved = true;
        for (const ci of c.circles) if (this.pushCircle(pos, ci, r)) moved = true;
      }
      for (const ci of extra) if (this.pushCircle(pos, ci, r)) moved = true;
      if (!moved) break;
    }
  }

  private pushCircle(pos: THREE.Vector3, c: CircleCol, r: number) {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + r;
    if (d >= min) return false;
    if (d < 1e-4) {
      pos.x += min;
      return true;
    }
    pos.x = c.x + (dx / d) * min;
    pos.z = c.z + (dz / d) * min;
    return true;
  }

  private pushBox(pos: THREE.Vector3, b: BoxCol, r: number) {
    const { lx, lz } = LandArea.local(b, pos.x, pos.z);
    if (Math.abs(lx) >= b.hx + r || Math.abs(lz) >= b.hz + r) return false;
    let nx: number;
    let nz: number;
    const cx = Math.max(-b.hx, Math.min(b.hx, lx));
    const cz = Math.max(-b.hz, Math.min(b.hz, lz));
    const dx = lx - cx;
    const dz = lz - cz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-5) {
      if (d >= r) return false;
      nx = cx + (dx / d) * r;
      nz = cz + (dz / d) * r;
    } else {
      // centre inside the box: leave by the nearest face
      const px = b.hx - Math.abs(lx);
      const pz = b.hz - Math.abs(lz);
      if (px < pz) {
        nx = Math.sign(lx || 1) * (b.hx + r);
        nz = lz;
      } else {
        nx = lx;
        nz = Math.sign(lz || 1) * (b.hz + r);
      }
    }
    // back to world
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    pos.x = b.x + nx * c + nz * s;
    pos.z = b.z - nx * s + nz * c;
    return true;
  }
}
