import type { FlagKind } from '../models/Flags';
import { mulberry32 } from '../core/math';
import type { ShipClassId } from './ShipClasses';
import { makeWeapon, WEAPONS, type WeaponItem } from './combat/Weapons';

// ---------------------------------------------------------------------------
// Trade goods
// ---------------------------------------------------------------------------
export type GoodCat = 'food' | 'spice' | 'textile' | 'material' | 'luxury' | 'contraband' | 'quest';
export type CargoId =
  | 'fish'
  | 'fruit'
  | 'meat'
  | 'grain'
  | 'pepper'
  | 'cinnamon'
  | 'exotic'
  | 'cloth'
  | 'silk'
  | 'clothing'
  | 'wood'
  | 'metal'
  | 'rope'
  | 'jewels'
  | 'goldware'
  | 'rare'
  | 'rum'
  | 'pearls'
  | 'krakenInk'
  | 'sealed';

export interface GoodDef {
  name: string;
  icon: string;
  /** base price per crate */
  value: number;
  color: string;
  cat: GoodCat;
  desc: string;
}

export const CARGO: Record<CargoId, GoodDef> = {
  fish: { name: 'Fish', icon: '🐟', value: 10, color: '#5aa9d6', cat: 'food', desc: 'Salted cod and silver herring.' },
  fruit: { name: 'Fruit', icon: '🍍', value: 12, color: '#f1c40f', cat: 'food', desc: 'Pineapples, mangoes and limes.' },
  meat: { name: 'Meat', icon: '🍖', value: 18, color: '#c0392b', cat: 'food', desc: 'Smoked hams and salt pork.' },
  grain: { name: 'Grain', icon: '🌾', value: 9, color: '#d9b45a', cat: 'food', desc: 'Sacks of wheat and rice.' },
  pepper: { name: 'Pepper', icon: '🌶️', value: 45, color: '#e74c3c', cat: 'spice', desc: 'Fiery black and red peppercorns.' },
  cinnamon: { name: 'Cinnamon', icon: '🍂', value: 55, color: '#a0522d', cat: 'spice', desc: 'Rolled bark that smells of Sunday.' },
  exotic: { name: 'Exotic Spices', icon: '🌺', value: 90, color: '#e67e22', cat: 'spice', desc: 'Saffron, clove and dragon-root.' },
  cloth: { name: 'Cloth', icon: '🧶', value: 26, color: '#8e7cc3', cat: 'textile', desc: 'Bolts of cotton and canvas.' },
  silk: { name: 'Silk', icon: '🎀', value: 75, color: '#e84393', cat: 'textile', desc: 'Shimmering silk from far away.' },
  clothing: { name: 'Clothing', icon: '👘', value: 40, color: '#6c5ce7', cat: 'textile', desc: 'Coats, shirts and fancy hats.' },
  wood: { name: 'Wood', icon: '🪵', value: 14, color: '#a0522d', cat: 'material', desc: 'Seasoned planks and spars.' },
  metal: { name: 'Metal', icon: '⚙️', value: 50, color: '#7f8c8d', cat: 'material', desc: 'Iron ingots and copper sheets.' },
  rope: { name: 'Rope', icon: '🪢', value: 20, color: '#cfae76', cat: 'material', desc: 'Coils of tarred hemp rope.' },
  jewels: { name: 'Jewellery', icon: '💍', value: 160, color: '#1abc9c', cat: 'luxury', desc: 'Rings, pendants and pearl drops.' },
  goldware: { name: 'Gold Objects', icon: '🏆', value: 140, color: '#f1c40f', cat: 'luxury', desc: 'Goblets, plates and candlesticks.' },
  rare: { name: 'Rare Curios', icon: '🏺', value: 220, color: '#9b59b6', cat: 'luxury', desc: 'Strange relics collectors adore.' },
  rum: { name: 'Pirate Rum', icon: '🍾', value: 30, color: '#8e5a2a', cat: 'contraband', desc: 'Untaxed and very illegal.' },
  pearls: { name: 'Mermaid Pearls', icon: '🦪', value: 260, color: '#dfe6e9', cat: 'contraband', desc: 'They glow faintly at night.' },
  krakenInk: { name: 'Kraken Ink', icon: '🦑', value: 300, color: '#4b2a6b', cat: 'contraband', desc: 'Squeezed from a very angry squid.' },
  sealed: { name: 'Sealed Crates', icon: '📦', value: 0, color: '#8a5a33', cat: 'quest', desc: 'Contract cargo. No peeking!' },
};
export const CARGO_IDS = Object.keys(CARGO) as CargoId[];
/** Goods that can be bought and sold (quest cargo excluded). */
export const TRADE_IDS = CARGO_IDS.filter((id) => CARGO[id].cat !== 'quest');

/** Old save ids -> new goods. */
const LEGACY_CARGO: Record<string, CargoId> = { food: 'grain', spices: 'pepper', textiles: 'cloth', machinery: 'metal', gold: 'goldware', luxury: 'jewels' };

// ---------------------------------------------------------------------------
// Ship classes
// ---------------------------------------------------------------------------
export type ShipTypeId = 'smallMerchant' | 'mediumMerchant' | 'largeCargo' | 'luxury' | 'armoured' | 'navyCutter' | 'navyFrigate' | 'rivalPirate' | 'steamFreighter' | 'navyIronclad' | 'navyInterceptor';

