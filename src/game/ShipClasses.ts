import { UPGRADES, type UpgradeId } from './Data';

/**
 * Player ship classes – the long-term progression ladder.
 *
 * Every number that matters for balance lives in SHIP_CLASSES below, so a class can be
 * re-tuned (or a new one slotted in) without touching gameplay code. Upgrades bought at a
 * shipwright are percentage bonuses on top of these base values (see UPGRADES in Data.ts).
 */
export type ShipClassId = 'dhow' | 'schooner' | 'brigantine' | 'galleon' | 'steamCorvette' | 'ironclad' | 'modern';
export type ShipEra = 'sail' | 'steam' | 'modern';
export type EngineType = 'Sail' | 'Sail (fore-and-aft)' | 'Sail (square rig)' | 'Steam paddle + sail' | 'Twin steam screws' | 'Gas turbines';

export interface ShipClass {
  id: ShipClassId;
  /** 1..7 – shown as "Class III" */
  tier: number;
  /** class name, e.g. "Brigantine" */
  name: string;
  /** what the player's ship is called when they buy one */
  shipName: string;
  icon: string;
  era: ShipEra;
  requiredLevel: number;
  purchasePrice: number;
  /** what a shipyard pays if you sell this ship */
  sellPrice: number;
  maxHealth: number;
  /** knots (world units / s) */
  maxSpeed: number;
  acceleration: number;
  /** radians / s at full way */
  turningSpeed: number;
  cargoCapacity: number;
  crewCapacity: number;
  /** guns on EACH broadside (turret ships: barrels that bear on each side) */
  cannonCount: number;
  /** extra guns that fire forward */
  bowGuns: number;
  /** damage per shot */
  cannonDamage: number;
  cannonRange: number;
  /** seconds between volleys */
  reloadSpeed: number;
  /** multiplier on crew power when boarding (and how hard this ship is to board) */
  boardingStrength: number;
  engineType: EngineType;
  /** guns on the broadside get +1 per side from cannon upgrade 3 */
  layout: 'broadside' | 'turret';
  /** shipwright upgrade prices are multiplied by this */
  upgradeCostMul: number;
  desc: string;
}

