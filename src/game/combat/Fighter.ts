import * as THREE from 'three';
import { Character, type AnimState, type PropKind } from '../../models/Character';
import { addRim } from '../../render/Materials';
import { clamp } from '../../core/math';
import type { WeaponStats } from './Weapons';

export type Team = 'player' | 'enemy' | 'ally';
export type ActionKind = 'attack' | 'heavy' | 'charge' | 'shoot' | 'reload' | 'roll' | 'hit' | 'knockdown' | 'draw' | 'death' | 'special' | 'victory';

/** The hitbox of an attack while it is active. */
export interface Swing {
  dmg: number;
  /** reach in front of the attacker (m) */
  reach: number;
  /** half-angle of the arc (radians); >= PI hits all round */
  arc: number;
  knockback: number;
  /** seconds the victim is stunned if their poise breaks */
  stun: number;
  /** heavy blows can't be fully blocked and knock people down */
  heavy?: boolean;
  /** last hit of a combo (bigger effects) */
  finisher?: boolean;
  /** radial blast around a point in front of the attacker instead of an arc (slams) */
  aoe?: number;
  /** offset of the aoe centre in front of the attacker */
  aoeAt?: number;
  /** ignores blocking entirely */
  unblockable?: boolean;
  sound?: 'light' | 'medium' | 'heavy';
}

export interface Action {
  kind: ActionKind;
  anim: AnimState;
  t: number;
  dur: number;
  /** active window as fractions of dur */
  active?: [number, number];
  swing?: Swing;
  /** combo step (1..3) */
  combo?: number;
  hits: Set<Fighter>;
  /** forward lunge speed while winding into the strike */
  lunge?: number;
  /** can't be interrupted by ordinary hits */
  armor?: boolean;
  /** invulnerable window as fractions of dur */
  iframes?: [number, number];
  /** fraction after which another action may start */
  cancelAt?: number;
  /** the active window has begun (one-shot effects done) */
  began?: boolean;
  /** custom data for special moves */
  tag?: string;
  /** blend time into the animation */
  blend?: number;
  /** time warp: at real progress knee[0] the animation is at knee[1] (stretched wind-ups) */
  knee?: [number, number];
}

const _v = new THREE.Vector3();

/**
 * Anyone who fights on land – the captain, rival pirates, bosses and your crew. Holds health,
 * stamina and poise, runs timed actions (swings, rolls, shots, hit reactions) and drives the
 * character's combat animations. Hit resolution lives in the Combat system.
 */
export class Fighter {
  c: Character;
  pos: THREE.Vector3;
  heading = 0;
  /** knockback / roll / lunge velocity (decays) */
  push = new THREE.Vector3();
  name: string;
  radius = 0.45;
  height = 1.95;
  maxHp = 100;
  hp = 100;
  maxStamina = 100;
  stamina = 100;
  /** seconds before stamina starts refilling */
  staminaWait = 0;
  staminaRegen = 32;
  maxPoise = 0;
  poise = 0;
  /** seconds out of combat before poise refills */
  poiseDelay = 2;
  /** knockback taken is multiplied by (1 - kbResist) */
  kbResist = 0;
  /** outgoing damage multiplier */
  dmgMul = 1;
  /** incoming damage multiplier */
  defMul = 1;
  melee: WeaponStats | null = null;
  gun: WeaponStats | null = null;
  useGun = false;
  /** rounds in the gun */
  loaded = 0;
  gunCD = 0;
  action: Action | null = null;
  blocking = false;
  /** seconds the guard has been up (a fresh guard parries) */
  blockT = 0;
  /** can't raise the guard again until this runs out */
  blockCD = 0;
  aiming = false;
  drawn = false;
  dead = false;
  deadT = 0;
  burnT = 0;
  burnDps = 0;
  burnBy: Fighter | null = null;
  /** time since this fighter last hit or was hit */
  sinceCombat = 99;
  /** a heavy attack is coming: glow red */
  telegraph = 0;
  rollCD = 0;
  /** horizontal speed this frame (for animation) */
  speed = 0;
  private legPh = 0;
  private flash = 0;
  private mat: THREE.MeshStandardMaterial;
  private prop: PropKind = 'none';
  private stars = false;
  private _p = new THREE.Vector3();

