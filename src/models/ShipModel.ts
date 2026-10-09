import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, T, cyl, ellipsoid, roundBox, beam, plankBetween, deform } from '../render/GeoBuilder';
import { addRim, canvasTexture, globalUniforms, M } from '../render/Materials';
import { clamp, lerp, smoothstep, mulberry32 } from '../core/math';
import { Placer, PAL, cannonGeo, crate, barrelAt, sack, lantern } from './Props';
import { FlagKind, makeFlag } from './Flags';

export type CannonSide = 'L' | 'R' | 'F' | 'B';

export interface SailDef {
  w: number;
  h: number;
}
export interface GaffDef {
  /** boom length (aft of the mast) */
  boom: number;
  /** gaff spar length */
  gaff: number;
  /** height of the gaff jaws above the mast foot */
  head: number;
  /** height of the boom above the mast foot */
  foot: number;
  /** how much the gaff peak rises */
  rise: number;
}
export interface MastDef {
  s: number; // position along hull 0 stern .. 1 bow
  h: number;
  sails: SailDef[]; // top to bottom
  /** tilt aft (radians) – raked schooner masts */
  rake?: number;
  /** fore-and-aft sail behind the mast */
  gaff?: GaffDef;
  /** wood (rigged), pole (steel signal mast) or lattice (radar mast) */
  kind?: 'wood' | 'pole' | 'lattice';
  /** mast foot height above the main deck */
  base?: number;
}

export interface FunnelDef {
  s: number;
  h: number;
  r: number;
  color: string;
  band: string;
  x?: number;
  rake?: number;
  /** foot height above the main deck (e.g. on top of a casemate) */
  base?: number;
  shape?: 'round' | 'box';
  pipe?: boolean;
}
export interface HouseDef {
  s0: number;
  s1: number;
  /** fraction of the hull half-width */
  w: number;
  h: number;
  color: string;
  roof: string;
  /** height above the main deck */
  y?: number;
  windows?: 'lit' | 'glass';
  rail?: boolean;
}
export interface TurretDef {
  s: number;
  barrels: number;
  scale: number;
  rest: 'F' | 'B';
  y?: number;
}

export interface ShipDesign {
  key: string;
  length: number;
  beam: number;
  depth: number;
  draft: number;
  sheer: number;
  sternW: number;
  hull: string;
  hull2: string;
  trim: string;
  bottom: string;
  deck: string;
  interior: string;
  masts: MastDef[];
  jib: boolean;
  sail: { base: string; stripe?: string; stripeMode?: 'h' | 'v' | 'none'; emblem?: 'skull' | 'crest' | 'crown' | 'anchor' | 'none'; emblemColor?: string };
  castle: number;
  castleLen: number;
  forecastle: number;
  cannons: { side: CannonSide; s: number; x?: number }[];
  cannonScale: number;
  cannonColor: string;
  armor: number;
  gold: boolean;
  figurehead: boolean;
  crates: number;
  flag: FlagKind;
  wheelS: number;
  separateCannons?: boolean;
  sailScale?: number;
  wheelGold?: boolean;
  bands?: number;
  // ---- later eras ----
  /** number of headsails (defaults to 1 when jib is set) */
  jibs?: number;
  bowsprit?: boolean;
  /** + clipper bow (top leans forward), − ram bow (forefoot juts out) */
  bowRake?: number;
  /** riveted plate pattern instead of planks */
  plating?: boolean;
  /** hull metalness */
  metal?: number;
  carriages?: boolean;
  funnels?: FunnelDef[];
  paddles?: { s: number; r: number; w: number; box: string; trim: string; bridge?: boolean };
  houses?: HouseDef[];
  casemate?: { s0: number; s1: number; h: number; color: string; top: string };
  turrets?: TurretDef[];
  turretColor?: string;
  /** decorative lower gun deck: ports with guns poking out */
  gunDeck?: { ports: number; lid: string };
  vents?: [number, number][];
  helipad?: number;
  exhaust?: boolean;
  /** wheel on a raised platform (bridge) this far above the deck */
  wheelH?: number;
  /** [station, fraction of half-width] crew positions */
  crewSpots?: [number, number][];
}

export interface CannonMount {
  obj: THREE.Object3D;
  side: CannonSide;
  /** Muzzle position in ship-local space. */
  muzzle: THREE.Vector3;
  /** Firing direction in ship-local space. */
  dir: THREE.Vector3;
  basePos: THREE.Vector3;
  recoil: number;
  /** index into ShipModel.turrets when this gun sits in a rotating turret */
  turret?: number;
}

export interface Spinner {
  obj: THREE.Object3D;
  axis: 'x' | 'y';
  rate: number;
  /** spins with the ship's speed (paddle wheels) rather than constantly (radar) */
  bySpeed: boolean;
}
export interface TurretPart {
  obj: THREE.Object3D;
  rest: number;
  target: number;
  idle: number;
}
export const SIDE_YAW: Record<CannonSide, number> = { L: Math.PI / 2, R: -Math.PI / 2, F: 0, B: Math.PI };

export interface ShipModel {
  group: THREE.Group;
  hullMat: THREE.MeshStandardMaterial;
  sails: THREE.Mesh | null;
  sailUniforms: { uBillow: { value: number }; uFurl: { value: number }; uDamage: { value: number } };
  flag: THREE.Mesh;
  cannons: CannonMount[];
  wheel: THREE.Object3D | null;
  wheelPos: THREE.Vector3;
  captainPos: THREE.Vector3;
  crewSpots: THREE.Vector3[];
  deckYAt: (z: number) => number;
  halfWidthAt: (z: number) => number;
  length: number;
  beam: number;
  /** widest point including paddle boxes */
  outerHalfWidth: number;
  topY: number;
  mastTop: number;
  lanternPos: THREE.Vector3;
  turrets: TurretPart[];
  spinners: Spinner[];
  /** smokestack tops (ship-local) */
  funnels: THREE.Vector3[];
  /** GPU resources this model owns (freed by disposeShipModel; shared ones are never listed) */
  disposables: { geos: THREE.BufferGeometry[]; mats: THREE.Material[] };
}

/** Free a ship model's own geometry and materials (cached sail/flag textures and shared materials stay). */
export function disposeShipModel(m: ShipModel) {
  for (const g of m.disposables.geos) g.dispose();
  for (const mt of m.disposables.mats) mt.dispose();
  m.disposables.geos.length = 0;
  m.disposables.mats.length = 0;
}

// ---------------------------------------------------------------------------
// Hull shape maths
// ---------------------------------------------------------------------------
function makeProfile(d: ShipDesign) {
  const L = d.length;
  const hb = d.beam / 2;
  const f = (s: number) => {
    if (s < 0.4) return lerp(d.sternW, 1, Math.sin((s / 0.4) * Math.PI * 0.5));
    return Math.pow(Math.max(0, Math.cos(((s - 0.4) / 0.6) * Math.PI * 0.5)), 0.62);
  };
  const castleK = (s: number) => (d.castle > 0 ? 1 - smoothstep(d.castleLen - 0.03, d.castleLen + 0.03, s) : 0);
  const foreK = (s: number) => (d.forecastle > 0 ? smoothstep(0.8, 0.86, s) : 0);
  const topBase = (s: number) => d.depth + d.sheer * Math.pow((s - 0.45) / 0.55, 2) * (s < 0.45 ? 1.2 : 1);
  const top = (s: number) => topBase(s) + d.castle * castleK(s) + d.forecastle * foreK(s);
  const bot = (s: number) => {
    let b = -d.draft * (1 - Math.pow(Math.max(0, s - 0.6) / 0.4, 2) * 0.85);
    if (s < 0.06) b *= lerp(0.55, 1, s / 0.06);
    return b;
  };
  const bulwark = 0.55 + d.length * 0.012;
  const deck = (s: number) => topBase(s) - bulwark;
  const raised = (s: number) => deck(s) + d.castle * castleK(s) + d.forecastle * foreK(s);
  const T_ROWS = [0, 0.07, 0.17, 0.3, 0.45, 0.6, 0.74, 0.86, 0.95, 1];
  const xAt = (s: number, t: number) => {
    const tumble = 1 - 0.06 * (1 - smoothstep(0, 0.3, t));
    return hb * f(s) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.4))) * tumble;
  };
  const rake = d.bowRake ?? 0.05;
  const zAt = (s: number, t = 0) => (s - 0.5) * L + (s > 0.85 ? L * Math.abs(rake) * (rake >= 0 ? 1 - t : t) * Math.pow((s - 0.85) / 0.15, 2) : 0);
  /** half width at a given height on station s */
  const widthAtY = (s: number, y: number) => {
    const tp = top(s);
    const b = bot(s);
    const t = clamp((tp - y) / (tp - b), 0, 1);
    return xAt(s, t);
  };
  return { L, f, top, topBase, bot, deck, raised, xAt, zAt, widthAtY, T_ROWS, bulwark, castleK, foreK };
}

