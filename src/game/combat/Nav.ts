import * as THREE from 'three';
import type { LandArea } from '../../world/LandArea';

const CELL = 1;
const MAX_CELLS = 90 * 90;

/** Tiny binary min-heap of cell indices keyed by cost. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.v.length;
  }
  push(v: number, k: number) {
    const a = this.k;
    const b = this.v;
    a.push(k);
    b.push(v);
    let i = b.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= a[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [b[p], b[i]] = [b[i], b[p]];
      i = p;
    }
  }
  pop() {
    const a = this.k;
    const b = this.v;
    const top = b[0];
    const lk = a.pop()!;
    const lv = b.pop()!;
    if (b.length) {
      a[0] = lk;
      b[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < b.length && a[l] < a[m]) m = l;
        if (r < b.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [b[m], b[i]] = [b[i], b[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over a 1 m grid laid across the box between two points (with a margin), for when a
 * fighter can't walk straight at its goal (boulders, tents, walls, cliffs). Returns waypoints
 * after string-pulling, or null if there's no way through.
 */
export function gridPath(area: LandArea, from: THREE.Vector3, to: THREE.Vector3, margin = 12): THREE.Vector3[] | null {
  const minX = Math.min(from.x, to.x) - margin;
  const minZ = Math.min(from.z, to.z) - margin;
  const W = Math.ceil((Math.max(from.x, to.x) + margin - minX) / CELL);
  const H = Math.ceil((Math.max(from.z, to.z) + margin - minZ) / CELL);
  if (W * H > MAX_CELLS) return null;
  const walk = new Int8Array(W * H).fill(-1);
  const hgt = new Float32Array(W * H);
  const ok = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const k = j * W + i;
    if (walk[k] === -1) {
      const x = minX + (i + 0.5) * CELL;
      const z = minZ + (j + 0.5) * CELL;
      const y = area.surface(x, z);
      walk[k] = y !== null && !area.blocked(x, z, 0.45) ? 1 : 0;
      hgt[k] = y ?? 0;
    }
    return walk[k] === 1;
  };
  const ci = (x: number) => Math.min(W - 1, Math.max(0, Math.floor((x - minX) / CELL)));
  const cj = (z: number) => Math.min(H - 1, Math.max(0, Math.floor((z - minZ) / CELL)));
  const si = ci(from.x);
  const sj = cj(from.z);
  let gi = ci(to.x);
  let gj = cj(to.z);
  // the goal may sit inside an obstacle (someone standing by a tree): aim for the nearest open cell
  if (!ok(gi, gj)) {
    let found = false;
    for (let r = 1; r < 4 && !found; r++)
      for (let dj = -r; dj <= r && !found; dj++)
        for (let di = -r; di <= r && !found; di++)
          if (ok(gi + di, gj + dj)) {
            gi += di;
            gj += dj;
            found = true;
          }
    if (!found) return null;
  }
  const start = sj * W + si;
  const goal = gj * W + gi;
  ok(si, sj);
  const cost = new Float32Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const open = new Heap();
  cost[start] = 0;
  open.push(start, 0);
  const D = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ];
  let iter = 0;
  let reached = false;
  while (open.size && iter++ < 5000) {
    const cur = open.pop();
    if (cur === goal) {
      reached = true;
      break;
    }
    const i = cur % W;
    const j = (cur - i) / W;
    for (const [di, dj, c] of D) {
      const ni = i + di;
      const nj = j + dj;
      if (!ok(ni, nj)) continue;
      // no cutting corners past obstacles
      if (di && dj && (!ok(i + di, j) || !ok(i, j + dj))) continue;
      const nk = nj * W + ni;
      if (Math.abs(hgt[nk] - hgt[cur]) > 0.9 && cur !== start) continue;
      const nc = cost[cur] + c * CELL;
      if (nc < cost[nk]) {
        cost[nk] = nc;
        came[nk] = cur;
        open.push(nk, nc + Math.hypot(ni - gi, nj - gj) * CELL);
      }
    }
  }
  if (!reached) return null;
  const cells: THREE.Vector3[] = [];
  for (let k = goal; k !== -1 && k !== start; k = came[k]) {
    const i = k % W;
    const j = (k - i) / W;
    cells.push(new THREE.Vector3(minX + (i + 0.5) * CELL, hgt[k], minZ + (j + 0.5) * CELL));
  }
  cells.reverse();
  // string-pull: skip waypoints we can walk straight past
  const out: THREE.Vector3[] = [];
  let p = from;
  let i = 0;
  while (i < cells.length) {
    let j = Math.min(cells.length - 1, i + 8);
    while (j > i && !area.clearLine(p, cells[j], 0.4, 0.6)) j--;
    out.push(cells[j]);
    p = cells[j];
    i = j + 1;
  }
  return out;
}

/** Follows a grid path toward a moving goal, re-planning now and then. */
export class Navigator {
  private path: THREE.Vector3[] = [];
  private idx = 0;
  private replanT = 0;
  private goal = new THREE.Vector3(1e9, 0, 1e9);
  /** using a path (the straight line is blocked) */
  routing = false;
  private directT = 0;
  private direct = true;

  /** Unit-ish direction to walk this frame toward `goal`. */
  steer(area: LandArea, pos: THREE.Vector3, goal: THREE.Vector3, dt: number, out: THREE.Vector3) {
    this.replanT -= dt;
    this.directT -= dt;
    // the straight-line test is re-done a few times a second, not every frame
    if (this.directT <= 0) {
      this.directT = 0.25;
      this.direct = Math.hypot(goal.x - pos.x, goal.z - pos.z) < 1.5 || area.clearLine(pos, goal, 0.4, 0.7);
    }
    if (this.direct) {
      this.routing = false;
      this.path.length = 0;
      return out.set(goal.x - pos.x, 0, goal.z - pos.z).normalize();
    }
    if (!this.path.length || this.replanT <= 0 || this.goal.distanceTo(goal) > 2.5) {
      this.replanT = 0.9;
      this.goal.copy(goal);
      this.path = gridPath(area, pos, goal) ?? [];
      this.idx = 0;
    }
    this.routing = this.path.length > 0;
    while (this.idx < this.path.length && Math.hypot(this.path[this.idx].x - pos.x, this.path[this.idx].z - pos.z) < 0.7) this.idx++;
    const wp = this.path[this.idx];
    if (!wp) return out.set(goal.x - pos.x, 0, goal.z - pos.z).normalize();
    return out.set(wp.x - pos.x, 0, wp.z - pos.z).normalize();
  }

  reset() {
    this.path.length = 0;
    this.routing = false;
  }
}