export interface ShipType {
  id: ShipTypeId;
  label: string;
  design: string;
  team: 'merchant' | 'navy';
  hp: number;
  speed: number;
  turn: number;
  crew: number;
  coffers: [number, number];
  cargo: { id: CargoId; min: number; max: number }[];
  armed: boolean;
  aggression: number; // chance to turn and fight instead of fleeing
  helpChance: number;
  detect: number;
  damage: number;
  reload: number;
  range: number;
  minLevel: number;
  xp: number;
  /** boarding mini-game needle speed multiplier */
  difficulty: number;
  /** defenders' power multiplier when boarded (easy 0.8 … extremely hard 2.8) */
  boarding: number;
}

export const SHIP_TYPES: Record<ShipTypeId, ShipType> = {
  smallMerchant: {
    id: 'smallMerchant',
    label: 'Small Merchant Ship',
    design: 'smallMerchant',
    team: 'merchant',
    hp: 70,
    speed: 17,
    turn: 0.9,
    crew: 4,
    coffers: [250, 450],
    cargo: [
      { id: 'fish', min: 3, max: 7 },
      { id: 'fruit', min: 2, max: 6 },
      { id: 'grain', min: 2, max: 6 },
      { id: 'wood', min: 2, max: 5 },
    ],
    armed: false,
    aggression: 0,
    helpChance: 0.15,
    detect: 70,
    damage: 0,
    reload: 99,
    range: 0,
    minLevel: 1,
    xp: 60,
    difficulty: 1,
    boarding: 0.8,
  },
  mediumMerchant: {
    id: 'mediumMerchant',
    label: 'Medium Merchant Ship',
    design: 'mediumMerchant',
    team: 'merchant',
    hp: 140,
    speed: 16,
    turn: 0.7,
    crew: 8,
    coffers: [500, 900],
    cargo: [
      { id: 'pepper', min: 2, max: 5 },
      { id: 'cinnamon', min: 1, max: 4 },
      { id: 'cloth', min: 3, max: 7 },
      { id: 'meat', min: 2, max: 5 },
    ],
    armed: true,
    aggression: 0.2,
    helpChance: 0.35,
    detect: 80,
    damage: 7,
    reload: 4.5,
    range: 60,
    minLevel: 1,
    xp: 120,
    difficulty: 1.15,
    boarding: 1.0,
  },
  largeCargo: {
    id: 'largeCargo',
    label: 'Large Cargo Ship',
    design: 'largeCargo',
    team: 'merchant',
    hp: 280,
    speed: 12.5,
    turn: 0.42,
    crew: 14,
    coffers: [900, 1600],
    cargo: [
      { id: 'metal', min: 3, max: 8 },
      { id: 'wood', min: 5, max: 12 },
      { id: 'rope', min: 3, max: 7 },
      { id: 'clothing', min: 3, max: 7 },
      { id: 'exotic', min: 1, max: 4 },
    ],
    armed: true,
    aggression: 0.55,
    helpChance: 0.6,
    detect: 95,
    damage: 9,
    reload: 4,
    range: 70,
    minLevel: 2,
    xp: 260,
    difficulty: 1.3,
    boarding: 1.35,
  },
  luxury: {
    id: 'luxury',
    label: 'Luxury Ship',
    design: 'luxury',
    team: 'merchant',
    hp: 150,
    speed: 21,
    turn: 0.8,
    crew: 9,
    coffers: [1800, 3000],
    cargo: [
      { id: 'jewels', min: 2, max: 5 },
      { id: 'silk', min: 2, max: 5 },
      { id: 'goldware', min: 1, max: 3 },
    ],
    armed: false,
    aggression: 0,
    helpChance: 0.8,
    detect: 110,
    damage: 6,
    reload: 4,
    range: 55,
    minLevel: 2,
    xp: 300,
    difficulty: 1.4,
    boarding: 1.1,
  },
  armoured: {
    id: 'armoured',
    label: 'Armoured Cargo Ship',
    design: 'armoured',
    team: 'merchant',
    hp: 420,
    speed: 11.5,
    turn: 0.4,
    crew: 16,
    coffers: [1500, 2600],
    cargo: [
      { id: 'goldware', min: 3, max: 6 },
      { id: 'metal', min: 4, max: 9 },
      { id: 'rare', min: 1, max: 2 },
    ],
    armed: true,
    aggression: 0.85,
    helpChance: 0.5,
    detect: 100,
    damage: 12,
    reload: 3.4,
    range: 80,
    minLevel: 3,
    xp: 420,
    difficulty: 1.6,
    boarding: 1.7,
  },
  navyCutter: {
    id: 'navyCutter',
    label: 'Navy Cutter',
    design: 'navyCutter',
    team: 'navy',
    hp: 120,
    speed: 23,
    turn: 1.0,
    crew: 8,
    coffers: [300, 500],
    cargo: [],
    armed: true,
    aggression: 1,
    helpChance: 0,
    detect: 180,
    damage: 8,
    reload: 3.0,
    range: 75,
    minLevel: 1,
    xp: 150,
    difficulty: 1.3,
    boarding: 1.2,
  },
  navyFrigate: {
    id: 'navyFrigate',
    label: 'Navy Frigate',
    design: 'navyFrigate',
    team: 'navy',
    hp: 420,
    speed: 18,
    turn: 0.55,
    crew: 20,
    coffers: [800, 1400],
    cargo: [],
    armed: true,
    aggression: 1,
    helpChance: 0,
    detect: 220,
    damage: 13,
    reload: 3.4,
    range: 95,
    minLevel: 1,
    xp: 400,
    difficulty: 1.7,
    boarding: 1.6,
  },
  rivalPirate: {
    id: 'rivalPirate',
    label: 'Rival Pirate Brig',
    design: 'rival',
    team: 'merchant',
    hp: 230,
    speed: 19,
    turn: 0.8,
    crew: 12,
    coffers: [1400, 2200],
    cargo: [
      { id: 'rum', min: 3, max: 7 },
      { id: 'jewels', min: 1, max: 3 },
    ],
    armed: true,
    aggression: 1,
    helpChance: 0,
    detect: 400,
    damage: 8,
    reload: 3.4,
    range: 78,
    minLevel: 1,
    xp: 500,
    difficulty: 1.45,
    boarding: 1.5,
  },
  // ---- the world modernises as you level up ----
  steamFreighter: {
    id: 'steamFreighter',
    label: 'Steam Freighter',
    design: 'steamFreighter',
    team: 'merchant',
    hp: 520,
    speed: 19,
    turn: 0.55,
    crew: 20,
    coffers: [2600, 4200],
    cargo: [
      { id: 'metal', min: 5, max: 10 },
      { id: 'clothing', min: 4, max: 8 },
      { id: 'exotic', min: 2, max: 5 },
      { id: 'goldware', min: 1, max: 3 },
    ],
    armed: true,
    aggression: 0.6,
    helpChance: 0.6,
    detect: 120,
    damage: 13,
    reload: 3.2,
    range: 90,
    minLevel: 25,
    xp: 520,
    difficulty: 1.5,
    boarding: 1.9,
  },
  navyIronclad: {
    id: 'navyIronclad',
    label: 'Navy Ironclad',
    design: 'navyIronclad',
    team: 'navy',
    hp: 760,
    speed: 21,
    turn: 0.55,
    crew: 28,
    coffers: [1600, 2600],
    cargo: [],
    armed: true,
    aggression: 1,
    helpChance: 0,
    detect: 240,
    damage: 15,
    reload: 3.2,
    range: 105,
    minLevel: 32,
    xp: 650,
    difficulty: 1.75,
    boarding: 2.3,
  },
  navyInterceptor: {
    id: 'navyInterceptor',
    label: 'Navy Interceptor',
    design: 'navyInterceptor',
    team: 'navy',
    hp: 900,
    speed: 30,
    turn: 0.9,
    crew: 34,
    coffers: [2400, 3600],
    cargo: [],
    armed: true,
    aggression: 1,
    helpChance: 0,
    detect: 280,
    damage: 17,
    reload: 2.6,
    range: 120,
    minLevel: 45,
    xp: 900,
    difficulty: 1.9,
    boarding: 2.8,
  },
};

