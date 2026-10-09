import * as THREE from 'three';
import { GeoBuilder, T, cyl, roundBox, rockGeo, ellipsoid } from '../render/GeoBuilder';
import { M } from '../render/Materials';
import { mulberry32 } from '../core/math';
import { Placer, PAL, house, crate, barrelAt, sack, lanternPost, flagPole, cannonGeo, palmTree, lantern, palmHut, HouseOpts } from '../models/Props';
import { makeFlag, FlagKind } from '../models/Flags';
import { buildShip, DESIGNS, playerDesign } from '../models/ShipModel';
import type { AnimState, PropKind } from '../models/Character';
import { STALLS, StallType } from '../game/Economy';
import { PIERS, PierDef, PortDef, islandByName, coastRadius, townToWorld } from './WorldData';
import { groundHeight } from './Islands';
import { LandArea } from './LandArea';
import * as K from './TownKit';
import type { BoxCol, CircleCol, Platform, Interactable, Interior, Spot, ResidentDef, AnimalDef, MapMark, TownBuild } from './TownTypes';

export const DECK_Y = 1.78;

/** Pier deck with posts, rope rings and lanterns (built in the pier's local frame). */
export function buildPier(wP: Placer, gP: Placer, p: PierDef, deckY = 1.7, lanterns = true) {
  const pl = wP.child(T(p.x, 0, p.z, 0, p.rot, 0));
  const gl = gP.child(T(p.x, 0, p.z, 0, p.rot, 0));
  const w = p.hw * 2;
  for (let z = -p.hl; z < p.hl; z += 0.55) {
    const k = Math.floor(z / 0.55) % 3;
    const c = k === 0 ? PAL.woodLight : k === 1 || k === -1 ? PAL.plank : '#a77447';
    pl.add(new THREE.BoxGeometry(w, 0.16, 0.5), c, T(0, deckY, z + 0.27, 0, 0, Math.sin(z * 7) * 0.01));
  }
  for (const sx of [-1, 1]) {
    pl.add(new THREE.BoxGeometry(0.3, 0.3, p.hl * 2), PAL.woodDark, T(sx * (p.hw - 0.2), deckY - 0.25, 0));
    for (let z = -p.hl + 1; z <= p.hl; z += 4) {
      pl.add(cyl(0.22, 0.26, deckY + 4, 7), PAL.woodDark, T(sx * (p.hw + 0.05), deckY / 2 - 2 + 0.6, z));
      pl.add(new THREE.TorusGeometry(0.26, 0.06, 5, 10), PAL.rope, T(sx * (p.hw + 0.05), deckY + 0.3, z, Math.PI / 2, 0, 0));
    }
  }
  if (lanterns) for (let z = -p.hl + 6; z < p.hl; z += 12) lanternPost(pl, gl, -p.hw + 0.4, deckY, z, 3.2);
}

/** Large stylised skull-shaped rock: the landmark of Skull Cove. */
function skullRock(pl: Placer) {
  pl.add(rockGeo(9, 3, 1, 1.05), PAL.rock, T(0, 5, 0), true);
  pl.add(roundBox(6.5, 3, 5, 3, 10, 8), PAL.rockDark, T(0, 0.5, 2.5), true);
  for (const sx of [-1, 1]) pl.add(ellipsoid(2.0, 2.4, 1.2, 10, 8), '#1d1b1f', T(sx * 3.1, 6.2, 7.6, 0.2, sx * 0.25, 0));
  pl.add(new THREE.ConeGeometry(1.0, 1.8, 3), '#1d1b1f', T(0, 3.4, 8.3, Math.PI, 0, 0));
  for (let i = -2; i <= 2; i++) pl.add(roundBox(0.7, 1.0, 0.5, 3), '#e8e2d2', T(i * 1.45, 1.4, 7.0));
}

// palms are built once per variant and stamped (fast loading)
let palmVariants: { a: THREE.BufferGeometry; b: THREE.BufferGeometry }[] | null = null;
function palmVariant(i: number) {
  if (!palmVariants) {
    palmVariants = [];
    for (let k = 0; k < 4; k++) {
      const a = new GeoBuilder();
      const b = new GeoBuilder();
      palmTree(new Placer(a), new Placer(b), 9, 500 + k * 131);
      palmVariants.push({ a: a.build(), b: b.build() });
    }
  }
  return palmVariants[i % palmVariants.length];
}

export interface InteriorOpts {
  id: string;
  kind: Interior['kind'];
  name: string;
  icon: string;
  a: number;
  b: number;
  ly: number;
  w: number;
  d: number;
  h?: number;
  wall: string;
  wallIn?: string;
  roof: string;
  trim?: string;
  floor?: string;
  doorW?: number;
  signBg?: string;
  signFg?: string;
  thatch?: boolean;
  stone?: boolean;
  noSign?: boolean;
}

/** Helpers handed to interior fill callbacks (coords are local to the building floor). */
export interface InteriorCtx {
  pl: Placer;
  stone: Placer;
  glow: Placer;
  w: number;
  d: number;
  rng: () => number;
  W: (lx: number, lz: number, ly?: number) => THREE.Vector3;
  yaw: (l: number) => number;
  box: (lx: number, lz: number, hx: number, hz: number, lr?: number) => void;
  circle: (lx: number, lz: number, r: number) => void;
  spot: (id: string, lx: number, lz: number, lyaw: number, anim: AnimState, opts?: Partial<Spot> & { y?: number }) => void;
  interact: (def: Omit<Interactable, 'pos' | 'look' | 'interior'> & { lx: number; lz: number; lookX: number; lookZ: number; lookY?: number }) => void;
}

