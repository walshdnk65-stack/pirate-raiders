import * as THREE from 'three';
import { PAL } from './Props';
import { playerDesign as dhowDesign, DESIGNS, type ShipDesign, type PlayerLook, type CannonSide } from './ShipModel';
import { SHIP_CLASSES, type ShipClassId } from '../game/ShipClasses';
import { lerp } from '../core/math';

/**
 * One distinct 3D design per player ship class, from the wooden starter boat to the
 * fictional modern super-ship. Each takes the player's look (paint, sails, flag and
 * upgrade levels) so upgrades and cosmetics still show on every class.
 */
export interface ClassLook extends PlayerLook {
  cls: ShipClassId;
  /** guns on each broadside (class + cannon upgrades) */
  perSide: number;
}

/** Blend two colours (paint over steel on metal ships). */
function mix(a: string, b: string, t: number) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/** n guns a side spread between two stations, optionally leaving a gap (paddle boxes). */
function broadside(n: number, s0: number, s1: number, gap?: [number, number]) {
  const spread = (k: number, a: number, b: number) => (k <= 0 ? [] : k === 1 ? [(a + b) / 2] : Array.from({ length: k }, (_, i) => lerp(a, b, i / (k - 1))));
  let ss: number[];
  if (gap) {
    const la = gap[0] - s0;
    const lb = s1 - gap[1];
    const na = Math.round((n * la) / (la + lb));
    ss = [...spread(na, s0, gap[0]), ...spread(n - na, gap[1], s1)];
  } else ss = spread(n, s0, s1);
  const out: { side: CannonSide; s: number; x?: number }[] = [];
  for (const s of ss) out.push({ side: 'L', s }, { side: 'R', s });
  return out;
}

function common(look: ClassLook) {
  const darkSail = look.sailColor === '#1d1d22' || look.sailColor === '#202028';
  return {
    gold: look.hullLvl >= 3,
    cannonColor: look.cannonSkin || (look.cannonLvl >= 4 ? PAL.gold : look.cannonLvl >= 2 ? '#b07a3a' : PAL.iron),
    gunK: 1 + look.cannonLvl * 0.07 + look.rangeLvl * 0.025,
    sail: { base: look.sailColor, stripe: look.sailStripe, stripeMode: look.sailStripe ? 'v' : 'none', emblem: 'skull', emblemColor: darkSail ? '#f3ead6' : '#1d1d22' } as ShipDesign['sail'],
    sailK: 1 + look.sailLvl * 0.05,
    bands: look.hullLvl >= 1 ? Math.min(look.hullLvl, 2) : 0,
  };
}

function schooner(look: ClassLook): ShipDesign {
  const c = common(look);
  return {
    key: 'p-schooner',
    length: 21,
    beam: 5.9,
    depth: 1.95,
    draft: 1.4,
    sheer: 1.1,
    sternW: 0.7,
    hull: look.hullPaint,
    hull2: '#f3ead6',
    trim: c.gold ? PAL.gold : '#e8dcc0',
    bottom: '#3a2a22',
    deck: '#d9a86a',
    interior: '#7a3a28',
    masts: [
      { s: 0.33, h: 17.5, rake: 0.09, sails: look.sailLvl >= 3 ? [{ w: 4.8, h: 2.6 }] : [], gaff: { boom: 7.4, gaff: 5.8, head: 11.4, foot: 1.5, rise: 2.2 } },
      { s: 0.64, h: 15.5, rake: 0.09, sails: look.sailLvl >= 2 ? [{ w: 5.2, h: 2.8 }] : [], gaff: { boom: 5.6, gaff: 4.6, head: 9.6, foot: 1.5, rise: 1.9 } },
    ],
    jib: true,
    jibs: look.sailLvl >= 1 ? 2 : 1,
    sail: c.sail,
    castle: 0.55,
    castleLen: 0.17,
    forecastle: 0,
    cannons: [...broadside(look.perSide, 0.3, 0.74), { side: 'F', s: 0.84, x: 0 }],
    cannonScale: 0.88 * c.gunK,
    cannonColor: c.cannonColor,
    armor: look.hullLvl >= 4 ? 1 : 0,
    gold: c.gold,
    figurehead: look.hullLvl >= 3,
    crates: look.cargoLvl * 2,
    flag: look.flag,
    wheelS: 0.08,
    separateCannons: true,
    sailScale: c.sailK,
    wheelGold: look.steerLvl >= 2,
    bands: c.bands,
    crewSpots: [
      [0.55, 0.45],
      [0.45, -0.45],
      [0.72, 0.4],
      [0.38, -0.4],
      [0.62, -0.42],
      [0.26, 0.4],
    ],
  };
}