  constructor(
    public team: Team,
    spec: string | Character,
    name: string,
  ) {
    this.c = typeof spec === 'string' ? new Character(spec) : spec;
    this.pos = this.c.root.position;
    this.name = name;
    // own copy of the character material so hits can flash just this fighter
    this.mat = addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }), 0.3);
    this.c.mesh.material = this.mat;
  }

  get alive() {
    return !this.dead;
  }
  get weapon(): WeaponStats | null {
    return this.useGun && this.gun ? this.gun : this.melee;
  }
  get progress() {
    return this.action ? clamp(this.action.t / this.action.dur, 0, 1) : 0;
  }
  /** invulnerable right now (mid-roll, getting up…) */
  get invulnerable() {
    const a = this.action;
    if (!a?.iframes) return false;
    const k = this.progress;
    return k >= a.iframes[0] && k <= a.iframes[1];
  }
  /** a new action may start now */
  get free() {
    if (this.dead) return false;
    const a = this.action;
    if (!a) return true;
    return a.cancelAt !== undefined && this.progress >= a.cancelAt;
  }
  /** the attack's hitbox is live */
  get swingLive() {
    const a = this.action;
    if (!a?.swing || !a.active) return false;
    const k = this.progress;
    return k >= a.active[0] && k <= a.active[1];
  }
  /** past the strike (rolling out of the recovery is allowed) */
  get inRecovery() {
    const a = this.action;
    if (!a) return true;
    if (!a.active) return a.cancelAt !== undefined && this.progress >= a.cancelAt;
    return this.progress > a.active[1];
  }

  setWeapons(melee: WeaponStats | null, gun: WeaponStats | null) {
    this.melee = melee;
    this.gun = gun;
    if (!gun) this.useGun = false;
    if (gun && this.loaded > gun.mag) this.loaded = gun.mag;
    this.refreshProp();
  }

  /** Show the active weapon in hand (or nothing when sheathed). */
  refreshProp() {
    const w = this.weapon;
    const want: PropKind = this.drawn && w ? w.base.prop : 'none';
    if (want === this.prop) return;
    this.prop = want;
    this.c.setProp(want);
  }

  setDrawn(on: boolean) {
    if (this.drawn === on) return;
    this.drawn = on;
    this.refreshProp();
  }

  /** The weapon mesh in the hand (for trails and muzzle flashes). */
  get propObj() {
    return this.c.prop;
  }

  /** Point in front of the barrel / blade tip in world space. */
  muzzle(out: THREE.Vector3) {
    const p = this.c.prop;
    if (!p) return out.copy(this.pos).setY(this.pos.y + 1.4);
    p.updateWorldMatrix(true, false);
    const len = this.useGun ? (this.gun?.base.prop === 'blunderbuss' ? 0.7 : 0.45) : (this.weapon?.base.blade ?? 0.8);
    return out.set(0, -len, 0).applyMatrix4(p.matrixWorld);
  }

  /** Start a timed action (interrupts whatever was happening). */
  start(a: Omit<Action, 't' | 'hits'> & Partial<Pick<Action, 'hits'>>) {
    const act: Action = { t: 0, hits: new Set(), ...a };
    this.action = act;
    this.blocking = false;
    this.aiming = false;
    this.c.params.k = 0;
    this.c.play(act.anim, true, act.blend ?? 0.09);
    return act;
  }

  endAction() {
    this.action = null;
  }

  useStamina(n: number, wait = 0.75) {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaWait = Math.max(this.staminaWait, wait);
  }

  /** Poise damage; returns true when the guard/poise breaks. */
  breakPoise(dmg: number) {
    if (this.maxPoise <= 0) return true;
    this.poise -= dmg;
    if (this.poise <= 0) {
      this.poise = this.maxPoise;
      return true;
    }
    return false;
  }

  hitFlash(strength = 1) {
    this.flash = Math.max(this.flash, strength);
  }

  /** Advance timers and the current action. Returns the action that just finished (if any). */
  update(dt: number): Action | null {
    this.sinceCombat += dt;
    this.rollCD = Math.max(0, this.rollCD - dt);
    this.blockCD = Math.max(0, this.blockCD - dt);
    this.gunCD = Math.max(0, this.gunCD - dt);
    this.telegraph = Math.max(0, this.telegraph - dt);
    if (this.blocking) this.blockT += dt;
    else this.blockT = 0;
    // stamina & poise
    if (this.staminaWait > 0) this.staminaWait -= dt;
    else if (!this.dead) this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * (this.blocking ? 0.35 : 1) * dt);
    if (this.maxPoise > 0 && this.sinceCombat > this.poiseDelay) this.poise = Math.min(this.maxPoise, this.poise + this.maxPoise * 0.5 * dt);
    // knockback decays
    const drag = Math.exp(-7 * dt);
    if (!this.action || this.action.kind !== 'roll') {
      this.push.x *= drag;
      this.push.z *= drag;
    }
    // material: hit flash, heavy-attack telegraph, burning
    this.flash = Math.max(0, this.flash - dt * 7);
    const e = this.mat.emissive;
    if (this.flash > 0) e.setRGB(this.flash * 0.6, this.flash * 0.55, this.flash * 0.5);
    else if (this.telegraph > 0) {
      const pulse = 0.35 + 0.35 * Math.sin(performance.now() / 45);
      e.setRGB(pulse, 0.05 * pulse, 0.02);
    } else if (this.burnT > 0) {
      const f = 0.25 + 0.15 * Math.sin(performance.now() / 60);
      e.setRGB(f, f * 0.45, 0.02);
    } else if (e.r || e.g || e.b) e.setRGB(0, 0, 0);

    let done: Action | null = null;
    const a = this.action;
    if (a) {
      a.t += dt;
      const p = clamp(a.t / a.dur, 0, 1);
      let k = p;
      if (a.knee) {
        const [r, a0] = a.knee;
        k = p <= r ? (r > 0 ? (p / r) * a0 : a0) : a0 + ((p - r) / (1 - r)) * (1 - a0);
      }
      this.c.params.k = k;
      if (a.t >= a.dur && a.kind !== 'death') {
        done = a;
        this.action = null;
      }
    }
    if (this.dead) this.deadT += dt;
    return done;
  }

  /** Pick the animation for this frame (actions already set theirs). */
  animate(dt: number, speed: number, sprinting: boolean) {
    const c = this.c;
    this.speed = speed;
    this.legPh += speed * dt * 1.55;
    c.params.legPh = this.legPh;
    c.params.move = clamp(speed / 5, 0, 1);
    c.params.armed = this.drawn ? 1 : 0;
    c.params.gun = this.useGun;
    if (this.dead) {
      if (!this.stars && this.deadT > 0.7) {
        this.stars = true;
        c.setStars(true);
      }
      return;
    }
    if (this.action) return;
    let want: AnimState;
    if (speed > 7.2 || (sprinting && speed > 4)) want = 'sprint';
    else if (speed > 3.4) want = 'run';
    else if (speed > 0.6 && !this.blocking && !this.aiming) want = 'walk';
    else if (this.blocking) want = 'block';
    else if (this.aiming) want = 'aim';
    else want = this.drawn ? 'guard' : 'idle';
    if (this.blocking && speed > 0.6) want = 'block';
    if (this.aiming && speed > 0.6) want = 'aim';
    if (c.state !== want) c.play(want, false, want === 'block' || want === 'aim' ? 0.08 : 0.16);
  }

  /** Revive (retry, or crew getting back up after a fight). */
  revive(hpK = 1) {
    this.dead = false;
    this.deadT = 0;
    this.hp = this.maxHp * hpK;
    this.stamina = this.maxStamina;
    this.poise = this.maxPoise;
    this.action = null;
    this.burnT = 0;
    this.push.set(0, 0, 0);
    this.blocking = false;
    this.aiming = false;
    this.stars = false;
    this.c.setStars(false);
    this.c.play(this.drawn ? 'guard' : 'idle', true);
  }

  /** Direction this fighter faces (unit). */
  forward(out = _v) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** Chest height point for effects. */
  chest(out = this._p) {
    return out.copy(this.pos).setY(this.pos.y + this.height * 0.62);
  }

  dispose() {
    this.c.dispose();
    this.mat.dispose();
  }
}
