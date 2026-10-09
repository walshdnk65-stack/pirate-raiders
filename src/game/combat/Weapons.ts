import type { PropKind } from '../../models/Character';

/**
 * Hand weapons for fighting on land.
 *
 * Every balance number lives in WEAPONS / RARITIES / EFFECTS below. A weapon you own is a
 * WeaponItem (base type + rarity + upgrade level + optional special effect); weaponStats()
 * turns that into the numbers combat uses.
 */
export type WeaponBaseId = 'cutlass' | 'sword' | 'axe' | 'rapier' | 'anchor' | 'pistol' | 'blunderbuss' | 'revolver';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type EffectId = 'secondWind' | 'thunder' | 'gilded' | 'swift' | 'crushing' | 'embers' | 'piercing' | 'quickload';
export type SwingStyle = 'slash' | 'thrust' | 'chop';
export type SwingSound = 'light' | 'medium' | 'heavy';

export interface WeaponBase {
  id: WeaponBaseId;
  name: string;
  icon: string;
  kind: 'melee' | 'ranged';
  prop: PropKind;
  /** player level needed to buy it (or find it as loot) */
  unlockLevel: number;
  price: number;
  /** damage per hit (melee) or per ball/pellet (ranged) */
  damage: number;
  /** attack speed: swing durations are divided by this */
  speed: number;
  /** melee reach / gun range in metres */
  range: number;
  /** half-angle of the swing arc (radians) */
  arc: number;
  /** shove given to whoever gets hit (m/s) */
  knockback: number;
  /** stamina per swing */
  stamina: number;
  style: SwingStyle;
  sound: SwingSound;
  /** blade length for the swing trail (m along the hand) */
  blade: number;
  trail: string;
  // guns
  /** rounds loaded at once */
  mag?: number;
  /** seconds to reload */
  reload?: number;
  /** seconds between shots */
  cooldown?: number;
  pellets?: number;
  spread?: number;
  desc: string;
}

export const WEAPONS: Record<WeaponBaseId, WeaponBase> = {
  cutlass: {
    id: 'cutlass',
    name: 'Cutlass',
    icon: '🗡️',
    kind: 'melee',
    prop: 'cutlass',
    unlockLevel: 1,
    price: 150,
    damage: 13,
    speed: 1.25,
    range: 2.1,
    arc: 1.15,
    knockback: 4,
    stamina: 8,
    style: 'slash',
    sound: 'light',
    blade: 0.95,
    trail: '#bfe8ff',
    desc: 'A pirate classic. Quick, curved and nimble – short reach, fast combos.',
  },
  sword: {
    id: 'sword',
    name: 'Broadsword',
    icon: '⚔️',
    kind: 'melee',
    prop: 'sword',
    unlockLevel: 3,
    price: 600,
    damage: 18,
    speed: 1.0,
    range: 2.6,
    arc: 1.0,
    knockback: 5.5,
    stamina: 10,
    style: 'slash',
    sound: 'medium',
    blade: 1.25,
    trail: '#e8f2ff',
    desc: 'Balanced steel with a longer reach. A fine all-rounder.',
  },
  axe: {
    id: 'axe',
    name: 'Heavy Axe',
    icon: '🪓',
    kind: 'melee',
    prop: 'axe',
    unlockLevel: 6,
    price: 1400,
    damage: 31,
    speed: 0.72,
    range: 2.4,
    arc: 1.2,
    knockback: 9.5,
    stamina: 15,
    style: 'chop',
    sound: 'heavy',
    blade: 1.0,
    trail: '#ffd6a0',
    desc: 'Slow, brutal swings that knock foes flat and smash through guards.',
  },
  rapier: {
    id: 'rapier',
    name: 'Rapier',
    icon: '🤺',
    kind: 'melee',
    prop: 'rapier',
    unlockLevel: 10,
    price: 2600,
    damage: 12,
    speed: 1.5,
    range: 2.95,
    arc: 0.55,
    knockback: 3,
    stamina: 7,
    style: 'thrust',
    sound: 'light',
    blade: 1.3,
    trail: '#f4f8ff',
    desc: 'A duellist’s needle: lightning thrusts, long reach and frequent critical hits.',
  },
  anchor: {
    id: 'anchor',
    name: 'Ship’s Anchor',
    icon: '⚓',
    kind: 'melee',
    prop: 'anchor',
    unlockLevel: 20,
    price: 7500,
    damage: 44,
    speed: 0.58,
    range: 2.8,
    arc: 1.4,
    knockback: 14,
    stamina: 19,
    style: 'chop',
    sound: 'heavy',
    blade: 1.15,
    trail: '#c9d6e6',
    desc: 'Who needs a sword? Enormous sweeping hits that send pirates flying.',
  },
  pistol: {
    id: 'pistol',
    name: 'Flintlock Pistol',
    icon: '🔫',
    kind: 'ranged',
    prop: 'pistol',
    unlockLevel: 1,
    price: 250,
    damage: 34,
    speed: 1,
    range: 28,
    arc: 0,
    knockback: 6,
    stamina: 0,
    style: 'slash',
    sound: 'light',
    blade: 0,
    trail: '#ffffff',
    mag: 1,
    reload: 1.7,
    cooldown: 0.4,
    desc: 'One big shot, then a slow reload. Make it count.',
  },
  blunderbuss: {
    id: 'blunderbuss',
    name: 'Blunderbuss',
    icon: '💥',
    kind: 'ranged',
    prop: 'blunderbuss',
    unlockLevel: 12,
    price: 3800,
    damage: 10,
    speed: 1,
    range: 13,
    arc: 0,
    knockback: 9,
    stamina: 0,
    style: 'slash',
    sound: 'heavy',
    blade: 0,
    trail: '#ffffff',
    mag: 1,
    reload: 2.2,
    cooldown: 0.5,
    pellets: 6,
    spread: 0.16,
    desc: 'A flared barrel full of scrap. Devastating up close.',
  },
  revolver: {
    id: 'revolver',
    name: 'Six-Shot Revolver',
    icon: '🤠',
    kind: 'ranged',
    prop: 'revolver',
    unlockLevel: 30,
    price: 16000,
    damage: 26,
    speed: 1,
    range: 32,
    arc: 0,
    knockback: 5,
    stamina: 0,
    style: 'slash',
    sound: 'light',
    blade: 0,
    trail: '#ffffff',
    mag: 6,
    reload: 2.4,
    cooldown: 0.32,
    desc: 'The modern age arrives: six shots before you reload.',
  },
};
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponBaseId[];

