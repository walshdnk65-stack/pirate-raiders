import * as THREE from 'three';
import { Character } from '../models/Character';
import { clamp, dampAngle, headingTo, lerp, rand } from '../core/math';
import { audio } from '../core/Audio';
import type { Input } from '../core/Input';
import type { LandArea } from '../world/LandArea';
import type { CircleCol } from '../world/TownTypes';
import type { Particles } from '../systems/Particles';

const WALK = 4.3;
const RUN = 7.8;
/** on-foot speeds with a weapon drawn */
const FIGHT_RUN = 5.3;
const FIGHT_SPRINT = 8.1;

/** How land combat steers the walker this frame. */
export interface WalkMods {
  /** multiplier on movement speed (0 = rooted while swinging) */
  speed: number;
  /** combat speeds (run by default, Shift sprints) */
  combat: boolean;
  /** Shift may sprint (enough stamina) */
  sprint: boolean;
  /** face this yaw instead of the move direction (lock-on, aiming, attacking) */
  face: number | null;
  /** extra velocity from rolls, lunges and knockback */
  push: THREE.Vector3;
  /** combat drives the animation */
  anim: boolean;
  /** Space is a dodge, not a jump */
  noJump: boolean;
}
const GRAVITY = 22;
const JUMP_V = 7.2;
export const WALKER_R = 0.42;

/**
 * The captain on foot: camera-relative movement, running, jumping, step-up onto decks and
 * ramps, collisions with buildings/stalls/NPCs, footstep sounds and scripted hops on and off
 * the ship.
 */