function brigantine(look: ClassLook): ShipDesign {
  const c = common(look);
  return {
    key: 'p-brigantine',
    length: 26,
    beam: 7.6,
    depth: 2.25,
    draft: 1.7,
    sheer: 1.25,
    sternW: 0.84,
    hull: look.hullPaint,
    hull2: '#1d1d22',
    trim: c.gold ? PAL.gold : '#b8322a',
    bottom: '#3a2a22',
    deck: '#c8955c',
    interior: '#8b2f25',
    masts: [
      { s: 0.38, h: 19.5, sails: look.sailLvl >= 2 ? [{ w: 6.4, h: 3.2 }, { w: 7.4, h: 3.4 }] : [{ w: 6.4, h: 3.2 }], gaff: { boom: 8.4, gaff: 6.2, head: 10.0, foot: 1.7, rise: 1.9 } },
      {
        s: 0.66,
        h: 18.5,
        sails: [
          { w: 6.2, h: 3.0 },
          { w: 7.8, h: 3.8 },
          { w: 9.4, h: 4.6 },
        ],
      },
    ],
    jib: true,
    jibs: 2,
    sail: c.sail,
    castle: 1.4,
    castleLen: 0.21,
    forecastle: 0.7,
    cannons: [...broadside(look.perSide, 0.3, 0.77), { side: 'F', s: 0.87, x: 0.55 }, { side: 'F', s: 0.87, x: -0.55 }],
    cannonScale: 0.95 * c.gunK,
    cannonColor: c.cannonColor,
    armor: look.hullLvl >= 4 ? 1 : 0,
    gold: c.gold,
    figurehead: true,
    crates: look.cargoLvl * 2 + 2,
    flag: look.flag,
    wheelS: 0.1,
    separateCannons: true,
    sailScale: c.sailK,
    wheelGold: look.steerLvl >= 2,
    bands: c.bands,
    crewSpots: [
      [0.62, 0.45],
      [0.42, -0.45],
      [0.75, 0.42],
      [0.52, -0.45],
      [0.33, 0.45],
      [0.7, -0.42],
      [0.5, 0.3],
      [0.9, 0.0],
    ],
  };
}

function galleon(look: ClassLook): ShipDesign {
  const c = common(look);
  return {
    key: 'p-galleon',
    length: 34,
    beam: 10,
    depth: 2.9,
    draft: 2.3,
    sheer: 1.8,
    sternW: 0.9,
    hull: look.hullPaint,
    hull2: '#e9c46a',
    trim: c.gold ? PAL.gold : '#c99a3c',
    bottom: '#3a2418',
    deck: '#c99560',
    interior: '#7a2a22',
    masts: [
      { s: 0.19, h: 15, base: 2.7, sails: [{ w: 5.4, h: 2.9 }], gaff: { boom: 6.0, gaff: 5.6, head: 7.6, foot: 1.6, rise: 2.4 } },
      {
        s: 0.47,
        h: 26,
        sails: [
          { w: 7.6, h: 3.6 },
          { w: 9.8, h: 4.4 },
          { w: 11.8, h: 5.6 },
        ],
      },
      {
        s: 0.72,
        h: 23,
        sails: [
          { w: 7.0, h: 3.4 },
          { w: 9.0, h: 4.2 },
          { w: 10.8, h: 5.2 },
        ],
      },
    ],
    jib: true,
    jibs: 2,
    sail: c.sail,
    castle: 2.7,
    castleLen: 0.25,
    forecastle: 1.4,
    cannons: [...broadside(look.perSide, 0.31, 0.78), { side: 'F', s: 0.88, x: 0.6 }, { side: 'F', s: 0.88, x: -0.6 }],
    cannonScale: 1.02 * c.gunK,
    cannonColor: c.cannonColor,
    armor: look.hullLvl >= 4 ? 1 : 0,
    gold: true,
    figurehead: true,
    crates: look.cargoLvl * 2 + 4,
    flag: look.flag,
    wheelS: 0.12,
    separateCannons: true,
    sailScale: c.sailK,
    wheelGold: look.steerLvl >= 2,
    bands: c.bands,
    gunDeck: { ports: 7, lid: '#8c2a22' },
    crewSpots: [
      [0.62, 0.45],
      [0.4, -0.45],
      [0.74, 0.42],
      [0.52, -0.42],
      [0.33, 0.42],
      [0.68, -0.42],
      [0.56, 0.2],
      [0.9, 0.2],
      [0.12, 0.4],
      [0.44, 0.3],
    ],
  };
}