const NAME_A = ['Golden', 'Merry', 'Silver', 'Royal', 'Lucky', 'Jolly', 'Gentle', 'Proud', 'Swift', 'Fair', 'Brave', 'Crimson', 'Velvet', 'Honest', 'Saucy', 'Plucky'];
const NAME_B = ['Goose', 'Maiden', 'Swan', 'Pelican', 'Dolphin', 'Duchess', 'Fortune', 'Biscuit', 'Herring', 'Penny', 'Marigold', 'Teapot', 'Mermaid', 'Lantern', 'Clipper', 'Petunia'];
const NAVY_NAMES = ['HMS Vigilant', 'HMS Stalwart', 'HMS Resolute', 'HMS Dauntless', 'HMS Steadfast', 'HMS Tenacious', 'HMS Indomitable', 'HMS Persistent'];

export function shipName(team: 'merchant' | 'navy') {
  if (team === 'navy') return NAVY_NAMES[Math.floor(Math.random() * NAVY_NAMES.length)];
  return `The ${NAME_A[Math.floor(Math.random() * NAME_A.length)]} ${NAME_B[Math.floor(Math.random() * NAME_B.length)]}`;
}

// ---------------------------------------------------------------------------
// Upgrades (shipwright + gunsmith)
// ---------------------------------------------------------------------------
export type UpgradeId = 'hull' | 'sails' | 'steering' | 'cannons' | 'range' | 'crew' | 'cargo';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  stat: string;
  /** multiplier on the ship class's base value, per level (index 0 = stock) */
  mul: number[];
  costs: number[];
  fmt: (v: number) => string;
  visual: string;
  /** per-level names (shown in shops) */
  levels?: string[];
  /** different names on steam / modern ships */
  era?: Partial<Record<'steam' | 'modern', { name?: string; icon?: string; levels?: string[]; visual?: string }>>;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  hull: {
    id: 'hull', name: 'Hull', icon: '🛡️', stat: 'Max Health', mul: [1, 1.2, 1.42, 1.68, 2.0], costs: [900, 2200, 4800, 9500], fmt: (v) => `${Math.round(v)} HP`,
    visual: 'Iron bands → gold trim → armour plating', levels: ['Pine Planks', 'Iron-Banded Oak', 'Double Oak', 'Gilded Hull', 'Armour Plated'],
    era: { steam: { name: 'Armour', levels: ['Iron Plate', 'Riveted Belt', 'Double Belt', 'Gilded Belt', 'Hardened Steel'], visual: 'Thicker riveted armour belts' }, modern: { name: 'Armour', levels: ['Steel Hull', 'Composite Panels', 'Reactive Plating', 'Titanium Skin', 'Super-Alloy'], visual: 'Armour panels along the hull' } },
  },
  sails: {
    id: 'sails', name: 'Sails', icon: '⛵', stat: 'Top Speed', mul: [1, 1.07, 1.14, 1.21, 1.3], costs: [800, 2000, 4400, 9000], fmt: (v) => `${Math.round(v)} kn`,
    visual: 'Bigger sails, jib, topsail', levels: ['Patched Canvas', 'Jib Rig', 'Topsail Rig', 'Racing Canvas', 'Twin-Mast Rig'],
    era: { steam: { name: 'Engines', icon: '⚙️', levels: ['Single Boiler', 'Double Boiler', 'Compound Engine', 'Triple Expansion', 'Forced Draught'], visual: 'Taller funnels, more steam' }, modern: { name: 'Turbines', icon: '⚙️', levels: ['Cruise Turbine', 'Twin Turbines', 'Afterburners', 'Hydro-Jets', 'Comet Drive'], visual: 'Turbine exhaust glow' } },
  },
  steering: { id: 'steering', name: 'Steering', icon: '☸️', stat: 'Turn Rate', mul: [1, 1.1, 1.2, 1.32, 1.45], costs: [600, 1500, 3400, 7000], fmt: (v) => `${Math.round(v * 100)}%`, visual: 'Golden ship wheel', levels: ['Old Wheel', 'Oiled Rudder', 'Golden Wheel', 'Balanced Rudder', 'Master Helm'] },
  cannons: {
    id: 'cannons', name: 'Cannons', icon: '💣', stat: 'Damage', mul: [1, 1.22, 1.48, 1.8, 2.15], costs: [1000, 2400, 5200, 10000], fmt: (v) => `${Math.round(v)} dmg`,
    visual: 'Bigger bronze then gold guns; +1 gun a side at level 3', levels: ['Iron 6-Pounders', 'Bronze 9-Pounders', 'Long 12-Pounders', 'Culverins', 'Royal Carronades'],
    era: { steam: { levels: ['Iron Rifles', 'Rifled 20-Pounders', 'Armstrong Guns', 'Breech-Loaders', 'Thunder Guns'] }, modern: { name: 'Turret Guns', levels: ['Auto-Cannons', 'Twin 76s', 'Rapid Turrets', 'Rail Turrets', 'Comet Cannons'], visual: 'Bigger, faster turrets' } },
  },
  range: { id: 'range', name: 'Cannon Range', icon: '🎯', stat: 'Range', mul: [1, 1.12, 1.25, 1.4, 1.55], costs: [700, 1800, 4000, 8000], fmt: (v) => `${Math.round(v)} m`, visual: 'Longer barrels', levels: ['Standard Barrels', 'Extended Barrels', 'Long Barrels', 'Rifled Barrels', 'Eagle-Eye Barrels'], era: { modern: { levels: ['Optical Sight', 'Rangefinder', 'Radar Lock', 'Fire Control', 'Eagle-Eye Radar'] } } },
  crew: { id: 'crew', name: 'Crew Quarters', icon: '👥', stat: 'Max Crew', mul: [1, 1.25, 1.5, 1.85, 2.2], costs: [700, 1800, 4000, 8200], fmt: (v) => `${Math.round(v)} pirates`, visual: 'More pirates on deck', levels: ['Hammocks', 'Bunk Beds', 'Crew Deck', 'Barracks', 'Pirate Palace'] },
  cargo: { id: 'cargo', name: 'Cargo Hold', icon: '📦', stat: 'Capacity', mul: [1, 1.3, 1.65, 2.1, 2.6], costs: [600, 1600, 3600, 7500], fmt: (v) => `${Math.round(v)} crates`, visual: 'Cargo stacked on deck', levels: ['Small Hold', 'Deep Hold', 'Twin Holds', 'Cargo Deck', 'Floating Warehouse'] },
};
export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];
export const MAX_UPGRADE = 4;

