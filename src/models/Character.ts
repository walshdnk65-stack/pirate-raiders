import * as THREE from 'three';
import { GeoBuilder, T, roundBox, ellipsoid, cyl, beam, deform, lathe } from '../render/GeoBuilder';
import { M } from '../render/Materials';
import { clamp, lerp, rand, dampT } from '../core/math';
import { PAL } from './Props';

// ---------------------------------------------------------------------------
// Character specification
// ---------------------------------------------------------------------------

export type HatKind = 'beret' | 'bandana' | 'tricorn' | 'tophat' | 'sailor' | 'headscarf' | 'none' | 'captain' | 'hood' | 'sunhat';
export type FacialHair = 'bigBeard' | 'mustache' | 'curlyMustache' | 'stubble' | 'goatee' | 'longBeard' | 'none';
export type ShirtStyle = 'tee' | 'striped' | 'coat' | 'vest' | 'apron' | 'dress';
export type PropKind =
  | 'none'
  | 'cutlass'
  | 'mop'
  | 'spyglass'
  | 'lantern'
  | 'crate'
  | 'cane'
  | 'telescope'
  | 'rod'
  | 'hammer'
  | 'mug'
  | 'musket'
  | 'sword'
  | 'rapier'
  | 'axe'
  | 'anchor'
  | 'pistol'
  | 'blunderbuss'
  | 'revolver';

export interface CharacterSpec {
  id: string;
  skin: string;
  hair: string;
  shirt: string;
  shirt2?: string;
  shirtStyle: ShirtStyle;
  pants: string;
  boots: string;
  belt?: string;
  hat: HatKind;
  hatColor: string;
  hatTrim?: string;
  facial: FacialHair;
  eyepatch?: boolean;
  earring?: boolean;
  /** body width multiplier */
  width: number;
  /** belly bulge 0..1 */
  belly: number;
  /** overall height scale */
  height: number;
  /** head size multiplier */
  head: number;
  hairStyle?: 'none' | 'short' | 'long' | 'bun' | 'wig';
  epaulettes?: boolean;
  prop?: PropKind;
}

export const SPECS: Record<string, CharacterSpec> = {
  captain: {
    id: 'captain',
    skin: '#f2b48c',
    hair: '#6b3a1f',
    shirt: '#6db6e8',
    shirtStyle: 'tee',
    pants: '#c3a640',
    boots: '#8a4b2a',
    belt: '#7a4a28',
    hat: 'beret',
    hatColor: '#d0312d',
    facial: 'bigBeard',
    width: 1.08,
    belly: 0.15,
    height: 1,
    head: 1.05,
    hairStyle: 'short',
    prop: 'none',
  },
  pirateA: {
    id: 'pirateA',
    skin: '#e6a27a',
    hair: '#2b1d14',
    shirt: '#f4efe4',
    shirt2: '#d23b35',
    shirtStyle: 'striped',
    pants: '#3e5a8a',
    boots: '#4a2e1e',
    belt: '#3a2a1a',
    hat: 'bandana',
    hatColor: '#d23b35',
    facial: 'stubble',
    earring: true,
    width: 0.95,
    belly: 0,
    height: 1.02,
    head: 1,
    prop: 'none',
  },
  pirateB: {
    id: 'pirateB',
    skin: '#a8714f',
    hair: '#1a1410',
    shirt: '#f0d36b',
    shirtStyle: 'vest',
    shirt2: '#5a3a24',
    pants: '#6a4a8a',
    boots: '#3a241a',
    belt: '#3a2a1a',
    hat: 'bandana',
    hatColor: '#2f7dd1',
    facial: 'goatee',
    eyepatch: true,
    width: 1.15,
    belly: 0.35,
    height: 0.95,
    head: 1.02,
    prop: 'none',
  },
  pirateC: {
    id: 'pirateC',
    skin: '#f5c39d',
    hair: '#c4621f',
    shirt: '#5aa36a',
    shirtStyle: 'tee',
    pants: '#8a6a40',
    boots: '#4a2e1e',
    belt: '#3a2a1a',
    hat: 'none',
    hatColor: '#000000',
    facial: 'mustache',
    hairStyle: 'short',
    earring: true,
    width: 0.92,
    belly: 0,
    height: 1.05,
    head: 0.98,
    prop: 'none',
  },
  merchant: {
    id: 'merchant',
    skin: '#f7c8a8',
    hair: '#d9d4cc',
    shirt: '#f4efe4',
    shirt2: '#2f7a55',
    shirtStyle: 'vest',
    pants: '#3a3a48',
    boots: '#1f1f26',
    hat: 'tophat',
    hatColor: '#26262e',
    hatTrim: '#b5322e',
    facial: 'curlyMustache',
    width: 1.3,
    belly: 0.9,
    height: 0.98,
    head: 1.02,
    hairStyle: 'short',
    prop: 'none',
  },
  sailor: {
    id: 'sailor',
    skin: '#eab08b',
    hair: '#5a3a22',
    shirt: '#f4f4f0',
    shirt2: '#2a4f9a',
    shirtStyle: 'striped',
    pants: '#f0f0ea',
    boots: '#2a2a30',
    belt: '#2a4f9a',
    hat: 'sailor',
    hatColor: '#f4f4f0',
    hatTrim: '#2a4f9a',
    facial: 'none',
    width: 0.95,
    belly: 0,
    height: 1.0,
    head: 1,
    hairStyle: 'short',
    prop: 'none',
  },
  navy: {
    id: 'navy',
    skin: '#f1c0a0',
    hair: '#f4f4f4',
    shirt: '#21468f',
    shirt2: '#f4f0e4',
    shirtStyle: 'coat',
    pants: '#f4f0e4',
    boots: '#16161a',
    belt: '#f4f0e4',
    hat: 'tricorn',
    hatColor: '#1a1d2a',
    hatTrim: '#f4c24c',
    facial: 'mustache',
    width: 1.0,
    belly: 0.1,
    height: 1.08,
    head: 0.98,
    hairStyle: 'wig',
    epaulettes: true,
    prop: 'none',
  },
  navyCaptain: {
    id: 'navyCaptain',
    skin: '#f1c0a0',
    hair: '#f4f4f4',
    shirt: '#a82428',
    shirt2: '#f4f0e4',
    shirtStyle: 'coat',
    pants: '#f4f0e4',
    boots: '#16161a',
    belt: '#f4c24c',
    hat: 'tricorn',
    hatColor: '#1a1d2a',
    hatTrim: '#f4c24c',
    facial: 'curlyMustache',
    width: 1.1,
    belly: 0.3,
    height: 1.05,
    head: 1.02,
    hairStyle: 'wig',
    epaulettes: true,
    prop: 'none',
  },
  townWoman: {
    id: 'townWoman',
    skin: '#d99a74',
    hair: '#3a2416',
    shirt: '#e05a7a',
    shirt2: '#f6efe2',
    shirtStyle: 'dress',
    pants: '#e05a7a',
    boots: '#5a3a24',
    hat: 'headscarf',
    hatColor: '#f2c94c',
    facial: 'none',
    earring: true,
    width: 0.95,
    belly: 0.1,
    height: 0.97,
    head: 1,
    hairStyle: 'long',
    prop: 'none',
  },
  innkeeper: {
    id: 'innkeeper',
    skin: '#f0b892',
    hair: '#4a2a18',
    shirt: '#e9e2d0',
    shirt2: '#f6f3ec',
    shirtStyle: 'apron',
    pants: '#5a4030',
    boots: '#3a2418',
    belt: '#5a3a24',
    hat: 'none',
    hatColor: '#000',
    facial: 'curlyMustache',
    width: 1.3,
    belly: 1,
    height: 0.95,
    head: 1.05,
    hairStyle: 'none',
    prop: 'none',
  },
  oldSalt: {
    id: 'oldSalt',
    skin: '#e6b08c',
    hair: '#eeeeee',
    shirt: '#c96a32',
    shirtStyle: 'tee',
    pants: '#4a5a6a',
    boots: '#3a2418',
    belt: '#3a2a1a',
    hat: 'captain',
    hatColor: '#2a3a5a',
    hatTrim: '#f4c24c',
    facial: 'longBeard',
    width: 0.95,
    belly: 0.2,
    height: 0.9,
    head: 1.02,
    prop: 'cane',
  },
  guard: {
    id: 'guard',
    skin: '#f1c0a0',
    hair: '#5a3a22',
    shirt: '#a82428',
    shirt2: '#f4f0e4',
    shirtStyle: 'coat',
    pants: '#f4f0e4',
    boots: '#16161a',
    belt: '#16161a',
    hat: 'tricorn',
    hatColor: '#16161a',
    hatTrim: '#f4f0e4',
    facial: 'mustache',
    width: 1.02,
    belly: 0.05,
    height: 1.06,
    head: 0.98,
    hairStyle: 'short',
    prop: 'musket',
  },
  fisher: {
    id: 'fisher',
    skin: '#e8a882',
    hair: '#9a9a9a',
    shirt: '#f2c335',
    shirt2: '#d99a12',
    shirtStyle: 'coat',
    pants: '#3e5a8a',
    boots: '#2a2a30',
    hat: 'sailor',
    hatColor: '#f2c335',
    hatTrim: '#d99a12',
    facial: 'bigBeard',
    width: 1.05,
    belly: 0.3,
    height: 0.96,
    head: 1.03,
    hairStyle: 'short',
    prop: 'none',
  },
  fishwife: {
    id: 'fishwife',
    skin: '#f0b892',
    hair: '#b5651d',
    shirt: '#3a7bd5',
    shirt2: '#f6efe2',
    shirtStyle: 'dress',
    pants: '#3a7bd5',
    boots: '#4a2e1e',
    hat: 'headscarf',
    hatColor: '#f6efe2',
    facial: 'none',
    width: 1.05,
    belly: 0.3,
    height: 0.93,
    head: 1.02,
    hairStyle: 'long',
    prop: 'none',
  },
  smuggler: {
    id: 'smuggler',
    skin: '#c99573',
    hair: '#1a1410',
    shirt: '#3a3340',
    shirt2: '#5a4a3a',
    shirtStyle: 'coat',
    pants: '#2a2530',
    boots: '#1a1418',
    belt: '#5a3a24',
    hat: 'hood',
    hatColor: '#2b2633',
    facial: 'stubble',
    eyepatch: true,
    earring: true,
    width: 0.98,
    belly: 0,
    height: 1.02,
    head: 1,
    prop: 'none',
  },
  richLady: {
    id: 'richLady',
    skin: '#f7d2b8',
    hair: '#e8c27a',
    shirt: '#8e44ad',
    shirt2: '#f6e3ff',
    shirtStyle: 'dress',
    pants: '#8e44ad',
    boots: '#5a2a6a',
    hat: 'sunhat',
    hatColor: '#fbe3ff',
    hatTrim: '#e84393',
    facial: 'none',
    earring: true,
    width: 0.92,
    belly: 0,
    height: 0.98,
    head: 1,
    hairStyle: 'long',
    prop: 'none',
  },
  richMan: {
    id: 'richMan',
    skin: '#f3c6a5',
    hair: '#c9c2b5',
    shirt: '#f4c24c',
    shirt2: '#2c3e50',
    shirtStyle: 'vest',
    pants: '#2c3e50',
    boots: '#16161a',
    hat: 'tophat',
    hatColor: '#4a2a6a',
    hatTrim: '#f4c24c',
    facial: 'curlyMustache',
    width: 1.2,
    belly: 0.7,
    height: 1.0,
    head: 1.02,
    hairStyle: 'short',
    prop: 'cane',
  },
  shipwright: {
    id: 'shipwright',
    skin: '#e6a27a',
    hair: '#a0522d',
    shirt: '#e3d3b0',
    shirt2: '#8a5a33',
    shirtStyle: 'apron',
    pants: '#5a4a3a',
    boots: '#3a2418',
    belt: '#5a3a24',
    hat: 'bandana',
    hatColor: '#2e86c1',
    facial: 'bigBeard',
    width: 1.22,
    belly: 0.5,
    height: 0.98,
    head: 1.04,
    prop: 'hammer',
  },
  gunsmith: {
    id: 'gunsmith',
    skin: '#d9926a',
    hair: '#1a1a1a',
    shirt: '#c0392b',
    shirt2: '#2a2a2a',
    shirtStyle: 'vest',
    pants: '#3a3a40',
    boots: '#1a1a1a',
    belt: '#3a2a1a',
    hat: 'none',
    hatColor: '#000',
    facial: 'bigBeard',
    eyepatch: true,
    width: 1.28,
    belly: 0.35,
    height: 1.02,
    head: 1.05,
    hairStyle: 'none',
    prop: 'none',
  },
  islander: {
    id: 'islander',
    skin: '#8d5524',
    hair: '#1a1410',
    shirt: '#ff7f50',
    shirt2: '#ffd166',
    shirtStyle: 'striped',
    pants: '#f5deb3',
    boots: '#8a5a33',
    belt: '#6a3a1a',
    hat: 'none',
    hatColor: '#000',
    facial: 'none',
    earring: true,
    width: 0.98,
    belly: 0,
    height: 1.0,
    head: 1,
    hairStyle: 'short',
    prop: 'none',
  },
  islanderWoman: {
    id: 'islanderWoman',
    skin: '#a0663a',
    hair: '#2a1a10',
    shirt: '#1abc9c',
    shirt2: '#f1c40f',
    shirtStyle: 'dress',
    pants: '#1abc9c',
    boots: '#8a5a33',
    hat: 'headscarf',
    hatColor: '#ff6f91',
    facial: 'none',
    earring: true,
    width: 0.95,
    belly: 0,
    height: 0.96,
    head: 1,
    hairStyle: 'long',
    prop: 'none',
  },
  clerk: {
    id: 'clerk',
    skin: '#f2c4a2',
    hair: '#7f6a4a',
    shirt: '#ecf0f1',
    shirt2: '#34495e',
    shirtStyle: 'vest',
    pants: '#34495e',
    boots: '#1f1f26',
    hat: 'none',
    hatColor: '#000',
    facial: 'mustache',
    width: 0.95,
    belly: 0.2,
    height: 0.97,
    head: 1.02,
    hairStyle: 'short',
    prop: 'none',
  },
};

