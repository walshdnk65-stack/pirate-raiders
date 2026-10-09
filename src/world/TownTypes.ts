import type * as THREE from 'three';
import type { StallType } from '../game/Economy';
import type { AnimState, PropKind } from '../models/Character';
import type { PortDef } from './WorldData';

/** Oriented box collider on the ground plane (rot = yaw, half extents along local x/z). */
export interface BoxCol {
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
  /** interior walls etc. can be identified */
  tag?: string;
}
export interface CircleCol {
  x: number;
  z: number;
  r: number;
}
/** Walkable surface above the terrain (pier decks, floors, ramps: y at local -hz → y2 at +hz). */
export interface Platform {
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
  y: number;
  y2?: number;
}

export type InteractKind = 'stall' | 'shipwright' | 'gunsmith' | 'bartender' | 'board' | 'warehouse' | 'black' | 'recruit' | 'npc' | 'boat';

export interface Interactable {
  id: string;
  kind: InteractKind;
  /** where the player stands to use it */
  pos: THREE.Vector3;
  radius: number;
  label: string;
  icon: string;
  /** point the camera frames (usually the vendor's head) */
  look: THREE.Vector3;
  stall?: StallType;
  /** resident who runs it (must be present for it to be open) */
  keeper?: string;
  interior?: string;
  /** black markets: hidden from the map until found */
  secret?: boolean;
  /** only open at night */
  nightOnly?: boolean;
  recruitIdx?: number;
}

export interface Interior {
  id: string;
  kind: 'tavern' | 'warehouse' | 'gunsmith' | 'den';
  name: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
  floorY: number;
  group: THREE.Group;
  /** walls with outward normals (hidden when they block the view inside) */
  walls: { obj: THREE.Object3D; nx: number; nz: number }[];
  roof: THREE.Object3D;
  /** meshes the camera collides with from outside */
  shell: THREE.Mesh[];
  /** furniture & fittings inside: only drawn when you're near the building */
  contents: THREE.Object3D[];
  fire?: THREE.Vector3;
}

export interface Spot {
  id: string;
  pos: THREE.Vector3;
  facing: number;
  anim: AnimState;
  interior?: string;
  prop?: PropKind;
  /** spots NPCs disappear into (house doors) */
  home?: boolean;
  public?: boolean;
}

export interface ScheduleEntry {
  from: number;
  to: number;
  /** spot id, a list to pick from (first free), 'wander' or 'home' */
  spot: string | string[];
  anim?: AnimState;
  prop?: PropKind;
}

export type ResidentRole = 'vendor' | 'keeper' | 'recruit' | 'guard' | 'fisher' | 'worker' | 'walker' | 'patron' | 'musician' | 'chatter' | 'smuggler' | 'sweeper' | 'dancer';

export interface ResidentDef {
  id: string;
  spec: string;
  name: string;
  role: ResidentRole;
  schedule: ScheduleEntry[];
  lines: string[];
  prop?: PropKind;
  speed?: number;
  /** patrol route (spot ids) for guards / workers */
  route?: string[];
}

export interface AnimalDef {
  kind: 'chicken' | 'cat' | 'parrot' | 'goat' | 'crab' | 'dog';
  pos: THREE.Vector3;
  r: number;
  facing?: number;
}

export interface MapMark {
  x: number;
  z: number;
  icon: string;
  label: string;
  id?: string;
  secret?: boolean;
}

export interface TownBuild {
  port: PortDef;
  group: THREE.Group;
  camColliders: THREE.Mesh[];
  boxes: BoxCol[];
  circles: CircleCol[];
  platforms: Platform[];
  interactables: Interactable[];
  interiors: Interior[];
  spots: Map<string, Spot>;
  residents: ResidentDef[];
  animals: AnimalDef[];
  nav: { nodes: THREE.Vector3[]; edges: number[][]; spotNode: Map<string, number> };
  map: { footprints: { x: number; z: number; hx: number; hz: number; rot: number; color: string }[]; marks: MapMark[] };
  /** where the player lands on the pier when disembarking, and the plank to the ship */
  landing: THREE.Vector3;
  gangplank: THREE.Object3D;
  flags: THREE.Mesh[];
  beams: THREE.Object3D[];
  center: THREE.Vector3;
  radius: number;
  smoke: THREE.Vector3[];
  fires: THREE.Vector3[];
}