// ---------------------------------------------------------------------------
// Ammunition (gunsmith)
// ---------------------------------------------------------------------------
export type AmmoId = 'round' | 'chain' | 'grape' | 'fire' | 'heavy';
export interface AmmoDef {
  id: AmmoId;
  name: string;
  icon: string;
  cost: number;
  dmg: number;
  range: number;
  reload: number;
  color: number;
  desc: string;
}
export const AMMO: Record<AmmoId, AmmoDef> = {
  round: { id: 'round', name: 'Round Shot', icon: '⚫', cost: 0, dmg: 1, range: 1, reload: 1, color: 0x23252b, desc: 'Good old iron balls. Reliable.' },
  chain: { id: 'chain', name: 'Chain Shot', icon: '⛓️', cost: 1200, dmg: 0.7, range: 0.9, reload: 1, color: 0x6a6f78, desc: 'Shreds sails: targets slow to a crawl for 6s.' },
  grape: { id: 'grape', name: 'Grapeshot', icon: '🍇', cost: 1500, dmg: 0.6, range: 0.7, reload: 0.9, color: 0x4a4a52, desc: 'Scatters the enemy crew – fewer defenders when you board.' },
  fire: { id: 'fire', name: 'Fire Shot', icon: '🔥', cost: 2400, dmg: 0.9, range: 1, reload: 1.1, color: 0xff6a1a, desc: 'Sets ships ablaze: extra burn damage over 5s.' },
  heavy: { id: 'heavy', name: 'Heavy Shot', icon: '🪨', cost: 3200, dmg: 1.45, range: 0.9, reload: 1.25, color: 0x16161a, desc: 'Huge balls that smash hulls. Slow to load.' },
};
export const AMMO_IDS = Object.keys(AMMO) as AmmoId[];