// Recruits: palette-swapped pirates (a fixed pool so their meshes can be cached)
(() => {
  const skins = ['#f2b48c', '#e6a27a', '#a8714f', '#8d5524', '#f5c39d', '#d99a74', '#c99573', '#f7c8a8'];
  const hats: HatKind[] = ['bandana', 'tricorn', 'none', 'beret', 'bandana', 'headscarf', 'tricorn', 'none'];
  const shirts: [string, string, ShirtStyle][] = [
    ['#2f7a55', '#f4efe4', 'vest'],
    ['#f4efe4', '#3f7fd0', 'striped'],
    ['#8e44ad', '#f4c24c', 'coat'],
    ['#e67e22', '#5a3a24', 'vest'],
    ['#f4efe4', '#1d1d22', 'striped'],
    ['#d35400', '#f6efe2', 'dress'],
    ['#2c3e50', '#c0392b', 'coat'],
    ['#27ae60', '#f4efe4', 'tee'],
  ];
  const facial: FacialHair[] = ['goatee', 'curlyMustache', 'none', 'bigBeard', 'stubble', 'none', 'longBeard', 'mustache'];
  const hairs = ['#2b1d14', '#c4621f', '#1a1410', '#6b3a1f', '#e8c27a', '#3a2416', '#dddddd', '#5a3a22'];
  for (let i = 0; i < 8; i++) {
    const [sh, sh2, style] = shirts[i];
    SPECS[`recruit${i}`] = {
      id: `recruit${i}`,
      skin: skins[i],
      hair: hairs[i],
      shirt: sh,
      shirt2: sh2,
      shirtStyle: style,
      pants: ['#3e5a8a', '#5a4030', '#2a2a30', '#8a6a40', '#4a5a6a', '#d35400', '#f4f0e4', '#6a4a8a'][i],
      boots: ['#4a2e1e', '#2a2a30', '#3a241a', '#5a3a24'][i % 4],
      belt: '#3a2a1a',
      hat: hats[i],
      hatColor: ['#c0392b', '#1a1d2a', '#000', '#2e86c1', '#16a085', '#f1c40f', '#5a2a1a', '#000'][i],
      hatTrim: '#f4c24c',
      facial: facial[i],
      eyepatch: i === 3 || i === 6,
      earring: i % 2 === 0,
      width: [1.0, 0.92, 1.1, 1.2, 0.95, 0.95, 1.05, 0.9][i],
      belly: [0.2, 0, 0.3, 0.5, 0, 0.1, 0.4, 0][i],
      height: [1.0, 1.04, 0.96, 0.98, 1.06, 0.95, 0.92, 1.02][i],
      head: [1.02, 0.98, 1.05, 1.0, 0.98, 1.0, 1.04, 0.97][i],
      hairStyle: style === 'dress' ? 'long' : hats[i] === 'none' ? 'short' : 'none',
      prop: 'none',
    };
  }
})();

// Land-combat foes: rough-and-ready rival pirates in a few recognisable silhouettes
(() => {
  const base = SPECS.pirateA;
  const grunts: Partial<CharacterSpec>[] = [
    { skin: '#e6a27a', hair: '#2b1d14', shirt: '#f4efe4', shirt2: '#7a2a2a', shirtStyle: 'striped', pants: '#4a3a2a', hatColor: '#7a2a2a', facial: 'stubble' },
    { skin: '#a8714f', hair: '#1a1410', shirt: '#6a4a8a', shirt2: '#3a2a1a', shirtStyle: 'vest', pants: '#2a2a30', hatColor: '#2a2a30', facial: 'goatee', eyepatch: true },
    { skin: '#f5c39d', hair: '#c4621f', shirt: '#5a6a3a', shirtStyle: 'tee', pants: '#5a4030', hat: 'none', hairStyle: 'short', facial: 'mustache' },
    { skin: '#8d5524', hair: '#1a1410', shirt: '#f4efe4', shirt2: '#2a2a30', shirtStyle: 'striped', pants: '#7a5a3a', hatColor: '#c96a32', facial: 'bigBeard' },
  ];
  grunts.forEach((g, i) => (SPECS[`foeGrunt${i}`] = { ...base, id: `foeGrunt${i}`, width: [0.98, 1.05, 0.92, 1.0][i], height: [1.0, 0.97, 1.04, 1.0][i], belly: [0.05, 0.2, 0, 0.1][i], ...g }));
  SPECS.foeBruiser = {
    ...base,
    id: 'foeBruiser',
    skin: '#d99a74',
    hair: '#3a2416',
    shirt: '#8a5a33',
    shirt2: '#3a2a1a',
    shirtStyle: 'vest',
    pants: '#3a3a48',
    boots: '#2a1a12',
    hat: 'bandana',
    hatColor: '#2a2a30',
    facial: 'bigBeard',
    eyepatch: false,
    earring: true,
    width: 1.45,
    belly: 0.75,
    height: 1.14,
    head: 1.02,
  };
  SPECS.foeGunner = {
    ...base,
    id: 'foeGunner',
    skin: '#f1c0a0',
    hair: '#5a3a22',
    shirt: '#3a5a7a',
    shirt2: '#f4efe4',
    shirtStyle: 'coat',
    pants: '#c3a640',
    boots: '#2a1a12',
    hat: 'tricorn',
    hatColor: '#2a2a30',
    hatTrim: '#c0392b',
    facial: 'curlyMustache',
    eyepatch: true,
    width: 0.95,
    belly: 0.1,
    height: 1.02,
  };
  SPECS.foeElite = {
    ...base,
    id: 'foeElite',
    skin: '#e6b08c',
    hair: '#1a1410',
    shirt: '#8e1f24',
    shirt2: '#16161a',
    shirtStyle: 'coat',
    pants: '#16161a',
    boots: '#16161a',
    belt: '#c9a227',
    hat: 'tricorn',
    hatColor: '#16161a',
    hatTrim: '#f4c24c',
    facial: 'goatee',
    eyepatch: false,
    earring: true,
    width: 1.05,
    belly: 0,
    height: 1.07,
    epaulettes: true,
  };
  SPECS.bossCinder = {
    ...base,
    id: 'bossCinder',
    skin: '#e8a882',
    hair: '#1a1410',
    shirt: '#2a2a30',
    shirt2: '#c0392b',
    shirtStyle: 'coat',
    pants: '#3a2418',
    boots: '#16161a',
    belt: '#f4c24c',
    hat: 'tricorn',
    hatColor: '#16161a',
    hatTrim: '#e8572a',
    facial: 'bigBeard',
    eyepatch: true,
    earring: true,
    width: 1.5,
    belly: 0.55,
    height: 1.32,
    head: 1.08,
    epaulettes: true,
  };
  SPECS.bossIronMeg = {
    ...base,
    id: 'bossIronMeg',
    skin: '#c99573',
    hair: '#c4621f',
    shirt: '#21468f',
    shirt2: '#f4f0e4',
    shirtStyle: 'coat',
    pants: '#f4f0e4',
    boots: '#16161a',
    belt: '#f4c24c',
    hat: 'captain',
    hatColor: '#16161a',
    hatTrim: '#f4c24c',
    facial: 'none',
    eyepatch: true,
    earring: true,
    width: 1.3,
    belly: 0.2,
    height: 1.28,
    head: 1.05,
    hairStyle: 'long',
    epaulettes: true,
  };
  // a castaway to escort, and the captain's crew when they come ashore
  SPECS.castaway = { ...SPECS.oldSalt, id: 'castaway', shirt: '#d9c79a', pants: '#8a7a5a', hat: 'sunhat', hatColor: '#e8d8a0', hatTrim: '#8a5a33', prop: 'none' };
})();


// ---------------------------------------------------------------------------
// Skeleton definition
// ---------------------------------------------------------------------------

export const BONES = [
  'root',
  'hips',
  'spine',
  'head',
  'eyes',
  'browL',
  'browR',
  'mouth',
  'armL',
  'foreL',
  'handL',
  'armR',
  'foreR',
  'handR',
  'legL',
  'shinL',
  'legR',
  'shinR',
] as const;
export type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;
const PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  hips: 'root',
  spine: 'hips',
  head: 'spine',
  eyes: 'head',
  browL: 'head',
  browR: 'head',
  mouth: 'head',
  armL: 'spine',
  foreL: 'armL',
  handL: 'foreL',
  armR: 'spine',
  foreR: 'armR',
  handR: 'foreR',
  legL: 'hips',
  shinL: 'legL',
  legR: 'hips',
  shinR: 'legR',
};

/** Bind-pose joint positions (model space, before height scale). */
function jointPositions(s: CharacterSpec): Record<BoneName, THREE.Vector3> {
  const w = s.width;
  const hy = 1.78; // head centre
  return {
    root: new THREE.Vector3(0, 0, 0),
    hips: new THREE.Vector3(0, 0.78, 0),
    spine: new THREE.Vector3(0, 0.9, 0),
    head: new THREE.Vector3(0, 1.36, 0),
    eyes: new THREE.Vector3(0, hy + 0.04, 0.36),
    browL: new THREE.Vector3(0.15, hy + 0.17, 0.39),
    browR: new THREE.Vector3(-0.15, hy + 0.17, 0.39),
    mouth: new THREE.Vector3(0, hy - 0.2, 0.42),
    armL: new THREE.Vector3(0.4 * w, 1.27, 0),
    foreL: new THREE.Vector3(0.47 * w, 1.0, 0),
    handL: new THREE.Vector3(0.5 * w, 0.76, 0.02),
    armR: new THREE.Vector3(-0.4 * w, 1.27, 0),
    foreR: new THREE.Vector3(-0.47 * w, 1.0, 0),
    handR: new THREE.Vector3(-0.5 * w, 0.76, 0.02),
    legL: new THREE.Vector3(0.17 * w, 0.74, 0),
    shinL: new THREE.Vector3(0.18 * w, 0.4, 0.01),
    legR: new THREE.Vector3(-0.17 * w, 0.74, 0),
    shinR: new THREE.Vector3(-0.18 * w, 0.4, 0.01),
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function capsuleBetween(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, seg = 8) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, true);
  const cap1 = new THREE.SphereGeometry(ra, seg, 4);
  cap1.translate(0, -len / 2, 0);
  const cap2 = new THREE.SphereGeometry(rb, seg, 4);
  cap2.translate(0, len / 2, 0);
  const parts = [g, cap1, cap2].map((x) => x.toNonIndexed());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
  return parts.map((p) => p.applyMatrix4(m));
}

const geoCache = new Map<string, THREE.BufferGeometry>();

// Characters appear in large numbers, so tessellation is kept modest.
const DETAIL = 0.6;
const sg = (n: number, min: number) => Math.max(min, Math.round(n * DETAIL));
const E = (rx: number, ry: number, rz: number, ws = 18, hs = 12) => ellipsoid(rx, ry, rz, sg(ws, 7), sg(hs, 5));
const RB = (rx: number, ry: number, rz: number, p = 3, ws = 20, hs = 14) => roundBox(rx, ry, rz, p, sg(ws, 8), sg(hs, 6));
const TOR = (r: number, t: number, rs: number, ts: number) => new THREE.TorusGeometry(r, t, Math.max(4, Math.round(rs * 0.7)), sg(ts, 8));

