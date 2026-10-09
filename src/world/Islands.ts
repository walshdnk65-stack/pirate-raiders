import * as THREE from 'three';
import { GeoBuilder, T } from '../render/GeoBuilder';
import { M } from '../render/Materials';
import { mulberry32, fbm2 } from '../core/math';
import { ISLANDS, ROCKS, IslandDef, coastRadius, islandHeight, terrainHeight } from './WorldData';
import { Placer, palmTree, jungleTree, bush, rockPile, PAL, treasureChest, palmHut, seaRock, barrelAt, crate } from '../models/Props';

export interface Treasure {
  island: IslandDef;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  collected: boolean;
  value: number;
}

export interface IslandBuild {
  group: THREE.Group;
  /** Meshes the camera should not clip through. */
  colliders: THREE.Mesh[];
  treasures: Treasure[];
  /** Points that emit ambient smoke (volcano). */
  smokeVents: THREE.Vector3[];
  /** Trunks and rocks people walking on port islands bump into. */
  obstacles: { x: number; z: number; r: number }[];
}

/**
 * Exact height of the rendered (faceted) terrain mesh. The analytic terrain function and
 * the coarse ring mesh differ slightly, so walkers sample the triangles they stand on.
 */
class TerrainSampler {
  private cells = new Map<number, number[]>();
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  constructor(
    private pos: ArrayLike<number>,
    private cell = 6,
  ) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]);
      maxX = Math.max(maxX, pos[i]);
      minZ = Math.min(minZ, pos[i + 2]);
      maxZ = Math.max(maxZ, pos[i + 2]);
    }
    this.minX = minX;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxZ = maxZ;
    for (let t = 0; t < pos.length / 9; t++) {
      const o = t * 9;
      const x0 = Math.min(pos[o], pos[o + 3], pos[o + 6]);
      const x1 = Math.max(pos[o], pos[o + 3], pos[o + 6]);
      const z0 = Math.min(pos[o + 2], pos[o + 5], pos[o + 8]);
      const z1 = Math.max(pos[o + 2], pos[o + 5], pos[o + 8]);
      for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++)
        for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
          const k = cx * 73856093 ^ cz * 19349663;
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(o);
        }
    }
  }
  height(x: number, z: number): number | null {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return null;
    const k = Math.floor(x / this.cell) * 73856093 ^ Math.floor(z / this.cell) * 19349663;
    const arr = this.cells.get(k);
    if (!arr) return null;
    const p = this.pos;
    for (const o of arr) {
      const ax = p[o], az = p[o + 2], bx = p[o + 3], bz = p[o + 5], cx = p[o + 6], cz = p[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) continue;
      return w1 * p[o + 1] + w2 * p[o + 4] + w3 * p[o + 7];
    }
    return null;
  }
}

const samplers: TerrainSampler[] = [];

/** Height of the visible ground (terrain mesh) at world xz. */
export function groundHeight(x: number, z: number) {
  for (const s of samplers) {
    const h = s.height(x, z);
    if (h !== null) return h;
  }
  return terrainHeight(x, z);
}

// Vegetation is built once per variant and then stamped many times (fast loading).
type Variant = { a: THREE.BufferGeometry; b: THREE.BufferGeometry };
const variantCache = new Map<string, Variant[]>();
function variants(kind: 'palm' | 'tree' | 'bush' | 'rock', count: number): Variant[] {
  let v = variantCache.get(kind);
  if (v) return v;
  v = [];
  for (let i = 0; i < count; i++) {
    const ga = new GeoBuilder();
    const gb = new GeoBuilder();
    const seed = 1000 + i * 7919;
    if (kind === 'palm') palmTree(new Placer(ga), new Placer(gb), 9, seed);
    else if (kind === 'tree') jungleTree(new Placer(ga), new Placer(gb), 6.5, seed);
    else if (kind === 'bush') bush(new Placer(gb), 1.3, seed);
    else rockPile(new Placer(ga), 1.6, seed);
    v.push({ a: ga.build(), b: gb.build() });
  }
  variantCache.set(kind, v);
  return v;
}