// ---------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------
export interface Cosmetic {
  id: string;
  name: string;
  kind: 'sail' | 'hull' | 'flag' | 'cannon';
  cost: number;
  value: string;
  stripe?: string;
  swatch: string;
  /** only unlocked through special items (not sold by the shipwright) */
  special?: boolean;
}
export const COSMETICS: Cosmetic[] = [
  { id: 'sail-canvas', name: 'Canvas Sails', kind: 'sail', cost: 0, value: '#f3ead6', swatch: '#f3ead6' },
  { id: 'sail-black', name: 'Midnight Sails', kind: 'sail', cost: 1200, value: '#202028', swatch: '#202028' },
  { id: 'sail-red', name: 'Crimson Sails', kind: 'sail', cost: 1500, value: '#b3261e', swatch: '#b3261e' },
  { id: 'sail-stripe', name: 'Striped Sails', kind: 'sail', cost: 1800, value: '#f3ead6', stripe: '#d23b35', swatch: 'repeating-linear-gradient(90deg,#f3ead6 0 8px,#d23b35 8px 16px)' },
  { id: 'sail-royal', name: 'Royal Purple', kind: 'sail', cost: 3000, value: '#5b2a86', stripe: '#f4c24c', swatch: 'repeating-linear-gradient(90deg,#5b2a86 0 8px,#f4c24c 8px 16px)' },
  { id: 'sail-storm', name: 'Storm-Silk Sails', kind: 'sail', cost: 0, value: '#1f2a44', stripe: '#7fd0ff', swatch: 'repeating-linear-gradient(90deg,#1f2a44 0 8px,#7fd0ff 8px 11px)', special: true },
  { id: 'hull-oak', name: 'Dark Oak', kind: 'hull', cost: 0, value: '#6b4428', swatch: '#6b4428' },
  { id: 'hull-black', name: 'Black Pearl', kind: 'hull', cost: 1500, value: '#24242a', swatch: '#24242a' },
  { id: 'hull-red', name: 'Buccaneer Red', kind: 'hull', cost: 1600, value: '#8c2a22', swatch: '#8c2a22' },
  { id: 'hull-teal', name: 'Lagoon Teal', kind: 'hull', cost: 2000, value: '#1f6f78', swatch: '#1f6f78' },
  { id: 'hull-gold', name: 'Treasure Gold', kind: 'hull', cost: 6000, value: '#b8862e', swatch: '#b8862e' },
  { id: 'hull-ghost', name: 'Ghost Ship', kind: 'hull', cost: 0, value: '#bfe3dc', swatch: 'linear-gradient(#e8fffb,#8fc9c0)', special: true },
  { id: 'hull-coral', name: 'Coral Reef', kind: 'hull', cost: 0, value: '#e8705a', swatch: 'linear-gradient(#ff9a7a,#d0503a)', special: true },
  { id: 'flag-pirate', name: 'Jolly Roger', kind: 'flag', cost: 0, value: 'pirate', swatch: '#15151a' },
  { id: 'flag-red', name: 'Red Skull', kind: 'flag', cost: 1000, value: 'pirateRed', swatch: '#a5161b' },
  { id: 'flag-swords', name: 'Crossed Cutlasses', kind: 'flag', cost: 1400, value: 'swords', swatch: '#1b1b24' },
  { id: 'flag-kraken', name: 'Kraken Banner', kind: 'flag', cost: 0, value: 'kraken', swatch: '#3b1d5a', special: true },
  { id: 'cannon-auto', name: 'Forge Finish', kind: 'cannon', cost: 0, value: '', swatch: 'linear-gradient(#5a6070,#2a2e36)' },
  { id: 'cannon-iron', name: 'Blackened Iron', kind: 'cannon', cost: 400, value: '#25292f', swatch: '#25292f' },
  { id: 'cannon-bronze', name: 'Polished Bronze', kind: 'cannon', cost: 800, value: '#c08a3e', swatch: 'linear-gradient(#e0b070,#9a6a2e)' },
  { id: 'cannon-jade', name: 'Jade Dragon', kind: 'cannon', cost: 3200, value: '#2fae84', swatch: 'linear-gradient(#6fe0b8,#1f7a5a)' },
  { id: 'cannon-gold', name: 'Gilded Gold', kind: 'cannon', cost: 2500, value: '#f4c24c', swatch: 'linear-gradient(#ffe48a,#d39a1a)' },
  { id: 'cannon-ruby', name: 'Ruby Kraken', kind: 'cannon', cost: 0, value: '#b3261e', swatch: 'linear-gradient(#ff6a5a,#7a0a0a)', special: true },
];