function hullGeometry(d: ShipDesign, P: ReturnType<typeof makeProfile>) {
  const N = 30;
  const K = P.T_ROWS.length;
  const pos: number[] = [];
  const idx: number[] = [];
  const ringLen = 2 * K - 1;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const tp = P.top(s);
    const b = P.bot(s);
    for (let j = 0; j < ringLen; j++) {
      const t = j < K ? P.T_ROWS[j] : P.T_ROWS[2 * K - 2 - j];
      const side = j < K - 1 ? 1 : j > K - 1 ? -1 : 0;
      const x = side * P.xAt(s, t);
      const y = tp - t * (tp - b);
      pos.push(x, y, P.zAt(s, t));
    }
  }
  for (let i = 0; i < N - 1; i++)
    for (let j = 0; j < ringLen - 1; j++) {
      const a = i * ringLen + j;
      const bb = (i + 1) * ringLen + j;
      const c = (i + 1) * ringLen + j + 1;
      const dd = i * ringLen + j + 1;
      idx.push(a, bb, dd, bb, c, dd);
    }
  // transom (stern cap)
  const base = pos.length / 3;
  const s0 = 0;
  pos.push(0, (P.top(s0) + P.bot(s0)) / 2, P.zAt(s0));
  for (let j = 0; j < ringLen - 1; j++) idx.push(base, j + 1, j);
  // close the top of the transom
  idx.push(0, ringLen - 1, base);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function deckGeometry(P: ReturnType<typeof makeProfile>, yFn: (s: number) => number, s0: number, s1: number, cols = 8) {
  const N = 22;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = lerp(s0, s1, i / (N - 1));
    const y = yFn(s);
    const hw = P.widthAtY(s, y) * 0.99;
    for (let c = 0; c <= cols; c++) {
      const x = lerp(-hw, hw, c / cols);
      pos.push(x, y, P.zAt(s, 0.1));
    }
  }
  const rl = cols + 1;
  for (let i = 0; i < N - 1; i++)
    for (let c = 0; c < cols; c++) {
      const a = i * rl + c;
      idx.push(a, a + 1, a + rl, a + 1, a + rl + 1, a + rl);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Strip following the inside/outside of the hull between two heights. */
function hullStrip(P: ReturnType<typeof makeProfile>, side: 1 | -1, y0Fn: (s: number) => number, y1Fn: (s: number) => number, inset: number, s0 = 0, s1 = 0.985) {
  const N = 24;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = lerp(s0, s1, i / (N - 1));
    const ya = y0Fn(s);
    const yb = y1Fn(s);
    const xa = Math.max(0.02, P.widthAtY(s, ya) - inset) * side;
    const xb = Math.max(0.02, P.widthAtY(s, yb) - inset) * side;
    const z = P.zAt(s, 0.05);
    pos.push(xa, ya, z, xb, yb, z);
  }
  for (let i = 0; i < N - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Sails
// ---------------------------------------------------------------------------
const sailTexCache = new Map<string, THREE.Texture>();
function sailTexture(d: ShipDesign) {
  const key = JSON.stringify(d.sail);
  let t = sailTexCache.get(key);
  if (t) return t;
  const sl = d.sail;
  t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = sl.base;
    ctx.fillRect(0, 0, w, h);
    if (sl.stripe && sl.stripeMode !== 'none') {
      ctx.fillStyle = sl.stripe;
      const n = 5;
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) continue;
        if (sl.stripeMode === 'v') ctx.fillRect((i * w) / n, 0, w / n, h);
        else ctx.fillRect(0, (i * h) / n, w, h / n);
      }
    }
    // seams & shading
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo((i * w) / 8, 0);
      ctx.lineTo((i * w) / 8, h);
      ctx.stroke();
    }
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(0,0,0,0.12)');
    grd.addColorStop(0.15, 'rgba(0,0,0,0)');
    grd.addColorStop(0.85, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    // edge band
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    const ec = sl.emblemColor ?? '#1a1a1a';
    const cx = w / 2;
    const cy = h / 2 + 6;
    ctx.fillStyle = ec;
    switch (sl.emblem) {
      case 'skull': {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1.25, 1.25);
        for (const a of [0.7, -0.7]) {
          ctx.save();
          ctx.rotate(a);
          ctx.beginPath();
          ctx.roundRect(-44, -6, 88, 12, 6);
          ctx.fill();
          for (const ex of [-44, 44])
            for (const ey of [-7, 7]) {
              ctx.beginPath();
              ctx.arc(ex, ey, 8, 0, Math.PI * 2);
              ctx.fill();
            }
          ctx.restore();
        }
        ctx.beginPath();
        ctx.ellipse(0, -10, 30, 28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(-17, 6, 34, 20, 6);
        ctx.fill();
        ctx.fillStyle = sl.base;
        for (const ex of [-12, 12]) {
          ctx.beginPath();
          ctx.ellipse(ex, -10, 9, 10, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-5, 9);
        ctx.lineTo(5, 9);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'crest':
        ctx.beginPath();
        ctx.moveTo(cx - 40, cy - 45);
        ctx.lineTo(cx + 40, cy - 45);
        ctx.lineTo(cx + 40, cy + 5);
        ctx.quadraticCurveTo(cx + 40, cy + 40, cx, cy + 55);
        ctx.quadraticCurveTo(cx - 40, cy + 40, cx - 40, cy + 5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = sl.base;
        ctx.fillRect(cx - 6, cy - 35, 12, 70);
        ctx.fillRect(cx - 30, cy - 10, 60, 12);
        break;
      case 'crown':
        ctx.beginPath();
        ctx.moveTo(cx - 50, cy + 30);
        ctx.lineTo(cx - 50, cy - 30);
        ctx.lineTo(cx - 25, cy);
        ctx.lineTo(cx, cy - 45);
        ctx.lineTo(cx + 25, cy);
        ctx.lineTo(cx + 50, cy - 30);
        ctx.lineTo(cx + 50, cy + 30);
        ctx.closePath();
        ctx.fill();
        break;
      case 'anchor':
        ctx.lineWidth = 14;
        ctx.strokeStyle = ec;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 50);
        ctx.lineTo(cx, cy + 45);
        ctx.moveTo(cx - 30, cy - 25);
        ctx.lineTo(cx + 30, cy - 25);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy + 5, 45, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy - 62, 12, 0, Math.PI * 2);
        ctx.stroke();
        break;
    }
  });
  sailTexCache.set(key, t);
  return t;
}