function buildGeometry(s: CharacterSpec): THREE.BufferGeometry {
  const gb = new GeoBuilder(true);
  const J = jointPositions(s);
  const w = s.width;
  const add = (g: THREE.BufferGeometry | THREE.BufferGeometry[], color: any, m: THREE.Matrix4 | undefined, bone: BoneName) => {
    const arr = Array.isArray(g) ? g : [g];
    for (const x of arr) gb.add(x, color, m, { bone: B[bone] });
  };
  const skin = s.skin;
  const skinDark = new THREE.Color(skin).multiplyScalar(0.86).getStyle();
  const hy = 1.78;
  const hs = s.head;

  // ---------------- HEAD ----------------
  const headM = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => {
    // scale head features around neck/head centre
    return new THREE.Matrix4().makeTranslation(0, hy, 0).multiply(new THREE.Matrix4().makeScale(hs, hs, hs)).multiply(T(x, y - hy, z, rx, ry, rz, sx, sy, sz));
  };
  // skull: chunky rounded box, wider at jaw
  const skull = deform(RB(0.4, 0.41, 0.37, 3.0, 24, 18), (v) => {
    const t = clamp((0.41 - v.y) / 0.82, 0, 1);
    v.x *= 1 + t * 0.06;
  });
  add(skull, skin, headM(0, hy, 0.02), 'head');
  // ears
  for (const sx of [-1, 1]) add(E(0.07, 0.1, 0.05, 10, 8), skinDark, headM(sx * 0.4, hy - 0.02, 0.0, 0, 0, sx * 0.2), 'head');
  // nose (big cartoon nose)
  add(E(0.085, 0.075, 0.085, 12, 10), new THREE.Color(skin).lerp(new THREE.Color('#e07a6a'), 0.25).getStyle(), headM(0, hy - 0.08, 0.425), 'head');
  // cheeks blush
  for (const sx of [-1, 1]) add(E(0.07, 0.05, 0.03, 8, 6), new THREE.Color(skin).lerp(new THREE.Color('#ff8a7a'), 0.3).getStyle(), headM(sx * 0.25, hy - 0.1, 0.33, 0, sx * 0.5, 0), 'head');

  // eyes (bone: eyes – scaled for blinks)
  for (const sx of [-1, 1]) {
    add(E(0.1, 0.115, 0.06, 14, 12), '#ffffff', headM(sx * 0.15, hy + 0.04, 0.36), 'eyes');
    add(E(0.052, 0.062, 0.03, 12, 10), '#1d1a1a', headM(sx * 0.14, hy + 0.03, 0.405), 'eyes');
    add(E(0.018, 0.02, 0.01, 6, 5), '#ffffff', headM(sx * 0.125, hy + 0.055, 0.433), 'eyes');
  }
  if (s.eyepatch) {
    add(E(0.12, 0.13, 0.05, 12, 10), '#16161a', headM(0.15, hy + 0.04, 0.39), 'head');
    add(TOR(0.405, 0.016, 4, 32), '#16161a', headM(0, hy + 0.1, 0.02, 0, Math.PI / 2, 0.35, 1, 1, 0.95), 'head');
  }
  // brows: chunky
  const browColor = s.facial === 'longBeard' ? '#e8e8e8' : s.hairStyle === 'wig' ? '#555555' : s.hair;
  add(RB(0.12, 0.042, 0.05, 2.5, 10, 8), browColor, headM(0.15, hy + 0.17, 0.4), 'browL');
  add(RB(0.12, 0.042, 0.05, 2.5, 10, 8), browColor, headM(-0.15, hy + 0.17, 0.4), 'browR');

  // mouth
  add(RB(0.095, 0.04, 0.03, 2.5, 12, 8), '#5a1f1f', headM(0, hy - 0.2, 0.42), 'mouth');
  add(RB(0.075, 0.014, 0.012, 2.5, 8, 6), '#ffffff', headM(0, hy - 0.185, 0.445), 'mouth');

  // facial hair
  const fh = s.facial === 'longBeard' ? '#ececec' : s.hair;
  switch (s.facial) {
    case 'bigBeard': {
      const beard = deform(E(0.43, 0.32, 0.3, 22, 16), (v) => {
        // fuller at the chin, pushed forward
        if (v.y < 0) v.z += -v.y * 0.25;
        v.x *= 1 - Math.max(0, -v.y) * 0.25;
      });
      add(beard, fh, headM(0, hy - 0.27, 0.13), 'head');
      // sideburns
      for (const sx of [-1, 1]) add(E(0.1, 0.18, 0.14, 10, 8), fh, headM(sx * 0.35, hy - 0.08, 0.06), 'head');
      // mustache
      for (const sx of [-1, 1]) add(E(0.12, 0.055, 0.06, 10, 8), new THREE.Color(fh).multiplyScalar(0.85).getStyle(), headM(sx * 0.085, hy - 0.15, 0.43, 0, 0, sx * 0.32), 'head');
      break;
    }
    case 'longBeard': {
      const beard = deform(E(0.36, 0.5, 0.26, 18, 16), (v) => {
        if (v.y < 0) {
          v.x *= 1 + v.y * 0.6;
          v.z += -v.y * 0.15;
        }
      });
      add(beard, fh, headM(0, hy - 0.4, 0.15), 'head');
      for (const sx of [-1, 1]) add(E(0.13, 0.05, 0.06, 10, 8), fh, headM(sx * 0.09, hy - 0.15, 0.43, 0, 0, sx * 0.4), 'head');
      break;
    }
    case 'mustache':
      for (const sx of [-1, 1]) add(E(0.11, 0.05, 0.055, 10, 8), fh, headM(sx * 0.085, hy - 0.145, 0.43, 0, 0, sx * 0.25), 'head');
      break;
    case 'curlyMustache':
      for (const sx of [-1, 1]) {
        add(E(0.11, 0.045, 0.05, 10, 8), fh, headM(sx * 0.09, hy - 0.145, 0.43, 0, 0, -sx * 0.15), 'head');
        add(TOR(0.045, 0.018, 6, 10), fh, headM(sx * 0.2, hy - 0.11, 0.4, 0, 0, 0), 'head');
      }
      break;
    case 'goatee':
      add(E(0.09, 0.11, 0.07, 10, 8), fh, headM(0, hy - 0.33, 0.33), 'head');
      for (const sx of [-1, 1]) add(E(0.09, 0.04, 0.05, 10, 8), fh, headM(sx * 0.08, hy - 0.145, 0.43, 0, 0, sx * 0.3), 'head');
      break;
    case 'stubble':
      add(
        deform(E(0.405, 0.25, 0.37, 20, 12), (v) => {
          if (v.y > 0.05) v.y = 0.05;
        }),
        new THREE.Color(skin).lerp(new THREE.Color(s.hair), 0.35).getStyle(),
        headM(0, hy - 0.22, 0.025),
        'head',
      );
      break;
  }

  // hair
  if (s.hairStyle === 'short') {
    const hair = deform(E(0.43, 0.38, 0.41, 20, 14), (v) => {
      if (v.y < -0.2) v.y = -0.2;
      if (v.z > 0.12 && v.y < 0.14) v.y = 0.14 + (v.z - 0.12) * 0.2;
    });
    add(hair, s.hair, headM(0, hy + 0.05, -0.03), 'head');
  }
  if (s.hairStyle === 'long') {
    add(E(0.42, 0.36, 0.36, 16, 12), s.hair, headM(0, hy + 0.08, -0.06), 'head');
    add(E(0.36, 0.42, 0.22, 14, 10), s.hair, headM(0, hy - 0.25, -0.2), 'head');
  }
  if (s.hairStyle === 'wig') {
    for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) add(TOR(0.08, 0.04, 6, 10), s.hair, headM(sx * 0.4, hy - 0.05 - i * 0.12, -0.05, 0, Math.PI / 2, 0), 'head');
    add(E(0.38, 0.3, 0.32, 14, 10), s.hair, headM(0, hy + 0.1, -0.08), 'head');
    add(E(0.09, 0.14, 0.08, 8, 6), s.hair, headM(0, hy - 0.3, -0.32), 'head');
  }
  if (s.earring) add(TOR(0.04, 0.012, 6, 12), PAL.gold, headM(0.42, hy - 0.12, 0.02, 0, Math.PI / 2, 0), 'head');

  // hats
  switch (s.hat) {
    case 'beret': {
      const beret = deform(E(0.48, 0.17, 0.46, 24, 12), (v) => {
        if (v.y < 0) v.y *= 0.4;
      });
      add(beret, s.hatColor, headM(0.05, hy + 0.36, -0.03, 0.05, 0, -0.17), 'head');
      add(TOR(0.37, 0.055, 8, 28), new THREE.Color(s.hatColor).multiplyScalar(0.72).getStyle(), headM(0.02, hy + 0.3, -0.01, Math.PI / 2, 0, -0.1), 'head');
      add(cyl(0.025, 0.04, 0.08, 6), new THREE.Color(s.hatColor).multiplyScalar(0.7).getStyle(), headM(0.03, hy + 0.48, -0.03, 0, 0, -0.17), 'head');
      break;
    }
    case 'bandana': {
      const cap = deform(E(0.43, 0.3, 0.4, 20, 12), (v) => {
        if (v.y < -0.02) v.y = -0.02;
      });
      add(cap, (c: THREE.Vector3) => (Math.floor((c.x + c.z) * 9 + 20) % 3 === 0 ? '#ffffff' : s.hatColor), headM(0, hy + 0.15, -0.0), 'head');
      add(E(0.08, 0.07, 0.07, 8, 6), s.hatColor, headM(0.12, hy + 0.12, -0.38), 'head');
      add(E(0.05, 0.16, 0.03, 8, 6), s.hatColor, headM(0.18, hy - 0.02, -0.4, 0.3, 0, 0.4), 'head');
      add(E(0.05, 0.14, 0.03, 8, 6), s.hatColor, headM(0.06, hy - 0.02, -0.41, 0.3, 0, -0.3), 'head');
      break;
    }
    case 'tricorn': {
      const brim = new THREE.CylinderGeometry(0.62, 0.62, 0.06, 3, 1);
      const bent = deform(brim, (v) => {
        const r = Math.hypot(v.x, v.z);
        v.y += Math.pow(r / 0.62, 2) * 0.16;
      }, false);
      add(bent, s.hatColor, headM(0, hy + 0.32, -0.02, 0, Math.PI / 6 + Math.PI, 0), 'head');
      add(cyl(0.6, 0.62, 0.05, 3), s.hatTrim ?? PAL.gold, headM(0, hy + 0.43, -0.02, 0, Math.PI / 6 + Math.PI, 0, 1.0, 1, 1.0), 'head');
      add(E(0.34, 0.22, 0.34, 14, 10), s.hatColor, headM(0, hy + 0.42, -0.02), 'head');
      add(new THREE.SphereGeometry(0.06, 8, 6), PAL.gold, headM(0.0, hy + 0.48, 0.4), 'head');
      break;
    }
    case 'tophat':
      add(cyl(0.5, 0.5, 0.05, 20), s.hatColor, headM(0, hy + 0.33, -0.02), 'head');
      add(cyl(0.3, 0.32, 0.6, 18), s.hatColor, headM(0, hy + 0.64, -0.02), 'head');
      add(cyl(0.325, 0.325, 0.1, 18), s.hatTrim ?? '#aa3333', headM(0, hy + 0.42, -0.02), 'head');
      break;
    case 'sailor':
      add(cyl(0.38, 0.36, 0.22, 18), s.hatColor, headM(0, hy + 0.36, -0.02), 'head');
      add(cyl(0.42, 0.42, 0.06, 18), s.hatTrim ?? '#2a4f9a', headM(0, hy + 0.27, -0.02), 'head');
      add(E(0.39, 0.08, 0.38, 16, 6), s.hatColor, headM(0, hy + 0.48, -0.02), 'head');
      break;
    case 'captain':
      add(cyl(0.4, 0.38, 0.25, 18), s.hatColor, headM(0, hy + 0.38, -0.02), 'head');
      add(E(0.42, 0.1, 0.42, 16, 6), s.hatColor, headM(0, hy + 0.52, -0.02), 'head');
      add(E(0.32, 0.04, 0.2, 12, 6), '#16161a', headM(0, hy + 0.27, 0.3, 0.25, 0, 0), 'head');
      add(cyl(0.405, 0.405, 0.06, 18), s.hatTrim ?? PAL.gold, headM(0, hy + 0.3, -0.02), 'head');
      break;
    case 'headscarf': {
      const cap = deform(E(0.44, 0.32, 0.41, 20, 12), (v) => {
        if (v.y < -0.05) v.y = -0.05;
      });
      add(cap, (c: THREE.Vector3) => (Math.hypot(c.x * 6 % 1, c.z * 6 % 1) < 0.25 ? '#ffffff' : s.hatColor), headM(0, hy + 0.14, -0.02), 'head');
      add(E(0.12, 0.1, 0.08, 8, 6), s.hatColor, headM(0, hy + 0.36, 0.0), 'head');
      break;
    }
    case 'hood': {
      const hood = deform(E(0.5, 0.5, 0.47, 22, 16), (v) => {
        // open at the front so the face peeks out
        if (v.z > 0.12) v.z = 0.12 + (v.z - 0.12) * 0.3;
        if (v.y < -0.3) v.y = -0.3;
      });
      add(hood, s.hatColor, headM(0, hy + 0.06, -0.08), 'head');
      add(TOR(0.36, 0.06, 6, 24), new THREE.Color(s.hatColor).multiplyScalar(0.75).getStyle(), headM(0, hy + 0.02, 0.06, 0, 0, 0, 1, 1.15, 1), 'head');
      add(E(0.52, 0.2, 0.44, 16, 8), s.hatColor, T(0, 1.42, -0.02), 'spine');
      break;
    }
    case 'sunhat':
      add(cyl(0.78, 0.8, 0.04, 26), s.hatColor, headM(0, hy + 0.3, -0.02, 0.08, 0, 0), 'head');
      add(E(0.36, 0.24, 0.36, 16, 10), s.hatColor, headM(0, hy + 0.4, -0.03), 'head');
      add(TOR(0.35, 0.05, 6, 24), s.hatTrim ?? '#e84393', headM(0, hy + 0.36, -0.03, Math.PI / 2, 0, 0), 'head');
      add(E(0.1, 0.08, 0.06, 8, 6), s.hatTrim ?? '#e84393', headM(0.3, hy + 0.4, 0.12), 'head');
      break;
  }

  // ---------------- TORSO ----------------
  const tw = 0.4 * w;
  const torso = deform(RB(tw, 0.3, 0.29 + s.belly * 0.04, 2.6, 22, 16), (v) => {
    const t = (v.y + 0.3) / 0.6; // 0 bottom .. 1 top
    v.x *= 0.92 + t * 0.16; // broad shoulders
    if (v.z > 0) v.z *= 1 + s.belly * 0.45 * Math.sin(Math.PI * clamp(1 - t * 1.1, 0, 1));
  });
  const shirtColor = (c: THREE.Vector3) => {
    if (s.shirtStyle === 'striped') return Math.floor((c.y + 1) * 10) % 2 ? s.shirt : s.shirt2!;
    if (s.shirtStyle === 'vest' && c.z > 0.05 && Math.abs(c.x) < 0.13 * w) return s.shirt;
    if (s.shirtStyle === 'vest') return s.shirt2!;
    if (s.shirtStyle === 'apron' && c.z > 0.05 && c.y < 0.2) return s.shirt2!;
    if (s.shirtStyle === 'coat' && c.z > 0.1 && Math.abs(c.x) < 0.09 * w) return s.shirt2!;
    return s.shirt;
  };
  add(torso, shirtColor, T(0, 1.1, 0), 'spine');
  // collar / neckline
  if (s.shirtStyle === 'tee' || s.shirtStyle === 'striped') {
    add(TOR(0.15, 0.04, 6, 16), s.shirtStyle === 'striped' ? s.shirt2! : new THREE.Color(s.shirt).multiplyScalar(0.8).getStyle(), T(0, 1.39, 0.02, Math.PI / 2, 0, 0), 'spine');
    add(E(0.13, 0.05, 0.1), skin, T(0, 1.38, 0.03), 'spine');
  }
  if (s.shirtStyle === 'vest' || s.shirtStyle === 'coat') {
    // buttons
    for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.03, 6, 4), PAL.gold, T(0.11 * (s.shirtStyle === 'coat' ? 1 : 0.5), 1.25 - i * 0.12, 0.3 + s.belly * 0.08), 'spine');
  }
  if (s.shirtStyle === 'coat') {
    // lapels + coat tails (on hips so they move with the legs region)
    for (const sx of [-1, 1]) add(RB(0.07, 0.2, 0.03, 3), s.shirt2!, T(sx * 0.14, 1.2, 0.29, 0, 0, sx * 0.15), 'spine');
    const tails = deform(cyl(0.36 * w, 0.42 * w, 0.42, 16, true), (v) => {
      if (v.z > 0.05) v.z = 0.05 + (v.z - 0.05) * 0.15;
    }, false);
    add(tails, s.shirt, T(0, 0.62, -0.02), 'hips');
    // cravat
    add(E(0.08, 0.1, 0.06), '#ffffff', T(0, 1.32, 0.28), 'spine');
  }
  if (s.shirtStyle === 'apron') add(RB(0.3, 0.32, 0.03, 4), s.shirt2!, T(0, 0.85, 0.33 + s.belly * 0.12), 'hips');
  if (s.epaulettes)
    for (const sx of [-1, 1]) {
      add(E(0.13, 0.04, 0.11), PAL.gold, T(sx * 0.37 * w, 1.37, 0), 'spine');
      for (let i = 0; i < 4; i++) add(cyl(0.012, 0.012, 0.08, 4), PAL.gold, T(sx * (0.3 + i * 0.045) * w, 1.31, 0.08), 'spine');
    }

  // belt
  if (s.belt && s.shirtStyle !== 'dress') {
    add(cyl(0.38 * w, 0.38 * w, 0.1, 22), s.belt, T(0, 0.84, 0, 0, 0, 0, 1, 1, 0.78 + s.belly * 0.1), 'hips');
    add(RB(0.09, 0.07, 0.03, 4), '#c9c9cf', T(0, 0.84, 0.31 + s.belly * 0.04), 'hips');
    add(RB(0.05, 0.035, 0.035, 4), new THREE.Color(s.belt).multiplyScalar(0.8).getStyle(), T(0, 0.84, 0.32 + s.belly * 0.04), 'hips');
  }

  // ---------------- LEGS ----------------
  if (s.shirtStyle === 'dress') {
    // lathe profile bottom -> top so normals face outwards
    add(lathe([[0, 0.18], [0.56 * w, 0.18], [0.5 * w, 0.35], [0.38 * w, 0.75], [0.3 * w, 0.95]], 18), (c: THREE.Vector3) => (c.y < 0.3 ? s.shirt2! : s.pants), T(0, 0, 0), 'hips');
  } else {
    add(E(0.34 * w, 0.17, 0.25 + s.belly * 0.05), s.pants, T(0, 0.74, 0), 'hips');
  }
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const leg = (side === 'L' ? 'legL' : 'legR') as BoneName;
    const shin = (side === 'L' ? 'shinL' : 'shinR') as BoneName;
    const hip = J[leg];
    const knee = J[shin];
    if (s.shirtStyle !== 'dress') {
      add(capsuleBetween(hip, knee, 0.155, 0.135, 8), s.pants, undefined, leg);
      add(capsuleBetween(knee, new THREE.Vector3(knee.x, 0.24, 0.0), 0.13, 0.145, 8), s.pants, undefined, shin);
    } else {
      add(capsuleBetween(new THREE.Vector3(knee.x, 0.35, 0), new THREE.Vector3(knee.x, 0.24, 0.0), 0.08, 0.08, 8), skin, undefined, shin);
    }
    // boot
    add(RB(0.135, 0.12, 0.2, 3, 14, 10), s.boots, T(knee.x * 1.02, 0.12, 0.05), shin);
    add(RB(0.14, 0.03, 0.21, 4, 12, 6), new THREE.Color(s.boots).multiplyScalar(0.6).getStyle(), T(knee.x * 1.02, 0.025, 0.05), shin);
    if (s.shirtStyle !== 'dress') add(cyl(0.155, 0.15, 0.08, 14), new THREE.Color(s.boots).multiplyScalar(0.8).getStyle(), T(knee.x, 0.25, 0), shin);
  }

  // ---------------- ARMS ----------------
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const arm = (side === 'L' ? 'armL' : 'armR') as BoneName;
    const fore = (side === 'L' ? 'foreL' : 'foreR') as BoneName;
    const hand = (side === 'L' ? 'handL' : 'handR') as BoneName;
    const sh = J[arm];
    const el = J[fore];
    const wr = J[hand];
    const longSleeve = s.shirtStyle === 'coat' || s.shirtStyle === 'dress';
    const sleeveColor = s.shirtStyle === 'striped' ? s.shirt2! : s.shirtStyle === 'vest' ? s.shirt : s.shirt;
    // shoulder / short sleeve
    add(E(0.16, 0.16, 0.16, 12, 10), sleeveColor, T(sh.x, sh.y - 0.02, sh.z), arm);
    add(capsuleBetween(sh, el, 0.105, 0.095, 7), longSleeve ? s.shirt : skin, undefined, arm);
    if (!longSleeve) add(cyl(0.15, 0.13, 0.14, 12), sleeveColor, T(sh.x * 1.02, sh.y - 0.1, sh.z, 0, 0, sx * 0.25), arm);
    add(capsuleBetween(el, wr, 0.095, 0.105, 7), longSleeve ? s.shirt : skin, undefined, fore);
    if (longSleeve) add(cyl(0.125, 0.12, 0.08, 12), s.shirt2 ?? '#ffffff', T(wr.x, wr.y + 0.06, wr.z), fore);
    // mitten hand + thumb
    add(RB(0.1, 0.125, 0.105, 2.4, 12, 10), skin, T(wr.x, wr.y - 0.1, wr.z + 0.01), hand);
    add(E(0.045, 0.07, 0.045, 8, 6), skin, T(wr.x - sx * 0.07, wr.y - 0.07, wr.z + 0.07, 0.3, 0, sx * 0.5), hand);
  }

  const geo = gb.build();
  // apply overall height scale
  geo.scale(s.height, s.height, s.height);
  return geo;
}