/**
 * Builds one explorable port: static merged geometry, colliders, walkable decks,
 * interiors with cut-away walls, NPC spots + schedules, interaction points and a nav grid.
 */
export class TownBuilder {
  group = new THREE.Group();
  wood = new GeoBuilder();
  stone = new GeoBuilder();
  glow = new GeoBuilder();
  leaves = new GeoBuilder();
  pave = new GeoBuilder();
  wP: Placer;
  sP: Placer;
  gP: Placer;
  lP: Placer;
  pvP: Placer;
  rng: () => number;
  baseYaw: number;
  boxes: BoxCol[] = [];
  circles: CircleCol[] = [];
  platforms: Platform[] = [];
  interactables: Interactable[] = [];
  interiors: Interior[] = [];
  spots = new Map<string, Spot>();
  residents: ResidentDef[] = [];
  animals: AnimalDef[] = [];
  marks: MapMark[] = [];
  footprints: { x: number; z: number; hx: number; hz: number; rot: number; color: string }[] = [];
  flags: THREE.Mesh[] = [];
  beams: THREE.Object3D[] = [];
  camColliders: THREE.Mesh[] = [];
  smoke: THREE.Vector3[] = [];
  fires: THREE.Vector3[] = [];
  private occupied: BoxCol[] = [];
  homeCount = 0;

  constructor(
    public port: PortDef,
    obstacles: CircleCol[],
  ) {
    this.group.name = 'town-' + port.id;
    this.wP = new Placer(this.wood);
    this.sP = new Placer(this.stone);
    this.gP = new Placer(this.glow);
    this.lP = new Placer(this.leaves);
    this.pvP = new Placer(this.pave);
    this.rng = mulberry32(port.id.charCodeAt(0) * 977 + port.id.length);
    this.baseYaw = Math.atan2(port.fx, port.fz);
    // trees and rocks of the island
    const isl = islandByName(port.island);
    for (const o of obstacles) if (Math.hypot(o.x - isl.x, o.z - isl.z) < isl.maxR! * 1.05) this.circles.push(o);
    // pier decks of this port are walkable
    for (const p of PIERS.filter((p) => p.port === port.id)) {
      this.platforms.push({ x: p.x, z: p.z, hx: p.hw, hz: p.hl, rot: p.rot, y: DECK_Y });
      this.occupied.push({ x: p.x, z: p.z, hx: p.hw + 1, hz: p.hl + 1, rot: p.rot });
    }
  }

  // ------------------------------------------------------------------ coords
  /** Town-local (a along shore, b seaward) → world with y on the ground. */
  w(a: number, b: number) {
    const v = townToWorld(this.port, a, b);
    v.y = this.ground(v.x, v.z);
    return v;
  }
  ground(x: number, z: number) {
    return Math.max(groundHeight(x, z), 0.2);
  }
  /** Local yaw (0 = facing the sea) → world yaw. */
  yaw(ly: number) {
    return this.baseYaw + ly;
  }
  /** Local yaw that faces from (a,b) toward (ta,tb). */
  faceTo(a: number, b: number, ta: number, tb: number) {
    return Math.atan2(ta - a, tb - b);
  }
  placer(which: Placer, x: number, y: number, z: number, rot: number) {
    return which.child(T(x, y, z, 0, rot, 0));
  }