function steamCorvette(look: ClassLook): ShipDesign {
  const c = common(look);
  return {
    key: 'p-corvette',
    length: 34,
    beam: 8.4,
    depth: 2.4,
    draft: 1.9,
    sheer: 0.75,
    sternW: 0.8,
    hull: mix(look.hullPaint, '#23262c', 0.55),
    hull2: '#f3ead6',
    trim: c.gold ? PAL.gold : PAL.brass,
    bottom: '#a8392e',
    deck: '#c8955c',
    interior: '#5a2a22',
    plating: true,
    metal: 0.15,
    bowRake: 0.08,
    masts: [
      {
        s: 0.27,
        h: 17,
        sails: [
          { w: 5.4, h: 2.8 },
          { w: 6.8, h: 3.4 },
        ],
      },
      {
        s: 0.75,
        h: 17.5,
        sails: [
          { w: 5.6, h: 2.8 },
          { w: 7.0, h: 3.6 },
        ],
      },
    ],
    jib: true,
    sail: c.sail,
    sailScale: 0.9,
    castle: 0.8,
    castleLen: 0.14,
    forecastle: 0.6,
    funnels: [{ s: 0.46, h: 7 + look.sailLvl * 0.6, r: 0.95, color: '#1d1d22', band: '#c0392b', rake: 0.07, pipe: true }],
    paddles: { s: 0.53, r: 2.7, w: 1.5, box: '#f3ead6', trim: '#c0392b', bridge: true },
    houses: [{ s0: 0.4, s1: 0.58, w: 0.4, h: 1.5, color: '#f3ead6', roof: '#6b4428', windows: 'lit' }],
    vents: [
      [0.36, 0.3],
      [0.64, -0.3],
    ],
    cannons: [...broadside(look.perSide, 0.19, 0.8, [0.4, 0.66]), { side: 'F', s: 0.87, x: 0.5 }, { side: 'F', s: 0.87, x: -0.5 }],
    cannonScale: 1.0 * c.gunK,
    cannonColor: c.cannonColor,
    armor: look.hullLvl >= 4 ? 1 : 0,
    gold: c.gold,
    figurehead: false,
    crates: look.cargoLvl * 2,
    flag: look.flag,
    wheelS: 0.08,
    separateCannons: true,
    wheelGold: look.steerLvl >= 2,
    bands: c.bands,
    crewSpots: [
      [0.7, 0.45],
      [0.3, -0.45],
      [0.78, -0.42],
      [0.22, 0.42],
      [0.62, 0.42],
      [0.35, 0.42],
      [0.9, 0.2],
      [0.45, -0.3],
    ],
  };
}

