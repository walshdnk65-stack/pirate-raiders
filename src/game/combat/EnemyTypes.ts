import type { WeaponBaseId, Rarity } from './Weapons';

/**
 * Land enemies. All balance numbers for foes live here; `tier` (1..6) scales health,
 * damage and rewards (see tierScale) so the same pirate can guard an easy beach or a fort.
 */
export type EnemyKind = 'grunt' | 'bruiser' | 'gunner' | 'elite' | 'boss';
export type EnemyId = 'grunt' | 'bruiser' | 'gunner' | 'elite' | 'cinder' | 'ironMeg';
export type BossMove = 'combo' | 'slam' | 'volley' | 'rush' | 'spin' | 'summon';

export interface EnemyType {
  id: EnemyId;
  kind: EnemyKind;
  name: string;
  /** character looks (one is picked at random) */
  specs: string[];
  hp: number;
  poise: number;
  kbResist: number;
  /** run speed (m/s); patrols walk at ~35% */
  speed: number;
  weapon: WeaponBaseId;
  gun?: WeaponBaseId;
  /** damage per melee hit / per shot */
  dmg: number;
  gunDmg?: number;
  /** seconds of wind-up before a melee strike lands (telegraph) */
  windup: number;
  /** recovery speed multiplier after a swing (higher = snappier) */
  tempo: number;
  /** most hits in one combo */
  combo: number;
  /** melee reach */
  reach: number;
  /** spotting distance */
  sight: number;
  /** chance to raise a guard against an incoming swing */
  block: number;
  /** chance to roll away from a heavy or finisher */
  dodge: number;
  /** preferred distance band for gunners [min, max] */
  keep?: [number, number];
  /** seconds spent aiming before a shot */
  aim?: number;
  /** bigger hurtbox */
  radius: number;
  xp: number;
  gold: [number, number];
  loot: { weapon: number; scrap: number; shot: number; cargo: number; rare: number; luck: number; min?: Rarity };
  /** boss only: moves per phase (phase 1 > 65% hp, phase 2 > 33%, then phase 3) and minions per phase */
  boss?: { title: string; moves: BossMove[][]; summon: EnemyId[][]; intro: string };
}