/**
 * Low-detail stand-ins for distant vegetation: a trunk prism and a faceted canopy blob, sized and
 * coloured from each detailed variant (a few dozen triangles instead of thousands).
 */
const loCache = new Map<string, Variant[]>();
function loVariants(kind: 'palm' | 'tree' | 'bush' | 'rock', count: number): Variant[] {
  let lo = loCache.get(kind);
  if (lo) return lo;
  const avg = (g: THREE.BufferGeometry) => {
    const c = g.attributes.color as THREE.BufferAttribute | undefined;
    const out = new THREE.Color(0x777777);
    if (!c || !c.count) return out;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < c.count; i++) {
      r += c.getX(i);
      gg += c.getY(i);
      b += c.getZ(i);
    }
    return out.setRGB(r / c.count, gg / c.count, b / c.count);
  };
  const box = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };
  lo = variants(kind, count).map((v) => {
    const ga = new GeoBuilder();
    const gb = new GeoBuilder();
    const blob = (target: GeoBuilder, src: THREE.BufferGeometry, squash = 1) => {
      if ((src.attributes.position?.count ?? 0) <= 3) return;
      const bb = box(src);
      const c = bb.getCenter(new THREE.Vector3());
      const s = bb.getSize(new THREE.Vector3());
      target.add(new THREE.IcosahedronGeometry(1, 0), avg(src), T(c.x, c.y, c.z, 0, 0, 0, s.x * 0.5, s.y * 0.5 * squash, s.z * 0.5), { flat: true });
    };
    if (kind === 'rock' || kind === 'bush') blob(kind === 'rock' ? ga : gb, kind === 'rock' ? v.a : v.b);
    else {
      if ((v.a.attributes.position?.count ?? 0) > 3) {
        const bb = box(v.a);
        const c = bb.getCenter(new THREE.Vector3());
        const r = Math.max(0.18, Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.18);
        ga.add(new THREE.CylinderGeometry(r * 0.7, r, bb.max.y - bb.min.y, 5), avg(v.a), T(c.x, c.y, c.z));
      }
      blob(gb, v.b, kind === 'palm' ? 0.8 : 1);
    }
    return { a: ga.build(), b: gb.build() };
  });
  loCache.set(kind, lo);
  return lo;
}
/** Islands switch to low-detail vegetation beyond this distance (plus their radius). */
const VEG_LOD = 280;

const RING_S = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.58, 0.66, 0.74, 0.8, 0.86, 0.91, 0.95, 0.98, 1.0, 1.03, 1.08, 1.16, 1.3];

function terrainColor(isl: IslandDef) {
  const cGrass = new THREE.Color(PAL.grass);
  const cGrassD = new THREE.Color(PAL.grassDark);
  const cGrassL = new THREE.Color(PAL.grassLight);
  const cSand = new THREE.Color(PAL.sand);
  const cWet = new THREE.Color(PAL.wetSand);
  const cRock = new THREE.Color(PAL.rock);
  const cRockD = new THREE.Color(PAL.rockDark);
  const cVolc = new THREE.Color('#5d4a46');
  const out = new THREE.Color();
  return (c: THREE.Vector3, n: THREE.Vector3) => {
    const h = c.y;
    const nz = fbm2(c.x * 0.15, c.z * 0.15, isl.seed);
    if (h < 0.15) return out.copy(cWet).multiplyScalar(h < -1 ? 0.85 : 1);
    if (h < 1.25 + nz * 0.4) return out.copy(cSand).lerp(cWet, Math.max(0, -nz) * 0.3);
    const slope = n.y;
    if (isl.kind === 'volcano' && h > isl.hill * 0.55) return out.copy(cVolc).lerp(cRockD, nz * 0.5 + 0.5);
    if (slope < 0.62 || (isl.kind === 'rocky' && h > isl.hill * 0.6)) return out.copy(nz > 0 ? cRock : cRockD);
    if (nz > 0.25) return out.copy(cGrassL);
    if (nz < -0.2) return out.copy(cGrassD);
    return out.copy(cGrass);
  };
}