function ironclad(look: ClassLook): ShipDesign {
  const c = common(look);
  const H = 3.0;
  return {
    key: 'p-ironclad',
    length: 38,
    beam: 9.8,
    depth: 1.75,
    draft: 2.3,
    sheer: 0.35,
    sternW: 0.88,
    hull: mix(look.hullPaint, '#4b525c', 0.6),
    hull2: '#2a2e35',
    trim: '#8a929c',
    bottom: '#8c2f26',
    deck: '#a88a64',
    interior: '#4a4f58',
    plating: true,
    metal: 0.25,
    bowRake: -0.07,
    bowsprit: false,
    masts: [{ s: 0.8, h: 15, kind: 'pole', sails: [] }],
    jib: false,
    sail: c.sail,
    castle: 0,
    castleLen: 0.2,
    forecastle: 0,
    casemate: { s0: 0.3, s1: 0.7, h: H, color: mix(look.hullPaint, '#5a616b', 0.72), top: '#3b414b' },
    funnels: [
      { s: 0.45, h: 6 + look.sailLvl * 0.5, r: 0.85, base: H, color: '#d8c8a0', band: '#1d1d22', rake: 0.05, pipe: true },
      { s: 0.56, h: 6 + look.sailLvl * 0.5, r: 0.85, base: H, color: '#d8c8a0', band: '#1d1d22', rake: 0.05, pipe: true },
    ],
    cannons: [...broadside(look.perSide, 0.34, 0.66), { side: 'F', s: 0.88, x: 0 }],
    cannonScale: 1.15 * c.gunK,
    cannonColor: c.cannonColor,
    carriages: false,
    armor: look.hullLvl >= 4 ? 3 : 2,
    gold: c.gold,
    figurehead: false,
    crates: look.cargoLvl * 2,
    flag: look.flag,
    wheelS: 0.36,
    wheelH: H,
    separateCannons: true,
    wheelGold: look.steerLvl >= 2,
    bands: 1 + Math.min(look.hullLvl, 2),
    vents: [
      [0.2, 0.35],
      [0.2, -0.35],
      [0.76, 0.35],
    ],
    crewSpots: [
      [0.5, 0.3],
      [0.62, -0.3],
      [0.84, 0.35],
      [0.18, -0.42],
      [0.42, -0.32],
      [0.9, -0.2],
      [0.13, 0.42],
      [0.6, 0.32],
    ],
  };
}

function modern(look: ClassLook): ShipDesign {
  const c = common(look);
  const gun = 1.6 + look.cannonLvl * 0.07 + look.rangeLvl * 0.03;
  return {
    key: 'p-modern',
    length: 42,
    beam: 9.4,
    depth: 2.6,
    draft: 2.0,
    sheer: 0.7,
    sternW: 0.95,
    hull: mix(look.hullPaint, '#8d97a3', 0.75),
    hull2: look.hullPaint,
    trim: c.gold ? PAL.gold : '#cfd6de',
    bottom: '#7a2a2a',
    deck: '#7d858f',
    interior: '#9aa3ad',
    plating: true,
    metal: 0.3,
    bowRake: 0.09,
    bowsprit: false,
    masts: [{ s: 0.5, h: 10, base: 4.6, kind: 'lattice', sails: [] }],
    jib: false,
    sail: c.sail,
    castle: 0,
    castleLen: 0.2,
    forecastle: 1.0,
    houses: [
      { s0: 0.36, s1: 0.62, w: 0.66, h: 2.6, color: '#e3e8ed', roof: '#9aa3ad', windows: 'lit' },
      { s0: 0.45, s1: 0.6, w: 0.52, h: 2.0, y: 2.6, color: '#eef2f5', roof: '#8d97a3', windows: 'glass' },
    ],
    funnels: [{ s: 0.4, h: 2.8 + look.sailLvl * 0.3, r: 1.0, base: 2.6, color: '#e3e8ed', band: '#1d1d22', shape: 'box', rake: 0.12 }],
    turrets: [
      { s: 0.77, barrels: 2, scale: gun, rest: 'F' },
      { s: 0.22, barrels: 2, scale: gun, rest: 'B' },
    ],
    turretColor: '#dfe5ea',
    cannons: [],
    cannonScale: 1,
    cannonColor: look.cannonSkin || (look.cannonLvl >= 4 ? PAL.gold : '#3b414b'),
    armor: look.hullLvl >= 4 ? 1 : 0,
    gold: false,
    figurehead: false,
    crates: look.cargoLvl * 2,
    flag: look.flag,
    wheelS: 0.55,
    wheelH: 4.7,
    separateCannons: true,
    wheelGold: look.steerLvl >= 2,
    bands: 0,
    helipad: 0.08,
    exhaust: true,
    crewSpots: [
      [0.7, 0.45],
      [0.3, -0.45],
      [0.66, -0.45],
      [0.32, 0.45],
      [0.86, 0.3],
      [0.14, -0.4],
      [0.4, 0.3],
      [0.6, -0.3],
    ],
  };
}