export const SHIP_CLASSES: Record<ShipClassId, ShipClass> = {
  dhow: {
    id: 'dhow',
    tier: 1,
    name: 'Starter Dhow',
    shipName: 'The Salty Barnacle',
    icon: '⛵',
    era: 'sail',
    requiredLevel: 1,
    purchasePrice: 0,
    sellPrice: 400,
    maxHealth: 100,
    maxSpeed: 21,
    acceleration: 7,
    turningSpeed: 1.0,
    cargoCapacity: 24,
    crewCapacity: 6,
    cannonCount: 2,
    bowGuns: 2,
    cannonDamage: 12,
    cannonRange: 70,
    reloadSpeed: 2.1,
    boardingStrength: 1.0,
    engineType: 'Sail',
    layout: 'broadside',
    upgradeCostMul: 1,
    desc: 'A plucky little pirate boat. Patched sails, two guns a side and a lot of heart.',
  },
  schooner: {
    id: 'schooner',
    tier: 2,
    name: 'Fast Schooner',
    shipName: 'The Sea Sprite',
    icon: '🚤',
    era: 'sail',
    requiredLevel: 5,
    purchasePrice: 5500,
    sellPrice: 2750,
    maxHealth: 170,
    maxSpeed: 25.5,
    acceleration: 9.5,
    turningSpeed: 1.15,
    cargoCapacity: 40,
    crewCapacity: 12,
    cannonCount: 3,
    bowGuns: 1,
    cannonDamage: 15,
    cannonRange: 80,
    reloadSpeed: 1.95,
    boardingStrength: 1.15,
    engineType: 'Sail (fore-and-aft)',
    layout: 'broadside',
    upgradeCostMul: 1.4,
    desc: 'Twin raked masts and fore-and-aft sails. Quick off the mark and nimble in a turn.',
  },
  brigantine: {
    id: 'brigantine',
    tier: 3,
    name: 'Brigantine',
    shipName: 'The Black Gull',
    icon: '🛳️',
    era: 'sail',
    requiredLevel: 10,
    purchasePrice: 16000,
    sellPrice: 8000,
    maxHealth: 320,
    maxSpeed: 26.5,
    acceleration: 8.5,
    turningSpeed: 1.0,
    cargoCapacity: 64,
    crewCapacity: 20,
    cannonCount: 4,
    bowGuns: 2,
    cannonDamage: 19,
    cannonRange: 90,
    reloadSpeed: 1.85,
    boardingStrength: 1.3,
    engineType: 'Sail (square rig)',
    layout: 'broadside',
    upgradeCostMul: 2,
    desc: 'A proper two-master with a much bigger hull, four guns a side and room for a real crew.',
  },
  galleon: {
    id: 'galleon',
    tier: 4,
    name: 'Galleon',
    shipName: 'The Golden Kraken',
    icon: '🏰',
    era: 'sail',
    requiredLevel: 20,
    purchasePrice: 45000,
    sellPrice: 22500,
    maxHealth: 620,
    maxSpeed: 25,
    acceleration: 6.5,
    turningSpeed: 0.8,
    cargoCapacity: 110,
    crewCapacity: 36,
    cannonCount: 6,
    bowGuns: 2,
    cannonDamage: 25,
    cannonRange: 98,
    reloadSpeed: 1.8,
    boardingStrength: 1.6,
    engineType: 'Sail (square rig)',
    layout: 'broadside',
    upgradeCostMul: 3,
    desc: 'A towering three-master with two gun decks and a castle of a stern. Slow to turn, terrifying to meet.',
  },
  steamCorvette: {
    id: 'steamCorvette',
    tier: 5,
    name: 'Steam Corvette',
    shipName: 'The Iron Kettle',
    icon: '🚂',
    era: 'steam',
    requiredLevel: 30,
    purchasePrice: 95000,
    sellPrice: 47500,
    maxHealth: 850,
    maxSpeed: 31,
    acceleration: 11,
    turningSpeed: 1.0,
    cargoCapacity: 140,
    crewCapacity: 50,
    cannonCount: 5,
    bowGuns: 2,
    cannonDamage: 34,
    cannonRange: 108,
    reloadSpeed: 1.6,
    boardingStrength: 1.8,
    engineType: 'Steam paddle + sail',
    layout: 'broadside',
    upgradeCostMul: 4.5,
    desc: 'Paddle wheels, a roaring smokestack and iron-shod sides. The age of steam has arrived!',
  },
  ironclad: {
    id: 'ironclad',
    tier: 6,
    name: 'Armoured Steamship',
    shipName: 'The Thunder Clam',
    icon: '🛡️',
    era: 'steam',
    requiredLevel: 40,
    purchasePrice: 200000,
    sellPrice: 100000,
    maxHealth: 1300,
    maxSpeed: 33,
    acceleration: 11,
    turningSpeed: 0.95,
    cargoCapacity: 180,
    crewCapacity: 66,
    cannonCount: 5,
    bowGuns: 1,
    cannonDamage: 46,
    cannonRange: 118,
    reloadSpeed: 1.5,
    boardingStrength: 2.1,
    engineType: 'Twin steam screws',
    layout: 'broadside',
    upgradeCostMul: 6.5,
    desc: 'Riveted armour plate, twin funnels and heavy guns behind a sloped casemate.',
  },
  modern: {
    id: 'modern',
    tier: 7,
    name: 'Advanced Modern Ship',
    shipName: 'The Neptune Comet',
    icon: '🚀',
    era: 'modern',
    requiredLevel: 50,
    purchasePrice: 380000,
    sellPrice: 190000,
    maxHealth: 1850,
    maxSpeed: 36,
    acceleration: 15,
    turningSpeed: 1.15,
    cargoCapacity: 240,
    crewCapacity: 85,
    cannonCount: 4,
    bowGuns: 2,
    cannonDamage: 62,
    cannonRange: 135,
    reloadSpeed: 1.2,
    boardingStrength: 2.5,
    engineType: 'Gas turbines',
    layout: 'turret',
    upgradeCostMul: 9,
    desc: 'A sleek fictional super-ship: turbine engines, radar and twin rotating gun turrets.',
  },
};