/** Hand props are shared between everyone holding the same thing (built once). */
const propCache = new Map<PropKind, THREE.BufferGeometry | null>();
export function propGeometry(kind: PropKind) {
  if (propCache.has(kind)) return propCache.get(kind)!;
  const g = buildPropGeometry(kind);
  propCache.set(kind, g);
  return g;
}

function buildPropGeometry(kind: PropKind) {
  const gb = new GeoBuilder();
  switch (kind) {
    case 'cutlass': {
      // cartoon cutlass (blade points along -Y of the hand)
      const blade = new THREE.Shape();
      blade.moveTo(-0.04, 0);
      blade.lineTo(0.05, 0);
      blade.quadraticCurveTo(0.12, -0.5, 0.02, -0.95);
      blade.lineTo(-0.04, -0.85);
      blade.quadraticCurveTo(0.03, -0.45, -0.04, 0);
      const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.02, bevelEnabled: false });
      bg.translate(0, 0, -0.01);
      // blade continues past the little finger, like every other weapon (along -Y)
      gb.add(bg, '#dfe6ee', T(0, -0.12, 0));
      gb.add(roundBox(0.16, 0.025, 0.06, 3), PAL.gold, T(0, -0.1, 0));
      gb.add(cyl(0.03, 0.03, 0.18, 6), '#5a3a20', T(0, 0.0, 0));
      break;
    }
    case 'mop':
      gb.add(cyl(0.025, 0.025, 1.4, 6), PAL.woodLight, T(0, -0.2, 0));
      gb.add(cyl(0.12, 0.08, 0.25, 8), '#e8e0c8', T(0, -0.95, 0));
      break;
    case 'spyglass':
    case 'telescope':
      gb.add(cyl(0.035, 0.05, 0.5, 8), PAL.brass, T(0, 0, 0.2, Math.PI / 2, 0, 0));
      gb.add(cyl(0.05, 0.05, 0.25, 8), '#5a3a20', T(0, 0, -0.05, Math.PI / 2, 0, 0));
      break;
    case 'lantern':
      gb.add(cyl(0.1, 0.12, 0.25, 6), '#ffd27a', T(0, -0.2, 0));
      gb.add(cyl(0.12, 0.12, 0.05, 6), PAL.ironDark, T(0, -0.05, 0));
      break;
    case 'crate':
      gb.add(new THREE.BoxGeometry(0.6, 0.5, 0.5), PAL.woodLight, T(0.25, -0.05, 0.25));
      break;
    case 'cane':
      gb.add(cyl(0.025, 0.025, 1.0, 6), PAL.woodDark, T(0, -0.55, 0.05));
      gb.add(new THREE.SphereGeometry(0.05, 6, 4), PAL.gold, T(0, 0, 0.05));
      break;
    case 'rod': {
      // held forward and up while fishing; line hangs from the tip
      const dir = new THREE.Vector3(0, -0.4, 1).normalize();
      const tip = dir.clone().multiplyScalar(2.3);
      gb.add(beam(dir.clone().multiplyScalar(-0.25), tip, 0.025, 5), PAL.woodDark);
      gb.add(cyl(0.045, 0.045, 0.12, 8), '#c0392b', T(0, -0.05, 0.2, Math.PI / 2 - 0.38, 0, 0));
      gb.add(beam(tip, tip.clone().add(new THREE.Vector3(0, -0.9, 0.9)), 0.006, 3), '#f4f4f4');
      break;
    }
    case 'hammer':
      gb.add(cyl(0.03, 0.03, 0.42, 6), PAL.woodLight, T(0, -0.02, 0.18, Math.PI / 2, 0, 0));
      gb.add(roundBox(0.06, 0.06, 0.13, 4, 8, 6), PAL.iron, T(0, -0.02, 0.4, 0, Math.PI / 2, 0));
      break;
    case 'mug':
      gb.add(cyl(0.085, 0.075, 0.2, 10), '#8a5a33', T(0, -0.04, 0.08));
      gb.add(cyl(0.07, 0.07, 0.02, 10), '#fff6dc', T(0, 0.065, 0.08));
      gb.add(new THREE.TorusGeometry(0.05, 0.015, 4, 8), '#5a3820', T(-0.09, -0.04, 0.08, 0, 0, Math.PI / 2));
      break;
    case 'musket':
      gb.add(cyl(0.03, 0.03, 1.5, 6), PAL.ironDark, T(0, 0.55, 0.06));
      gb.add(roundBox(0.05, 0.3, 0.07, 3, 8, 6), '#6b3e1e', T(0, -0.2, 0.06));
      gb.add(new THREE.ConeGeometry(0.025, 0.18, 5), '#c9c9cf', T(0, 1.38, 0.06));
      break;
    // ---- land-combat weapons: blades and barrels point along -Y of the hand ----
    case 'sword':
      gb.add(roundBox(0.055, 0.52, 0.016, 3, 6, 10), '#e4ebf2', T(0, -0.66, 0));
      gb.add(new THREE.ConeGeometry(0.055, 0.16, 4), '#e4ebf2', T(0, -1.25, 0, Math.PI, Math.PI / 4, 0, 1, 1, 0.3));
      gb.add(roundBox(0.2, 0.03, 0.05, 3), PAL.brass, T(0, -0.13, 0));
      gb.add(cyl(0.032, 0.032, 0.2, 6), '#4a2e1a', T(0, 0.0, 0));
      gb.add(new THREE.SphereGeometry(0.045, 8, 6), PAL.brass, T(0, 0.11, 0));
      break;
    case 'rapier':
      gb.add(cyl(0.012, 0.018, 1.2, 5), '#eef3f8', T(0, -0.72, 0));
      gb.add(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), PAL.gold, T(0, -0.1, 0, Math.PI, 0, 0));
      gb.add(new THREE.TorusGeometry(0.08, 0.012, 4, 12), PAL.gold, T(0, -0.04, 0.05));
      gb.add(cyl(0.028, 0.028, 0.18, 6), '#2a1a12', T(0, 0.03, 0));
      gb.add(new THREE.SphereGeometry(0.04, 8, 6), PAL.gold, T(0, 0.13, 0));
      break;
    case 'axe': {
      gb.add(cyl(0.036, 0.04, 1.05, 7), '#7a4a26', T(0, -0.42, 0));
      const head = new THREE.Shape();
      head.moveTo(0, 0.14);
      head.quadraticCurveTo(0.22, 0.2, 0.34, 0.3);
      head.quadraticCurveTo(0.26, 0, 0.34, -0.3);
      head.quadraticCurveTo(0.22, -0.2, 0, -0.14);
      head.lineTo(-0.08, -0.08);
      head.lineTo(-0.08, 0.08);
      head.closePath();
      const hg = new THREE.ExtrudeGeometry(head, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
      hg.translate(0, 0, -0.025);
      gb.add(hg, '#c9d1d9', T(0, -0.86, 0, 0, Math.PI / 2, 0));
      gb.add(roundBox(0.07, 0.12, 0.07, 3), PAL.ironDark, T(0, -0.86, 0));
      break;
    }
    case 'anchor':
      gb.add(cyl(0.05, 0.05, 1.1, 8), PAL.ironDark, T(0, -0.5, 0));
      gb.add(new THREE.TorusGeometry(0.08, 0.025, 6, 12), PAL.ironDark, T(0, 0.1, 0, 0, Math.PI / 2, 0));
      gb.add(roundBox(0.32, 0.04, 0.05, 3), PAL.ironDark, T(0, -0.12, 0));
      gb.add(new THREE.TorusGeometry(0.36, 0.055, 6, 18, Math.PI), '#4a4f58', T(0, -0.72, 0, 0, Math.PI / 2, Math.PI));
      for (const sz of [-1, 1]) gb.add(new THREE.ConeGeometry(0.1, 0.2, 4), '#4a4f58', T(0, -0.74, sz * 0.36, sz * 0.6, 0, 0, 1, 1, 0.5));
      break;
    case 'pistol':
      gb.add(cyl(0.032, 0.036, 0.42, 8), '#3a3f48', T(0, -0.24, 0));
      gb.add(cyl(0.048, 0.04, 0.05, 8), PAL.brass, T(0, -0.45, 0));
      gb.add(roundBox(0.045, 0.16, 0.05, 3), '#6b3e1e', T(0, -0.1, 0.0));
      gb.add(roundBox(0.04, 0.05, 0.13, 3), '#6b3e1e', T(0, 0.0, -0.12, -0.45, 0, 0));
      gb.add(roundBox(0.02, 0.04, 0.03, 3), PAL.brass, T(0, -0.04, 0.06));
      break;
    case 'blunderbuss':
      gb.add(cyl(0.04, 0.045, 0.6, 8), PAL.brass, T(0, -0.32, 0));
      gb.add(cyl(0.11, 0.045, 0.14, 10, true), PAL.brass, T(0, -0.66, 0));
      gb.add(roundBox(0.05, 0.2, 0.06, 3), '#6b3e1e', T(0, -0.1, 0));
      gb.add(roundBox(0.045, 0.06, 0.2, 3), '#6b3e1e', T(0, 0.02, -0.16, -0.5, 0, 0));
      break;
    case 'revolver':
      gb.add(cyl(0.028, 0.03, 0.34, 8), '#2a2e36', T(0, -0.24, 0));
      gb.add(cyl(0.065, 0.065, 0.12, 8), '#4a4f58', T(0, -0.07, 0));
      gb.add(roundBox(0.04, 0.05, 0.14, 3), '#5a3a20', T(0, 0.02, -0.12, -0.4, 0, 0));
      gb.add(roundBox(0.02, 0.03, 0.03, 3), '#c9c9cf', T(0, -0.4, 0.035));
      break;
    default:
      return null;
  }
  return gb.build();
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export type AnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'steer'
  | 'attack'
  | 'board'
  | 'victory'
  | 'defeat'
  | 'celebrate'
  | 'dizzy'
  | 'wave'
  | 'carry'
  | 'sit'
  | 'panic'
  | 'load'
  | 'cheer'
  | 'point'
  | 'jump'
  | 'interact'
  | 'talk'
  | 'fish'
  | 'hammer'
  | 'sitDrink'
  | 'hips'
  | 'present'
  | 'sweep'
  | 'dance'
  // land combat (time-driven through params.k = 0..1 progress of the action)
  | 'guard'
  | 'sprint'
  | 'slash1'
  | 'slash2'
  | 'slash3'
  | 'thrust'
  | 'charge'
  | 'heavy'
  | 'block'
  | 'roll'
  | 'stagger'
  | 'knockdown'
  | 'death'
  | 'aim'
  | 'shoot'
  | 'reload'
  | 'spin'
  | 'rush'
  | 'draw';