// ---------------------------------------------------------------------------
// Special items (black market / remote traders) – all fictional & arcade-y
// ---------------------------------------------------------------------------
export interface SpecialItem {
  id: string;
  name: string;
  icon: string;
  cost: number;
  desc: string;
  where: ('blackmarket' | 'remote')[];
  unlocks?: string;
  repeatable?: boolean;
}
export const SPECIAL_ITEMS: SpecialItem[] = [
  { id: 'dragonCannons', name: "Dragon's Breath Cannons", icon: '🐉', cost: 6000, desc: '+20% cannon damage. Unlocks the Ruby Kraken cannon skin.', where: ['blackmarket'], unlocks: 'cannon-ruby' },
  { id: 'stormSails', name: 'Storm-Silk Sails', icon: '⛈️', cost: 5000, desc: '+8% top speed. Unlocks the Storm-Silk sail colours.', where: ['blackmarket', 'remote'], unlocks: 'sail-storm' },
  { id: 'ghostPaint', name: 'Ghost Ship Paint', icon: '👻', cost: 3500, desc: 'A spooky pale hull paint. Merchants shiver.', where: ['blackmarket'], unlocks: 'hull-ghost' },
  { id: 'krakenFlag', name: 'Kraken Banner', icon: '🦑', cost: 2500, desc: 'A legendary flag. Makes your crew feel invincible.', where: ['blackmarket'], unlocks: 'flag-kraken' },
  { id: 'treasureMap', name: 'Treasure Map', icon: '🗺️', cost: 1200, desc: 'Reveals the location of a hidden treasure island.', where: ['blackmarket', 'remote'], repeatable: true },
  { id: 'grapplingHooks', name: 'Grappling Hooks', icon: '🪝', cost: 2200, desc: 'Boarding parties land faster: +25% hit zone in brawls.', where: ['blackmarket'] },
  { id: 'cursedCutlasses', name: 'Cursed Cutlasses', icon: '🗡️', cost: 2800, desc: 'Defenders panic: the brawl needle moves 15% slower.', where: ['blackmarket', 'remote'] },
  { id: 'smugglerCharts', name: "Smuggler's Charts", icon: '🧭', cost: 2000, desc: 'Secret routes: the navy notices you 30% less.', where: ['blackmarket'] },
  { id: 'mermaidCharm', name: 'Mermaid Scale Charm', icon: '🧜', cost: 4500, desc: 'Your hull slowly mends itself at sea.', where: ['remote'] },
  { id: 'coralPaint', name: 'Coral Reef Paint', icon: '🪸', cost: 1800, desc: 'Bright coral hull paint from the lagoon.', where: ['remote'], unlocks: 'hull-coral' },
];

// ---------------------------------------------------------------------------
// Officers (recruited in taverns)
// ---------------------------------------------------------------------------
export type RoleId = 'gunner' | 'navigator' | 'engineer' | 'boarder' | 'trader';
export const ROLES: Record<RoleId, { name: string; icon: string; color: string; bonus: (skill: number) => string }> = {
  gunner: { name: 'Gunner', icon: '💣', color: '#e74c3c', bonus: (s) => `Cannons reload ${s * 7}% faster` },
  navigator: { name: 'Navigator', icon: '🧭', color: '#3498db', bonus: (s) => `+${s * 4}% speed and turning` },
  engineer: { name: 'Engineer', icon: '🔧', color: '#7f8c8d', bonus: (s) => `+${s * 8}% hull, repairs at sea` },
  boarder: { name: 'Boarder', icon: '⚔️', color: '#c0392b', bonus: (s) => `Bigger brawl zone (+${s * 12}%)` },
  trader: { name: 'Trader', icon: '⚖️', color: '#f1c40f', bonus: (s) => `${s * 4}% better market prices` },
};
export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

export interface Officer {
  id: string;
  name: string;
  role: RoleId;
  skill: number;
  spec: string;
  cost: number;
  ability: string;
  line: string;
}