export const SHIP_CLASS_IDS = Object.keys(SHIP_CLASSES) as ShipClassId[];
export const shipClass = (id: string | undefined) => SHIP_CLASSES[(id as ShipClassId) ?? 'dhow'] ?? SHIP_CLASSES.dhow;
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export interface ShipStats {
  maxHp: number;
  speed: number;
  accel: number;
  turn: number;
  damage: number;
  range: number;
  reload: number;
  crew: number;
  cargo: number;
  boarding: number;
  /** guns on each broadside */
  perSide: number;
  /** total guns (both broadsides + bow guns) */
  guns: number;
}

/** A class's stats with a set of shipwright upgrades fitted (before officers, items and ammo). */
export function shipStats(id: ShipClassId, u: Record<UpgradeId, number>): ShipStats {
  const c = SHIP_CLASSES[id];
  const perSide = c.cannonCount + (c.layout === 'broadside' && u.cannons >= 3 ? 1 : 0);
  return {
    maxHp: Math.round(c.maxHealth * UPGRADES.hull.mul[u.hull]),
    speed: c.maxSpeed * UPGRADES.sails.mul[u.sails],
    accel: c.acceleration * (1 + u.sails * 0.06),
    turn: c.turningSpeed * UPGRADES.steering.mul[u.steering],
    damage: c.cannonDamage * UPGRADES.cannons.mul[u.cannons],
    range: c.cannonRange * UPGRADES.range.mul[u.range],
    reload: c.reloadSpeed * (1 - u.cannons * 0.05),
    crew: Math.round(c.crewCapacity * UPGRADES.crew.mul[u.crew]),
    cargo: Math.round(c.cargoCapacity * UPGRADES.cargo.mul[u.cargo]),
    boarding: c.boardingStrength,
    perSide,
    guns: perSide * 2 + c.bowGuns,
  };
}

/** The value an upgrade gives at a level on a given class (for shop cards). */
export function upgradeValue(id: ShipClassId, up: UpgradeId, lvl: number) {
  const c = SHIP_CLASSES[id];
  const m = UPGRADES[up].mul[lvl];
  switch (up) {
    case 'hull':
      return Math.round(c.maxHealth * m);
    case 'sails':
      return c.maxSpeed * m;
    case 'steering':
      return m;
    case 'cannons':
      return c.cannonDamage * m;
    case 'range':
      return c.cannonRange * m;
    case 'crew':
      return Math.round(c.crewCapacity * m);
    case 'cargo':
      return Math.round(c.cargoCapacity * m);
  }
}

/** Shipwright price of the next level of an upgrade for a class. */
export function upgradeCost(id: ShipClassId, up: UpgradeId, lvl: number, portMul = 1) {
  const base = UPGRADES[up].costs[lvl];
  if (base === undefined) return undefined;
  return Math.round((base * SHIP_CLASSES[id].upgradeCostMul * portMul) / 10) * 10;
}

/** The next class above a given one (or null at the top). */
export function nextClass(id: ShipClassId) {
  const t = SHIP_CLASSES[id].tier;
  return SHIP_CLASS_IDS.map((i) => SHIP_CLASSES[i]).find((c) => c.tier === t + 1) ?? null;
}

/** Upgrade name, icon and level names as shown for a class (steam ships have engines, not sails). */
export function upgradeLabel(id: ShipClassId, up: UpgradeId) {
  const u = UPGRADES[up];
  const era = SHIP_CLASSES[id].era;
  const o = era === 'sail' ? undefined : u.era?.[era];
  return { name: o?.name ?? u.name, icon: o?.icon ?? u.icon, levels: o?.levels ?? u.levels ?? [], visual: o?.visual ?? u.visual };
}
