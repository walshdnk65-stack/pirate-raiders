import * as THREE from 'three';
import { Character, AnimState, PropKind, SPECS } from '../models/Character';
import { GeoBuilder, T, ellipsoid, cyl, roundBox } from '../render/GeoBuilder';
import { M } from '../render/Materials';
import { clamp, dampAngle, headingTo, rand, mulberry32 } from '../core/math';
import { LandArea } from '../world/LandArea';
import type { TownBuild, ResidentDef, ScheduleEntry, Spot, AnimalDef } from '../world/TownTypes';

export interface Npc {
  def: ResidentDef;
  c: Character;
  pos: THREE.Vector3;
  heading: number;
  entry: ScheduleEntry | null;
  target: Spot | null;
  path: THREE.Vector3[];
  pathIdx: number;
  state: 'idle' | 'walk' | 'home' | 'talk';
  waitT: number;
  routeIdx: number;
  home: string;
  blockedT: number;
  talkT: number;
  lod: number;
  /** hired recruits leave the tavern for good */
  gone?: boolean;
}

const inHours = (h: number, from: number, to: number) => (from <= to ? h >= from && h < to : h >= from || h < to);

/** Tiny binary heap for A*. */
class Heap {
  private a: { k: number; v: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(v: number, k: number) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.v;
  }
}

/**
 * Brings a port to life: residents follow daily schedules (stalls by day, the tavern at
 * night, home to bed), walk the town's nav grid, chat, fish, work and react to the player.
 */
export class TownLife {
  npcs: Npc[] = [];
  animals: Animal[] = [];
  active = false;
  private spawned = false;
  private taken = new Map<string, Npc>();
  private seats: string[] = [];
  private wanderSpots: string[] = [];
  private homes: string[] = [];
  private frame = 0;
  /** dialogue partner (faces the player) */
  talking: Npc | null = null;

  constructor(
    public town: TownBuild,
    public area: LandArea,
    private scene: THREE.Scene,
  ) {
    for (const s of town.spots.values()) {
      if (s.id.includes('-tavern-seat')) this.seats.push(s.id);
      if (s.public) this.wanderSpots.push(s.id);
      if (s.home) this.homes.push(s.id);
    }
  }

  get specs() {
    return [...new Set(this.town.residents.map((r) => r.spec))];
  }

  private spawn() {
    this.spawned = true;
    const rng = mulberry32(this.town.port.id.length * 991);
    this.town.residents.forEach((def, i) => {
      if (!SPECS[def.spec]) return;
      const c = new Character(def.spec, def.prop ?? undefined);
      // hidden NPCs stay out of the scene graph until they're shown
      c.root.visible = false;
      const home = this.homes.length ? this.homes[Math.floor(rng() * this.homes.length + i) % this.homes.length] : '';
      this.npcs.push({ def, c, pos: c.root.position, heading: 0, entry: null, target: null, path: [], pathIdx: 0, state: 'home', waitT: 0, routeIdx: i % Math.max(1, def.route?.length ?? 1), home, blockedT: 0, talkT: 0, lod: 0 });
    });
    for (const a of this.town.animals) this.animals.push(new Animal(a, this.scene));
  }

  /** Turn the town on (player arrived) – NPCs pop straight to where they should be. */
  activate(hour: number) {
    if (!this.spawned) this.spawn();
    this.active = true;
    this.taken.clear();
    for (const n of this.npcs) {
      n.entry = null;
      if (n.gone) continue;
      this.applySchedule(n, hour, true);
    }
    for (const a of this.animals) {
      a.obj.visible = true;
      if (!a.obj.parent) this.scene.add(a.obj);
    }
  }

  deactivate() {
    this.active = false;
    this.fear.clear();
    for (const n of this.npcs) this.shown(n, false);
    for (const a of this.animals) {
      a.obj.visible = false;
      a.obj.removeFromParent();
    }
  }

  private entryFor(def: ResidentDef, hour: number) {
    return def.schedule.find((e) => inHours(hour, e.from, e.to)) ?? null;
  }

  private release(n: Npc) {
    for (const [k, v] of this.taken) if (v === n) this.taken.delete(k);
  }