const FIRST = ['Peg-Leg', 'One-Eyed', 'Salty', 'Lucky', 'Mad', 'Calico', 'Barnacle', 'Red', 'Iron', 'Smiling', 'Gentleman', 'Long', 'Bonnie', 'Squinty', 'Admiral', 'Cookie'];
const LAST = ['Polly', 'Jack', 'Meg', 'Finn', 'Rosa', 'Bart', 'Nell', 'Silas', 'Anne', 'Mungo', 'Ivy', 'Tobias', 'Greta', 'Rufus', 'Mabel', 'Ned'];
const ABILITY: Record<RoleId, string[]> = {
  gunner: ['Can hit a gull at 100 paces', 'Sleeps next to the powder kegs', 'Names every cannon after an aunt'],
  navigator: ['Reads the stars like a book', 'Never once been lost (allegedly)', 'Can smell a shortcut'],
  engineer: ['Patches holes with chewing gum', 'Talks to the hull. It listens.', 'Owns forty-seven hammers'],
  boarder: ['Swings on ropes for fun', 'Has never lost an arm-wrestle', 'Yells VERY loudly'],
  trader: ['Haggles in nine languages', 'Can sell sand to a crab', 'Knows every merchant by name'],
};
const LINES: Record<RoleId, string> = {
  gunner: 'Point me at a ship and I\'ll put a ball through her porthole!',
  navigator: 'With me at the charts, the wind is always on our side.',
  engineer: 'Your hull creaks like an old door. I can fix that.',
  boarder: 'Get me close and I\'ll be first over the rail!',
  trader: 'I\'ll squeeze every last coin out of those merchants.',
};
export const RECRUIT_SPECS = ['recruit0', 'recruit1', 'recruit2', 'recruit3', 'recruit4', 'recruit5', 'recruit6', 'recruit7'];