export class Walker {
  c: Character;
  pos: THREE.Vector3;
  vel = new THREE.Vector3();
  heading = 0;
  grounded = true;
  speed = 0;
  locked = false;
  private stepT = 0;
  private airT = 0;
  private interactT = 0;
  private hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number; done: () => void } | null = null;
  private extra: CircleCol[] = [];
  onWood = false;
  /** world-space direction the movement keys point (unit, or zero) */
  moveDir = new THREE.Vector3();
  sprinting = false;

  constructor(scene: THREE.Scene) {
    this.c = new Character('captain');
    this.c.play('idle');
    this.c.express('happy');
    this.pos = this.c.root.position;
    this.c.root.visible = false;
    scene.add(this.c.root);
  }

  get visible() {
    return this.c.root.visible;
  }
  set visible(v: boolean) {
    this.c.root.visible = v;
  }

  place(p: THREE.Vector3, heading: number) {
    this.pos.copy(p);
    this.heading = heading;
    this.c.root.rotation.y = heading;
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.hop = null;
  }

  /** Scripted parabolic hop (ship ⇄ pier). */
  hopTo(from: THREE.Vector3, to: THREE.Vector3, done: () => void, dur = 0.9) {
    this.pos.copy(from);
    this.heading = headingTo(to.x - from.x, to.z - from.z);
    this.hop = { from: from.clone(), to: to.clone(), t: 0, dur, h: Math.max(1.2, to.y - from.y + 1.2), done };
    this.c.play('jump', true);
    audio.play('whoosh', { volume: 0.5 });
  }

  get hopping() {
    return !!this.hop;
  }

  /** Play the reach-out animation (used when interacting). */
  interact() {
    this.interactT = 0.55;
    this.c.play('interact', true);
  }

  faceTo(p: THREE.Vector3) {
    this.heading = headingTo(p.x - this.pos.x, p.z - this.pos.z);
  }

  update(dt: number, input: Input | null, camYaw: number, area: LandArea | null, npcCols: CircleCol[], fx: Particles, mods: WalkMods | null = null) {
    const c = this.c;
    if (this.hop) {
      const h = this.hop;
      h.t += dt / h.dur;
      const k = Math.min(1, h.t);
      this.pos.lerpVectors(h.from, h.to, k);
      this.pos.y += Math.sin(k * Math.PI) * h.h;
      c.root.rotation.y = dampAngle(c.root.rotation.y, this.heading, 12, dt);
      c.update(dt);
      if (k >= 1) {
        this.hop = null;
        c.play('idle');
        audio.play('step', { volume: 0.9, pitch: 0.8 });
        fx.dust(this.pos.clone(), 0.4);
        h.done();
      }
      return;
    }
    if (!area) {
      c.update(dt);
      return;
    }

    // ---- input → desired velocity (relative to the camera) ----
    let ix = 0;
    let iz = 0;
    let run = false;
    if (input && !this.locked) {
      if (input.forward) iz += 1;
      if (input.back) iz -= 1;
      if (input.left) ix -= 1;
      if (input.right) ix += 1;
      run = input.boost;
    }
    const len = Math.hypot(ix, iz);
    // camera looks along -camYaw direction toward the player: forward = away from camera
    const fx_ = -Math.sin(camYaw);
    const fz_ = -Math.cos(camYaw);
    const rx = -fz_;
    const rz = fx_;
    let tx = 0;
    let tz = 0;
    if (len > 0) {
      tx = (fx_ * iz + rx * ix) / len;
      tz = (fz_ * iz + rz * ix) / len;
    }
    this.moveDir.set(tx, 0, tz);
    this.sprinting = false;
    let maxSp = run ? RUN : WALK;
    if (mods?.combat) {
      this.sprinting = run && mods.sprint && len > 0;
      maxSp = this.sprinting ? FIGHT_SPRINT : FIGHT_RUN;
    }
    if (mods) maxSp *= mods.speed;
    const accel = this.grounded ? (mods?.combat ? 18 : 14) : 4;
    this.vel.x = lerp(this.vel.x, tx * maxSp, clamp(accel * dt, 0, 1));
    this.vel.z = lerp(this.vel.z, tz * maxSp, clamp(accel * dt, 0, 1));
    if (mods && mods.face !== null) this.heading = mods.face;
    else if (len > 0 && (!mods || mods.speed > 0.05)) this.heading = headingTo(tx, tz);

    // jump
    if (input && !this.locked && !mods?.noJump && input.pressed('Space') && this.grounded) {
      this.vel.y = JUMP_V;
      this.grounded = false;
      this.airT = 0;
      c.play('jump', true);
      audio.play('whoosh', { volume: 0.35, pitch: 1.4 });
    }

    // ---- horizontal move with step / water checks (axis-separated for sliding) ----
    const tryMove = (nx: number, nz: number) => {
      const s = area.surface(nx, nz, this.pos.y, this.grounded ? 0.6 : 0.35);
      return s !== null;
    };
    const ox = this.pos.x;
    const oz = this.pos.z;
    const mx = (this.vel.x + (mods?.push.x ?? 0)) * dt;
    const mz = (this.vel.z + (mods?.push.z ?? 0)) * dt;
    if (tryMove(ox + mx, oz + mz)) {
      this.pos.x += mx;
      this.pos.z += mz;
    } else if (tryMove(ox + mx, oz)) {
      this.pos.x += mx;
      this.vel.z *= 0.5;
    } else if (tryMove(ox, oz + mz)) {
      this.pos.z += mz;
      this.vel.x *= 0.5;
    } else {
      this.vel.x = 0;
      this.vel.z = 0;
    }
    this.extra.length = 0;
    for (const n of npcCols) this.extra.push(n);
    area.resolve(this.pos, WALKER_R, this.extra);
    // never end up over water after pushes
    if (area.surface(this.pos.x, this.pos.z, this.pos.y, 0.6) === null) {
      this.pos.x = ox;
      this.pos.z = oz;
    }

    // ---- vertical ----
    const ground = area.surface(this.pos.x, this.pos.z, this.pos.y, this.grounded ? 0.6 : 0.2) ?? this.pos.y;
    if (this.grounded) {
      if (ground < this.pos.y - 0.45) {
        // walked off an edge
        this.grounded = false;
        this.vel.y = 0;
        this.airT = 0;
      } else this.pos.y = lerp(this.pos.y, ground, clamp(dt * 18, 0, 1));
    }
    if (!this.grounded) {
      this.airT += dt;
      this.vel.y -= GRAVITY * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground && this.vel.y <= 0) {
        this.pos.y = ground;
        this.grounded = true;
        if (this.airT > 0.25) {
          audio.play('step', { volume: 1, pitch: 0.75 });
          fx.dust(this.pos.clone().setY(this.pos.y + 0.1), 0.35);
        }
        this.vel.y = 0;
      }
    }

    // ---- animation ----
    this.speed = Math.hypot(this.vel.x + (mods?.push.x ?? 0), this.vel.z + (mods?.push.z ?? 0));
    this.interactT -= dt;
    if (mods?.anim) {
      // land combat poses the captain itself
    } else if (!this.grounded) {
      if (c.state !== 'jump') c.play('jump');
    } else if (this.interactT > 0) {
      // keep the reach pose
    } else if (this.speed > 5.6) c.play('run');
    else if (this.speed > 0.6) c.play('walk');
    else if (c.state === 'run' || c.state === 'walk' || c.state === 'jump' || c.state === 'interact') c.play('idle');
    c.root.rotation.y = dampAngle(c.root.rotation.y, this.heading, mods?.combat ? 20 : 12, dt);

    // footsteps
    if (this.grounded && this.speed > 0.6) {
      this.stepT -= dt * (this.speed > 5.6 ? 1.6 : 1);
      if (this.stepT <= 0) {
        this.stepT = 0.36;
        const wood = this.pos.y > 1.5 && Math.abs(this.pos.y - 1.78) < 0.05;
        this.onWood = wood;
        audio.play('step', { volume: this.speed > 5.6 ? 0.55 : 0.4, pitch: (wood ? 1.25 : 0.95) * rand(0.9, 1.1) });
        if (this.speed > 5.6 && !wood && Math.random() < 0.35) fx.dust(this.pos.clone().setY(this.pos.y + 0.05), 0.18);
      }
    }
    c.update(dt);
  }
}