  private resolveSpot(n: Npc, e: ScheduleEntry): Spot | null {
    const spots = this.town.spots;
    const tryIds = (ids: string[]) => {
      for (const id of ids) if (spots.has(id) && !this.taken.has(id)) return spots.get(id)!;
      return null;
    };
    if (n.def.route && n.def.route.length && e.spot === n.def.route[0]) {
      return spots.get(n.def.route[n.routeIdx % n.def.route.length]) ?? null;
    }
    if (Array.isArray(e.spot)) return tryIds(e.spot);
    switch (e.spot) {
      case 'home':
        return spots.get(n.home) ?? null;
      case 'tavern': {
        const free = this.seats.filter((s) => !this.taken.has(s));
        if (!free.length) return this.randomWander();
        return spots.get(free[Math.floor(Math.random() * free.length)])!;
      }
      case 'wander':
        return this.randomWander();
      default:
        return spots.get(e.spot) ?? null;
    }
  }

  private randomWander() {
    if (!this.wanderSpots.length) return null;
    const s = this.town.spots.get(this.wanderSpots[Math.floor(Math.random() * this.wanderSpots.length)])!;
    // a random point near the waypoint so wanderers don't stack up
    const nodes = this.town.nav.nodes;
    const near = nodes.filter((p) => p.distanceTo(s.pos) < 9 && Math.abs(p.y - s.pos.y) < 1);
    const p = near.length ? near[Math.floor(Math.random() * near.length)] : s.pos;
    return { ...s, id: 'wander', pos: p.clone(), facing: Math.random() * Math.PI * 2 };
  }

  /** Pick the spot for the current schedule entry and walk (or pop) there. */
  private applySchedule(n: Npc, hour: number, instant: boolean) {
    const e = this.entryFor(n.def, hour);
    if (!e) return;
    const changed = e !== n.entry;
    n.entry = e;
    if (!changed && !instant) return;
    this.release(n);
    const spot = this.resolveSpot(n, e);
    n.target = spot;
    if (!spot) return;
    if (spot.id !== 'wander' && !spot.home) this.taken.set(spot.id, n);
    if (instant) {
      if (spot.home) {
        n.state = 'home';
        this.shown(n, false);
        n.pos.copy(spot.pos);
        return;
      }
      n.pos.copy(spot.pos);
      n.heading = spot.facing;
      this.arrive(n);
      this.shown(n, true);
      return;
    }
    if (n.state === 'home') {
      // step out of the front door
      const hs = this.town.spots.get(n.home);
      if (hs) n.pos.copy(hs.pos);
      this.shown(n, true);
    }
    this.walkTo(n, spot.pos);
  }