/** Recruits sitting in a tavern on a given day (deterministic per port & day). */
export function recruitsFor(portId: string, day: number, count = 3): Officer[] {
  let h = day * 977;
  for (const ch of portId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const rng = mulberry32(h);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
  const out: Officer[] = [];
  const roles = [...ROLE_IDS].sort(() => rng() - 0.5);
  for (let i = 0; i < count; i++) {
    const role = roles[i % roles.length];
    const skill = 1 + Math.floor(rng() * rng() * 3.2);
    out.push({
      id: `${portId}-${day}-${i}`,
      name: `${pick(FIRST)} ${pick(LAST)}`,
      role,
      skill: Math.min(3, skill),
      spec: RECRUIT_SPECS[Math.floor(rng() * RECRUIT_SPECS.length)],
      cost: Math.round((600 + skill * skill * 650 + rng() * 300) / 50) * 50,
      ability: pick(ABILITY[role]),
      line: LINES[role],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Player profile (persisted)
// ---------------------------------------------------------------------------
export interface ContractSave {
  id: string;
  kind: string;
  title: string;
  desc: string;
  money: number;
  xp: number;
  target: number;
  progress: number;
  port?: string;
  good?: CargoId;
  qty?: number;
  island?: string;
  typeId?: ShipTypeId;
  from: string;
}

/** A ship you own but aren't sailing right now (moored at any shipyard). */
export interface OwnedShip {
  upgrades: Record<UpgradeId, number>;
  hp: number;
}

export interface Profile {
  money: number;
  xp: number;
  level: number;
  /** the ship class you're sailing */
  ship: ShipClassId;
  /** every ship class you own (including the one you're sailing) */
  fleet: Partial<Record<ShipClassId, OwnedShip>>;
  /** classes the game has already told you about (for the "new ship unlocked" fanfare) */
  shipsUnlocked: ShipClassId[];
  crew: number;
  hp: number;
  cargo: Partial<Record<CargoId, number>>;
  /** average price paid per crate (for profit display) */
  costBasis: Partial<Record<CargoId, number>>;
  warehouses: Record<string, Partial<Record<CargoId, number>>>;
  upgrades: Record<UpgradeId, number>;
  owned: string[];
  sail: string;
  hull: string;
  flag: string;
  cannonSkin: string;
  ammo: AmmoId[];
  ammoSel: AmmoId;
  items: string[];
  officers: Officer[];
  hiredRecruits: string[];
  contracts: ContractSave[];
  doneContracts: string[];
  maps: string[];
  blackMarkets: string[];
  stats: { captures: number; sunk: number; earned: number; navySunk: number; treasures: number; traded: number; tradeProfit: number; byType: Partial<Record<ShipTypeId, number>> };
  missionIndex: number;
  missions: { id: string; progress: number }[];
  treasuresFound: string[];
  tutorialDone: boolean;
  landTutorial: number;
  lastPort: string;
  day: number;
  hour: number;
  market: Record<string, Record<string, [number, number]>> | null;
  // ---- land combat ----
  /** every hand weapon you own */
  weapons: WeaponItem[];
  /** uid of the equipped blade */
  melee: string;
  /** uid of the equipped gun ('' = none) */
  ranged: string;
  /** pistol balls / cartridges */
  shot: number;
  /** iron scrap for upgrading weapons */
  scrap: number;
  land: {
    kills: number;
    bosses: string[];
    cleared: Record<string, number>;
    escorts: number;
    defeats: number;
    /** combat tips already shown (bit flags) */
    tut: number;
    /** port id → day you last looted its treasury */
    raids: Record<string, number>;
    raided: number;
  };
}

export function newProfile(): Profile {
  return {
    money: 1000,
    xp: 0,
    level: 1,
    ship: 'dhow',
    fleet: { dhow: { upgrades: { hull: 0, sails: 0, steering: 0, cannons: 0, range: 0, crew: 0, cargo: 0 }, hp: 100 } },
    shipsUnlocked: ['dhow'],
    crew: 6,
    hp: 100,
    cargo: {},
    costBasis: {},
    warehouses: {},
    upgrades: { hull: 0, sails: 0, steering: 0, cannons: 0, range: 0, crew: 0, cargo: 0 },
    owned: ['sail-canvas', 'hull-oak', 'flag-pirate', 'cannon-auto'],
    sail: 'sail-canvas',
    hull: 'hull-oak',
    flag: 'flag-pirate',
    cannonSkin: 'cannon-auto',
    ammo: ['round'],
    ammoSel: 'round',
    items: [],
    officers: [],
    hiredRecruits: [],
    contracts: [],
    doneContracts: [],
    maps: [],
    blackMarkets: [],
    stats: { captures: 0, sunk: 0, earned: 0, navySunk: 0, treasures: 0, traded: 0, tradeProfit: 0, byType: {} },
    missionIndex: 0,
    missions: [],
    treasuresFound: [],
    tutorialDone: false,
    landTutorial: 0,
    lastPort: 'skull',
    day: 1,
    hour: 9.5,
    market: null,
    ...starterArms(),
    land: { kills: 0, bosses: [], cleared: {}, escorts: 0, defeats: 0, tut: 0, raids: {}, raided: 0 },
  };
}

/** A rusty cutlass and an old flintlock: every captain starts with these. */
function starterArms() {
  const blade = makeWeapon('cutlass');
  const gun = makeWeapon('pistol');
  return { weapons: [blade, gun], melee: blade.uid, ranged: gun.uid, shot: 12, scrap: 0 };
}

const SAVE_KEY = 'pirate-raiders-save-v1';
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(p));
  } catch {
    /* storage may be unavailable */
  }
}

/** Convert goods from older saves to the current trade goods. */
function migrateGoods(src: Record<string, number> | undefined) {
  const out: Partial<Record<CargoId, number>> = {};
  for (const [k, v] of Object.entries(src ?? {})) {
    const id = (CARGO[k as CargoId] ? k : LEGACY_CARGO[k]) as CargoId | undefined;
    if (id && v > 0) out[id] = (out[id] ?? 0) + v;
  }
  return out;
}

export function loadProfile(): Profile | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    const p = JSON.parse(s) as Profile;
    const base = newProfile();
    const prof: Profile = { ...base, ...p, upgrades: { ...base.upgrades, ...p.upgrades }, stats: { ...base.stats, ...p.stats } };
    prof.cargo = migrateGoods(p.cargo as Record<string, number>);
    for (const k of Object.keys(prof.warehouses)) prof.warehouses[k] = migrateGoods(prof.warehouses[k] as Record<string, number>);
    if (!prof.owned.includes('cannon-auto')) prof.owned.push('cannon-auto');
    if (!AMMO[prof.ammoSel]) prof.ammoSel = 'round';
    // saves from before ship classes: the old sloop becomes your Starter Dhow (upgrades kept)
    if (!prof.ship) prof.ship = 'dhow';
    prof.fleet = { ...(p.fleet ?? {}) };
    prof.fleet[prof.ship] = { upgrades: { ...prof.upgrades }, hp: prof.hp };
    if (!prof.shipsUnlocked?.length) prof.shipsUnlocked = ['dhow'];
    // saves from before land combat get the starter arms; drop anything unknown
    prof.weapons = (prof.weapons ?? []).filter((w) => w && WEAPONS[w.base]);
    if (!prof.weapons.length) Object.assign(prof, starterArms());
    if (!prof.weapons.some((w) => w.uid === prof.melee && WEAPONS[w.base].kind === 'melee')) prof.melee = prof.weapons.find((w) => WEAPONS[w.base].kind === 'melee')?.uid ?? '';
    if (prof.ranged && !prof.weapons.some((w) => w.uid === prof.ranged)) prof.ranged = prof.weapons.find((w) => WEAPONS[w.base].kind === 'ranged')?.uid ?? '';
    if (!prof.melee) {
      const blade = makeWeapon('cutlass');
      prof.weapons.push(blade);
      prof.melee = blade.uid;
    }
    prof.land = { ...base.land, ...(p.land ?? {}) };
    return prof;
  } catch {
    return null;
  }
}
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * XP needed to go from `lvl` to `lvl + 1`. Tuned so the ship ladder (levels 5, 10, 20, 30, 40, 50)
 * is a long but reachable journey: ~12 captures to level 5, ~70 to level 20, a few hundred to 50.
 */
export const XP_CURVE = { base: 350, linear: 130, quad: 0.5 };
export const xpForLevel = (lvl: number) => Math.round(XP_CURVE.base + XP_CURVE.linear * lvl + XP_CURVE.quad * lvl * lvl);

export function cosmeticById(id: string) {
  return COSMETICS.find((c) => c.id === id) ?? COSMETICS[0];
}
export function flagKindOf(p: Profile) {
  return cosmeticById(p.flag).value as FlagKind;
}

/** Combined officer skill for a role (0 if none hired). */
export function officerSkill(p: Profile, role: RoleId) {
  return p.officers.filter((o) => o.role === role).reduce((s, o) => s + o.skill, 0);
}
export const hasItem = (p: Profile, id: string) => p.items.includes(id);