const BUILDERS: Record<ShipClassId, (l: ClassLook) => ShipDesign> = {
  dhow: (l) => dhowDesign(l),
  schooner,
  brigantine,
  galleon,
  steamCorvette,
  ironclad,
  modern,
};

/** The 3D design for a player ship of any class. */
export function classDesign(look: ClassLook): ShipDesign {
  return (BUILDERS[look.cls] ?? BUILDERS.dhow)(look);
}

/** Stock look for previewing a class you don't own yet. */
export function previewLook(cls: ShipClassId, base: PlayerLook): ClassLook {
  return { ...base, cls, perSide: SHIP_CLASSES[cls].cannonCount, hullLvl: 0, sailLvl: 0, cannonLvl: 0, rangeLvl: 0, steerLvl: 0, cargoLvl: 0 };
}

// ---------------------------------------------------------------------------
// NPC ships of the later eras (they start appearing as you level up)
// ---------------------------------------------------------------------------
const navyLook: ClassLook = {
  cls: 'ironclad',
  perSide: 4,
  hullLvl: 2,
  sailLvl: 1,
  cannonLvl: 2,
  rangeLvl: 1,
  steerLvl: 0,
  cargoLvl: 0,
  sailColor: '#f7f4ec',
  hullPaint: '#2a3550',
  flag: 'navy',
  cannonSkin: '#25292f',
};

const NPC_DESIGNS: Record<string, ShipDesign> = {
  steamFreighter: {
    key: 'steamFreighter',
    length: 30,
    beam: 8.8,
    depth: 2.6,
    draft: 2.0,
    sheer: 0.8,
    sternW: 0.85,
    hull: '#3a3f47',
    hull2: '#e8d6a0',
    trim: '#c05621',
    bottom: '#a8392e',
    deck: '#c99560',
    interior: '#6e3e22',
    plating: true,
    metal: 0.15,
    masts: [
      { s: 0.25, h: 15, sails: [{ w: 5.6, h: 3.2 }] },
      { s: 0.75, h: 15.5, sails: [{ w: 5.8, h: 3.4 }] },
    ],
    jib: true,
    sail: { base: '#efe0bd', stripe: '#e39a62', stripeMode: 'h', emblem: 'anchor', emblemColor: '#a8461c' },
    castle: 1.0,
    castleLen: 0.15,
    forecastle: 0.8,
    funnels: [{ s: 0.5, h: 7, r: 1.0, color: '#e39a62', band: '#1d1d22', rake: 0.06 }],
    houses: [{ s0: 0.43, s1: 0.58, w: 0.5, h: 1.8, color: '#e8d6a0', roof: '#6e3e22', windows: 'lit' }],
    vents: [
      [0.38, 0.35],
      [0.64, -0.35],
    ],
    cannons: [
      { side: 'L', s: 0.33 },
      { side: 'R', s: 0.33 },
      { side: 'L', s: 0.68 },
      { side: 'R', s: 0.68 },
      { side: 'B', s: 0.06, x: 0 },
    ],
    cannonScale: 1.0,
    cannonColor: PAL.iron,
    armor: 0,
    gold: false,
    figurehead: false,
    crates: 14,
    flag: 'merchantC',
    wheelS: 0.08,
  },
  navyIronclad: { ...ironclad(navyLook), key: 'navyIronclad', separateCannons: false, casemate: { s0: 0.3, s1: 0.7, h: 2.6, color: '#3b4a66', top: '#25292f' }, trim: PAL.gold, sail: { base: '#f7f4ec', emblem: 'anchor', emblemColor: '#1f3b73' } },
  navyInterceptor: {
    ...modern({ ...navyLook, cls: 'modern', hullPaint: '#1f3b73' }),
    key: 'navyInterceptor',
    separateCannons: false,
    hull: '#6f7b8a',
    turretColor: '#b9c2cc',
  },
};

/** Design lookup for AI ships: classic designs plus the steam/modern ones. */
export function npcDesign(key: string): ShipDesign {
  return NPC_DESIGNS[key] ?? DESIGNS[key];
}