  // ------------------------------------------------------------------ registry
  box(x: number, z: number, hx: number, hz: number, rot: number, tag?: string) {
    this.boxes.push({ x, z, hx, hz, rot, tag });
  }
  circle(x: number, z: number, r: number) {
    this.circles.push({ x, z, r });
  }
  /** Box given in a placed object's local frame. */
  boxLocal(origin: THREE.Vector3, rot: number, lx: number, lz: number, hx: number, hz: number, lr = 0) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    this.box(origin.x + lx * c + lz * s, origin.z - lx * s + lz * c, hx, hz, rot + lr);
  }
  localToWorld(origin: THREE.Vector3, rot: number, lx: number, lz: number, y = origin.y) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return new THREE.Vector3(origin.x + lx * c + lz * s, y, origin.z - lx * s + lz * c);
  }
  spot(id: string, pos: THREE.Vector3, facing: number, anim: AnimState, opts: Partial<Spot> = {}) {
    this.spots.set(id, { id, pos, facing, anim, ...opts });
  }
  resident(def: Omit<ResidentDef, 'id'> & { id?: string }) {
    const r = { id: def.id ?? `${this.port.id}-r${this.residents.length}`, ...def } as ResidentDef;
    this.residents.push(r);
    return r;
  }
  mark(pos: THREE.Vector3, icon: string, label: string, opts: Partial<MapMark> = {}) {
    this.marks.push({ x: pos.x, z: pos.z, icon, label, ...opts });
  }
  footprint(x: number, z: number, hx: number, hz: number, rot: number, color: string) {
    this.footprints.push({ x, z, hx, hz, rot, color });
    this.occupied.push({ x, z, hx: hx + 0.8, hz: hz + 0.8, rot });
  }

  /**
   * Nudge a footprint inland until it sits on dry ground and doesn't overlap anything.
   * Returns town-local coords.
   */
  fit(a: number, b: number, hw: number, hd: number, ly: number, minH = 1.0) {
    for (let i = 0; i < 16; i++) {
      const bb = b - i * 1.5;
      if (this.footprintOk(a, bb, hw, hd, ly, minH)) return { a, b: bb };
    }
    if (import.meta.env.DEV) console.warn(`[town ${this.port.id}] could not fit footprint at`, a, b);
    return { a, b };
  }
  private footprintOk(a: number, b: number, hw: number, hd: number, ly: number, minH: number) {
    const c = this.w(a, b);
    const rot = this.yaw(ly);
    for (const [sx, sz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const p = this.localToWorld(c, rot, sx * hw, sz * hd);
      if (groundHeight(p.x, p.z) < minH) return false;
      for (const o of this.occupied) {
        const { lx, lz } = LandArea.local(o, p.x, p.z);
        if (Math.abs(lx) < o.hx && Math.abs(lz) < o.hz) return false;
      }
    }
    // existing footprints inside the new one
    const me = { x: c.x, z: c.z, rot, hx: hw + 0.5, hz: hd + 0.5 };
    for (const o of this.occupied) {
      const { lx, lz } = LandArea.local(me, o.x, o.z);
      if (Math.abs(lx) < me.hx && Math.abs(lz) < me.hz) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ props
  palm(a: number, b: number, scale = 1) {
    const p = this.w(a, b);
    const v = palmVariant(Math.floor(this.rng() * 4));
    const m = T(p.x, p.y - 0.2, p.z, 0, this.rng() * Math.PI * 2, 0, scale);
    this.wood.addBuilt(v.a, m);
    this.leaves.addBuilt(v.b, m);
    this.circle(p.x, p.z, 0.45 * scale);
  }
  lamp(a: number, b: number, fancy = false) {
    const p = this.w(a, b);
    K.lampPost(this.placer(this.wP, p.x, p.y, p.z, 0), this.placer(this.gP, p.x, p.y, p.z, 0), fancy);
    this.circle(p.x, p.z, 0.3);
  }
  torch(a: number, b: number) {
    const p = this.w(a, b);
    K.tikiTorch(this.placer(this.wP, p.x, p.y, p.z, 0), this.placer(this.gP, p.x, p.y, p.z, 0));
    this.circle(p.x, p.z, 0.25);
    this.fires.push(p.clone().setY(p.y + 2.9));
  }
  crates(a: number, b: number, n = 4, ly = 0) {
    const p = this.w(a, b);
    K.crateStack(this.placer(this.wP, p.x, p.y, p.z, this.yaw(ly)), 0, 0, this.rng, n);
    this.boxLocal(p, this.yaw(ly), 0, 0, 1.6, 0.7);
  }
  barrels(a: number, b: number, ly = 0) {
    const p = this.w(a, b);
    K.barrelStack(this.placer(this.wP, p.x, p.y, p.z, this.yaw(ly)), 0, 0, this.rng);
    this.boxLocal(p, this.yaw(ly), 0, 0, 1.45, 0.5);
  }
  pile(a: number, b: number, n = 5) {
    const c = this.w(a, b);
    for (let i = 0; i < n; i++) {
      const p = this.w(a + (this.rng() - 0.5) * 3.5, b + (this.rng() - 0.5) * 3.5);
      const k = this.rng();
      if (k < 0.4) crate(this.wP, p.x, p.y, p.z, 0.8 + this.rng() * 0.4, this.rng() * 3);
      else if (k < 0.75) barrelAt(this.wP, p.x, p.y, p.z, 0.85);
      else sack(this.wP, p.x, p.y, p.z, 1);
    }
    this.circle(c.x, c.z, 2.3);
  }
  sign(text: string, icon: string, pos: THREE.Vector3, rot: number, width = 3, bg?: string, fg?: string) {
    const m = K.signMesh(text, icon, width, bg, fg);
    m.position.copy(pos);
    m.rotation.y = rot;
    // unreadable from afar: the game hides signs on distant towns
    m.userData.farHide = true;
    this.group.add(m);
    // wooden backing board
    const back = this.placer(this.wP, pos.x, pos.y, pos.z, rot);
    back.add(new THREE.BoxGeometry(width + 0.2, width * 0.3125 + 0.2, 0.12), PAL.woodDark, T(0, 0, -0.08));
    return m;
  }
  flag(kind: FlagKind, pos: THREE.Vector3, h = 8, w = 2.8) {
    flagPole(this.wP, pos.x, pos.y, pos.z, h);
    const f = makeFlag(kind, w, w * 0.62);
    f.position.set(pos.x, pos.y + h + 0.2, pos.z);
    this.flags.push(f);
    this.group.add(f);
  }
  plaza(a: number, b: number, w: number, d: number, ly: number, ca: string, cb: string, tile = 1.2, round = false) {
    const p = this.w(a, b);
    K.paving(this.placer(this.pvP, p.x, p.y + 0.05, p.z, this.yaw(ly)), w, d, ca, cb, tile, round);
  }

  // ------------------------------------------------------------------ buildings
  houseAt(a: number, b: number, ly: number, o: HouseOpts) {
    const f = this.fit(a, b, o.w / 2 + 0.3, o.d / 2 + 0.3, ly);
    const p = this.w(f.a, f.b);
    const rot = this.yaw(ly);
    house(this.placer(this.wP, p.x, p.y - 0.4, p.z, rot), this.placer(this.gP, p.x, p.y - 0.4, p.z, rot), o);
    this.placer(this.wP, p.x, p.y - 0.4, p.z, rot).add(new THREE.BoxGeometry(o.w + 0.6, 3, o.d + 0.6), o.stone ? '#8d8580' : '#7d6a58', T(0, -1.5, 0), true);
    this.box(p.x, p.z, o.w / 2 + 0.25, o.d / 2 + 0.25, rot);
    this.footprint(p.x, p.z, o.w / 2 + 0.25, o.d / 2 + 0.25, rot, o.roof);
    const id = `${this.port.id}-home${this.homeCount++}`;
    const door = this.localToWorld(p, rot, 0, o.d / 2 + 0.9);
    door.y = this.ground(door.x, door.z);
    this.spot(id, door, rot + Math.PI, 'idle', { home: true });
    return { pos: p, rot, home: id };
  }

  hutAt(a: number, b: number, ly: number, seed: number) {
    const f = this.fit(a, b, 2.4, 2.4, ly);
    const p = this.w(f.a, f.b);
    const rot = this.yaw(ly);
    palmHut(this.placer(this.wP, p.x, p.y - 0.1, p.z, rot), seed);
    this.circle(p.x, p.z, 2.3);
    this.footprint(p.x, p.z, 2.2, 2.2, rot, '#d8b25a');
    const id = `${this.port.id}-home${this.homeCount++}`;
    const door = this.localToWorld(p, rot, 0, 3.0);
    door.y = this.ground(door.x, door.z);
    this.spot(id, door, rot + Math.PI, 'idle', { home: true });
    return { pos: p, rot, home: id };
  }

  /** Market stall with its vendor. */
  stall(type: StallType, a: number, b: number, ly: number, style: 'wood' | 'bamboo' | 'fancy', vendor: { spec: string; name: string; lines?: string[] }, color?: string) {
    const def = STALLS[type];
    const f = this.fit(a, b, K.STALL_W / 2 + 0.4, 1.5, ly);
    const p = this.w(f.a, f.b);
    const rot = this.yaw(ly);
    const id = `${this.port.id}-${type}`;
    K.stallGeo(this.placer(this.wP, p.x, p.y, p.z, rot), type, color ?? def.color, Math.floor(this.rng() * 1000), style);
    this.sign(def.name, def.icon, this.localToWorld(p, rot, 0, 1.25, p.y + 3.55), rot, 2.7);
    // colliders: counter, back rail, posts
    this.boxLocal(p, rot, 0, 0.3, K.STALL_W / 2 - 0.05, 0.6);
    this.boxLocal(p, rot, 0, -1.15, K.STALL_W / 2, 0.22);
    this.footprint(p.x, p.z, K.STALL_W / 2 + 0.2, 1.4, rot, def.color);
    const vpos = this.localToWorld(p, rot, 0, -0.62);
    this.spot(`${id}-vendor`, vpos, rot, 'idle');
    const rid = `${id}-keeper`;
    const [o, c] = def.hours ?? [0, 24];
    this.resident({
      id: rid,
      spec: vendor.spec,
      name: vendor.name,
      role: 'vendor',
      schedule: def.hours
        ? [
            { from: o, to: c, spot: `${id}-vendor` },
            { from: c, to: Math.min(c + 2.5, 23.5), spot: 'tavern' },
            { from: Math.min(c + 2.5, 23.5), to: o, spot: 'home' },
          ]
        : [{ from: 0, to: 24, spot: `${id}-vendor` }],
      lines: vendor.lines ?? def.greet,
    });
    const front = this.localToWorld(p, rot, 0, 1.75);
    this.interactables.push({
      id,
      kind: 'stall',
      stall: type,
      pos: front,
      radius: 2.3,
      label: def.name,
      icon: def.icon,
      look: vpos.clone().setY(vpos.y + 1.7),
      keeper: rid,
    });
    this.mark(front, def.icon, def.name, { id });
    return { pos: p, rot, id };
  }

  /**
   * Walk-in building: floor, four cut-away walls with a door, removable roof, furniture via
   * `fill`. The door is on the local +Z side.
   */
  interior(o: InteriorOpts, fill: (ctx: InteriorCtx) => void) {
    const H = o.h ?? 4.4;
    const doorW = o.doorW ?? 2.4;
    const f = this.fit(o.a, o.b, o.w / 2 + 0.4, o.d / 2 + 0.4, o.ly);
    const c = this.w(f.a, f.b);
    const rot = this.yaw(o.ly);
    let floorY = 0;
    for (const [sx, sz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = this.localToWorld(c, rot, (sx * o.w) / 2, (sz * o.d) / 2);
      floorY = Math.max(floorY, this.ground(p.x, p.z));
    }
    floorY += 0.3;
    const group = new THREE.Group();
    group.position.set(c.x, floorY, c.z);
    group.rotation.y = rot;
    this.group.add(group);
    const rng = mulberry32(o.id.length * 31 + Math.floor(c.x));
    const wallIn = o.wallIn ?? '#a87a4e';
    const trim = o.trim ?? PAL.woodDark;
    const t = 0.32;

    // floor + foundation (always visible, part of the building's inside mesh)
    const inside = new GeoBuilder();
    const insideGlow = new GeoBuilder();
    const inP = new Placer(inside);
    const inG = new Placer(insideGlow);
    const inS = new Placer(inside);
    for (let x = -o.w / 2; x < o.w / 2 - 0.01; x += 0.6) {
      const k = Math.round(x / 0.6);
      inP.add(new THREE.BoxGeometry(0.58, 0.16, o.d - 0.1), o.floor ?? (k % 3 === 0 ? '#b98552' : k % 3 === 1 ? '#a87444' : '#c18f5a'), T(x + 0.3, -0.08, 0));
    }
    this.placer(o.stone ? this.sP : this.wP, c.x, floorY, c.z, rot).add(new THREE.BoxGeometry(o.w + 0.5, 2.6, o.d + 0.5), o.stone ? '#8d8580' : '#7d6a58', T(0, -1.45, 0), true);

    // walls: back, left, right, front (with door)
    const walls: Interior['walls'] = [];
    const shell: THREE.Mesh[] = [];
    const makeWall = (len: number, local: THREE.Matrix4, normalLocal: THREE.Vector3, door: boolean, windows: number) => {
      const gb = new GeoBuilder();
      const gl = new GeoBuilder();
      const P = new Placer(gb, local);
      const G = new Placer(gl, local);
      const seg = (x0: number, x1: number, y0: number, y1: number) => {
        const w = x1 - x0;
        if (w <= 0.01) return;
        P.add(new THREE.BoxGeometry(w, y1 - y0, t * 0.5), o.wall, T((x0 + x1) / 2, (y0 + y1) / 2, t * 0.25), o.thatch);
        P.add(new THREE.BoxGeometry(w, y1 - y0, t * 0.5), wallIn, T((x0 + x1) / 2, (y0 + y1) / 2, -t * 0.25));
      };
      if (door) {
        seg(-len / 2, -doorW / 2, 0, H);
        seg(doorW / 2, len / 2, 0, H);
        seg(-doorW / 2, doorW / 2, 3.0, H);
        P.add(new THREE.BoxGeometry(doorW + 0.5, 0.3, t + 0.15), trim, T(0, 3.1, 0));
        for (const sx of [-1, 1]) P.add(new THREE.BoxGeometry(0.25, 3.0, t + 0.15), trim, T((sx * (doorW + 0.25)) / 2, 1.5, 0));
      } else seg(-len / 2, len / 2, 0, H);
      // timber trims
      P.add(new THREE.BoxGeometry(len + 0.1, 0.28, t + 0.12), trim, T(0, H - 0.1, 0));
      P.add(new THREE.BoxGeometry(len + 0.1, 0.22, t + 0.12), trim, T(0, 0.12, 0));
      if (!o.stone && !o.thatch) P.add(new THREE.BoxGeometry(len, 0.18, t + 0.08), trim, T(0, H * 0.55, 0));
      // windows (glowing at night) with shutters
      for (let i = 0; i < windows; i++) {
        const x = windows === 1 ? (door ? len * 0.3 : 0) : -len / 2 + (len / (windows + 1)) * (i + 1);
        if (door && Math.abs(x) < doorW / 2 + 0.9) continue;
        G.add(new THREE.BoxGeometry(1.0, 1.1, t + 0.04), '#ffffff', T(x, 2.2, 0));
        P.add(new THREE.BoxGeometry(1.2, 0.14, t + 0.2), trim, T(x, 1.58, 0));
        P.add(new THREE.BoxGeometry(0.1, 1.1, t + 0.1), trim, T(x, 2.2, 0));
        P.add(new THREE.BoxGeometry(0.4, 1.1, 0.06), o.roof, T(x - 0.75, 2.2, t / 2 + 0.06));
        P.add(new THREE.BoxGeometry(0.4, 1.1, 0.06), o.roof, T(x + 0.75, 2.2, t / 2 + 0.06));
      }
      const wg = new THREE.Group();
      const wm = new THREE.Mesh(gb.build(), M.vc);
      wm.castShadow = true;
      wm.receiveShadow = true;
      wg.add(wm);
      if (!gl.empty) wg.add(new THREE.Mesh(gl.build(), M.glowWindow));
      group.add(wg);
      shell.push(wm);
      const nw = normalLocal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      walls.push({ obj: wg, nx: nw.x, nz: nw.z });
    };
    const hw = o.w / 2;
    const hd = o.d / 2;
    makeWall(o.w, T(0, 0, -hd + t / 2, 0, Math.PI, 0), new THREE.Vector3(0, 0, -1), false, 2);
    makeWall(o.d, T(-hw + t / 2, 0, 0, 0, -Math.PI / 2, 0), new THREE.Vector3(-1, 0, 0), false, o.d > 7 ? 2 : 1);
    makeWall(o.d, T(hw - t / 2, 0, 0, 0, Math.PI / 2, 0), new THREE.Vector3(1, 0, 0), false, o.d > 7 ? 2 : 1);
    makeWall(o.w, T(0, 0, hd - t / 2), new THREE.Vector3(0, 0, 1), true, 2);
    // wall colliders
    this.boxLocal(c, rot, 0, -hd + t / 2, hw, t / 2 + 0.05);
    this.boxLocal(c, rot, -hw + t / 2, 0, t / 2 + 0.05, hd);
    this.boxLocal(c, rot, hw - t / 2, 0, t / 2 + 0.05, hd);
    const sideLen = (o.w - doorW) / 2;
    this.boxLocal(c, rot, -hw + sideLen / 2, hd - t / 2, sideLen / 2, t / 2 + 0.05);
    this.boxLocal(c, rot, hw - sideLen / 2, hd - t / 2, sideLen / 2, t / 2 + 0.05);
    this.footprint(c.x, c.z, hw, hd, rot, o.roof);
    this.occupied.push({ x: c.x, z: c.z, hx: hw + 1.5, hz: hd + 2.5, rot });

    // roof (hidden while you're inside)
    const roofGb = new GeoBuilder();
    const RP = new Placer(roofGb);
    const rh = Math.min(o.w, o.d) * 0.42;
    const shape = new THREE.Shape();
    shape.moveTo(-hd - 0.8, 0);
    shape.lineTo(hd + 0.8, 0);
    shape.lineTo(0, rh);
    shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: o.w + 1.2, bevelEnabled: false });
    roofGeo.translate(0, 0, -(o.w + 1.2) / 2);
    const roofCol = (cc: THREE.Vector3, n: THREE.Vector3) => (n.y > 0.1 ? (o.thatch ? (Math.floor((cc.y + 10) * 3) % 2 ? '#d8b25a' : '#c49a45') : Math.floor((cc.y + 10) * 2.2) % 2 ? o.roof : new THREE.Color(o.roof).multiplyScalar(0.85)) : o.wall);
    RP.add(roofGeo, roofCol, T(0, H, 0, 0, Math.PI / 2, 0), true);
    // gable fill + chimney
    if (o.kind === 'tavern') RP.add(new THREE.BoxGeometry(0.9, rh + 1.6, 0.9), '#8d8580', T(hw - 1.0, H + rh * 0.6, -hd * 0.3), true);
    const roof = new THREE.Mesh(roofGb.build(), M.vc);
    roof.castShadow = true;
    group.add(roof);
    shell.push(roof);
    if (o.kind === 'tavern') this.smoke.push(this.localToWorld(c, rot, hw - 1.0, -hd * 0.3, floorY + H + rh + 1.0));

    // walkable floor + entrance ramp
    this.platforms.push({ x: c.x, z: c.z, hx: hw - 0.05, hz: hd - 0.05, rot, y: floorY });
    const doorOut = this.localToWorld(c, rot, 0, hd + 0.75);
    const gDoor = this.ground(doorOut.x, doorOut.z);
    this.platforms.push({ x: doorOut.x, z: doorOut.z, hx: doorW / 2 + 0.4, hz: 0.75, rot, y: floorY, y2: Math.min(gDoor, floorY) });
    for (let i = 0; i < 2; i++) this.placer(this.wP, c.x, floorY, c.z, rot).add(new THREE.BoxGeometry(doorW + 0.6, 0.2, 0.5), PAL.woodDark, T(0, -0.12 - i * 0.18, hd + 0.3 + i * 0.5));
    // sign above the door
    if (!o.noSign) this.sign(o.name, o.icon, this.localToWorld(c, rot, 0, hd + 0.35, floorY + H + 0.55), rot, Math.min(4.4, o.w * 0.45), o.signBg, o.signFg);
    // nav: outside & inside door spots
    this.spot(`${o.id}-door-out`, this.localToWorld(c, rot, 0, hd + 2.2, gDoor), rot, 'idle', { public: true });
    this.spot(`${o.id}-door-in`, this.localToWorld(c, rot, 0, hd - 1.5, floorY), rot + Math.PI, 'idle', { interior: o.id });

    const ctx: InteriorCtx = {
      pl: inP,
      stone: inS,
      glow: inG,
      w: o.w,
      d: o.d,
      rng,
      W: (lx, lz, y = 0) => this.localToWorld(c, rot, lx, lz, floorY + y),
      yaw: (l) => rot + l,
      box: (lx, lz, bhx, bhz, lr = 0) => this.boxLocal(c, rot, lx, lz, bhx, bhz, lr),
      circle: (lx, lz, r) => {
        const p = this.localToWorld(c, rot, lx, lz);
        this.circle(p.x, p.z, r);
      },
      spot: (id, lx, lz, lyaw, anim, opts = {}) => this.spot(id, this.localToWorld(c, rot, lx, lz, floorY + (opts.y ?? 0)), rot + lyaw, anim, { interior: o.id, ...opts }),
      interact: (d) => {
        const { lx, lz, lookX, lookZ, lookY, ...rest } = d;
        this.interactables.push({ ...rest, interior: o.id, pos: this.localToWorld(c, rot, lx, lz, floorY), look: this.localToWorld(c, rot, lookX, lookZ, floorY + (lookY ?? 1.7)) });
      },
    };
    fill(ctx);
    const inMesh = new THREE.Mesh(inside.build(), M.vc);
    inMesh.receiveShadow = true;
    inMesh.castShadow = true;
    group.add(inMesh);
    const contents: THREE.Object3D[] = [inMesh];
    if (!insideGlow.empty) {
      const gm = new THREE.Mesh(insideGlow.build(), M.glow);
      group.add(gm);
      contents.push(gm);
    }
    const int: Interior = { id: o.id, kind: o.kind, name: o.name, x: c.x, z: c.z, hx: hw, hz: hd, rot, floorY, group, walls, roof, shell, contents };
    this.interiors.push(int);
    this.camColliders.push(...shell);
    return { int, pos: c, rot, floorY, ctx };
  }

  // ------------------------------------------------------------------ finish
  build(landing: THREE.Vector3, center: THREE.Vector3, radius: number): TownBuild {
    const wMesh = this.wood.mesh(M.vc);
    wMesh.layers.enable(1);
    this.group.add(wMesh);
    const sMesh = this.stone.mesh(M.vcFlat);
    sMesh.layers.enable(1);
    this.group.add(sMesh);
    if (!this.glow.empty) this.group.add(new THREE.Mesh(this.glow.build(), M.glowWindow));
    if (!this.leaves.empty) this.group.add(this.leaves.mesh(M.vcDouble));
    if (!this.pave.empty) {
      const pv = new THREE.Mesh(this.pave.build(), M.vcFlat);
      pv.receiveShadow = true;
      this.group.add(pv);
    }
    this.camColliders.push(sMesh);
    // gangplank (shown while your ship is docked here)
    const plank = new THREE.Group();
    const pg = new GeoBuilder();
    for (let i = 0; i < 6; i++) pg.add(new THREE.BoxGeometry(1.2, 0.08, 0.5), i % 2 ? PAL.woodLight : PAL.plank, T(0, 0, -1.4 + i * 0.55));
    for (const sx of [-1, 1]) pg.add(new THREE.BoxGeometry(0.08, 0.08, 3.4), PAL.rope, T(sx * 0.62, 0.45, 0));
    const pm = new THREE.Mesh(pg.build(), M.vc);
    pm.castShadow = true;
    plank.add(pm);
    plank.visible = false;
    this.group.add(plank);
    const nav = this.buildNav(center, radius);
    return {
      port: this.port,
      group: this.group,
      camColliders: this.camColliders,
      boxes: this.boxes,
      circles: this.circles,
      platforms: this.platforms,
      interactables: this.interactables,
      interiors: this.interiors,
      spots: this.spots,
      residents: this.residents,
      animals: this.animals,
      nav,
      map: { footprints: this.footprints, marks: this.marks },
      landing,
      gangplank: plank,
      flags: this.flags,
      beams: this.beams,
      center,
      radius,
      smoke: this.smoke,
      fires: this.fires,
    };
  }

  /** Walkable grid + spots, connected where a person can walk in a straight line. */
  private buildNav(center: THREE.Vector3, radius: number) {
    const area = new LandArea(this.boxes, this.circles, this.platforms);
    const nodes: THREE.Vector3[] = [];
    const edges: number[][] = [];
    const STEP = 2.5;
    const n = Math.ceil(radius / STEP);
    const index = new Map<string, number>();
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) {
        const x = center.x + i * STEP;
        const z = center.z + j * STEP;
        if (Math.hypot(x - center.x, z - center.z) > radius) continue;
        const y = area.surface(x, z);
        if (y === null || area.blocked(x, z, 0.55)) continue;
        index.set(`${i},${j}`, nodes.length);
        nodes.push(new THREE.Vector3(x, y, z));
        edges.push([]);
      }
    const link = (a: number, b: number) => {
      if (!edges[a].includes(b)) edges[a].push(b);
      if (!edges[b].includes(a)) edges[b].push(a);
    };
    for (const [k, idx] of index) {
      const [i, j] = k.split(',').map(Number);
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const o = index.get(`${i + di},${j + dj}`);
        if (o === undefined) continue;
        if (area.clearLine(nodes[idx], nodes[o], 0.4, 0.8)) link(idx, o);
      }
    }
    // spots: connect to nearby visible nodes
    const spotNode = new Map<string, number>();
    const doorPairs: [number, number][] = [];
    for (const s of this.spots.values()) {
      const id = nodes.length;
      nodes.push(s.pos.clone());
      edges.push([]);
      spotNode.set(s.id, id);
      const cands = nodes
        .map((p, i) => ({ i, d: p.distanceTo(s.pos) }))
        .filter((c) => c.i !== id && c.d < 9)
        .sort((a, b) => a.d - b.d)
        .slice(0, 10);
      let linked = 0;
      for (const c of cands) {
        if (linked >= 3) break;
        if (area.clearLine(s.pos, nodes[c.i], 0.15, 0.4)) {
          link(id, c.i);
          linked++;
        }
      }
    }
    for (const s of this.spots.values()) {
      if (s.id.endsWith('-door-out')) {
        const base = s.id.slice(0, -'-door-out'.length);
        const a = spotNode.get(s.id);
        const b = spotNode.get(base + '-door-in');
        if (a !== undefined && b !== undefined) doorPairs.push([a, b]);
      }
    }
    for (const [a, b] of doorPairs) link(a, b);
    return { nodes, edges, spotNode };
  }
}