export type OneShot = 'hit' | 'fire' | 'flinch';

/** Combat poses that keep the legs walking when the fighter moves while acting. */
const UPPER_BODY: ReadonlySet<AnimState> = new Set<AnimState>(['guard', 'slash1', 'slash2', 'thrust', 'charge', 'block', 'aim', 'shoot', 'reload', 'draw']);
export type Expression = 'neutral' | 'angry' | 'happy' | 'hurt' | 'surprised' | 'sad' | 'determined';

const NB = BONES.length;
/** Pose = per-bone euler (3) + root offset (3). */
class Pose {
  r = new Float32Array(NB * 3);
  off = new THREE.Vector3();
  clear() {
    this.r.fill(0);
    this.off.set(0, 0, 0);
  }
  set(b: BoneName, x: number, y = 0, z = 0) {
    const i = B[b] * 3;
    this.r[i] = x;
    this.r[i + 1] = y;
    this.r[i + 2] = z;
  }
  add(b: BoneName, x: number, y = 0, z = 0) {
    const i = B[b] * 3;
    this.r[i] += x;
    this.r[i + 1] += y;
    this.r[i + 2] += z;
  }
  lerpFrom(a: Pose, b: Pose, t: number) {
    for (let i = 0; i < this.r.length; i++) this.r[i] = a.r[i] + (b.r[i] - a.r[i]) * t;
    this.off.lerpVectors(a.off, b.off, t);
  }
  copy(p: Pose) {
    this.r.set(p.r);
    this.off.copy(p.off);
  }
}

interface ExprTarget {
  browRot: number;
  browY: number;
  mouthX: number;
  mouthY: number;
  eyeY: number;
}
const EXPR: Record<Expression, ExprTarget> = {
  neutral: { browRot: 0.12, browY: 0, mouthX: 1, mouthY: 1, eyeY: 1 },
  angry: { browRot: 0.42, browY: -0.035, mouthX: 1.15, mouthY: 1.1, eyeY: 0.85 },
  determined: { browRot: 0.3, browY: -0.02, mouthX: 1.05, mouthY: 0.7, eyeY: 0.9 },
  happy: { browRot: -0.15, browY: 0.03, mouthX: 1.35, mouthY: 2.3, eyeY: 0.75 },
  hurt: { browRot: -0.35, browY: 0.0, mouthX: 0.9, mouthY: 1.8, eyeY: 0.18 },
  surprised: { browRot: -0.2, browY: 0.06, mouthX: 0.7, mouthY: 2.8, eyeY: 1.2 },
  sad: { browRot: -0.4, browY: 0.01, mouthX: 0.8, mouthY: 0.7, eyeY: 0.7 },
};

export interface PoseParams {
  steer: number;
  speed: number;
  /** progress (0..1) of a timed combat action */
  k: number;
  /** 0..1: weapon drawn (right arm holds it ready while walking) */
  armed: number;
  /** the drawn weapon is a gun */
  gun: boolean;
  /** stride phase for legs that keep walking during upper-body actions */
  legPh: number;
  /** 0..1 how fast the fighter is moving during an action */
  move: number;
}

const ease = (x: number) => x * x * (3 - 2 * x);
/** 0..1 progress through [a, b] of k */
const seg = (k: number, a: number, b: number) => clamp((k - a) / (b - a), 0, 1);

function strideLegs(p: Pose, ph: number, amp: number) {
  const sn = Math.sin(ph);
  p.set('legL', -sn * amp);
  p.set('legR', sn * amp);
  p.set('shinL', Math.max(0, Math.sin(ph + 1.2)) * amp * 1.3);
  p.set('shinR', Math.max(0, Math.sin(ph + 1.2 + Math.PI)) * amp * 1.3);
  p.set('hips', 0, -sn * 0.08, 0);
}

/** Right arm holding a weapon at the ready. */
function readyArm(p: Pose, gun: boolean, t: number, w = 1) {
  const s = Math.sin(t * 2.4) * 0.04;
  const a = (b: BoneName, x: number, y = 0, z = 0) => {
    const i = B[b] * 3;
    p.r[i] += (x - p.r[i]) * w;
    p.r[i + 1] += (y - p.r[i + 1]) * w;
    p.r[i + 2] += (z - p.r[i + 2]) * w;
  };
  if (gun) {
    a('armR', -0.42 + s, 0.12, -0.12);
    a('foreR', -0.85);
    a('handR', -0.2);
  } else {
    a('armR', -0.42 + s, 0.3, -0.2);
    a('foreR', -1.15);
    a('handR', -1.05);
  }
}

function stance(p: Pose) {
  p.set('legL', -0.22, 0, 0.13);
  p.set('legR', 0.22, 0, -0.13);
  p.set('shinL', 0.32);
  p.set('shinR', 0.2);
  p.off.y = -0.05;
}