function sailMaterial(d: ShipDesign, uniforms: ShipModel['sailUniforms']) {
  // emissive copy of the canvas texture fakes light glowing through the sailcloth
  const tex = sailTexture(d);
  const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x6a6660, side: THREE.DoubleSide, roughness: 0.95 });
  addRim(m, 0.15);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev.call(m, shader, r);
    shader.uniforms.uBillow = uniforms.uBillow;
    shader.uniforms.uFurl = uniforms.uFurl;
    shader.uniforms.uDamage = uniforms.uDamage;
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aBillowDir;
        attribute float aBillowW;
        attribute float aTop;
        uniform float uBillow; uniform float uFurl; uniform float uTime;
        varying vec2 vSailUv;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSailUv = uv;
        float flutter = sin(uTime * 7.0 + position.y * 2.0 + position.x) * 0.06 * (1.2 - uBillow);
        transformed += aBillowDir * aBillowW * (uBillow * (1.0 - uFurl * 0.8) + flutter);
        transformed.y = mix(transformed.y, aTop, uFurl * 0.82);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDamage;
        varying vec2 vSailUv;
        float sh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float sn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(sh(i),sh(i+vec2(1,0)),f.x), mix(sh(i+vec2(0,1)),sh(i+vec2(1,1)),f.x), f.y); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float holes = sn(vSailUv * 7.0) * 0.65 + sn(vSailUv * 17.0) * 0.35;
        if (uDamage > 0.01 && holes < uDamage * 0.42) discard;
        float scorch = 1.0 - smoothstep(uDamage * 0.42, uDamage * 0.42 + 0.08, holes);
        diffuseColor.rgb *= 1.0 - scorch * 0.5 * step(0.01, uDamage);`,
      );
  };
  m.customProgramCacheKey = () => 'sail';
  return m;
}

/** Square sail hanging below a yard, billowing toward +Z. */
function squareSail(w: number, h: number, yTop: number, z: number, furlY = yTop) {
  const g = new THREE.PlaneGeometry(1, 1, 8, 6);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = p.count;
  const dir = new Float32Array(n * 3);
  const wgt = new Float32Array(n);
  const top = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i); // 1 top, 0 bottom
    const ww = lerp(w * 1.08, w * 0.92, v); // wider at the foot
    p.setXYZ(i, (u - 0.5) * ww, yTop - (1 - v) * h, z);
    dir[i * 3 + 2] = 1;
    wgt[i] = Math.sin(Math.PI * u) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, (1 - v) * 1.1))) * h * 0.32;
    top[i] = furlY;
  }
  g.setAttribute('aBillowDir', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aBillowW', new THREE.BufferAttribute(wgt, 1));
  g.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
  g.computeVertexNormals();
  return g;
}

/** Triangular jib: from bowsprit tip up to the mast. */
function jibSail(tip: THREE.Vector3, head: THREE.Vector3, foot: THREE.Vector3) {
  const S = 6;
  const pos: number[] = [];
  const uvs: number[] = [];
  const dir: number[] = [];
  const wgt: number[] = [];
  const top: number[] = [];
  const idx: number[] = [];
  // grid in barycentric rows
  let k = 0;
  const rows: number[][] = [];
  for (let i = 0; i <= S; i++) {
    const row: number[] = [];
    for (let j = 0; j <= S - i; j++) {
      const a = i / S;
      const b = j / S;
      const c = 1 - a - b;
      const p = new THREE.Vector3().addScaledVector(head, a).addScaledVector(foot, b).addScaledVector(tip, c);
      pos.push(p.x, p.y, p.z);
      uvs.push(b + a * 0.5, a);
      dir.push(1, 0, 0);
      wgt.push(Math.min(a, b, c) * 2.2);
      top.push(p.y);
      row.push(k++);
    }
    rows.push(row);
  }
  for (let i = 0; i < S; i++)
    for (let j = 0; j < S - i; j++) {
      idx.push(rows[i][j], rows[i][j + 1], rows[i + 1][j]);
      if (j < S - i - 1) idx.push(rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aBillowDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aBillowW', new THREE.Float32BufferAttribute(wgt, 1));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Fore-and-aft (gaff) sail: a four-cornered sail between mast, boom and gaff, billowing sideways. */
function gaffSail(tack: THREE.Vector3, throat: THREE.Vector3, peak: THREE.Vector3, clew: THREE.Vector3) {
  const NU = 7;
  const NV = 6;
  const pos: number[] = [];
  const uvs: number[] = [];
  const dir: number[] = [];
  const wgt: number[] = [];
  const top: number[] = [];
  const idx: number[] = [];
  const size = Math.max(tack.distanceTo(clew), tack.distanceTo(throat));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let j = 0; j <= NV; j++)
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const v = j / NV;
      a.lerpVectors(tack, clew, u);
      b.lerpVectors(throat, peak, u);
      const p = a.clone().lerp(b, v);
      pos.push(p.x, p.y, p.z);
      uvs.push(u, v);
      dir.push(1, 0, 0);
      wgt.push(Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.15 + 0.08)) * size * 0.09);
      top.push(a.y);
    }
  for (let j = 0; j < NV; j++)
    for (let i = 0; i < NU; i++) {
      const k = j * (NU + 1) + i;
      idx.push(k, k + 1, k + NU + 1, k + 1, k + NU + 2, k + NU + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aBillowDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aBillowW', new THREE.Float32BufferAttribute(wgt, 1));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------
export function makeHullMaterial(metal = 0) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 - metal * 0.6, metalness: metal, side: THREE.DoubleSide, emissive: 0x000000 });
  return addRim(m, 0.22);
}
/** Moving parts (turrets, paddle wheels, radar) – painted metal. */
function makePartMaterial() {
  return addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }), 0.25);
}

const templates = new Map<string, ShipModel>();

/** NPC ship designs are built once, then cloned (geometry shared, materials per ship). */
export function buildShip(d: ShipDesign): ShipModel {
  if (d.separateCannons) return buildShipModel(d);
  let t = templates.get(d.key);
  if (!t) {
    t = buildShipModel(d);
    templates.set(d.key, t);
  }
  return cloneShip(t, d);
}

function cloneShip(t: ShipModel, d: ShipDesign): ShipModel {
  const group = t.group.clone(true);
  let flag: THREE.Mesh = t.flag;
  let sails: THREE.Mesh | null = null;
  let wheel: THREE.Object3D | null = null;
  const hullMat = makeHullMaterial(d.metal ?? 0);
  const sailUniforms = { uBillow: { value: 1 }, uFurl: { value: 0 }, uDamage: { value: 0 } };
  const turrets: TurretPart[] = [];
  const spinners: Spinner[] = [];
  group.traverse((o) => {
    const role = o.userData.role;
    if (role === 'hull') (o as THREE.Mesh).material = hullMat;
    if (role === 'sails') {
      sails = o as THREE.Mesh;
      sails.material = sailMaterial(d, sailUniforms);
    }
    if (role === 'flag') flag = o as THREE.Mesh;
    if (role === 'wheel') wheel = o;
    if (o.userData.turretIdx !== undefined) turrets[o.userData.turretIdx] = { ...t.turrets[o.userData.turretIdx], obj: o };
    if (o.userData.spinnerIdx !== undefined) spinners[o.userData.spinnerIdx] = { ...t.spinners[o.userData.spinnerIdx], obj: o };
  });
  return {
    ...t,
    group,
    hullMat,
    sails,
    sailUniforms,
    flag,
    wheel,
    cannons: t.cannons.map((c) => ({ ...c, obj: c.turret !== undefined ? turrets[c.turret].obj : group, muzzle: c.muzzle.clone(), dir: c.dir.clone(), basePos: c.basePos.clone(), recoil: 0 })),
    turrets,
    spinners,
    funnels: t.funnels.map((v) => v.clone()),
    // a clone shares the template's geometry; it only owns its hull and sail materials
    disposables: { geos: [], mats: [hullMat, ...(sails ? [(sails as THREE.Mesh).material as THREE.Material] : [])] },
    wheelPos: t.wheelPos.clone(),
    captainPos: t.captainPos.clone(),
    crewSpots: t.crewSpots.map((v) => v.clone()),
    lanternPos: t.lanternPos.clone(),
  };
}

function buildShipModel(d: ShipDesign): ShipModel {
  const P = makeProfile(d);
  const L = d.length;
  const group = new THREE.Group();
  const wood = new GeoBuilder();
  const metal = new GeoBuilder();
  const glow = new GeoBuilder();
  const wP = new Placer(wood);
  const mP = new Placer(metal);
  const gP = new Placer(glow);
  const rng = mulberry32(L * 1000);
  const sOf = (z: number) => z / L + 0.5;
  const turrets: TurretPart[] = [];
  const spinners: Spinner[] = [];
  const funnels: THREE.Vector3[] = [];
  let partMat: THREE.MeshStandardMaterial | null = null;
  const parts = () => (partMat ??= makePartMaterial());
  const at = (M: THREE.Matrix4, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M);

  // roofs you can stand on (deckhouses, casemate) – crew, boarders and the gangplank use them
  const covers: { s0: number; s1: number; hw: number; y: number }[] = [];
  for (const h of d.houses ?? []) {
    const sm = (h.s0 + h.s1) / 2;
    covers.push({ s0: h.s0, s1: h.s1, hw: P.widthAtY(sm, P.deck(sm) + 0.5) * h.w, y: P.deck(sm) + (h.y ?? 0) + h.h + 0.1 });
  }
  if (d.casemate) {
    const c = d.casemate;
    const sm = (c.s0 + c.s1) / 2;
    covers.push({ s0: c.s0 + 0.02, s1: c.s1 - 0.02, hw: P.widthAtY(sm, P.deck(sm) + 0.3) * CASEMATE_W * 0.62, y: P.deck(sm) + c.h });
  }
  const surfaceY = (s: number, x = 0) => {
    let y = P.raised(s);
    for (const c of covers) if (s >= c.s0 && s <= c.s1 && Math.abs(x) <= c.hw && c.y > y) y = c.y;
    return y;
  };

  // ---------------- hull ----------------
  const hullDark = new THREE.Color(d.hull).multiplyScalar(0.84).getStyle();
  const plateDark = new THREE.Color(d.hull).multiplyScalar(0.91).getStyle();
  const hullColor = (c: THREE.Vector3) => {
    const s = clamp(sOf(c.z), 0, 1);
    const tp = P.top(s);
    if (c.y < 0.1) return d.bottom;
    if (c.y > tp - 0.24) return d.trim;
    const wale = P.topBase(s) * 0.42;
    if (c.y > wale && c.y < wale + 0.3) return d.hull2;
    if (d.castle > 0 && P.castleK(s) > 0.5 && c.y > P.topBase(s) + 0.1 && c.y < P.topBase(s) + 0.32) return d.hull2;
    if (d.plating) return (Math.floor((c.y + 5) / 1.05) + Math.floor((c.z + 100) / 2.6)) % 2 ? d.hull : plateDark;
    return Math.floor((c.y + 5) / 0.34) % 2 ? d.hull : hullDark;
  };
  wP.add(hullGeometry(d, P), hullColor);

  // ---------------- decks ----------------
  const deckDark = new THREE.Color(d.deck).multiplyScalar(0.88).getStyle();
  const deckColor = (c: THREE.Vector3) => (Math.floor((c.x + 20) / 0.42) % 2 ? d.deck : deckDark);
  const deckEnd = 0.93;
  wP.add(deckGeometry(P, P.deck, 0.0, deckEnd), deckColor);
  if (d.castle > 0) {
    const yQ = (s: number) => P.deck(s) + d.castle;
    wP.add(deckGeometry(P, yQ, 0.0, d.castleLen, 6), deckColor);
    // cabin front wall
    const s = d.castleLen;
    const z = P.zAt(s);
    const hw = P.widthAtY(s, P.deck(s) + d.castle * 0.5);
    wP.add(new THREE.BoxGeometry(hw * 2 * 0.98, d.castle, 0.16), d.interior, T(0, P.deck(s) + d.castle / 2, z));
    // door + windows on cabin front
    wP.add(roundBox(0.42, Math.min(0.75, d.castle * 0.42), 0.06, 4), PAL.woodDark, T(0, P.deck(s) + Math.min(0.75, d.castle * 0.42), z + 0.1));
    if (d.castle > 1.1)
      for (const sx of [-1, 1]) gP.add(new THREE.BoxGeometry(0.5, 0.45, 0.05), '#fff', T(sx * hw * 0.55, P.deck(s) + d.castle * 0.6, z + 0.09));
    // railing on the quarterdeck front edge
    const ry = P.deck(s) + d.castle;
    for (let i = 0; i <= 6; i++) {
      const x = lerp(-hw, hw, i / 6);
      wP.add(cyl(0.05, 0.06, 0.6, 5), d.trim, T(x, ry + 0.3, z));
    }
    wP.add(new THREE.BoxGeometry(hw * 2, 0.1, 0.14), d.trim, T(0, ry + 0.62, z));
    // stairs
    for (let i = 0; i < 4; i++) wP.add(new THREE.BoxGeometry(0.9, 0.12, 0.35), PAL.woodLight, T(hw * 0.6, P.deck(s) + (d.castle * (i + 0.5)) / 4, z + 0.25 + (3 - i) * 0.3));
  }
  if (d.forecastle > 0) {
    const yF = (s: number) => P.deck(s) + d.forecastle;
    wP.add(deckGeometry(P, yF, 0.83, deckEnd, 5), deckColor);
    const s = 0.83;
    const hw = P.widthAtY(s, P.deck(s) + d.forecastle * 0.5);
    wP.add(new THREE.BoxGeometry(hw * 2 * 0.98, d.forecastle, 0.16), d.interior, T(0, P.deck(s) + d.forecastle / 2, P.zAt(s)));
  }

  // bulwark lining + cap rail
  for (const side of [1, -1] as const) {
    wP.add(hullStrip(P, side, (s) => P.raised(s), (s) => P.top(s), 0.08, 0, 0.97), d.interior);
    // cap rail
    const N = 22;
    for (let i = 0; i < N; i++) {
      const s0 = (i / N) * 0.975;
      const s1 = ((i + 1) / N) * 0.975;
      const a = new THREE.Vector3(side * (P.xAt(s0, 0) - 0.04), P.top(s0) + 0.05, P.zAt(s0, 0));
      const b = new THREE.Vector3(side * (P.xAt(s1, 0) - 0.04), P.top(s1) + 0.05, P.zAt(s1, 0));
      wP.add(plankBetween(a, b, 0.24, 0.12), d.trim);
    }
  }

  // stern windows on the transom
  {
    const s = 0.0;
    const z = P.zAt(s) - 0.05;
    const yTop = P.top(s);
    const hw = P.xAt(s, 0.2);
    const nW = d.length > 20 ? 4 : 2;
    const wy = d.castle > 0 ? yTop - d.castle * 0.55 : yTop - 0.6;
    for (let i = 0; i < nW; i++) {
      const x = lerp(-hw * 0.6, hw * 0.6, i / (nW - 1));
      gP.add(new THREE.BoxGeometry(0.5, 0.55, 0.1), '#fff', T(x, wy, z));
      wP.add(new THREE.BoxGeometry(0.66, 0.1, 0.16), d.gold ? PAL.gold : d.trim, T(x, wy - 0.32, z));
      wP.add(new THREE.BoxGeometry(0.66, 0.1, 0.16), d.gold ? PAL.gold : d.trim, T(x, wy + 0.32, z));
    }
    if (d.gold) {
      wP.add(new THREE.TorusGeometry(hw * 0.7, 0.08, 6, 20, Math.PI), PAL.gold, T(0, wy + 0.5, z - 0.02));
    }
  }

  // armour plating / iron bands
  const bands = d.bands ?? 0;
  for (let bi = 0; bi < bands; bi++) {
    for (const side of [1, -1] as const) {
      const N = 18;
      for (let i = 0; i < N; i++) {
        const s0 = 0.03 + (i / N) * 0.86;
        const s1 = 0.03 + ((i + 1) / N) * 0.86;
        const yf = (s: number) => lerp(0.35, P.topBase(s) - 0.35, (bi + 0.5) / bands);
        const a = new THREE.Vector3(side * (P.widthAtY(s0, yf(s0)) + 0.03), yf(s0), P.zAt(s0));
        const b = new THREE.Vector3(side * (P.widthAtY(s1, yf(s1)) + 0.03), yf(s1), P.zAt(s1));
        mP.add(plankBetween(a, b, 0.06, 0.16), PAL.iron);
      }
    }
  }
  if (d.armor > 0) {
    const plates = Math.round(L / 2.4);
    for (const side of [1, -1] as const)
      for (let i = 0; i < plates; i++) {
        const s = 0.08 + (i / plates) * 0.74;
        const y = P.topBase(s) * 0.55;
        const x = P.widthAtY(s, y) + 0.04;
        const z = P.zAt(s);
        const plate = roundBox(0.07, 0.42 + d.armor * 0.08, (L / plates) * 0.42, 5, 10, 8);
        const nrm = Math.atan2(P.widthAtY(s + 0.02, y) - P.widthAtY(s - 0.02, y), 0.04 * L) * side;
        mP.add(plate, i % 2 ? PAL.iron : '#4b525c', T(side * x, y, z, 0, nrm, 0));
        for (const dy of [-0.3, 0.3]) mP.add(new THREE.SphereGeometry(0.06, 6, 4), '#9aa3ad', T(side * (x + 0.06), y + dy, z));
      }
  }

  // decorative lower gun deck (galleons): a row of ports with guns poking out
  if (d.gunDeck) {
    const n = d.gunDeck.ports;
    for (const side of [1, -1] as const)
      for (let i = 0; i < n; i++) {
        const s = lerp(0.22, 0.78, i / (n - 1));
        const y = P.topBase(s) * 0.46;
        const x = P.widthAtY(s, y);
        const z = P.zAt(s);
        wP.add(new THREE.BoxGeometry(0.1, 0.52, 0.6), '#151010', T(side * (x + 0.02), y, z));
        wP.add(new THREE.BoxGeometry(0.08, 0.12, 0.7), d.gunDeck.lid, T(side * (x + 0.06), y + 0.34, z));
        mP.add(cyl(0.1, 0.13, 1.0, 8), d.cannonColor, T(side * (x + 0.32), y - 0.02, z, 0, 0, Math.PI / 2));
      }
  }

  // ---------------- masts, yards, sails ----------------
  const sailUniforms = { uBillow: { value: 1 }, uFurl: { value: 0 }, uDamage: { value: 0 } };
  const sailGeos: THREE.BufferGeometry[] = [];
  let mastTop = 0;
  let mainMastZ = 0;
  let mainMastTop = 0;
  const sailScale = d.sailScale ?? 1;
  const mastMats: THREE.Matrix4[] = [];
  d.masts.forEach((m, mi) => {
    const z = P.zAt(m.s);
    const y0 = P.deck(m.s) + (m.base ?? 0);
    const h = m.h;
    const r = 0.16 + L * 0.006;
    const kind = m.kind ?? 'wood';
    // mast frame: foot on the deck, optionally raked aft
    const M = new THREE.Matrix4().makeTranslation(0, y0, z);
    if (m.rake) M.multiply(new THREE.Matrix4().makeRotationX(-m.rake));
    mastMats.push(M);
    const local = (mat: THREE.Matrix4) => M.clone().multiply(mat);
    if (kind === 'lattice') latticeMast(mP, M, h, d.trim, group, parts(), spinners);
    else {
      wP.add(cyl(r * 0.7, r, h, 8), kind === 'pole' ? PAL.iron : PAL.wood, local(T(0, h / 2, 0)));
      // mast bands
      for (let i = 1; i < 4; i++) mP.add(cyl(r * 1.08, r * 1.08, 0.12, 8), PAL.iron, local(T(0, (h * i) / 4, 0)));
    }
    const tip = at(M, 0, h, 0);
    if (tip.y > mastTop) mastTop = tip.y;
    if (mi === 0 || h > mainMastTop - y0) {
      mainMastZ = tip.z;
      mainMastTop = tip.y;
    }
    // crow's nest
    if (h > 13 && kind !== 'lattice') {
      const yn = h * 0.78;
      wP.add(cyl(0.95, 0.75, 0.55, 10, false), kind === 'pole' ? '#5a616b' : PAL.woodLight, local(T(0, yn, 0)));
      wP.add(cyl(1.0, 1.0, 0.1, 10), d.trim, local(T(0, yn + 0.3, 0)));
    }
    // square sails top-down
    let yTop = h - 0.6;
    for (const sd of m.sails) {
      const sw = sd.w * sailScale;
      const sh = sd.h * sailScale;
      wP.add(cyl(0.09, 0.09, sw * 1.12, 6), PAL.woodDark, local(T(0, yTop + 0.05, 0.25, 0, 0, Math.PI / 2)));
      sailGeos.push(squareSail(sw, sh, yTop, 0.32, at(M, 0, yTop, 0.32).y).applyMatrix4(M));
      yTop -= sh + 0.25;
    }
    // fore-and-aft sail on a boom and gaff
    if (m.gaff) {
      const gf = m.gaff;
      const k = sailScale;
      const boomEnd = at(M, 0, gf.foot + 0.25, -gf.boom * k);
      const gaffEnd = at(M, 0, gf.head + gf.rise * k, -gf.gaff * k);
      wP.add(beam(at(M, 0, gf.foot, -0.15), boomEnd, 0.1, 6), PAL.woodDark);
      wP.add(beam(at(M, 0, gf.head, -0.15), gaffEnd, 0.085, 6), PAL.woodDark);
      wP.add(beam(gaffEnd, at(M, 0, h * 0.97, 0), 0.025, 3), PAL.rope);
      sailGeos.push(gaffSail(at(M, 0, gf.foot + 0.18, -0.35), at(M, 0, gf.head - 0.12, -0.35), gaffEnd.clone().add(new THREE.Vector3(0, -0.12, 0.15)), boomEnd.clone().add(new THREE.Vector3(0, 0.12, 0.15))));
    }
    // shrouds (rope ladders)
    if (kind === 'wood')
      for (const side of [1, -1]) {
        const sTop = at(M, 0, h * 0.75, 0);
        for (let k = -1; k <= 1; k++) {
          const ss = clamp(m.s + k * 0.035, 0.02, 0.9);
          const base = new THREE.Vector3(side * (P.xAt(ss, 0) + 0.05), P.top(ss), P.zAt(ss));
          wP.add(beam(base, sTop, 0.035, 4), PAL.rope);
        }
        // ratlines
        for (let k = 1; k < 6; k++) {
          const t = k / 6;
          const aa = new THREE.Vector3(side * (P.xAt(m.s - 0.035, 0) + 0.05), P.top(m.s), P.zAt(m.s - 0.035)).lerp(sTop, t);
          const bb = new THREE.Vector3(side * (P.xAt(m.s + 0.035, 0) + 0.05), P.top(m.s), P.zAt(m.s + 0.035)).lerp(sTop, t);
          wP.add(beam(aa, bb, 0.025, 3), PAL.rope);
        }
      }
    else if (kind === 'pole')
      for (const side of [1, -1]) {
        const base = new THREE.Vector3(side * (P.xAt(m.s, 0) + 0.05), P.top(m.s), P.zAt(m.s));
        wP.add(beam(base, at(M, 0, h * 0.72, 0), 0.03, 3), '#2a2e35');
      }
  });
  // stays between masts and to the bowsprit
  const jibs = d.jibs ?? (d.jib ? 1 : 0);
  const sprit = d.bowsprit !== false;
  const bowTip = new THREE.Vector3(0, P.top(1) + 1.2, P.zAt(1) + L * (jibs >= 2 ? 0.22 : 0.17));
  if (d.masts.length) {
    const fi = d.masts.length - 1;
    const front = d.masts[fi];
    const rigged = (m: MastDef) => (m.kind ?? 'wood') !== 'lattice';
    const fTop = at(mastMats[fi], 0, front.h * 0.92, 0);
    if (sprit) {
      const bs = new THREE.Vector3(0, P.top(0.9), P.zAt(0.9));
      wP.add(beam(bs, bowTip, 0.13 + L * 0.004, 7), PAL.wood);
      if (rigged(front)) wP.add(beam(fTop, bowTip, 0.04, 4), PAL.rope);
    }
    for (let i = 0; i < d.masts.length - 1; i++) {
      const a = d.masts[i];
      const b = d.masts[i + 1];
      if (!rigged(a) || !rigged(b)) continue;
      wP.add(beam(at(mastMats[i], 0, a.h * 0.95, 0), at(mastMats[i + 1], 0, b.h * 0.6, 0), 0.035, 4), PAL.rope);
    }
    const back = d.masts[0];
    if (rigged(back)) wP.add(beam(at(mastMats[0], 0, back.h * 0.9, 0), new THREE.Vector3(0, P.top(0.02) + 0.2, P.zAt(0.02)), 0.035, 4), PAL.rope);
    if (sprit && jibs >= 1) {
      const head = fTop.clone().lerp(bowTip, 0.06);
      const foot = new THREE.Vector3(0, P.top(0.88) + 0.6, P.zAt(0.86));
      sailGeos.push(jibSail(bowTip.clone().add(new THREE.Vector3(0, -0.1, -0.4)), head, foot));
    }
    if (sprit && jibs >= 2) {
      // flying jib out on the jib-boom
      const head2 = at(mastMats[fi], 0, front.h * 0.99, 0);
      wP.add(beam(head2, bowTip, 0.03, 3), PAL.rope);
      const foot2 = new THREE.Vector3(0, P.top(0.97) + 1.0, P.zAt(1) + L * 0.06);
      sailGeos.push(jibSail(bowTip.clone().add(new THREE.Vector3(0, 0.05, 0.1)), head2.clone().lerp(bowTip, 0.12), foot2));
    }
  }
  if (d.figurehead) {
    const fz = P.zAt(1) + 0.3;
    const fy = P.top(1) - 0.3;
    mP.add(ellipsoid(0.32, 0.45, 0.3), PAL.gold, T(0, fy, fz, -0.6, 0, 0));
    mP.add(new THREE.SphereGeometry(0.24, 10, 8), PAL.gold, T(0, fy + 0.45, fz + 0.32));
    mP.add(ellipsoid(0.5, 0.12, 0.2), PAL.gold, T(0, fy - 0.1, fz - 0.1, -0.5, 0, 0));
  }

  // ---------------- lanterns ----------------
  const sternY = P.top(0.0);
  const lanternPos = new THREE.Vector3(0, sternY + 1.4, P.zAt(0.0) + 0.4);
  for (const sx of [-1, 1]) {
    const lx = sx * P.xAt(0.02, 0) * 0.85;
    wP.add(cyl(0.06, 0.06, 1.1, 5), PAL.woodDark, T(lx, sternY + 0.5, P.zAt(0.02)));
    lantern(mP, gP, lx, sternY + 1.25, P.zAt(0.02), 1.0);
  }
  lantern(mP, gP, 0, P.top(0.95) + 0.5, P.zAt(0.95), 0.9);

  // ---------------- steam & modern fittings ----------------
  buildHouses(d, P, wP, gP);
  if (d.casemate) buildCasemate(d, P, wP, mP);
  let outerHalfWidth = d.beam / 2;
  if (d.paddles) outerHalfWidth = buildPaddles(d, P, wP, group, parts(), spinners);
  for (const f of d.funnels ?? []) funnels.push(buildFunnel(f, P, wP, mP));
  for (const [s, xf] of d.vents ?? []) {
    const z = P.zAt(s);
    const y = surfaceY(s, 0);
    const x = xf * P.widthAtY(s, y + 0.3);
    wP.add(cyl(0.2, 0.24, 1.3, 10), '#f3ead6', T(x, y + 0.65, z));
    wP.add(ellipsoid(0.4, 0.36, 0.36), '#f3ead6', T(x, y + 1.42, z + 0.08));
    wP.add(cyl(0.27, 0.27, 0.06, 12), '#b3261e', T(x, y + 1.42, z + 0.4, Math.PI / 2, 0, 0));
  }
  if (d.helipad !== undefined) {
    const s = d.helipad;
    const z = P.zAt(s);
    const y = P.raised(s) + 0.03;
    const r = Math.min(2.7, P.widthAtY(s, y) * 0.78);
    wP.add(cyl(r, r, 0.04, 24), '#4a525c', T(0, y, z));
    wP.add(new THREE.TorusGeometry(r * 0.82, 0.08, 4, 28), PAL.gold, T(0, y + 0.04, z, Math.PI / 2, 0, 0));
    for (const sx of [-1, 1]) wP.add(new THREE.BoxGeometry(0.24, 0.04, 1.6), '#ffffff', T(sx * 0.5, y + 0.05, z));
    wP.add(new THREE.BoxGeometry(1.0, 0.04, 0.24), '#ffffff', T(0, y + 0.05, z));
  }
  if (d.exhaust) {
    const z = P.zAt(0) - 0.06;
    for (const sx of [-1, 1]) gP.add(new THREE.BoxGeometry(1.0, 0.45, 0.12), '#fff', T(sx * P.xAt(0, 0.5) * 0.5, 0.75, z));
  }

  // ---------------- cargo on deck ----------------
  for (let i = 0; i < d.crates; i++) {
    const s = 0.3 + ((i * 0.618) % 1) * 0.42;
    const x = (rng() - 0.5) * P.widthAtY(s, P.deck(s)) * 1.1;
    const y = surfaceY(s, x);
    const kind = i % 3;
    if (kind === 0) crate(wP, x, y, P.zAt(s), 0.8 + rng() * 0.4, rng());
    else if (kind === 1) barrelAt(wP, x, y, P.zAt(s), 0.8);
    else sack(wP, x, y, P.zAt(s), 0.9);
  }

  // ---------------- steering wheel ----------------
  const wheelS = d.wheelS;
  const wheelDeck = P.raised(wheelS) + (d.wheelH ?? 0);
  const wheelZ = P.zAt(wheelS);
  if (d.wheelH) {
    // open bridge platform with a railing
    wP.add(new THREE.BoxGeometry(3.4, 0.16, 3.0), d.deck, T(0, wheelDeck - 0.08, wheelZ - 0.6));
    for (const [x0, z0, x1, z1] of [
      [-1.7, 0.9, 1.7, 0.9],
      [-1.7, -2.1, -1.7, 0.9],
      [1.7, -2.1, 1.7, 0.9],
    ]) {
      wP.add(plankBetween(new THREE.Vector3(x0, wheelDeck + 0.95, wheelZ + z0), new THREE.Vector3(x1, wheelDeck + 0.95, wheelZ + z1), 0.1, 0.1), d.trim);
      for (let i = 0; i <= 3; i++) wP.add(cyl(0.04, 0.04, 0.95, 5), d.trim, T(lerp(x0, x1, i / 3), wheelDeck + 0.47, wheelZ + lerp(z0, z1, i / 3)));
    }
  }
  wP.add(new THREE.BoxGeometry(0.35, 1.0, 0.35), PAL.woodDark, T(0, wheelDeck + 0.5, wheelZ));
  const wheelB = new GeoBuilder();
  const wheelCol = d.wheelGold ? PAL.gold : PAL.woodLight;
  wheelB.add(new THREE.TorusGeometry(0.62, 0.07, 6, 18), wheelCol);
  wheelB.add(new THREE.TorusGeometry(0.2, 0.08, 6, 12), d.wheelGold ? PAL.gold : PAL.woodDark);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    wheelB.add(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 5), wheelCol, T(Math.cos(a) * 0.31, Math.sin(a) * 0.31, 0, 0, 0, a - Math.PI / 2));
    wheelB.add(new THREE.CylinderGeometry(0.05, 0.035, 0.28, 6), PAL.woodDark, T(Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0, 0, 0, a - Math.PI / 2));
  }
  const wheel = wheelB.mesh(addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: d.wheelGold ? 0.3 : 0.7, metalness: d.wheelGold ? 0.5 : 0 }), 0.2));
  wheel.position.set(0, wheelDeck + 1.25, wheelZ - 0.15);
  wheel.userData.role = 'wheel';
  group.add(wheel);
  const wheelPos = wheel.position.clone();
  const captainPos = new THREE.Vector3(0, wheelDeck, wheelZ - 0.95);

  // ---------------- cannons ----------------
  const cannons: CannonMount[] = [];
  const cannonMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 });
  addRim(cannonMetal, 0.3);
  for (const c of d.cannons) {
    const s = c.s;
    const deckY = P.raised(s);
    const z = P.zAt(s);
    let pos: THREE.Vector3;
    let rotY: number;
    const sc = d.cannonScale;
    if (c.side === 'L' || c.side === 'R') {
      const sx = c.side === 'L' ? 1 : -1;
      const hw = P.widthAtY(s, deckY + 0.5);
      // guns behind an ironclad's casemate poke right out through their ports
      const behindArmour = d.casemate && s >= d.casemate.s0 && s <= d.casemate.s1;
      pos = new THREE.Vector3(sx * (hw - (behindArmour ? 0.15 : 0.75) * sc), deckY, z);
      rotY = sx * (Math.PI / 2);
    } else if (c.side === 'F') {
      pos = new THREE.Vector3(c.x ?? 0, deckY, z);
      rotY = 0;
    } else {
      pos = new THREE.Vector3(c.x ?? 0, deckY, z);
      rotY = Math.PI;
    }
    const dir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
    const muzzle = pos.clone().addScaledVector(dir, 0.9 * sc).add(new THREE.Vector3(0, 0.55 * sc, 0));
    const carriage = d.carriages !== false;
    if (d.separateCannons) {
      const cb = new GeoBuilder();
      cannonGeo(new Placer(cb), sc, d.cannonColor, carriage);
      const obj = cb.mesh(cannonMetal);
      obj.position.copy(pos);
      obj.rotation.y = rotY;
      group.add(obj);
      cannons.push({ obj, side: c.side, muzzle, dir, basePos: pos.clone(), recoil: 0 });
    } else {
      cannonGeo(mP.child(T(pos.x, pos.y, pos.z, 0, rotY, 0)), sc, d.cannonColor, carriage);
      cannons.push({ obj: group, side: c.side, muzzle, dir, basePos: pos.clone(), recoil: 0 });
    }
  }
  // rotating gun turrets
  (d.turrets ?? []).forEach((td, ti) => {
    const z = P.zAt(td.s);
    const y = P.raised(td.s) + (td.y ?? 0.15);
    const sc = td.scale;
    const tb = new GeoBuilder();
    const tp = new Placer(tb);
    const col = d.turretColor ?? d.trim;
    tp.add(cyl(1.25 * sc, 1.4 * sc, 0.38 * sc, 20), '#5a616b', T(0, 0.19 * sc, 0));
    const house = deform(roundBox(1.05 * sc, 0.55 * sc, 1.3 * sc, 6, 16, 10), (v) => {
      if (v.z > 0 && v.y > 0) v.z -= (v.y / (0.55 * sc)) * 0.55 * sc * (v.z / (1.3 * sc));
    });
    tp.add(house, col, T(0, 0.9 * sc, -0.15 * sc));
    tp.add(new THREE.BoxGeometry(0.5 * sc, 0.22 * sc, 0.5 * sc), '#3b414b', T(0.45 * sc, 1.52 * sc, -0.6 * sc));
    const n = td.barrels;
    const bxs: number[] = [];
    for (let b = 0; b < n; b++) {
      const bx = (b - (n - 1) / 2) * 0.46 * sc;
      bxs.push(bx);
      tp.add(cyl(0.11 * sc, 0.16 * sc, 2.9 * sc, 10), d.cannonColor, T(bx, 0.85 * sc, 2.55 * sc, Math.PI / 2, 0, 0));
      tp.add(cyl(0.17 * sc, 0.17 * sc, 0.3 * sc, 10), '#25292f', T(bx, 0.85 * sc, 3.9 * sc, Math.PI / 2, 0, 0));
    }
    const obj = tb.mesh(parts());
    const rest = td.rest === 'B' ? Math.PI : 0;
    obj.position.set(0, y, z);
    obj.rotation.y = rest;
    obj.userData.turretIdx = ti;
    group.add(obj);
    turrets.push({ obj, rest, target: rest, idle: 0 });
    const sides: CannonSide[] = td.rest === 'B' ? ['B', 'L', 'R'] : ['F', 'L', 'R'];
    for (const side of sides) {
      const yaw = SIDE_YAW[side];
      for (const bx of bxs) {
        const muzzle = new THREE.Vector3(bx, 0.85 * sc, 4.1 * sc).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(obj.position);
        cannons.push({ obj, side, muzzle, dir: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), basePos: obj.position.clone(), recoil: 0, turret: ti });
      }
    }
  });

  // flag pole tip
  wP.add(new THREE.SphereGeometry(0.15, 6, 4), PAL.gold, T(0, mainMastTop + 0.1, mainMastZ));

  // ---------------- assemble ----------------
  const hullMat = makeHullMaterial(d.metal ?? 0);
  const hullMesh = new THREE.Mesh(wood.build(), hullMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  hullMesh.layers.enable(1);
  hullMesh.userData.role = 'hull';
  group.add(hullMesh);
  if (!metal.empty) {
    const mm = new THREE.Mesh(metal.build(), cannonMetal);
    mm.castShadow = true;
    mm.layers.enable(1);
    group.add(mm);
  }
  if (!glow.empty) {
    const gm = new THREE.Mesh(glow.build(), sharedGlow);
    group.add(gm);
  }
  let sails: THREE.Mesh | null = null;
  if (sailGeos.length) {
    // normalise attribute sets so they merge
    const clean = sailGeos.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      return ng;
    });
    const merged = mergeGeometries(clean, false)!;
    sails = new THREE.Mesh(merged, sailMaterial(d, sailUniforms));
    sails.castShadow = true;
    sails.layers.enable(1);
    sails.userData.role = 'sails';
    group.add(sails);
  }
  const flag = makeFlag(d.flag, 1.8 + L * 0.05, 1.1 + L * 0.03);
  flag.position.set(0, mainMastTop + 0.15, mainMastZ);
  flag.rotation.y = Math.PI / 2;
  flag.userData.role = 'flag';
  group.add(flag);

  // everything built above belongs to this model (flags and the glow material are shared caches)
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geos.add(mesh.geometry);
    if (o.userData.role === 'flag') return;
    for (const mt of [mesh.material].flat()) if (mt !== sharedGlow) mats.add(mt);
  });

  // crew spots spread around the deck
  const crewSpots: THREE.Vector3[] = [];
  const spots = d.crewSpots ?? [
    [0.62, 0.45],
    [0.42, -0.45],
    [0.75, 0.45],
    [0.52, -0.45],
    [0.33, 0.45],
    [0.68, -0.45],
  ];
  for (const [s, xf] of spots) {
    const x = xf * P.widthAtY(s, P.deck(s));
    crewSpots.push(new THREE.Vector3(x, surfaceY(s, x), P.zAt(s)));
  }

  return {
    group,
    hullMat,
    sails,
    sailUniforms,
    flag,
    cannons,
    wheel,
    wheelPos,
    captainPos,
    crewSpots,
    deckYAt: (z: number) => surfaceY(clamp(sOf(z), 0, 1), 0),
    halfWidthAt: (z: number) => P.widthAtY(clamp(sOf(z), 0, 1), P.deck(clamp(sOf(z), 0, 1)) + 0.5),
    length: L,
    beam: d.beam,
    outerHalfWidth,
    topY: mastTop,
    mastTop: mainMastTop,
    lanternPos,
    turrets,
    spinners,
    funnels,
    disposables: { geos: [...geos], mats: [...mats] },
  };
}

type HullProfile = ReturnType<typeof makeProfile>;
/** casemate base width as a fraction of the hull */
const CASEMATE_W = 0.86;

/** Steel radar mast: a tapering lattice tower with a spinning antenna. */
function latticeMast(mP: Placer, M: THREE.Matrix4, h: number, col: string, group: THREE.Group, mat: THREE.Material, spinners: Spinner[]) {
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M);
  const b0 = 0.85;
  const b1 = 0.22;
  const half = (y: number) => lerp(b0, b1, y / h);
  const corners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  for (const [sx, sz] of corners) mP.add(beam(at(sx * b0, 0, sz * b0), at(sx * b1, h, sz * b1), 0.07, 4), col);
  for (let y = 1.2; y < h - 0.5; y += 1.6) {
    const a = half(y);
    const a2 = half(y + 1.6);
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[(i + 1) % 4];
      mP.add(beam(at(x0 * a, y, z0 * a), at(x1 * a, y, z1 * a), 0.035, 3), col);
      mP.add(beam(at(x0 * a, y, z0 * a), at(x1 * a2, Math.min(h, y + 1.6), z1 * a2), 0.03, 3), col);
    }
  }
  for (const k of [0.55, 0.8]) mP.add(new THREE.BoxGeometry(2.0, 0.1, 1.6), '#5a616b', M.clone().multiply(T(0, h * k, 0)));
  mP.add(new THREE.SphereGeometry(0.5, 12, 8), '#e8edf2', M.clone().multiply(T(0.9, h * 0.62, 0)));
  // spinning antenna
  const rb = new GeoBuilder();
  rb.add(cyl(0.08, 0.08, 0.7, 6), '#3b414b', T(0, 0.35, 0));
  rb.add(roundBox(1.9, 0.22, 0.14, 5, 12, 6), '#e8edf2', T(0, 0.75, 0));
  rb.add(new THREE.BoxGeometry(3.6, 0.06, 0.06), '#d9443a', T(0, 0.98, 0));
  const radar = rb.mesh(mat);
  radar.position.copy(at(0, h * 0.86, 0));
  radar.userData.spinnerIdx = spinners.length;
  group.add(radar);
  spinners.push({ obj: radar, axis: 'y', rate: 2.4, bySpeed: false });
}

function buildHouses(d: ShipDesign, P: HullProfile, wP: Placer, gP: Placer) {
  for (const hd of d.houses ?? []) {
    const sm = (hd.s0 + hd.s1) / 2;
    const z0 = P.zAt(hd.s0);
    const z1 = P.zAt(hd.s1);
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    const yb = P.deck(sm) + (hd.y ?? 0);
    const hw = P.widthAtY(sm, P.deck(sm) + 0.5) * hd.w;
    wP.add(roundBox(hw, hd.h / 2 + 0.05, len / 2, 8, 16, 10), hd.color, T(0, yb + hd.h / 2, zc));
    wP.add(roundBox(hw + 0.14, 0.1, len / 2 + 0.14, 8, 12, 6), hd.roof, T(0, yb + hd.h + 0.04, zc));
    if (hd.windows === 'glass') {
      // wrap-around bridge windows
      wP.add(new THREE.BoxGeometry(hw * 2 + 0.06, hd.h * 0.3, len * 0.9), '#22364a', T(0, yb + hd.h * 0.66, zc));
      wP.add(new THREE.BoxGeometry(hw * 1.7, hd.h * 0.3, len + 0.06), '#22364a', T(0, yb + hd.h * 0.66, zc));
    } else if (hd.windows === 'lit') {
      const n = Math.max(1, Math.floor(len / 1.7));
      for (const sx of [-1, 1])
        for (let i = 0; i < n; i++) gP.add(new THREE.BoxGeometry(0.06, 0.48, 0.62), '#fff', T(sx * (hw + 0.02), yb + hd.h * 0.6, zc + (i - (n - 1) / 2) * 1.7));
      wP.add(new THREE.BoxGeometry(0.7, Math.min(1.5, hd.h * 0.8), 0.08), PAL.woodDark, T(0, yb + Math.min(1.5, hd.h * 0.8) / 2, z0 - 0.02));
    }
    if (hd.rail) {
      const y = yb + hd.h + 0.1;
      for (const sx of [-1, 1]) {
        wP.add(plankBetween(new THREE.Vector3(sx * hw, y + 0.8, z0), new THREE.Vector3(sx * hw, y + 0.8, z1), 0.08, 0.08), '#cfd6de');
        for (let i = 0; i <= 4; i++) wP.add(cyl(0.035, 0.035, 0.8, 5), '#cfd6de', T(sx * hw, y + 0.4, lerp(z0, z1, i / 4)));
      }
    }
  }
}

/** Ironclad casemate: a sloped armoured citadel with gun ports. */
function buildCasemate(d: ShipDesign, P: HullProfile, wP: Placer, mP: Placer) {
  const c = d.casemate!;
  const sm = (c.s0 + c.s1) / 2;
  const z0 = P.zAt(c.s0);
  const z1 = P.zAt(c.s1);
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  const yb = P.deck(sm);
  const hwB = P.widthAtY(sm, yb + 0.3) * CASEMATE_W;
  const hwT = hwB * 0.62;
  const g = new THREE.BoxGeometry(hwB * 2, c.h, len);
  const endK = (len - c.h * 1.4) / len;
  const box = deform(
    g,
    (v) => {
      if (v.y > 0) {
        v.x *= hwT / hwB;
        v.z *= endK;
      }
    },
    false,
  );
  wP.add(box, (_c, n) => (n.y > 0.9 ? c.top : c.color), T(0, yb + c.h / 2, zc));
  const slope = Math.atan((hwB - hwT) / c.h);
  // gun ports where the broadside guns poke out
  for (const cn of d.cannons) {
    if ((cn.side !== 'L' && cn.side !== 'R') || cn.s < c.s0 || cn.s > c.s1) continue;
    const sx = cn.side === 'L' ? 1 : -1;
    const py = 0.55 * d.cannonScale + 0.05;
    const x = hwB - (hwB - hwT) * (py / c.h);
    wP.add(new THREE.BoxGeometry(0.12, 0.78, 0.9), '#141414', T(sx * (x + 0.03), yb + py, P.zAt(cn.s), 0, 0, sx * slope));
  }
  // rivet lines along the top and bottom edges
  const n = Math.round(len / 0.9);
  for (const sx of [-1, 1])
    for (let i = 0; i <= n; i++) {
      const z = lerp(z0 + 0.4, z1 - 0.4, i / n);
      mP.add(new THREE.SphereGeometry(0.06, 6, 4), '#9aa3ad', T(sx * (hwB - 0.02), yb + 0.18, z));
      mP.add(new THREE.SphereGeometry(0.06, 6, 4), '#9aa3ad', T(sx * (hwT + 0.06), yb + c.h - 0.18, z * endK + zc * (1 - endK)));
    }
}

/** Side paddle wheels in decorated paddle boxes. Returns the ship's outer half-width. */
function buildPaddles(d: ShipDesign, P: HullProfile, wP: Placer, group: THREE.Group, mat: THREE.Material, spinners: Spinner[]) {
  const pd = d.paddles!;
  const z = P.zAt(pd.s);
  const r = pd.r;
  const w = pd.w;
  const yc = r * 0.52;
  const hw = P.widthAtY(pd.s, P.deck(pd.s));
  const boxR = r + 0.35;
  for (const sx of [1, -1]) {
    const cx = sx * (hw + w / 2 + 0.12);
    // the wheel itself spins with the ship's speed
    const wb = new GeoBuilder();
    for (const ox of [-w / 2 + 0.1, w / 2 - 0.1]) wb.add(new THREE.TorusGeometry(r * 0.92, 0.07, 6, 26), PAL.woodDark, T(ox, 0, 0, 0, Math.PI / 2, 0));
    wb.add(cyl(0.3, 0.3, w + 0.3, 10), PAL.iron, T(0, 0, 0, 0, 0, Math.PI / 2));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      for (const ox of [-w / 2 + 0.1, w / 2 - 0.1]) wb.add(beam(new THREE.Vector3(ox, 0, 0), new THREE.Vector3(ox, Math.sin(a) * r * 0.9, Math.cos(a) * r * 0.9), 0.05, 4), PAL.iron);
      wb.add(new THREE.BoxGeometry(w * 0.95, 0.7, 0.1), '#b3261e', T(0, Math.sin(a) * r * 0.78, Math.cos(a) * r * 0.78, Math.PI / 2 - a, 0, 0));
    }
    const wheel = wb.mesh(mat);
    wheel.position.set(cx, yc, z);
    wheel.userData.spinnerIdx = spinners.length;
    group.add(wheel);
    spinners.push({ obj: wheel, axis: 'x', rate: 1 / r, bySpeed: true });
    // paddle box: a half drum over the wheel with a sunburst face
    wP.add(new THREE.CylinderGeometry(boxR, boxR, w + 0.4, 20, 1, true, 0, Math.PI), pd.box, T(cx, yc, z, 0, 0, Math.PI / 2));
    wP.add(new THREE.CircleGeometry(boxR, 20, 0, Math.PI), pd.box, T(cx + sx * (w / 2 + 0.2), yc, z, 0, sx * Math.PI / 2, 0));
    wP.add(new THREE.TorusGeometry(boxR, 0.09, 6, 20, Math.PI), pd.trim, T(cx + sx * (w / 2 + 0.22), yc, z, 0, sx * Math.PI / 2, 0));
    for (let k = 0; k < 7; k++) {
      const a = ((k + 0.5) / 7) * Math.PI;
      wP.add(new THREE.BoxGeometry(0.05, boxR * 0.72, 0.16), pd.trim, T(cx + sx * (w / 2 + 0.24), yc + Math.sin(a) * boxR * 0.48, z + Math.cos(a) * boxR * 0.48, Math.PI / 2 - a, 0, 0));
    }
    wP.add(new THREE.SphereGeometry(0.3, 10, 8), pd.trim, T(cx + sx * (w / 2 + 0.24), yc + 0.05, z));
    // sponson deck joining the box to the hull
    wP.add(new THREE.BoxGeometry(w + 0.4, 0.16, boxR * 2.2), d.deck, T(cx, P.deck(pd.s) - 0.05, z));
  }
  if (pd.bridge) {
    // walkway over the deck between the paddle boxes
    const y = yc + boxR + 0.2;
    const span = hw + w + 0.3;
    wP.add(new THREE.BoxGeometry(span * 2, 0.14, 1.2), d.deck, T(0, y, z));
    for (const sz of [-0.55, 0.55]) {
      wP.add(new THREE.BoxGeometry(span * 2, 0.08, 0.08), d.trim, T(0, y + 0.85, z + sz));
      for (let i = 0; i <= 8; i++) wP.add(cyl(0.035, 0.035, 0.85, 5), d.trim, T(lerp(-span, span, i / 8), y + 0.42, z + sz));
    }
  }
  return hw + w + 0.45;
}

/** Smokestack. Returns the smoke vent position. */
function buildFunnel(f: FunnelDef, P: HullProfile, wP: Placer, mP: Placer) {
  const z = P.zAt(f.s);
  const yb = P.deck(f.s) + (f.base ?? 0);
  const Mf = new THREE.Matrix4().makeTranslation(f.x ?? 0, yb, z).multiply(new THREE.Matrix4().makeRotationX(-(f.rake ?? 0)));
  const loc = (m: THREE.Matrix4) => Mf.clone().multiply(m);
  const R = f.r;
  const H = f.h;
  if (f.shape === 'box') {
    wP.add(roundBox(R * 0.8, H / 2, R * 1.3, 7, 14, 10), f.color, loc(T(0, H / 2, 0)));
    wP.add(roundBox(R * 0.84, H * 0.1, R * 1.34, 7, 14, 8), f.band, loc(T(0, H * 0.88, 0)));
    wP.add(new THREE.BoxGeometry(R * 1.3, 0.08, R * 2.2), '#141414', loc(T(0, H + 0.02, 0)));
  } else {
    wP.add(cyl(R, R * 1.08, H, 18), f.color, loc(T(0, H / 2, 0)));
    wP.add(cyl(R * 1.04, R * 1.04, H * 0.18, 18), f.band, loc(T(0, H * 0.9, 0)));
    wP.add(new THREE.TorusGeometry(R * 1.02, 0.09, 6, 18), f.band, loc(T(0, H, 0, Math.PI / 2, 0, 0)));
    wP.add(cyl(R * 0.94, R * 0.94, 0.06, 16), '#141414', loc(T(0, H - 0.02, 0)));
  }
  if (f.pipe) {
    mP.add(cyl(0.09, 0.09, H * 0.95, 6), PAL.brass, loc(T(R + 0.2, H * 0.48, -0.15)));
    mP.add(cyl(0.16, 0.12, 0.4, 8), PAL.brass, loc(T(R + 0.2, H * 0.98, -0.15)));
  }
  return new THREE.Vector3(0, H + 0.3, 0).applyMatrix4(Mf);
}

const sharedGlow = M.glow;

// ---------------------------------------------------------------------------
// Ship designs
// ---------------------------------------------------------------------------
export interface PlayerLook {
  hullLvl: number;
  sailLvl: number;
  cannonLvl: number;
  rangeLvl: number;
  steerLvl: number;
  cargoLvl: number;
  sailColor: string;
  sailStripe?: string;
  hullPaint: string;
  flag: FlagKind;
  /** cannon skin colour override ('' = follow cannon level) */
  cannonSkin?: string;
  /** guns on each broadside (from the ship class); older callers fall back to the cannon level */
  perSide?: number;
}

export function playerDesign(look: PlayerLook): ShipDesign {
  const cannons: ShipDesign['cannons'] = [];
  const perSide = look.perSide ?? (look.cannonLvl >= 4 ? 4 : look.cannonLvl >= 2 ? 3 : 2);
  const spots = perSide <= 2 ? [0.4, 0.58] : perSide === 3 ? [0.34, 0.5, 0.66] : [0.3, 0.44, 0.58, 0.72];
  for (const s of spots) {
    cannons.push({ side: 'L', s });
    cannons.push({ side: 'R', s });
  }
  cannons.push({ side: 'F', s: 0.8, x: 0.55 });
  cannons.push({ side: 'F', s: 0.8, x: -0.55 });
  const sailK = 1 + look.sailLvl * 0.07;
  const sails: SailDef[] = [];
  if (look.sailLvl >= 2) sails.push({ w: 5.4, h: 3.0 });
  sails.push({ w: 7.6, h: 5.0 });
  const masts: MastDef[] = [{ s: 0.53, h: 12.5 + look.sailLvl * 0.9, sails }];
  if (look.sailLvl >= 4) masts.unshift({ s: 0.3, h: 10, sails: [{ w: 5.6, h: 3.8 }] });
  return {
    key: 'player',
    length: 15 + look.hullLvl * 0.4,
    beam: 5.4 + look.hullLvl * 0.15,
    depth: 1.9,
    draft: 1.3,
    sheer: 0.95,
    sternW: 0.8,
    hull: look.hullPaint,
    hull2: '#1d1d22',
    trim: look.hullLvl >= 3 ? PAL.gold : '#b8322a',
    bottom: '#3a2a22',
    deck: '#c8955c',
    interior: '#8b2f25',
    masts,
    jib: look.sailLvl >= 1,
    sail: { base: look.sailColor, stripe: look.sailStripe, stripeMode: look.sailStripe ? 'v' : 'none', emblem: 'skull', emblemColor: look.sailColor === '#1d1d22' || look.sailColor === '#202028' ? '#f3ead6' : '#1d1d22' },
    castle: 1.0,
    castleLen: 0.22,
    forecastle: 0,
    cannons,
    cannonScale: 0.85 + look.cannonLvl * 0.09 + look.rangeLvl * 0.03,
    cannonColor: look.cannonSkin || (look.cannonLvl >= 4 ? PAL.gold : look.cannonLvl >= 2 ? '#b07a3a' : PAL.iron),
    armor: look.hullLvl >= 4 ? 1 : 0,
    gold: look.hullLvl >= 3,
    figurehead: look.hullLvl >= 3,
    crates: look.cargoLvl * 2,
    flag: look.flag,
    wheelS: 0.12,
    separateCannons: true,
    sailScale: sailK,
    wheelGold: look.steerLvl >= 2,
    bands: look.hullLvl >= 1 ? Math.min(look.hullLvl, 2) : 0,
  };
}

export const DESIGNS: Record<string, ShipDesign> = {
  smallMerchant: {
    key: 'smallMerchant',
    length: 13,
    beam: 5,
    depth: 1.6,
    draft: 1.1,
    sheer: 0.8,
    sternW: 0.8,
    hull: '#b98552',
    hull2: '#2b6cb0',
    trim: '#2b6cb0',
    bottom: '#5a3a2a',
    deck: '#d7a86e',
    interior: '#9a6a40',
    masts: [{ s: 0.5, h: 11, sails: [{ w: 6.5, h: 4.6 }] }],
    jib: true,
    sail: { base: '#f3ead6', stripe: '#7fb0e8', stripeMode: 'v', emblem: 'none' },
    castle: 0,
    castleLen: 0.2,
    forecastle: 0,
    cannons: [],
    cannonScale: 0.8,
    cannonColor: PAL.iron,
    armor: 0,
    gold: false,
    figurehead: false,
    crates: 6,
    flag: 'merchantA',
    wheelS: 0.1,
  },
  mediumMerchant: {
    key: 'mediumMerchant',
    length: 19,
    beam: 6.4,
    depth: 2.0,
    draft: 1.5,
    sheer: 1.0,
    sternW: 0.82,
    hull: '#8a5a33',
    hull2: '#2f855a',
    trim: '#2f855a',
    bottom: '#4a3020',
    deck: '#cf9e66',
    interior: '#7a4a28',
    masts: [
      { s: 0.36, h: 13, sails: [{ w: 5.6, h: 3.0 }, { w: 7.2, h: 4.2 }] },
      { s: 0.66, h: 14, sails: [{ w: 5.8, h: 3.0 }, { w: 7.4, h: 4.4 }] },
    ],
    jib: true,
    sail: { base: '#f1e6cc', stripe: '#9fd29a', stripeMode: 'h', emblem: 'crest', emblemColor: '#2f855a' },
    castle: 1.2,
    castleLen: 0.2,
    forecastle: 0,
    cannons: [
      { side: 'L', s: 0.5 },
      { side: 'R', s: 0.5 },
      { side: 'B', s: 0.08, x: 0 },
    ],
    cannonScale: 0.85,
    cannonColor: PAL.iron,
    armor: 0,
    gold: false,
    figurehead: false,
    crates: 8,
    flag: 'merchantB',
    wheelS: 0.1,
  },
  rival: {
    key: 'rival',
    length: 20,
    beam: 6.4,
    depth: 2.0,
    draft: 1.5,
    sheer: 1.1,
    sternW: 0.82,
    hull: '#2a2226',
    hull2: '#8c1c1c',
    trim: '#c0392b',
    bottom: '#1a1418',
    deck: '#a8784a',
    interior: '#5a2020',
    masts: [
      { s: 0.36, h: 13.5, sails: [{ w: 5.6, h: 3.0 }, { w: 7.2, h: 4.2 }] },
      { s: 0.66, h: 14.5, sails: [{ w: 5.8, h: 3.2 }, { w: 7.6, h: 4.6 }] },
    ],
    jib: true,
    sail: { base: '#2a2a30', stripe: '#8c1c1c', stripeMode: 'h', emblem: 'skull', emblemColor: '#f3ead6' },
    castle: 1.2,
    castleLen: 0.22,
    forecastle: 0.6,
    cannons: [
      { side: 'L', s: 0.36 },
      { side: 'L', s: 0.58 },
      { side: 'R', s: 0.36 },
      { side: 'R', s: 0.58 },
      { side: 'F', s: 0.82, x: 0 },
      { side: 'B', s: 0.08, x: 0 },
    ],
    cannonScale: 0.95,
    cannonColor: PAL.ironDark,
    armor: 0,
    gold: false,
    figurehead: true,
    crates: 4,
    flag: 'pirateRed',
    wheelS: 0.1,
  },
  largeCargo: {
    key: 'largeCargo',
    length: 28,
    beam: 8.8,
    depth: 2.6,
    draft: 2.0,
    sheer: 1.4,
    sternW: 0.86,
    hull: '#7a4a2a',
    hull2: '#e8d6a0',
    trim: '#c05621',
    bottom: '#3a2418',
    deck: '#c99560',
    interior: '#6e3e22',
    masts: [
      { s: 0.27, h: 15, sails: [{ w: 6.4, h: 3.4 }, { w: 8.4, h: 4.8 }] },
      { s: 0.5, h: 19, sails: [{ w: 6.8, h: 3.4 }, { w: 9.2, h: 4.4 }, { w: 10.6, h: 5.2 }] },
      { s: 0.73, h: 16, sails: [{ w: 6.4, h: 3.4 }, { w: 8.6, h: 4.8 }] },
    ],
    jib: true,
    sail: { base: '#efe0bd', stripe: '#e39a62', stripeMode: 'h', emblem: 'anchor', emblemColor: '#a8461c' },
    castle: 2.0,
    castleLen: 0.2,
    forecastle: 1.0,
    cannons: [
      { side: 'L', s: 0.35 },
      { side: 'L', s: 0.5 },
      { side: 'L', s: 0.65 },
      { side: 'R', s: 0.35 },
      { side: 'R', s: 0.5 },
      { side: 'R', s: 0.65 },
    ],
    cannonScale: 1.0,
    cannonColor: PAL.iron,
    armor: 0,
    gold: false,
    figurehead: true,
    crates: 14,
    flag: 'merchantC',
    wheelS: 0.1,
  },
  luxury: {
    key: 'luxury',
    length: 21,
    beam: 6.4,
    depth: 2.2,
    draft: 1.5,
    sheer: 1.2,
    sternW: 0.84,
    hull: '#f4efe4',
    hull2: '#5b2a86',
    trim: PAL.gold,
    bottom: '#3a2a4a',
    deck: '#e0b47a',
    interior: '#7a3fa8',
    masts: [
      { s: 0.36, h: 15, sails: [{ w: 5.6, h: 3.2 }, { w: 7.2, h: 4.6 }] },
      { s: 0.66, h: 16.5, sails: [{ w: 5.8, h: 3.2 }, { w: 7.6, h: 4.8 }] },
    ],
    jib: true,
    sail: { base: '#7a3fb0', stripe: '#f4c24c', stripeMode: 'h', emblem: 'crown', emblemColor: '#f4c24c' },
    castle: 1.6,
    castleLen: 0.24,
    forecastle: 0,
    cannons: [{ side: 'B', s: 0.06, x: 0 }],
    cannonScale: 0.8,
    cannonColor: PAL.gold,
    armor: 0,
    gold: true,
    figurehead: true,
    crates: 4,
    flag: 'luxury',
    wheelS: 0.12,
    wheelGold: true,
  },
  armoured: {
    key: 'armoured',
    length: 25,
    beam: 8.6,
    depth: 2.5,
    draft: 2.0,
    sheer: 1.0,
    sternW: 0.88,
    hull: '#5a5f68',
    hull2: '#2a2e35',
    trim: '#8a929c',
    bottom: '#2a2420',
    deck: '#a88a64',
    interior: '#4a4f58',
    masts: [
      { s: 0.33, h: 15, sails: [{ w: 6.4, h: 3.4 }, { w: 8.4, h: 4.8 }] },
      { s: 0.64, h: 16, sails: [{ w: 6.6, h: 3.4 }, { w: 8.8, h: 5.0 }] },
    ],
    jib: false,
    sail: { base: '#c9c4b8', stripe: '#6a707a', stripeMode: 'h', emblem: 'crest', emblemColor: '#3a3f47' },
    castle: 1.6,
    castleLen: 0.2,
    forecastle: 0.9,
    cannons: [
      { side: 'L', s: 0.35 },
      { side: 'L', s: 0.52 },
      { side: 'L', s: 0.69 },
      { side: 'R', s: 0.35 },
      { side: 'R', s: 0.52 },
      { side: 'R', s: 0.69 },
      { side: 'B', s: 0.06, x: 0 },
    ],
    cannonScale: 1.05,
    cannonColor: PAL.ironDark,
    armor: 3,
    gold: false,
    figurehead: false,
    crates: 10,
    flag: 'merchantA',
    wheelS: 0.1,
    bands: 2,
  },
  navyCutter: {
    key: 'navyCutter',
    length: 15,
    beam: 5.2,
    depth: 1.8,
    draft: 1.3,
    sheer: 0.9,
    sternW: 0.78,
    hull: '#1f3b73',
    hull2: '#f2efe6',
    trim: PAL.gold,
    bottom: '#2a2420',
    deck: '#d0a06a',
    interior: '#1b2f5a',
    masts: [{ s: 0.52, h: 13, sails: [{ w: 5.2, h: 3.0 }, { w: 7.2, h: 4.6 }] }],
    jib: true,
    sail: { base: '#f7f4ec', stripe: '#3a64b8', stripeMode: 'h', emblem: 'anchor', emblemColor: '#1f3b73' },
    castle: 0.8,
    castleLen: 0.2,
    forecastle: 0,
    cannons: [
      { side: 'F', s: 0.82, x: 0.5 },
      { side: 'F', s: 0.82, x: -0.5 },
      { side: 'L', s: 0.48 },
      { side: 'R', s: 0.48 },
    ],
    cannonScale: 0.9,
    cannonColor: '#b07a3a',
    armor: 0,
    gold: false,
    figurehead: false,
    crates: 0,
    flag: 'navy',
    wheelS: 0.1,
  },
  navyFrigate: {
    key: 'navyFrigate',
    length: 27,
    beam: 8.6,
    depth: 2.6,
    draft: 2.0,
    sheer: 1.2,
    sternW: 0.86,
    hull: '#1c1f2a',
    hull2: '#e9c46a',
    trim: '#e9c46a',
    bottom: '#2a2420',
    deck: '#c99560',
    interior: '#8b2f25',
    masts: [
      { s: 0.27, h: 16, sails: [{ w: 6.4, h: 3.4 }, { w: 8.6, h: 4.8 }] },
      { s: 0.5, h: 20, sails: [{ w: 6.8, h: 3.4 }, { w: 9.0, h: 4.4 }, { w: 10.6, h: 5.4 }] },
      { s: 0.73, h: 17, sails: [{ w: 6.4, h: 3.4 }, { w: 8.6, h: 4.8 }] },
    ],
    jib: true,
    sail: { base: '#f7f4ec', stripe: '#d9e2f2', stripeMode: 'h', emblem: 'anchor', emblemColor: '#1f3b73' },
    castle: 1.8,
    castleLen: 0.2,
    forecastle: 0.9,
    cannons: [
      { side: 'L', s: 0.3 },
      { side: 'L', s: 0.43 },
      { side: 'L', s: 0.56 },
      { side: 'L', s: 0.69 },
      { side: 'R', s: 0.3 },
      { side: 'R', s: 0.43 },
      { side: 'R', s: 0.56 },
      { side: 'R', s: 0.69 },
      { side: 'F', s: 0.86, x: 0 },
    ],
    cannonScale: 1.05,
    cannonColor: PAL.iron,
    armor: 0,
    gold: true,
    figurehead: true,
    crates: 2,
    flag: 'navy',
    wheelS: 0.1,
    bands: 1,
  },
};