function buildTerrain(isl: IslandDef) {
  const rng = mulberry32(isl.seed * 31);
  const segs = Math.max(30, Math.round(isl.r * 1.15));
  const rings: THREE.Vector3[][] = [];
  for (let ri = 0; ri < RING_S.length; ri++) {
    const ring: THREE.Vector3[] = [];
    const s0 = RING_S[ri];
    const count = ri === 0 ? 1 : segs;
    for (let k = 0; k < count; k++) {
      const jitterA = ri > 0 && ri < RING_S.length - 1 ? (rng() - 0.5) * 0.5 : 0;
      const th = ((k + jitterA + (ri % 2) * 0.5) / segs) * Math.PI * 2;
      const rr = coastRadius(isl, th);
      const jitterS = s0 > 0 && s0 < 0.9 ? (rng() - 0.5) * 0.05 : 0;
      const s = s0 + jitterS;
      const x = isl.x + Math.cos(th) * rr * s;
      const z = isl.z + Math.sin(th) * rr * s;
      ring.push(new THREE.Vector3(x, islandHeight(isl, x, z), z));
    }
    rings.push(ring);
  }
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  // centre fan
  for (let k = 0; k < segs; k++) tri(rings[0][0], rings[1][(k + 1) % segs], rings[1][k]);
  for (let ri = 1; ri < rings.length - 1; ri++) {
    const A = rings[ri];
    const B = rings[ri + 1];
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs;
      if (ri % 2 === 0) {
        tri(A[k], A[k1], B[k]);
        tri(A[k1], B[k1], B[k]);
      } else {
        tri(A[k], B[k1], B[k]);
        tri(A[k], A[k1], B[k1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // ensure upward facing
  const gb = new GeoBuilder();
  gb.add(g, terrainColor(isl), undefined, { flat: true });
  return gb.build();
}

/** Random land spot within s-range; returns null if unsuitable. */
function sampleSpot(isl: IslandDef, rng: () => number, sMin: number, sMax: number, minH = 1.3) {
  for (let tries = 0; tries < 12; tries++) {
    const th = rng() * Math.PI * 2;
    const s = sMin + rng() * (sMax - sMin);
    const rr = coastRadius(isl, th);
    const x = isl.x + Math.cos(th) * rr * s;
    const z = isl.z + Math.sin(th) * rr * s;
    if (isl.flatten?.some((f) => Math.hypot(x - f.x, z - f.z) < f.r * 0.95)) continue;
    const h = islandHeight(isl, x, z);
    if (h < minH) continue;
    // slope check
    const h2 = islandHeight(isl, x + 1.5, z);
    const h3 = islandHeight(isl, x, z + 1.5);
    if (Math.abs(h2 - h) > 1.6 || Math.abs(h3 - h) > 1.6) continue;
    return new THREE.Vector3(x, h, z);
  }
  return null;
}

export function buildIslands(): IslandBuild {
  const group = new THREE.Group();
  group.name = 'islands';
  const colliders: THREE.Mesh[] = [];
  const treasures: Treasure[] = [];
  const smokeVents: THREE.Vector3[] = [];
  const obstacles: { x: number; z: number; r: number }[] = [];
  samplers.length = 0;

  for (const isl of ISLANDS) {
    const rng = mulberry32(isl.seed * 101);
    // every island can be explored on foot (ports by gangplank, the rest by rowing ashore)
    const walkable = true;
    const tGeo = buildTerrain(isl);
    if (walkable) samplers.push(new TerrainSampler((tGeo.attributes.position as THREE.BufferAttribute).array));
    const terrain = new THREE.Mesh(tGeo, M.vcFlat);
    terrain.receiveShadow = true;
    terrain.castShadow = false;
    terrain.layers.enable(1);
    terrain.name = isl.name;
    group.add(terrain);
    colliders.push(terrain);

    const trunks = new GeoBuilder();
    const leaves = new GeoBuilder();
    const props = new GeoBuilder();
    const pP = new Placer(props);
    // far-away version of the same vegetation
    const trunksLo = new GeoBuilder();
    const leavesLo = new GeoBuilder();
    const rocksLo = new GeoBuilder();

    const area = isl.r * isl.r;
    let palms = Math.round(area / 90);
    let trees = 0;
    let bushes = Math.round(area / 160);
    let rocks = Math.round(area / 400);
    switch (isl.kind) {
      case 'jungle':
        trees = Math.round(area / 110);
        palms = Math.round(area / 180);
        break;
      case 'rocky':
        palms = Math.round(area / 260);
        rocks = Math.round(area / 120);
        break;
      case 'volcano':
        palms = Math.round(area / 200);
        rocks = Math.round(area / 150);
        trees = Math.round(area / 300);
        break;
      case 'pirate':
      case 'port':
        palms = Math.round(area / 120);
        trees = Math.round(area / 260);
        break;
      case 'hidden':
        palms = 3;
        bushes = 3;
        rocks = 1;
        break;
    }
    palms = Math.min(palms, 70);
    trees = Math.min(trees, 60);

    const stampV = (kind: 'palm' | 'tree' | 'bush' | 'rock', p: THREE.Vector3, scale: number, dy = 0) => {
      const vs = variants(kind, kind === 'rock' ? 6 : 8);
      const vi = Math.floor(rng() * vs.length);
      const v = vs[vi];
      const lo = loVariants(kind, kind === 'rock' ? 6 : 8)[vi];
      const m = T(p.x, p.y + dy, p.z, 0, rng() * Math.PI * 2, 0, scale);
      if (walkable && kind !== 'bush') obstacles.push({ x: p.x, z: p.z, r: (kind === 'rock' ? 1.6 : kind === 'tree' ? 0.7 : 0.45) * scale });
      if (kind === 'rock') {
        props.addBuilt(v.a, m);
        if (lo.a.attributes.position.count > 3) rocksLo.addBuilt(lo.a, m);
      } else {
        if (!v.a.attributes.position || v.a.attributes.position.count > 3) trunks.addBuilt(v.a, m);
        if (v.b.attributes.position.count > 3) leaves.addBuilt(v.b, m);
        if (lo.a.attributes.position.count > 3) trunksLo.addBuilt(lo.a, m);
        if (lo.b.attributes.position.count > 3) leavesLo.addBuilt(lo.b, m);
      }
    };
    for (let i = 0; i < palms; i++) {
      const p = sampleSpot(isl, rng, 0.45, 0.9, 0.9);
      if (p) stampV('palm', p, 0.8 + rng() * 0.5);
    }
    for (let i = 0; i < trees; i++) {
      const p = sampleSpot(isl, rng, 0.05, 0.65, 2);
      if (p) stampV('tree', p, 0.8 + rng() * 0.6);
    }
    for (let i = 0; i < bushes; i++) {
      const p = sampleSpot(isl, rng, 0.2, 0.86, 1.2);
      if (p) stampV('bush', p, 0.7 + rng() * 0.7, -0.2);
    }
    for (let i = 0; i < rocks; i++) {
      const p = sampleSpot(isl, rng, 0.3, 1.02, -0.5);
      if (p) stampV('rock', p, 0.6 + rng() * 1.4, -0.3);
    }
    // a few beach props on regular islands
    if (isl.kind === 'sandy' || isl.kind === 'jungle') {
      const p = sampleSpot(isl, rng, 0.5, 0.75, 1.2);
      if (p && rng() < 0.6) palmHut(pP.child(T(p.x, p.y - 0.1, p.z, 0, rng() * 6, 0)), isl.seed);
      const q = sampleSpot(isl, rng, 0.78, 0.9, 0.4);
      if (q) {
        barrelAt(pP, q.x, q.y - 0.1, q.z, 1.0, rng() < 0.5);
        crate(pP, q.x + 1.4, q.y - 0.1, q.z + 0.6, 1.0, rng());
      }
    }
    if (isl.kind === 'volcano') {
      smokeVents.push(new THREE.Vector3(isl.x, isl.hill * 0.85, isl.z));
      // lava pool in the crater
      const lava = new THREE.Mesh(new THREE.CircleGeometry(isl.r * 0.14, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.35, 0.08).multiplyScalar(2.5) }));
      lava.rotation.x = -Math.PI / 2;
      lava.position.set(isl.x, islandHeight(isl, isl.x, isl.z) + 0.4, isl.z);
      group.add(lava);
    }
    if (isl.kind === 'hidden') {
      // X marks the spot + chest
      const th = rng() * Math.PI * 2;
      const rr = coastRadius(isl, th) * 0.3;
      const x = isl.x + Math.cos(th) * rr;
      const z = isl.z + Math.sin(th) * rr;
      const y = islandHeight(isl, x, z);
      pP.add(new THREE.BoxGeometry(3.2, 0.08, 0.5), '#c0392b', T(x, y + 0.05, z + 2.2, 0, Math.PI / 4, 0));
      pP.add(new THREE.BoxGeometry(3.2, 0.08, 0.5), '#c0392b', T(x, y + 0.05, z + 2.2, 0, -Math.PI / 4, 0));
      const chestB = new GeoBuilder();
      treasureChest(new Placer(chestB), 0, 0, 0, rng() * 6, true);
      const chest = new THREE.Mesh(chestB.build(), M.vc);
      chest.position.set(x, y - 0.05, z);
      chest.castShadow = true;
      group.add(chest);
      treasures.push({ island: isl, pos: new THREE.Vector3(x, y, z), mesh: chest, collected: false, value: 2500 + Math.floor(rng() * 2500) });
    }

    // vegetation LOD: full detail up close, simple stand-ins further out
    const lod = new THREE.LOD();
    lod.position.set(isl.x, 0, isl.z);
    const hi = new THREE.Group();
    const loG = new THREE.Group();
    hi.position.set(-isl.x, 0, -isl.z);
    loG.position.set(-isl.x, 0, -isl.z);
    if (!trunks.empty) hi.add(trunks.mesh(M.vcFlat));
    if (!leaves.empty) hi.add(leaves.mesh(M.vcDouble));
    if (!props.empty) hi.add(props.mesh(M.vc));
    if (!trunksLo.empty) loG.add(trunksLo.mesh(M.vcFlat, false));
    if (!leavesLo.empty) loG.add(leavesLo.mesh(M.vcFlat, false));
    if (!rocksLo.empty) loG.add(rocksLo.mesh(M.vcFlat, false));
    lod.addLevel(hi, 0);
    lod.addLevel(loG, VEG_LOD + isl.r);
    group.add(lod);
  }

  // sea stacks, merged by area for culling
  const buckets = new Map<string, GeoBuilder>();
  ROCKS.forEach((r, i) => {
    const key = `${Math.floor(r.x / 400)},${Math.floor(r.z / 400)}`;
    let gb = buckets.get(key);
    if (!gb) buckets.set(key, (gb = new GeoBuilder()));
    seaRock(new Placer(gb, T(r.x, -2, r.z)), r.r, r.h + 2, 900 + i);
  });
  for (const gb of buckets.values()) {
    const m = gb.mesh(M.vcFlat);
    m.layers.enable(1);
    group.add(m);
    colliders.push(m);
  }

  // everything here is static: compute matrices once instead of every frame
  group.updateMatrixWorld(true);
  group.traverse((o) => (o.matrixAutoUpdate = false));
  return { group, colliders, treasures, smokeVents, obstacles };
}