function combatPose(state: AnimState, t: number, p: Pose, params: PoseParams) {
  const k = params.k;
  const gun = params.gun;
  switch (state) {
    case 'guard': {
      stance(p);
      readyArm(p, gun, t);
      p.set('armL', -0.55, 0, 0.32);
      p.set('foreL', -1.05);
      p.set('spine', 0.1 + Math.sin(t * 2.4) * 0.02, gun ? 0.1 : -0.15, 0);
      p.set('head', -0.05, gun ? -0.1 : 0.15, 0);
      p.off.y += Math.sin(t * 2.4) * 0.012;
      break;
    }
    case 'sprint': {
      const ph = t * 13;
      const sn = Math.sin(ph);
      strideLegs(p, ph, 1.05);
      p.set('armL', sn * 1.1, 0, 0.18);
      p.set('armR', -sn * 1.1, 0, -0.18);
      p.set('foreL', -1.3);
      p.set('foreR', -1.3);
      p.set('spine', 0.38, sn * 0.14, 0);
      p.set('head', -0.25);
      p.off.y = Math.abs(Math.cos(ph)) * 0.11;
      break;
    }
    case 'slash1': {
      // forehand: cock to the right, sweep across to the left
      const w = ease(seg(k, 0, 0.34));
      const s = ease(seg(k, 0.34, 0.56));
      const r = ease(seg(k, 0.62, 1));
      let ax = lerp(-0.42, -1.35, w);
      let ay = lerp(0.3, -1.0, w);
      let fr = lerp(-1.15, -0.45, w);
      let hr = lerp(-1.05, -0.35, w);
      let sy = lerp(-0.15, -0.6, w);
      ax = lerp(ax, -1.5, s);
      ay = lerp(ay, 0.95, s);
      fr = lerp(fr, -0.15, s);
      hr = lerp(hr, -0.2, s);
      sy = lerp(sy, 0.55, s);
      p.set('armR', lerp(ax, -0.42, r), lerp(ay, 0.3, r), -0.15);
      p.set('foreR', lerp(fr, -1.15, r));
      p.set('handR', lerp(hr, -1.05, r));
      p.set('spine', 0.12, lerp(sy, -0.15, r), 0);
      p.set('armL', -0.7, -0.2, 0.45);
      p.set('foreL', -1.1);
      stance(p);
      p.set('legL', -0.22 - 0.25 * (s - r), 0, 0.13);
      p.set('shinL', 0.32 + 0.3 * (s - r));
      break;
    }
    case 'slash2': {
      // backhand: from the left shoulder, rising across to the right
      const w = ease(seg(k, 0, 0.32));
      const s = ease(seg(k, 0.32, 0.55));
      const r = ease(seg(k, 0.62, 1));
      let ax = lerp(-0.42, -1.15, w);
      let ay = lerp(0.3, 1.05, w);
      let fr = lerp(-1.15, -1.55, w);
      let hr = lerp(-1.05, -0.5, w);
      let sy = lerp(-0.15, 0.55, w);
      ax = lerp(ax, -1.85, s);
      ay = lerp(ay, -0.9, s);
      fr = lerp(fr, -0.15, s);
      hr = lerp(hr, -0.15, s);
      sy = lerp(sy, -0.55, s);
      p.set('armR', lerp(ax, -0.42, r), lerp(ay, 0.3, r), -0.15);
      p.set('foreR', lerp(fr, -1.15, r));
      p.set('handR', lerp(hr, -1.05, r));
      p.set('spine', 0.1, lerp(sy, -0.15, r), 0);
      p.set('armL', -0.6, 0.3, 0.6);
      p.set('foreL', -0.9);
      stance(p);
      p.set('legR', 0.22 + 0.2 * (s - r), 0, -0.13);
      break;
    }
    case 'slash3':
    case 'heavy': {
      // overhead finisher / charged heavy chop with a lunge
      const heavy = state === 'heavy';
      const w = heavy ? 1 : ease(seg(k, 0, 0.38));
      const s = ease(seg(k, heavy ? 0.08 : 0.38, heavy ? 0.32 : 0.56));
      const r = ease(seg(k, heavy ? 0.55 : 0.64, 1));
      const ayW = heavy ? -0.7 : 0.05;
      let ax = lerp(-0.42, -2.85, w);
      let ay = lerp(0.3, ayW, w);
      let fr = lerp(-1.15, -0.75, w);
      let hr = lerp(-1.05, -0.65, w);
      let sx = lerp(0.1, -0.2, w);
      let sy = lerp(-0.15, heavy ? -0.6 : 0, w);
      ax = lerp(ax, -0.6, s);
      ay = lerp(ay, heavy ? 0.75 : 0.15, s);
      fr = lerp(fr, -0.1, s);
      hr = lerp(hr, -0.1, s);
      sx = lerp(sx, 0.42, s);
      sy = lerp(sy, heavy ? 0.6 : 0.05, s);
      p.set('armR', lerp(ax, -0.42, r), lerp(ay, 0.3, r), -0.12);
      p.set('foreR', lerp(fr, -1.15, r));
      p.set('handR', lerp(hr, -1.05, r));
      p.set('spine', lerp(sx, 0.1, r), lerp(sy, -0.15, r), 0);
      p.set('head', lerp(-0.15 * w, 0, r), 0, 0);
      p.set('armL', lerp(-1.6 * w, -0.7, s), 0, 0.35);
      p.set('foreL', -0.9);
      const lunge = s * (1 - r);
      p.set('legL', -0.22 - 0.65 * lunge, 0, 0.13);
      p.set('shinL', 0.3 + 0.6 * lunge);
      p.set('legR', 0.22 + 0.35 * lunge, 0, -0.13);
      p.set('shinR', 0.2 + 0.15 * lunge);
      p.off.y = -0.05 - 0.13 * lunge + 0.04 * w * (1 - s);
      break;
    }
    case 'charge': {
      // winding up a heavy attack (held)
      const tr = Math.sin(t * 38) * 0.02;
      stance(p);
      p.set('armR', -2.75 + tr, -0.7, -0.12);
      p.set('foreR', -0.75);
      p.set('handR', -0.65);
      p.set('armL', -1.3, 0, 0.4);
      p.set('foreL', -0.6);
      p.set('spine', -0.15, -0.6 + tr, 0);
      p.set('shinL', 0.55);
      p.set('shinR', 0.45);
      p.off.y = -0.12;
      break;
    }
    case 'thrust': {
      const w = ease(seg(k, 0, 0.3));
      const s = ease(seg(k, 0.3, 0.48));
      const r = ease(seg(k, 0.6, 1));
      let ax = lerp(-0.42, -1.2, w);
      let ay = lerp(0.3, -0.4, w);
      let fr = lerp(-1.15, -1.9, w);
      let hr = lerp(-1.05, 1.55, w);
      let sy = lerp(-0.15, -0.45, w);
      ax = lerp(ax, -1.6, s);
      ay = lerp(ay, 0.05, s);
      fr = lerp(fr, -0.05, s);
      hr = lerp(hr, 0.05, s);
      sy = lerp(sy, 0.3, s);
      p.set('armR', lerp(ax, -0.42, r), lerp(ay, 0.3, r), -0.1);
      p.set('foreR', lerp(fr, -1.15, r));
      p.set('handR', lerp(hr, -1.05, r));
      p.set('spine', 0.15, lerp(sy, -0.15, r), 0);
      p.set('armL', 0.4 * s, 0, 0.6);
      p.set('foreL', -0.5);
      const lunge = s * (1 - r);
      stance(p);
      p.set('legL', -0.22 - 0.7 * lunge, 0, 0.13);
      p.set('shinL', 0.32 + 0.5 * lunge);
      p.set('legR', 0.22 + 0.4 * lunge, 0, -0.13);
      p.off.y = -0.05 - 0.1 * lunge;
      break;
    }
    case 'block': {
      stance(p);
      if (gun) {
        p.set('armR', -0.9, 0.5, 0);
        p.set('foreR', -1.2);
        p.set('handR', 0.3);
      } else {
        p.set('armR', -1.05, 0.62, -0.1);
        p.set('foreR', -1.0);
        p.set('handR', -0.55, 0, -1.2);
      }
      p.set('armL', -1.0, -0.35, 0.15);
      p.set('foreL', -1.65);
      p.set('spine', 0.18, 0.15, 0);
      p.set('head', 0.1, -0.1, 0);
      p.set('shinL', 0.45);
      p.set('shinR', 0.35);
      p.off.y = -0.1;
      break;
    }
    case 'roll': {
      // forward roll around the hips
      const r = ease(seg(k, 0.06, 0.82));
      const tuck = Math.sin(Math.min(1, k / 0.9) * Math.PI);
      p.set('hips', r * Math.PI * 2, 0, 0);
      p.set('spine', 0.65 * tuck);
      p.set('head', 0.55 * tuck);
      p.set('legL', -1.7 * tuck, 0, 0.1);
      p.set('legR', -1.6 * tuck, 0, -0.1);
      p.set('shinL', 2.1 * tuck);
      p.set('shinR', 2.0 * tuck);
      p.set('armL', -1.1 * tuck, 0, 0.25);
      p.set('armR', -1.1 * tuck, 0, -0.25);
      p.set('foreL', -1.7 * tuck);
      p.set('foreR', -1.7 * tuck);
      p.off.y = -0.12 * tuck + 0.2 * Math.sin(r * Math.PI);
      break;
    }
    case 'stagger': {
      const e = Math.sin(Math.min(1, k) * Math.PI);
      p.set('spine', -0.42 * e, 0, 0.12 * e);
      p.set('head', -0.35 * e, 0, 0.1 * e);
      p.set('armL', -0.9 * e, 0, 0.9 * e);
      p.set('armR', -0.9 * e, 0, -0.9 * e);
      p.set('foreL', -0.4);
      p.set('foreR', -0.4);
      p.set('legL', 0.25 * e, 0, 0.1);
      p.set('legR', -0.35 * e, 0, -0.1);
      p.set('shinR', 0.4 * e);
      p.off.y = -0.05 * e;
      break;
    }
    case 'knockdown':
    case 'death': {
      const death = state === 'death';
      const fall = death ? seg(k, 0, 0.45) : seg(k, 0, 0.3);
      const up = death ? 0 : ease(seg(k, 0.68, 1));
      // fall with a little bounce on landing
      const f = fall < 1 ? fall * fall : 1;
      const bounce = fall >= 1 ? Math.max(0, Math.sin(seg(k, death ? 0.45 : 0.3, death ? 0.6 : 0.42) * Math.PI)) * 0.06 : 0;
      const lie = f * (1 - up);
      p.set('hips', -1.5 * lie, 0, 0);
      p.set('spine', -0.15 * lie);
      p.set('head', (death ? 0.25 : 0.4) * lie, death ? 0.5 * lie : 0, 0);
      p.set('armL', -0.4 * lie, 0, 1.3 * lie);
      p.set('armR', -0.4 * lie, 0, -1.3 * lie);
      p.set('foreL', -0.3);
      p.set('foreR', -0.3);
      p.set('legL', -0.35 * lie, 0, 0.12);
      p.set('legR', 0.15 * lie, 0, -0.12);
      p.set('shinL', 0.6 * lie);
      p.off.y = -0.64 * lie + bounce;
      break;
    }
    case 'aim':
    case 'shoot': {
      const rec = state === 'shoot' ? Math.max(0, 1 - k / 0.5) * Math.min(1, k / 0.06) : 0;
      stance(p);
      p.set('armR', -1.57 - 0.55 * rec, 0.1, -0.02);
      p.set('foreR', -0.05 - 0.3 * rec);
      p.set('handR', -0.05);
      p.set('armL', 0.05, 0, 0.75);
      p.set('foreL', 0, 0, -1.65);
      p.set('spine', 0.05 - 0.1 * rec, 0.3, 0);
      p.set('head', -0.05, -0.25, 0);
      break;
    }
    case 'reload': {
      stance(p);
      const ram = Math.sin(k * Math.PI * 6) * 0.25 * Math.sin(k * Math.PI);
      p.set('armR', -0.75, 0.55, 0);
      p.set('foreR', -1.5);
      p.set('handR', 1.1);
      p.set('armL', -0.95 + ram, -0.55, 0.2);
      p.set('foreL', -1.35 - ram);
      p.set('spine', 0.18, 0.1, 0);
      p.set('head', 0.35, -0.1, 0);
      break;
    }
    case 'spin': {
      const st = Math.sin(t * 16);
      p.set('armR', -0.15, 0, -1.45);
      p.set('foreR', -0.1);
      p.set('handR', 0.1);
      p.set('armL', -0.15, 0, 1.45);
      p.set('foreL', -0.1);
      p.set('spine', 0.1, 0, 0);
      p.set('legL', -st * 0.4, 0, 0.15);
      p.set('legR', st * 0.4, 0, -0.15);
      p.off.y = Math.abs(st) * 0.06 - 0.05;
      break;
    }
    case 'rush': {
      const ph = t * 14;
      strideLegs(p, ph, 1.0);
      p.set('spine', 0.55, 0, 0);
      p.set('head', -0.4);
      p.set('armL', -0.7, 0.3, 0.2);
      p.set('foreL', -1.5);
      p.set('armR', -0.7, -0.3, -0.2);
      p.set('foreR', -1.5);
      p.off.y = Math.abs(Math.cos(ph)) * 0.1;
      break;
    }
    case 'draw': {
      // reach for the hip, then flourish up into the ready stance
      const a = ease(seg(k, 0, 0.4));
      const b = ease(seg(k, 0.4, 1));
      p.set('armR', lerp(lerp(0, 0.35, a), -0.42, b), lerp(0, 0.3, b), lerp(lerp(-0.12, 0.35, a), -0.2, b));
      p.set('foreR', lerp(lerp(-0.25, -0.9, a), -1.15, b));
      p.set('handR', lerp(0, gun ? -0.2 : -1.05, b));
      p.set('spine', 0.08, lerp(-0.3 * a, -0.15, b), 0);
      stance(p);
      break;
    }
  }
}