export interface RarityDef {
  name: string;
  color: string;
  /** damage multiplier */
  dmg: number;
  /** attack speed / reload multiplier */
  spd: number;
  /** relative loot weight */
  weight: number;
  /** chance of rolling a special effect */
  effect: number;
  /** upgrade price multiplier */
  cost: number;
  prefix: string;
}

export const RARITIES: Record<Rarity, RarityDef> = {
  common: { name: 'Common', color: '#d6d6d6', dmg: 1, spd: 1, weight: 58, effect: 0, cost: 1, prefix: 'Rusty' },
  uncommon: { name: 'Uncommon', color: '#5ee06a', dmg: 1.12, spd: 1.03, weight: 27, effect: 0, cost: 1.4, prefix: 'Fine' },
  rare: { name: 'Rare', color: '#3fb7ff', dmg: 1.26, spd: 1.06, weight: 11, effect: 0.45, cost: 2, prefix: 'Masterwork' },
  epic: { name: 'Epic', color: '#c46bff', dmg: 1.42, spd: 1.09, weight: 3.4, effect: 1, cost: 3, prefix: 'Gilded' },
  legendary: { name: 'Legendary', color: '#ffb21f', dmg: 1.62, spd: 1.12, weight: 0.6, effect: 1, cost: 4.5, prefix: '' },
};
export const RARITY_IDS = Object.keys(RARITIES) as Rarity[];

export interface EffectDef {
  name: string;
  icon: string;
  suffix: string;
  kind: 'melee' | 'ranged' | 'any';
  desc: string;
}
export const EFFECTS: Record<EffectId, EffectDef> = {
  secondWind: { name: 'Second Wind', icon: '💚', suffix: 'of Second Wind', kind: 'any', desc: 'Heals you for 7% of the damage you deal.' },
  thunder: { name: 'Thunderclap', icon: '⚡', suffix: 'of Thunder', kind: 'melee', desc: 'Combo finishers release a shockwave that hits everyone nearby.' },
  gilded: { name: 'Gilded', icon: '🪙', suffix: 'of Plenty', kind: 'any', desc: 'Defeated foes drop 50% more gold.' },
  swift: { name: 'Swift', icon: '💨', suffix: 'of the Gull', kind: 'melee', desc: '+12% attack speed and swings cost less stamina.' },
  crushing: { name: 'Crushing', icon: '🔨', suffix: 'of Ruin', kind: 'melee', desc: 'Hits stagger longer and break through guards.' },
  embers: { name: 'Embers', icon: '🔥', suffix: 'of Embers', kind: 'any', desc: 'Hits set foes alight for a few seconds.' },
  piercing: { name: 'Piercing', icon: '🎯', suffix: 'of the Hawk', kind: 'ranged', desc: 'Shots pass straight through and hit everyone in a line.' },
  quickload: { name: 'Quickload', icon: '⏩', suffix: 'of the Quickdraw', kind: 'ranged', desc: 'Reloads 40% faster.' },
};

const LEGENDARY_NAMES: Record<WeaponBaseId, string> = {
  cutlass: "Blackbeard's Grin",
  sword: "Sea Serpent's Fang",
  axe: 'The Kraken Cleaver',
  rapier: 'The Silver Whisper',
  anchor: "Davy Jones' Anchor",
  pistol: 'Old Thunderclap',
  blunderbuss: "The Parrot's Squawk",
  revolver: 'Six-Gun Sally',
};
const LEGENDARY_EFFECT: Record<WeaponBaseId, EffectId> = {
  cutlass: 'swift',
  sword: 'thunder',
  axe: 'crushing',
  rapier: 'secondWind',
  anchor: 'thunder',
  pistol: 'piercing',
  blunderbuss: 'embers',
  revolver: 'quickload',
};