// ---------------------------------------------------------------------------
// Landmarks reused by the port plans
// ---------------------------------------------------------------------------
export function lighthouse(tb: TownBuilder) {
  const port = tb.port;
  const isl = islandByName(port.island);
  const th = Math.atan2(port.fz, port.fx) + 0.6;
  const lr = coastRadius(isl, th) * 0.84;
  const lx = isl.x + Math.cos(th) * lr;
  const lz = isl.z + Math.sin(th) * lr;
  const ly = groundHeight(lx, lz);
  const H = 18;
  for (let i = 0; i < 6; i++) {
    const r0 = 3 - i * 0.28;
    tb.sP.add(cyl(r0 - 0.28, r0, H / 6, 14), i % 2 ? '#d64541' : '#f5f2ea', T(lx, ly + (H / 6) * (i + 0.5), lz));
  }
  tb.sP.add(cyl(1.9, 1.9, 0.4, 14), PAL.ironDark, T(lx, ly + H + 0.2, lz));
  tb.gP.add(cyl(1.3, 1.3, 2, 10), '#fff', T(lx, ly + H + 1.4, lz));
  tb.sP.add(new THREE.ConeGeometry(1.8, 1.8, 14), '#d64541', T(lx, ly + H + 3.3, lz));
  tb.circle(lx, lz, 3.1);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(6, 70, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  beam.geometry.translate(0, -35, 0);
  beam.rotation.z = Math.PI / 2;
  const pivot = new THREE.Object3D();
  pivot.position.set(lx, ly + H + 1.4, lz);
  pivot.add(beam);
  tb.group.add(pivot);
  tb.beams.push(pivot);
  tb.mark(new THREE.Vector3(lx, 0, lz), '🗼', 'Lighthouse');
}

export function watchtower(tb: TownBuilder, a: number, b: number, flag: FlagKind = 'pirate') {
  const p = tb.w(a, b);
  const h = 10;
  const wP = tb.wP;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wP.add(cyl(0.25, 0.3, h, 6), PAL.woodDark, T(p.x + sx * 1.6, p.y + h / 2, p.z + sz * 1.6, sz * 0.05, 0, -sx * 0.05));
  for (let k = 1; k < 4; k++) {
    wP.add(new THREE.BoxGeometry(3.6, 0.15, 0.15), PAL.wood, T(p.x, p.y + k * 2.4, p.z + 1.6, 0, 0, k % 2 ? 0.5 : -0.5));
    wP.add(new THREE.BoxGeometry(3.6, 0.15, 0.15), PAL.wood, T(p.x, p.y + k * 2.4, p.z - 1.6, 0, 0, k % 2 ? -0.5 : 0.5));
  }
  wP.add(new THREE.BoxGeometry(4.6, 0.3, 4.6), PAL.plank, T(p.x, p.y + h, p.z));
  for (const sx of [-1, 1]) {
    wP.add(new THREE.BoxGeometry(4.6, 0.8, 0.15), PAL.wood, T(p.x, p.y + h + 0.55, p.z + sx * 2.25));
    wP.add(new THREE.BoxGeometry(0.15, 0.8, 4.6), PAL.wood, T(p.x + sx * 2.25, p.y + h + 0.55, p.z));
  }
  wP.add(new THREE.ConeGeometry(3.6, 2.4, 4), '#c0392b', T(p.x, p.y + h + 3.4, p.z, 0, Math.PI / 4, 0), true);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wP.add(cyl(0.12, 0.12, 2.2, 5), PAL.woodDark, T(p.x + sx * 2.0, p.y + h + 1.2, p.z + sz * 2.0));
  tb.flag(flag, p.clone().setY(p.y + h + 4.4), 3.4, 3.2);
  lantern(wP, tb.gP, p.x + 2.2, p.y + h + 1.4, p.z + 2.2, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tb.circle(p.x + sx * 1.6, p.z + sz * 1.6, 0.4);
  tb.footprint(p.x, p.z, 2.3, 2.3, 0, '#c0392b');
}

export function fort(tb: TownBuilder, a: number, b: number, ly: number) {
  const p = tb.w(a, b);
  const rot = tb.yaw(ly);
  const sp = tb.placer(tb.sP, p.x, p.y, p.z, rot);
  sp.add(new THREE.BoxGeometry(14, 3, 8), PAL.rock, T(0, 0.5, 0), true);
  for (let i = -3; i <= 3; i++) sp.add(new THREE.BoxGeometry(1.2, 1.2, 1.2), PAL.rockDark, T(i * 2, 2.6, 3.4), true);
  for (let i = -1; i <= 1; i++) cannonGeo(tb.placer(tb.wP, p.x, p.y + 2.0, p.z, rot).child(T(i * 4, 0, 1.5)), 1.3);
  tb.box(p.x, p.z, 7, 4, rot);
  tb.footprint(p.x, p.z, 7, 4, rot, '#9c9088');
  const fp = tb.localToWorld(p, rot, -5, -2, p.y + 2);
  tb.flag('pirateRed', fp, 6, 2.6);
}

export { skullRock, palmVariant };


export type { InteriorCtx as Ctx };
export { K, PAL, T, cyl, roundBox, crate, barrelAt, sack, cannonGeo, lantern, buildShip, DESIGNS, playerDesign };
export type { PropKind };