function poseFor(state: AnimState, t: number, p: Pose, params: PoseParams) {
  p.clear();
  const breathe = Math.sin(t * 2.2);
  // default relaxed arms
  p.set('armL', 0, 0, 0.12 + breathe * 0.015);
  p.set('armR', 0, 0, -0.12 - breathe * 0.015);
  p.set('foreL', -0.25);
  p.set('foreR', -0.25);
  p.set('spine', breathe * 0.015);
  switch (state) {
    case 'idle':
      p.set('head', Math.sin(t * 0.7) * 0.04, Math.sin(t * 0.45) * 0.18, 0);
      p.set('legL', 0, 0, 0.04);
      p.set('legR', 0, 0, -0.04);
      p.off.y = breathe * 0.01;
      break;
    case 'walk':
    case 'run':
    case 'panic': {
      const run = state !== 'walk';
      const ph = t * (run ? 11 : 7);
      const amp = run ? 0.85 : 0.55;
      const sn = Math.sin(ph);
      p.set('legL', -sn * amp);
      p.set('legR', sn * amp);
      p.set('shinL', Math.max(0, Math.sin(ph + 1.2)) * (run ? 1.2 : 0.7));
      p.set('shinR', Math.max(0, Math.sin(ph + 1.2 + Math.PI)) * (run ? 1.2 : 0.7));
      if (state === 'panic') {
        p.set('armL', -2.6 + Math.sin(ph * 1.3) * 0.4, 0, 0.5);
        p.set('armR', -2.6 - Math.sin(ph * 1.3) * 0.4, 0, -0.5);
        p.set('foreL', -0.3);
        p.set('foreR', -0.3);
      } else {
        p.set('armL', sn * amp * 0.9, 0, 0.15);
        p.set('armR', -sn * amp * 0.9, 0, -0.15);
        p.set('foreL', -0.4 - (run ? 0.7 : 0));
        p.set('foreR', -0.4 - (run ? 0.7 : 0));
      }
      p.set('spine', run ? 0.22 : 0.05, sn * 0.12, 0);
      p.set('hips', 0, -sn * 0.1, 0);
      p.off.y = Math.abs(Math.cos(ph)) * (run ? 0.09 : 0.05);
      break;
    }
    case 'steer': {
      const s = params.steer;
      const sw = Math.sin(t * 1.6) * 0.05;
      p.set('armL', -1.05 + s * 0.35 + sw, -0.15, -0.15);
      p.set('armR', -1.05 - s * 0.35 - sw, 0.15, 0.15);
      p.set('foreL', -0.65);
      p.set('foreR', -0.65);
      p.set('spine', 0.08, -s * 0.18, s * 0.06);
      p.set('head', -0.05, s * 0.35, 0);
      p.set('legL', 0, 0, 0.14);
      p.set('legR', 0, 0, -0.14);
      p.off.x = -s * 0.04;
      break;
    }
    case 'point':
      p.set('armR', -1.55, 0.1, 0);
      p.set('foreR', -0.05);
      p.set('armL', -0.3, 0, 0.5);
      p.set('foreL', -1.6);
      p.set('spine', 0.1, 0.25, 0);
      p.set('legL', -0.2, 0, 0.12);
      p.set('legR', 0.15, 0, -0.12);
      break;
    case 'attack': {
      const cyc = (t * 1.6) % 1;
      const swing = cyc < 0.55 ? cyc / 0.55 : 1 - (cyc - 0.55) / 0.45;
      const e = Math.pow(swing, 2.2);
      p.set('armR', lerp(-0.6, -2.7, 1 - e), 0.0, -0.25);
      p.set('foreR', lerp(-0.2, -0.9, 1 - e));
      p.set('armL', -0.8, 0, 0.45);
      p.set('foreL', -1.2);
      p.set('spine', 0.18 * e, lerp(0.35, -0.3, e), 0);
      p.set('legL', -0.45, 0, 0.12);
      p.set('shinL', 0.4);
      p.set('legR', 0.35, 0, -0.12);
      p.set('shinR', 0.3);
      p.off.y = -0.06;
      break;
    }
    case 'board': {
      p.set('armL', -2.7, 0, 0.35);
      p.set('armR', -2.4, 0, -0.5);
      p.set('foreL', -0.2);
      p.set('foreR', -0.4);
      p.set('legL', -1.0);
      p.set('shinL', 1.4);
      p.set('legR', -0.3);
      p.set('shinR', 1.0);
      p.set('spine', 0.25);
      break;
    }
    case 'victory': {
      const pump = Math.sin(t * 10);
      p.set('armL', -2.7 + pump * 0.2, 0, 0.35);
      p.set('armR', -2.7 - pump * 0.2, 0, -0.35);
      p.set('foreL', -0.3);
      p.set('foreR', -0.3);
      p.set('spine', -0.12);
      p.set('head', -0.25);
      p.off.y = Math.abs(Math.sin(t * 5)) * 0.25;
      p.set('legL', -Math.abs(Math.sin(t * 5)) * 0.4);
      p.set('shinL', Math.abs(Math.sin(t * 5)) * 0.8);
      p.set('legR', -Math.abs(Math.sin(t * 5)) * 0.4);
      p.set('shinR', Math.abs(Math.sin(t * 5)) * 0.8);
      break;
    }
    case 'celebrate':
    case 'cheer': {
      const k = Math.sin(t * 8);
      p.set('armR', -2.8 + k * 0.25, 0, -0.2);
      p.set('foreR', -0.5 + k * 0.3);
      p.set('armL', state === 'cheer' ? -2.6 - k * 0.25 : -0.6, 0, state === 'cheer' ? 0.3 : 0.6);
      p.set('foreL', -1.4);
      p.set('spine', -0.08, k * 0.15, 0);
      p.set('head', -0.2, k * 0.2, 0);
      p.off.y = Math.max(0, Math.sin(t * 8)) * 0.18;
      break;
    }
    case 'defeat':
      p.set('head', 0.55, 0, 0.1);
      p.set('spine', 0.4);
      p.set('armL', -0.2, 0, 0.05);
      p.set('armR', -0.2, 0, -0.05);
      p.set('foreL', -0.1);
      p.set('foreR', -0.1);
      p.set('legL', -0.25);
      p.set('shinL', 0.5);
      p.set('legR', -0.25);
      p.set('shinR', 0.5);
      p.off.y = -0.12;
      break;
    case 'dizzy':
    case 'sit': {
      p.off.y = -0.42;
      p.set('legL', -1.45, 0, 0.25);
      p.set('legR', -1.45, 0, -0.25);
      p.set('shinL', 0.25);
      p.set('shinR', 0.25);
      if (state === 'dizzy') {
        p.set('head', Math.cos(t * 4) * 0.15, 0, Math.sin(t * 4) * 0.25);
        p.set('spine', -0.15, 0, Math.sin(t * 4) * 0.1);
        p.set('armL', 0.5, 0, 0.6);
        p.set('armR', 0.5, 0, -0.6);
      } else {
        p.set('armL', -0.4, 0, 0.1);
        p.set('armR', -0.4, 0, -0.1);
        p.set('foreL', -0.8);
        p.set('foreR', -0.8);
        p.set('head', Math.sin(t * 0.6) * 0.05, Math.sin(t * 0.4) * 0.3, 0);
      }
      break;
    }
    case 'wave': {
      p.set('armR', -0.3, 0, -2.5);
      p.set('foreR', 0, 0, -0.5 + Math.sin(t * 9) * 0.5);
      p.set('head', -0.1, -0.15, 0.1);
      p.off.y = breathe * 0.01;
      break;
    }
    case 'carry': {
      const ph = t * 7;
      const sn = Math.sin(ph);
      p.set('legL', -sn * 0.45);
      p.set('legR', sn * 0.45);
      p.set('shinL', Math.max(0, Math.sin(ph + 1.2)) * 0.6);
      p.set('shinR', Math.max(0, Math.sin(ph + 1.2 + Math.PI)) * 0.6);
      p.set('armL', -1.2, 0, -0.1);
      p.set('armR', -1.2, 0, 0.1);
      p.set('foreL', -0.7);
      p.set('foreR', -0.7);
      p.set('spine', -0.05);
      p.off.y = Math.abs(Math.cos(ph)) * 0.04;
      break;
    }
    case 'jump':
      p.set('legL', -1.0);
      p.set('shinL', 1.5);
      p.set('legR', -0.35);
      p.set('shinR', 0.8);
      p.set('armL', -0.5, 0, 1.1);
      p.set('armR', -0.5, 0, -1.1);
      p.set('foreL', -0.6);
      p.set('foreR', -0.6);
      p.set('spine', 0.12);
      p.set('head', -0.12);
      break;
    case 'interact': {
      const k = Math.sin(t * 6) * 0.04;
      p.set('armR', -1.4 + k, 0.1, -0.05);
      p.set('foreR', -0.15);
      p.set('armL', -0.2, 0, 0.2);
      p.set('spine', 0.16);
      p.set('head', 0.08);
      p.set('legL', -0.15);
      p.set('legR', 0.1);
      break;
    }
    case 'talk': {
      p.set('armR', -0.55 + Math.sin(t * 3.1) * 0.35, 0, -0.3);
      p.set('foreR', -1.1 + Math.sin(t * 4.3) * 0.25);
      p.set('armL', -0.3 + Math.sin(t * 2.3 + 1) * 0.25, 0, 0.35);
      p.set('foreL', -0.9 + Math.sin(t * 3.7) * 0.2);
      p.set('head', Math.sin(t * 5) * 0.07, Math.sin(t * 1.3) * 0.15, 0);
      p.set('spine', Math.sin(t * 2) * 0.04, Math.sin(t * 1.1) * 0.06, 0);
      p.off.y = Math.abs(Math.sin(t * 3)) * 0.015;
      break;
    }
    case 'fish': {
      const tug = Math.pow(Math.max(0, Math.sin(t * 0.9)), 12);
      p.set('armR', -1.0 - tug * 0.35, 0, -0.05);
      p.set('foreR', -0.45);
      p.set('armL', -0.95 - tug * 0.3, 0, 0.45);
      p.set('foreL', -0.7);
      p.set('spine', 0.04 - tug * 0.1);
      p.set('head', Math.sin(t * 0.5) * 0.05, Math.sin(t * 0.3) * 0.1, 0);
      p.set('legL', 0, 0, 0.1);
      p.set('legR', 0, 0, -0.1);
      break;
    }
    case 'hammer': {
      const cyc = (t * 1.8) % 1;
      const up = cyc < 0.6 ? cyc / 0.6 : 1 - (cyc - 0.6) / 0.4;
      const e = up * up;
      p.set('armR', lerp(-0.7, -2.3, e), 0, -0.15);
      p.set('foreR', lerp(-0.4, -0.9, e));
      p.set('armL', -0.85, 0, 0.3);
      p.set('foreL', -0.8);
      p.set('spine', 0.32 - e * 0.08);
      p.set('head', 0.25);
      p.set('legL', -0.3, 0, 0.1);
      p.set('shinL', 0.4);
      p.set('legR', 0.1, 0, -0.1);
      p.set('shinR', 0.2);
      p.off.y = -0.06;
      break;
    }
    case 'sitDrink': {
      p.off.y = -0.42;
      p.set('legL', -1.45, 0, 0.25);
      p.set('legR', -1.45, 0, -0.25);
      p.set('shinL', 0.25);
      p.set('shinR', 0.25);
      const ph = (t % 6) / 6;
      const sip = ph > 0.55 && ph < 0.8 ? Math.sin(((ph - 0.55) / 0.25) * Math.PI) : 0;
      p.set('armR', -0.6 - sip * 1.0, 0, -0.1);
      p.set('foreR', -1.2 - sip * 0.8);
      p.set('armL', -0.5, 0, 0.1);
      p.set('foreL', -0.9);
      p.set('head', -sip * 0.35 + Math.sin(t * 0.6) * 0.04, Math.sin(t * 0.4) * 0.25, 0);
      break;
    }
    case 'hips':
      p.set('armL', 0.05, 0, 0.75);
      p.set('foreL', 0, 0, -1.65);
      p.set('armR', 0.05, 0, -0.75);
      p.set('foreR', 0, 0, 1.65);
      p.set('head', Math.sin(t * 0.7) * 0.04, Math.sin(t * 0.45) * 0.2, 0);
      p.set('spine', -0.05);
      p.set('legL', 0, 0, 0.1);
      p.set('legR', 0, 0, -0.1);
      p.off.y = breathe * 0.01;
      break;
    case 'present': {
      const k = Math.sin(t * 2.2) * 0.08;
      p.set('armL', -0.55 + k, 0, 0.55);
      p.set('foreL', -0.55);
      p.set('armR', -0.55 - k, 0, -0.55);
      p.set('foreR', -0.55);
      p.set('head', -0.08, Math.sin(t * 0.8) * 0.12, 0.08);
      p.set('spine', -0.06);
      p.off.y = breathe * 0.012;
      break;
    }
    case 'sweep': {
      const sw = Math.sin(t * 3);
      p.set('armR', -0.6 + sw * 0.35, 0, -0.25);
      p.set('foreR', -0.5);
      p.set('armL', -0.9 + sw * 0.25, 0, 0.1);
      p.set('foreL', -0.9);
      p.set('spine', 0.28, sw * 0.25, 0);
      p.set('head', 0.15, -sw * 0.15, 0);
      p.set('legL', -0.2, 0, 0.1);
      p.set('legR', 0.15, 0, -0.1);
      break;
    }
    case 'dance': {
      const b = Math.sin(t * 6.5);
      p.off.y = Math.abs(b) * 0.14;
      p.set('legL', -Math.max(0, b) * 0.9, 0, 0.12);
      p.set('shinL', Math.max(0, b) * 1.2);
      p.set('legR', -Math.max(0, -b) * 0.9, 0, -0.12);
      p.set('shinR', Math.max(0, -b) * 1.2);
      p.set('armL', -2.5 + b * 0.3, 0, 0.45);
      p.set('armR', -2.5 - b * 0.3, 0, -0.45);
      p.set('foreL', -0.4);
      p.set('foreR', -0.4);
      p.set('hips', 0, Math.sin(t * 3.25) * 0.3, 0);
      p.set('spine', 0, 0, Math.sin(t * 6.5) * 0.1);
      p.set('head', -0.15, Math.sin(t * 3.25) * 0.25, 0);
      break;
    }
    case 'load': {
      const k = (Math.sin(t * 4) + 1) / 2;
      p.set('spine', 0.4 + k * 0.2);
      p.set('armL', -1.3 - k * 0.3, 0, -0.1);
      p.set('armR', -1.3 - k * 0.3, 0, 0.1);
      p.set('foreL', -0.4);
      p.set('foreR', -0.4);
      p.set('legL', -0.5, 0, 0.1);
      p.set('shinL', 0.8);
      p.set('legR', -0.2, 0, -0.1);
      p.set('shinR', 0.5);
      p.off.y = -0.12;
      break;
    }
    default:
      combatPose(state, t, p, params);
  }
  // weapon drawn: the right arm holds it ready while walking or running
  if (params.armed > 0 && (state === 'walk' || state === 'run' || state === 'idle')) readyArm(p, params.gun, t, params.armed);
  // swing or aim on the move: keep the legs striding under the upper body
  if (params.move > 0.05 && UPPER_BODY.has(state)) {
    strideLegs(p, params.legPh, 0.75 * params.move);
    p.off.y = Math.min(p.off.y, 0) + Math.abs(Math.cos(params.legPh)) * 0.06 * params.move;
  }
}