  private nearestNode(p: THREE.Vector3) {
    const nodes = this.town.nav.nodes;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i].x - p.x) ** 2 + (nodes[i].z - p.z) ** 2 + (nodes[i].y - p.y) ** 2 * 4;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private findPath(from: THREE.Vector3, to: THREE.Vector3) {
    const { nodes, edges } = this.town.nav;
    const s = this.nearestNode(from);
    const g = this.nearestNode(to);
    const came = new Int32Array(nodes.length).fill(-1);
    const cost = new Float32Array(nodes.length).fill(Infinity);
    const open = new Heap();
    cost[s] = 0;
    open.push(s, 0);
    let found = false;
    let iter = 0;
    while (open.size && iter++ < 6000) {
      const cur = open.pop();
      if (cur === g) {
        found = true;
        break;
      }
      for (const nb of edges[cur]) {
        const c = cost[cur] + nodes[cur].distanceTo(nodes[nb]);
        if (c < cost[nb]) {
          cost[nb] = c;
          came[nb] = cur;
          open.push(nb, c + nodes[nb].distanceTo(nodes[g]));
        }
      }
    }
    if (!found) return [to.clone()];
    const path: THREE.Vector3[] = [];
    for (let k = g; k !== -1; k = came[k]) path.push(nodes[k].clone());
    path.reverse();
    path.push(to.clone());
    // string-pull: skip nodes we can walk straight past
    const out: THREE.Vector3[] = [];
    let i = 0;
    let curP = from.clone();
    while (i < path.length) {
      let j = Math.min(path.length - 1, i + 5);
      while (j > i && !this.area.clearLine(curP, path[j], 0.3, 0.7)) j--;
      out.push(path[j]);
      curP = path[j];
      i = j + 1;
    }
    return out;
  }

  private walkTo(n: Npc, to: THREE.Vector3) {
    n.path = this.findPath(n.pos, to);
    n.pathIdx = 0;
    n.state = 'walk';
    n.blockedT = 0;
    const carrying = n.def.role === 'worker';
    n.c.play(carrying ? 'carry' : 'walk');
    this.setProp(n, carrying ? 'crate' : n.def.role === 'guard' ? 'musket' : 'none');
  }

  private setProp(n: Npc, p: PropKind) {
    const cur = (n.c as unknown as { _prop?: PropKind })._prop ?? n.c.spec.prop ?? 'none';
    if (cur === p) return;
    (n.c as unknown as { _prop?: PropKind })._prop = p;
    n.c.setProp(p);
  }

  private arrive(n: Npc) {
    const s = n.target;
    n.path = [];
    if (!s) return;
    if (s.home) {
      n.state = 'home';
      this.shown(n, false);
      return;
    }
    n.state = 'idle';
    n.pos.copy(s.pos);
    n.heading = s.facing;
    const anim: AnimState = n.entry?.anim ?? (s.id === 'wander' ? 'idle' : s.anim);
    n.c.play(n.def.role === 'worker' && s.id !== 'wander' ? 'load' : anim);
    const prop = n.entry?.prop ?? s.prop ?? (n.def.role === 'guard' ? 'musket' : n.def.spec === 'shipwright' ? 'hammer' : 'none');
    this.setProp(n, prop);
    n.waitT = n.def.route ? rand(3, 7) : s.id === 'wander' ? rand(4, 10) : 0;
    if (n.def.role === 'vendor') n.c.express('happy');
  }

  /** Make an NPC face the player and chat (dialogue). */
  startTalk(n: Npc, playerPos: THREE.Vector3) {
    this.talking = n;
    n.state = 'talk';
    n.talkT = 0;
    n.heading = headingTo(playerPos.x - n.pos.x, playerPos.z - n.pos.z);
    n.c.play('talk');
    n.c.express('happy', 2);
  }

  endTalk() {
    const n = this.talking;
    this.talking = null;
    if (!n) return;
    if (n.path.length && n.pathIdx < n.path.length) {
      n.state = 'walk';
      n.c.play(n.def.role === 'worker' ? 'carry' : 'walk');
    } else this.arrive(n);
  }

  /** A shopkeeper greets you (turns to the player, gestures). */
  greet(n: Npc, playerPos: THREE.Vector3) {
    if (n.state === 'walk') return;
    n.heading = headingTo(playerPos.x - n.pos.x, playerPos.z - n.pos.z);
    n.c.play('present');
    n.c.express('happy', 2.5);
    n.waitT = -1;
  }

  /** Back to work after shopping. */
  resume(n: Npc) {
    if (n.state === 'idle' && n.target) this.arrive(n);
  }

  /** Swap an NPC's look (tavern recruits change every day). */
  setSpec(n: Npc, spec: string) {
    const old = n.c;
    const c = new Character(spec);
    c.root.position.copy(old.root.position);
    c.root.rotation.y = old.root.rotation.y;
    c.root.visible = old.root.visible;
    c.play(old.state, true);
    const wasShown = !!old.root.parent;
    old.root.removeFromParent();
    old.dispose();
    if (wasShown) this.scene.add(c.root);
    n.c = c;
    n.pos = c.root.position;
  }

  /** Show/hide an NPC. Hidden ones are taken out of the scene so they cost nothing per frame. */
  private shown(n: Npc, v: boolean) {
    const r = n.c.root;
    r.visible = v;
    if (v && !r.parent) this.scene.add(r);
    else if (!v && r.parent) r.removeFromParent();
  }

  setHidden(n: Npc, hidden: boolean) {
    if (hidden === !!n.gone) return;
    n.gone = hidden;
    if (hidden) {
      this.release(n);
      n.state = 'home';
      this.shown(n, false);
    } else if (this.active) {
      n.entry = null;
      n.state = 'home';
    }
  }

  npcById(id: string) {
    return this.npcs.find((n) => n.def.id === id) ?? null;
  }

  isPresent(id: string) {
    const n = this.npcById(id);
    return !!n && n.state === 'idle' && n.target?.id !== 'wander' && !n.target?.home && this.taken.get(n.target!.id) === n;
  }

  /** Townsfolk caught near a fight run off for a few seconds (shopkeepers stay put). */
  private fear = new Map<Npc, { t: number; from: THREE.Vector3 }>();
  scare(at: THREE.Vector3, radius: number) {
    if (!this.active) return;
    for (const n of this.npcs) {
      if (n.state === 'home' || n.state === 'talk' || n.gone || !n.c.root.visible) continue;
      const role = n.def.role;
      if (role === 'vendor' || role === 'keeper' || role === 'recruit' || role === 'guard' || role === 'smuggler') continue;
      if (n.pos.distanceTo(at) > radius) continue;
      const f = this.fear.get(n);
      if (f) {
        f.t = 4;
        f.from.copy(at);
      } else {
        this.fear.set(n, { t: 4, from: at.clone() });
        n.c.play('panic', true);
        n.c.express('surprised', 3);
      }
    }
  }

  private flee(n: Npc, dt: number, f: { t: number; from: THREE.Vector3 }) {
    f.t -= dt;
    if (f.t <= 0) {
      this.fear.delete(n);
      if (n.target) this.walkTo(n, n.target.pos);
      else n.c.play('idle');
      return;
    }
    const dx = n.pos.x - f.from.x;
    const dz = n.pos.z - f.from.z;
    const d = Math.hypot(dx, dz) || 1;
    let ux = dx / d;
    let uz = dz / d;
    const sp = 3.6 * dt;
    for (const a of [0, 0.7, -0.7, 1.5, -1.5]) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const rx = ux * c + uz * s;
      const rz = -ux * s + uz * c;
      const nx = n.pos.x + rx * sp;
      const nz = n.pos.z + rz * sp;
      if (!this.area.blocked(nx, nz, 0.4) && this.area.surface(nx, nz, n.pos.y + 0.3, 0.8) !== null) {
        ux = rx;
        uz = rz;
        n.pos.x = nx;
        n.pos.z = nz;
        const y = this.area.surface(nx, nz, n.pos.y + 0.3, 0.8);
        if (y !== null) n.pos.y += (y - n.pos.y) * clamp(dt * 12, 0, 1);
        break;
      }
    }
    n.heading = headingTo(ux, uz);
  }

  /** Dynamic colliders for the player. */
  colliders(out: { x: number; z: number; r: number }[]) {
    for (const n of this.npcs) if (n.c.root.visible && n.state !== 'home') out.push({ x: n.pos.x, z: n.pos.z, r: 0.42 });
    for (const a of this.animals) if (a.def.kind === 'goat' || a.def.kind === 'dog') out.push({ x: a.obj.position.x, z: a.obj.position.z, r: 0.45 });
  }

  update(dt: number, hour: number, player: THREE.Vector3, cam: THREE.Vector3) {
    if (!this.active) return;
    this.frame++;
    for (const n of this.npcs) {
      if (n.gone) continue;
      const fear = this.fear.get(n);
      if (fear) this.flee(n, dt, fear);
      else if (n.state !== 'talk') this.applySchedule(n, hour, false);
      if (!fear) switch (n.state) {
        case 'walk':
          this.stepWalk(n, dt, player);
          break;
        case 'idle':
          if (n.waitT > 0) {
            n.waitT -= dt;
            if (n.waitT <= 0 && n.entry) {
              if (n.def.route?.length) {
                n.routeIdx = (n.routeIdx + 1) % n.def.route.length;
                this.release(n);
                const s = this.town.spots.get(n.def.route[n.routeIdx]);
                if (s) {
                  n.target = s;
                  this.walkTo(n, s.pos);
                }
              } else if (n.entry.spot === 'wander') {
                const s = this.randomWander();
                if (s) {
                  n.target = s;
                  this.walkTo(n, s.pos);
                }
              }
            }
          }
          // vendors greet passing customers
          if (n.def.role === 'vendor' && n.c.state === 'idle' && player.distanceTo(n.pos) < 4.5 && Math.random() < dt * 0.4) {
            n.c.play('present');
            n.c.express('happy', 2);
            setTimeout(() => n.state === 'idle' && n.c.state === 'present' && this.talking !== n && n.c.play(n.target?.anim ?? 'idle'), 2200);
          }
          break;
        case 'talk':
          n.talkT += dt;
          break;
      }
      if (n.state === 'home') continue;
      // LOD
      const d = n.pos.distanceTo(cam);
      this.shown(n, d < 120);
      if (!n.c.root.visible) continue;
      n.lod = d > 70 ? 3 : d > 40 ? 2 : 1;
      n.c.root.rotation.y = dampAngle(n.c.root.rotation.y, n.heading, 10, dt);
      if (this.frame % n.lod === 0) n.c.update(dt * n.lod);
    }
    for (const a of this.animals) a.update(dt, player, this.area);
  }

  private stepWalk(n: Npc, dt: number, player: THREE.Vector3) {
    const tgt = n.path[n.pathIdx];
    if (!tgt) {
      this.arrive(n);
      return;
    }
    const dx = tgt.x - n.pos.x;
    const dz = tgt.z - n.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) {
      n.pathIdx++;
      if (n.pathIdx >= n.path.length) this.arrive(n);
      return;
    }
    // wait politely if the player is right in the way
    const px = player.x - n.pos.x;
    const pz = player.z - n.pos.z;
    const pd = Math.hypot(px, pz);
    if (pd < 1.3 && (px * dx + pz * dz) / (d * pd + 1e-6) > 0.5) {
      n.blockedT += dt;
      if (n.blockedT < 1.5) {
        if (n.c.state !== 'idle') n.c.play('idle');
        return;
      }
    } else if (n.blockedT > 0) {
      n.blockedT = 0;
      n.c.play(n.def.role === 'worker' ? 'carry' : 'walk');
    }
    const sp = (n.def.speed ?? 1.55) * dt;
    const k = Math.min(1, sp / d);
    n.pos.x += dx * k;
    n.pos.z += dz * k;
    const y = this.area.surface(n.pos.x, n.pos.z, n.pos.y + 0.3, 0.8);
    if (y !== null) n.pos.y += (y - n.pos.y) * clamp(dt * 12, 0, 1);
    n.heading = headingTo(dx, dz);
  }

  dispose() {
    for (const n of this.npcs) n.c.dispose();
    for (const a of this.animals) a.obj.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Animals – tiny procedural critters with simple behaviours
// ---------------------------------------------------------------------------
type Part = { body: THREE.BufferGeometry; head?: THREE.BufferGeometry; tail?: THREE.BufferGeometry; wingL?: THREE.BufferGeometry; wingR?: THREE.BufferGeometry };
const partCache = new Map<string, Part>();

function animalParts(kind: AnimalDef['kind']): Part {
  let p = partCache.get(kind);
  if (p) return p;
  const gb = () => new GeoBuilder();
  switch (kind) {
    case 'chicken': {
      const b = gb();
      b.add(ellipsoid(0.22, 0.2, 0.28, 10, 8), '#f6f1e6', T(0, 0.34, 0));
      b.add(ellipsoid(0.08, 0.14, 0.12, 8, 6), '#f6f1e6', T(0, 0.42, -0.26, -0.6, 0, 0));
      for (const sx of [-1, 1]) b.add(cyl(0.02, 0.02, 0.18, 4), '#f39c12', T(sx * 0.08, 0.09, 0));
      const h = gb();
      h.add(ellipsoid(0.1, 0.11, 0.1, 8, 6), '#f6f1e6', T(0, 0.05, 0));
      h.add(new THREE.ConeGeometry(0.04, 0.1, 5), '#f39c12', T(0, 0.03, 0.12, Math.PI / 2, 0, 0));
      h.add(ellipsoid(0.03, 0.06, 0.06, 6, 4), '#e74c3c', T(0, 0.15, 0.01));
      h.add(ellipsoid(0.025, 0.04, 0.02, 6, 4), '#e74c3c', T(0, -0.04, 0.08));
      for (const sx of [-1, 1]) h.add(new THREE.SphereGeometry(0.018, 5, 4), '#1d1426', T(sx * 0.07, 0.07, 0.06));
      p = { body: b.build(), head: h.build() };
      break;
    }
    case 'cat': {
      const b = gb();
      b.add(ellipsoid(0.17, 0.17, 0.32, 10, 8), '#f39c4a', T(0, 0.25, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl(0.05, 0.05, 0.2, 5), '#f39c4a', T(sx * 0.09, 0.1, sz * 0.18));
      const h = gb();
      h.add(ellipsoid(0.14, 0.13, 0.13, 10, 8), '#f39c4a', T(0, 0, 0));
      for (const sx of [-1, 1]) {
        h.add(new THREE.ConeGeometry(0.05, 0.1, 4), '#e8873a', T(sx * 0.08, 0.13, 0));
        h.add(ellipsoid(0.03, 0.04, 0.02, 6, 4), '#2ecc71', T(sx * 0.055, 0.03, 0.115));
      }
      h.add(new THREE.SphereGeometry(0.02, 5, 4), '#ff8fa3', T(0, -0.02, 0.13));
      const t = gb();
      t.add(cyl(0.03, 0.04, 0.38, 5), '#e8873a', T(0, 0.19, 0));
      p = { body: b.build(), head: h.build(), tail: t.build() };
      break;
    }
    case 'parrot': {
      const b = gb();
      b.add(cyl(0.05, 0.06, 1.4, 6), '#6b3e1e', T(0, 0.7, 0));
      b.add(cyl(0.035, 0.035, 0.6, 6), '#6b3e1e', T(0, 1.4, 0, 0, 0, Math.PI / 2));
      b.add(cyl(0.25, 0.3, 0.06, 10), '#5a3820', T(0, 0.03, 0));
      b.add(ellipsoid(0.11, 0.17, 0.11, 8, 6), '#2ecc71', T(0, 1.58, 0, 0.2, 0, 0));
      b.add(ellipsoid(0.05, 0.16, 0.03, 6, 4), '#e74c3c', T(0, 1.42, -0.1, 0.5, 0, 0));
      const h = gb();
      h.add(ellipsoid(0.09, 0.09, 0.09, 8, 6), '#e74c3c', T(0, 0, 0));
      h.add(new THREE.ConeGeometry(0.035, 0.09, 5), '#f6e58d', T(0, -0.02, 0.1, Math.PI / 2 + 0.4, 0, 0));
      for (const sx of [-1, 1]) h.add(new THREE.SphereGeometry(0.016, 5, 4), '#1d1426', T(sx * 0.06, 0.02, 0.05));
      const w = gb();
      w.add(ellipsoid(0.03, 0.14, 0.08, 6, 4), '#3498db', T(0, -0.1, 0));
      p = { body: b.build(), head: h.build(), wingL: w.build(), wingR: w.build() };
      break;
    }
    case 'goat': {
      const b = gb();
      b.add(roundBox(0.24, 0.24, 0.42, 3, 10, 8), '#f4f1ea', T(0, 0.62, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl(0.05, 0.045, 0.45, 5), '#e8e2d4', T(sx * 0.14, 0.22, sz * 0.28));
      const h = gb();
      h.add(ellipsoid(0.13, 0.14, 0.2, 8, 6), '#f4f1ea', T(0, 0, 0.08));
      for (const sx of [-1, 1]) {
        h.add(new THREE.ConeGeometry(0.035, 0.2, 5), '#8a7a6a', T(sx * 0.07, 0.17, -0.02, -0.5, 0, sx * 0.3));
        h.add(ellipsoid(0.08, 0.03, 0.04, 6, 4), '#e8e2d4', T(sx * 0.14, 0.03, 0, 0, 0, sx * 0.4));
        h.add(new THREE.SphereGeometry(0.02, 5, 4), '#1d1426', T(sx * 0.08, 0.04, 0.2));
      }
      h.add(ellipsoid(0.03, 0.08, 0.03, 6, 4), '#d9d2c5', T(0, -0.14, 0.18));
      p = { body: b.build(), head: h.build() };
      break;
    }
    case 'dog': {
      const b = gb();
      b.add(ellipsoid(0.2, 0.2, 0.38, 10, 8), '#a0682a', T(0, 0.45, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl(0.06, 0.05, 0.35, 5), '#a0682a', T(sx * 0.11, 0.17, sz * 0.22));
      b.add(ellipsoid(0.12, 0.06, 0.2, 8, 6), '#f4f1ea', T(0, 0.35, 0.05));
      const h = gb();
      h.add(ellipsoid(0.15, 0.15, 0.16, 10, 8), '#a0682a', T(0, 0, 0));
      h.add(ellipsoid(0.08, 0.07, 0.12, 8, 6), '#f4f1ea', T(0, -0.04, 0.14));
      h.add(new THREE.SphereGeometry(0.035, 6, 4), '#1d1426', T(0, -0.01, 0.26));
      for (const sx of [-1, 1]) {
        h.add(ellipsoid(0.05, 0.12, 0.03, 6, 4), '#6b3e1e', T(sx * 0.13, 0.02, -0.02, 0, 0, sx * 0.4));
        h.add(new THREE.SphereGeometry(0.025, 5, 4), '#1d1426', T(sx * 0.07, 0.05, 0.13));
      }
      const t = gb();
      t.add(cyl(0.03, 0.04, 0.3, 5), '#a0682a', T(0, 0.15, 0));
      p = { body: b.build(), head: h.build(), tail: t.build() };
      break;
    }
    case 'crab': {
      const b = gb();
      b.add(ellipsoid(0.2, 0.09, 0.15, 10, 6), '#e74c3c', T(0, 0.12, 0));
      for (const sx of [-1, 1]) {
        b.add(new THREE.SphereGeometry(0.07, 6, 5), '#e74c3c', T(sx * 0.25, 0.14, 0.12));
        for (let i = 0; i < 3; i++) b.add(cyl(0.015, 0.015, 0.18, 4), '#c0392b', T(sx * 0.2, 0.06, -0.08 + i * 0.07, 0, 0, sx * 1.1));
        b.add(cyl(0.012, 0.012, 0.1, 4), '#c0392b', T(sx * 0.06, 0.22, 0.08));
        b.add(new THREE.SphereGeometry(0.025, 5, 4), '#1d1426', T(sx * 0.06, 0.28, 0.08));
      }
      p = { body: b.build() };
      break;
    }
  }
  partCache.set(kind, p!);
  return p!;
}

class Animal {
  obj = new THREE.Group();
  private head: THREE.Mesh | null = null;
  private tail: THREE.Mesh | null = null;
  private wings: THREE.Mesh[] = [];
  private home: THREE.Vector3;
  private target = new THREE.Vector3();
  private heading: number;
  private t = Math.random() * 10;
  private waitT = rand(1, 4);
  private moving = false;

  constructor(
    public def: AnimalDef,
    scene: THREE.Scene,
  ) {
    const parts = animalParts(def.kind);
    const body = new THREE.Mesh(parts.body, M.vc);
    body.castShadow = true;
    this.obj.add(body);
    const headPos: Record<string, [number, number, number]> = { chicken: [0, 0.52, 0.26], cat: [0, 0.4, 0.3], parrot: [0, 1.75, 0.05], goat: [0, 0.95, 0.42], dog: [0, 0.68, 0.38], crab: [0, 0, 0] };
    if (parts.head) {
      this.head = new THREE.Mesh(parts.head, M.vc);
      this.head.position.set(...headPos[def.kind]);
      this.obj.add(this.head);
    }
    if (parts.tail) {
      this.tail = new THREE.Mesh(parts.tail, M.vc);
      this.tail.position.set(0, def.kind === 'cat' ? 0.3 : 0.55, def.kind === 'cat' ? -0.3 : -0.36);
      this.tail.rotation.x = -0.6;
      this.obj.add(this.tail);
    }
    if (parts.wingL && parts.wingR) {
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(sx < 0 ? parts.wingL : parts.wingR, M.vc);
        w.position.set(sx * 0.1, 1.66, 0);
        this.wings.push(w);
        this.obj.add(w);
      }
    }
    this.home = def.pos.clone();
    this.obj.position.copy(def.pos);
    this.heading = def.facing ?? 0;
    this.obj.rotation.y = this.heading;
    if (def.kind === 'cat') this.obj.scale.setScalar(1.1);
    scene.add(this.obj);
    this.obj.visible = false;
  }

  update(dt: number, player: THREE.Vector3, area: LandArea) {
    if (!this.obj.visible) return;
    this.t += dt;
    const k = this.def.kind;
    const p = this.obj.position;
    if (k === 'parrot') {
      const flap = Math.max(0, Math.sin(this.t * 0.7)) ** 20;
      this.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * (0.1 + flap * Math.abs(Math.sin(this.t * 30)) * 1.2)));
      if (this.head) this.head.rotation.set(Math.sin(this.t * 3) * 0.15, Math.sin(this.t * 0.9) * 0.6, 0);
      if (player.distanceTo(p) < 5 && this.head) this.head.rotation.y = headingTo(player.x - p.x, player.z - p.z) - this.heading;
      return;
    }
    // dogs come to say hello
    const pd = player.distanceTo(p);
    if (k === 'dog' && pd < 9 && pd > 2.2) {
      this.target.copy(player);
      this.moving = true;
    }
    if (!this.moving) {
      this.waitT -= dt;
      if (this.waitT <= 0) {
        const r = this.def.r;
        const a = Math.random() * Math.PI * 2;
        this.target.set(this.home.x + Math.cos(a) * r * Math.random(), 0, this.home.z + Math.sin(a) * r * Math.random());
        if (area.walkable(this.target.x, this.target.z, 0.25)) this.moving = true;
        this.waitT = k === 'cat' ? rand(5, 14) : rand(1.5, 5);
      }
    }
    // flee from a running captain
    if ((k === 'chicken' || k === 'crab') && pd < 2.2) {
      this.target.set(p.x + (p.x - player.x) * 2, 0, p.z + (p.z - player.z) * 2);
      this.moving = true;
    }
    const sp = k === 'crab' ? 0.9 : k === 'chicken' ? 1.4 : k === 'dog' ? 3.2 : k === 'goat' ? 0.8 : 1.2;
    if (this.moving) {
      const dx = this.target.x - p.x;
      const dz = this.target.z - p.z;
      const d = Math.hypot(dx, dz);
      const stop = k === 'dog' && pd < 2.4;
      if (d < 0.15 || stop) this.moving = false;
      else {
        const nx = p.x + (dx / d) * Math.min(d, sp * dt);
        const nz = p.z + (dz / d) * Math.min(d, sp * dt);
        if (area.walkable(nx, nz, 0.2)) {
          p.x = nx;
          p.z = nz;
        } else this.moving = false;
        const want = headingTo(dx, dz) + (k === 'crab' ? Math.PI / 2 : 0);
        this.heading = dampAngle(this.heading, want, 8, dt);
      }
      const y = area.surface(p.x, p.z, p.y + 0.4, 0.8);
      if (y !== null) p.y = y;
    }
    this.obj.rotation.y = this.heading;
    const bob = this.moving ? Math.abs(Math.sin(this.t * (k === 'chicken' ? 14 : 10))) : 0;
    this.obj.children[0].position.y = bob * (k === 'crab' ? 0.02 : 0.05);
    if (this.head) {
      if (k === 'chicken') this.head.rotation.x = !this.moving && Math.sin(this.t * 2.2) > 0.7 ? 0.9 : Math.sin(this.t * 9) * 0.1;
      else this.head.rotation.y = Math.sin(this.t * 0.6) * 0.4;
    }
    if (this.tail) this.tail.rotation.z = Math.sin(this.t * (k === 'dog' ? (pd < 4 ? 18 : 6) : 2)) * 0.5;
  }
}