export const ENEMIES: Record<EnemyId, EnemyType> = {
  grunt: {
    id: 'grunt',
    kind: 'grunt',
    name: 'Pirate Grunt',
    specs: ['foeGrunt0', 'foeGrunt1', 'foeGrunt2', 'foeGrunt3'],
    hp: 60,
    poise: 0,
    kbResist: 0,
    speed: 4.7,
    weapon: 'cutlass',
    dmg: 7,
    windup: 0.5,
    tempo: 1.0,
    combo: 2,
    reach: 2.0,
    sight: 15,
    block: 0.08,
    dodge: 0,
    radius: 0.45,
    xp: 22,
    gold: [12, 32],
    loot: { weapon: 0.035, scrap: 0.15, shot: 0.2, cargo: 0.06, rare: 0.006, luck: 0 },
  },
  bruiser: {
    id: 'bruiser',
    kind: 'bruiser',
    name: 'Pirate Bruiser',
    specs: ['foeBruiser'],
    hp: 175,
    poise: 55,
    kbResist: 0.55,
    speed: 3.5,
    weapon: 'axe',
    dmg: 21,
    windup: 0.82,
    tempo: 0.85,
    combo: 1,
    reach: 2.6,
    sight: 13,
    block: 0,
    dodge: 0,
    radius: 0.62,
    xp: 60,
    gold: [30, 65],
    loot: { weapon: 0.08, scrap: 0.55, shot: 0.1, cargo: 0.12, rare: 0.015, luck: 0.3 },
  },
  gunner: {
    id: 'gunner',
    kind: 'gunner',
    name: 'Pirate Gunner',
    specs: ['foeGunner'],
    hp: 48,
    poise: 0,
    kbResist: 0,
    speed: 4.5,
    weapon: 'cutlass',
    gun: 'pistol',
    dmg: 7,
    gunDmg: 12,
    windup: 0.5,
    tempo: 1,
    combo: 1,
    reach: 1.9,
    sight: 20,
    block: 0,
    dodge: 0.15,
    keep: [8, 14],
    aim: 1.0,
    radius: 0.45,
    xp: 32,
    gold: [18, 40],
    loot: { weapon: 0.05, scrap: 0.1, shot: 0.65, cargo: 0.05, rare: 0.01, luck: 0.1 },
  },
  elite: {
    id: 'elite',
    kind: 'elite',
    name: 'Elite Corsair',
    specs: ['foeElite'],
    hp: 140,
    poise: 45,
    kbResist: 0.25,
    speed: 5.7,
    weapon: 'sword',
    dmg: 14,
    windup: 0.3,
    tempo: 1.2,
    combo: 3,
    reach: 2.5,
    sight: 18,
    block: 0.55,
    dodge: 0.38,
    radius: 0.47,
    xp: 95,
    gold: [55, 120],
    loot: { weapon: 0.25, scrap: 0.5, shot: 0.3, cargo: 0.15, rare: 0.05, luck: 0.8, min: 'uncommon' },
  },
  cinder: {
    id: 'cinder',
    kind: 'boss',
    name: 'Captain Cinderbeard',
    specs: ['bossCinder'],
    hp: 600,
    poise: 120,
    kbResist: 0.82,
    speed: 4.3,
    weapon: 'anchor',
    dmg: 19,
    windup: 0.62,
    tempo: 1,
    combo: 3,
    reach: 3.1,
    sight: 22,
    block: 0,
    dodge: 0,
    radius: 0.85,
    xp: 900,
    gold: [1800, 2600],
    loot: { weapon: 1, scrap: 1, shot: 1, cargo: 1, rare: 0.6, luck: 3, min: 'epic' },
    boss: {
      title: 'Terror of Ember Peak',
      intro: 'Ye dare climb MY mountain? I’ll melt ye down for cannonballs!',
      moves: [
        ['combo', 'combo', 'slam'],
        ['combo', 'slam', 'rush', 'summon'],
        ['spin', 'combo', 'slam', 'rush', 'summon'],
      ],
      summon: [[], ['grunt', 'grunt'], ['grunt', 'bruiser']],
    },
  },
  ironMeg: {
    id: 'ironMeg',
    kind: 'boss',
    name: 'Admiral Iron Meg',
    specs: ['bossIronMeg'],
    hp: 720,
    poise: 100,
    kbResist: 0.75,
    speed: 5.2,
    weapon: 'sword',
    gun: 'revolver',
    dmg: 18,
    gunDmg: 14,
    windup: 0.45,
    tempo: 1.15,
    combo: 3,
    reach: 2.9,
    sight: 24,
    block: 0.3,
    dodge: 0.25,
    aim: 0.7,
    radius: 0.78,
    xp: 1300,
    gold: [2600, 3600],
    loot: { weapon: 1, scrap: 1, shot: 1, cargo: 1, rare: 0.8, luck: 4, min: 'epic' },
    boss: {
      title: 'The Turncoat Admiral',
      intro: 'The Navy threw me out. Now I sink pirates for FUN.',
      moves: [
        ['combo', 'volley', 'combo'],
        ['combo', 'volley', 'rush', 'summon'],
        ['spin', 'volley', 'combo', 'rush', 'summon'],
      ],
      summon: [[], ['gunner', 'grunt'], ['elite']],
    },
  },
};

/** Health / damage / reward multipliers for a difficulty tier (1 = beginner beaches). */
export function tierScale(tier: number) {
  const t = Math.max(1, tier) - 1;
  return { hp: 1 + 0.42 * t, dmg: 1 + 0.27 * t, gold: 1 + 0.6 * t, xp: 1 + 0.5 * t };
}