function oneShotPose(kind: OneShot, k: number, p: Pose) {
  // k = envelope 0..1
  switch (kind) {
    case 'hit':
      p.add('spine', -0.45 * k, 0, 0.1 * k);
      p.add('head', -0.35 * k);
      p.add('armL', -0.6 * k, 0, 0.7 * k);
      p.add('armR', -0.6 * k, 0, -0.7 * k);
      p.off.z -= 0.12 * k;
      break;
    case 'flinch':
      p.add('spine', 0.25 * k);
      p.add('head', 0.2 * k);
      p.add('armL', -0.9 * k, 0, -0.3 * k);
      p.add('armR', -0.9 * k, 0, 0.3 * k);
      p.add('foreL', -1.2 * k);
      p.add('foreR', -1.2 * k);
      p.off.y -= 0.06 * k;
      break;
    case 'fire':
      p.add('armR', -1.4 * k, 0, 0.1 * k);
      p.add('foreR', 0.2 * k);
      p.add('spine', -0.1 * k, 0.2 * k, 0);
      p.add('head', -0.15 * k);
      break;
  }
}

// ---------------------------------------------------------------------------
// Character instance
// ---------------------------------------------------------------------------

let starGeo: THREE.BufferGeometry | null = null;
const starMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.2).multiplyScalar(1.6) });

export class Character {
  readonly spec: CharacterSpec;
  readonly mesh: THREE.SkinnedMesh;
  /** Top-level object to position in the world. */
  readonly root: THREE.Group;
  readonly bones: THREE.Bone[];
  state: AnimState = 'idle';
  private prevState: AnimState = 'idle';
  private blend = 1;
  private blendDur = 0.25;
  private t = Math.random() * 10;
  private prevT = 0;
  private pose = new Pose();
  private poseA = new Pose();
  private poseB = new Pose();
  private oneShots: { kind: OneShot; t: number; dur: number }[] = [];
  expression: Expression = 'neutral';
  private exprTimer = 0;
  private baseExpression: Expression = 'neutral';
  private ex: ExprTarget = { ...EXPR.neutral };
  private blinkT = rand(1, 4);
  private blinkK = 0;
  params: PoseParams = { steer: 0, speed: 0, k: 0, armed: 0, gun: false, legPh: 0, move: 0 };
  prop: THREE.Mesh | null = null;
  private stars: THREE.Group | null = null;
  private bindPos: THREE.Vector3[];
  private _e = new THREE.Euler();

  constructor(spec: CharacterSpec | string, propKind?: PropKind) {
    this.spec = typeof spec === 'string' ? SPECS[spec] : spec;
    const s = this.spec;
    let geo = geoCache.get(s.id);
    if (!geo) {
      geo = buildGeometry(s);
      geoCache.set(s.id, geo);
    }
    const J = jointPositions(s);
    this.bones = BONES.map((name) => {
      const b = new THREE.Bone();
      b.name = name;
      return b;
    });
    BONES.forEach((name, i) => {
      const parent = PARENT[name];
      const wp = J[name].clone().multiplyScalar(s.height);
      if (parent) {
        const pp = J[parent].clone().multiplyScalar(s.height);
        this.bones[i].position.copy(wp.sub(pp));
        this.bones[B[parent]].add(this.bones[i]);
      } else this.bones[i].position.copy(wp);
    });
    this.bindPos = this.bones.map((b) => b.position.clone());
    this.mesh = new THREE.SkinnedMesh(geo, M.character);
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1, 0), 2.2);
    this.root = new THREE.Group();
    this.root.add(this.mesh);
    this.setProp(propKind ?? s.prop ?? 'none');
  }

  setProp(kind: PropKind) {
    if (this.prop) {
      this.prop.removeFromParent();
      this.prop = null;
    }
    const g = propGeometry(kind);
    if (!g) return;
    this.prop = new THREE.Mesh(g, M.vc);
    this.prop.castShadow = true;
    // attach in the hand, offset to the palm
    this.prop.position.set(0, -0.12 * this.spec.height, 0.02);
    this.bones[B.handR].add(this.prop);
  }

  play(state: AnimState, force = false, blendTime = 0.25) {
    if (state === this.state && !force) return;
    this.prevState = this.state;
    this.prevT = this.t;
    this.state = state;
    this.blend = 0;
    this.blendDur = blendTime;
    this.t = 0;
    if (state === 'dizzy') this.showStars(true);
    else this.showStars(false);
  }

  trigger(kind: OneShot, dur = 0.45) {
    this.oneShots.push({ kind, t: 0, dur });
    if (kind === 'hit') this.express('hurt', 0.7);
    if (kind === 'fire') this.express('angry', 0.8);
  }

  /** Temporarily override the facial expression. */
  express(e: Expression, duration = 0) {
    if (duration > 0) {
      this.expression = e;
      this.exprTimer = duration;
    } else {
      this.baseExpression = e;
      if (this.exprTimer <= 0) this.expression = e;
    }
  }

  /** Little orbiting stars over the head (dizzy, or knocked out cold). */
  setStars(on: boolean) {
    this.showStars(on);
  }

  private showStars(on: boolean) {
    if (on && !this.stars) {
      if (!starGeo) {
        const sh = new THREE.Shape();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 0.05 : 0.12;
          const a = (i / 10) * Math.PI * 2;
          if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        starGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false });
      }
      this.stars = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(starGeo, starMat);
        const a = (i / 3) * Math.PI * 2;
        m.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
        this.stars.add(m);
      }
      this.stars.position.set(0, 0.95, 0);
      this.bones[B.head].add(this.stars);
    }
    if (this.stars) this.stars.visible = on;
  }

  update(dt: number) {
    this.t += dt;
    this.prevT += dt;
    this.blend = Math.min(1, this.blend + dt / this.blendDur);

    poseFor(this.state, this.t, this.poseB, this.params);
    if (this.blend < 1) {
      poseFor(this.prevState, this.prevT, this.poseA, this.params);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      this.pose.lerpFrom(this.poseA, this.poseB, k);
    } else this.pose.copy(this.poseB);

    for (let i = this.oneShots.length - 1; i >= 0; i--) {
      const o = this.oneShots[i];
      o.t += dt;
      const x = o.t / o.dur;
      if (x >= 1) {
        this.oneShots.splice(i, 1);
        continue;
      }
      const env = x < 0.2 ? x / 0.2 : 1 - (x - 0.2) / 0.8;
      oneShotPose(o.kind, Math.sin((env * Math.PI) / 2), this.pose);
    }

    // apply to bones
    for (let i = 0; i < NB; i++) {
      const b = this.bones[i];
      this._e.set(this.pose.r[i * 3], this.pose.r[i * 3 + 1], this.pose.r[i * 3 + 2], 'YXZ');
      b.quaternion.setFromEuler(this._e);
    }
    const h = this.spec.height;
    this.bones[0].position.copy(this.bindPos[0]).addScaledVector(this.pose.off, h);

    // expressions
    if (this.exprTimer > 0) {
      this.exprTimer -= dt;
      if (this.exprTimer <= 0) this.expression = this.baseExpression;
    }
    const tgt = EXPR[this.expression];
    const k = dampT(12, dt);
    this.ex.browRot = lerp(this.ex.browRot, tgt.browRot, k);
    this.ex.browY = lerp(this.ex.browY, tgt.browY, k);
    this.ex.mouthX = lerp(this.ex.mouthX, tgt.mouthX, k);
    this.ex.mouthY = lerp(this.ex.mouthY, tgt.mouthY, k);
    this.ex.eyeY = lerp(this.ex.eyeY, tgt.eyeY, k);

    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinkK = 0.14;
      this.blinkT = rand(1.8, 5);
    }
    this.blinkK = Math.max(0, this.blinkK - dt);
    const blink = this.blinkK > 0 ? 0.1 : 1;

    const hs = this.spec.head;
    const bl = this.bones[B.browL];
    const br = this.bones[B.browR];
    bl.rotation.set(0, 0, this.ex.browRot);
    br.rotation.set(0, 0, -this.ex.browRot);
    bl.position.y = this.bindPos[B.browL].y + this.ex.browY * h * hs;
    br.position.y = this.bindPos[B.browR].y + this.ex.browY * h * hs;
    const mouth = this.bones[B.mouth];
    mouth.scale.set(this.ex.mouthX, this.ex.mouthY, 1);
    this.bones[B.eyes].scale.set(1, this.ex.eyeY * blink, 1);

    if (this.stars) this.stars.rotation.y += dt * 4;
  }

  dispose() {
    this.root.removeFromParent();
    // the skeleton's bone texture lives on the GPU (geometry and material are shared caches)
    this.mesh.skeleton?.dispose();
  }
}

/** Pre-build the shared geometry for every spec (avoids hitches mid-game). */
export function warmCharacterCache(ids: string[] = Object.keys(SPECS)) {
  for (const k of ids) {
    if (!geoCache.has(k)) geoCache.set(k, buildGeometry(SPECS[k]));
  }
}