/** A weapon in the captain's armoury (saved in the profile). */
export interface WeaponItem {
  uid: string;
  base: WeaponBaseId;
  rarity: Rarity;
  /** blacksmith upgrades, 0..MAX_WEAPON_LEVEL */
  level: number;
  effect?: EffectId;
}
export const MAX_WEAPON_LEVEL = 5;

let uidN = 0;
export const newUid = () => `w${Date.now().toString(36)}${(uidN++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function makeWeapon(base: WeaponBaseId, rarity: Rarity = 'common', effect?: EffectId, level = 0): WeaponItem {
  return { uid: newUid(), base, rarity, level, effect: effect ?? (rarity === 'legendary' ? LEGENDARY_EFFECT[base] : undefined) };
}

export function weaponName(w: WeaponItem) {
  const b = WEAPONS[w.base];
  if (w.rarity === 'legendary') return LEGENDARY_NAMES[w.base];
  const pre = RARITIES[w.rarity].prefix;
  const suf = w.effect ? ` ${EFFECTS[w.effect].suffix}` : '';
  return `${pre} ${b.name}${suf}`;
}

export interface WeaponStats {
  item: WeaponItem;
  base: WeaponBase;
  name: string;
  kind: 'melee' | 'ranged';
  damage: number;
  speed: number;
  range: number;
  arc: number;
  knockback: number;
  stamina: number;
  crit: number;
  mag: number;
  reload: number;
  cooldown: number;
  pellets: number;
  spread: number;
  effect?: EffectId;
  color: string;
}

/** Final numbers for a weapon (rarity, upgrades and effect applied). */
export function weaponStats(w: WeaponItem): WeaponStats {
  const b = WEAPONS[w.base];
  const r = RARITIES[w.rarity];
  const swift = w.effect === 'swift';
  return {
    item: w,
    base: b,
    name: weaponName(w),
    kind: b.kind,
    damage: b.damage * r.dmg * (1 + w.level * 0.09),
    speed: b.speed * r.spd * (swift ? 1.12 : 1),
    range: b.range,
    arc: b.arc,
    knockback: b.knockback * (w.effect === 'crushing' ? 1.3 : 1),
    stamina: b.stamina * (swift ? 0.8 : 1),
    crit: b.style === 'thrust' ? 0.2 : 0.08,
    mag: b.mag ?? 0,
    reload: (b.reload ?? 0) / r.spd * (w.effect === 'quickload' ? 0.6 : 1) * (1 - w.level * 0.04),
    cooldown: b.cooldown ?? 0,
    pellets: b.pellets ?? 1,
    spread: b.spread ?? 0,
    effect: w.effect,
    color: r.color,
  };
}

/** Rough damage-per-second figure for comparing weapons in menus. */
export function weaponDps(s: WeaponStats) {
  if (s.kind === 'ranged') return (s.damage * s.pellets * s.mag) / (s.reload + s.cooldown * s.mag);
  // a 3-hit combo takes about 1.6 s at speed 1 and deals 1 + 1 + 1.6 hits
  return (s.damage * 3.6) / (1.6 / s.speed);
}

/** Blacksmith price to raise a weapon one level: money and iron scrap. */
export function upgradePrice(w: WeaponItem) {
  if (w.level >= MAX_WEAPON_LEVEL) return null;
  const b = WEAPONS[w.base];
  const lv = w.level + 1;
  return {
    money: Math.round((b.price * 0.35 + 120) * lv * RARITIES[w.rarity].cost / 10) * 10,
    scrap: lv * 2 + (w.rarity === 'legendary' ? 3 : w.rarity === 'epic' ? 2 : 0),
  };
}

/** Roll a rarity: `luck` shifts the odds toward better weapons; `min` sets a floor. */
export function rollRarity(rng: () => number, luck = 0, min: Rarity = 'common'): Rarity {
  const minI = RARITY_IDS.indexOf(min);
  const ids = RARITY_IDS.slice(minI);
  const ws = ids.map((id, i) => RARITIES[id].weight * Math.pow(1 + luck, i));
  let x = rng() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ids.length; i++) {
    x -= ws[i];
    if (x <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}

/** A random weapon drop for the player's level. */
export function rollWeapon(rng: () => number, level: number, luck = 0, min: Rarity = 'common'): WeaponItem {
  const pool = WEAPON_IDS.filter((id) => WEAPONS[id].unlockLevel <= Math.max(1, level + 2));
  const base = pool[Math.floor(rng() * pool.length)];
  const rarity = rollRarity(rng, luck, min);
  let effect: EffectId | undefined;
  if (rarity !== 'legendary' && rng() < RARITIES[rarity].effect) {
    const kind = WEAPONS[base].kind;
    const fx = (Object.keys(EFFECTS) as EffectId[]).filter((e) => EFFECTS[e].kind === 'any' || EFFECTS[e].kind === kind);
    effect = fx[Math.floor(rng() * fx.length)];
  }
  return makeWeapon(base, rarity, effect);
}
