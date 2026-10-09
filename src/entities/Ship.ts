import * as THREE from 'three';
import type { Game } from '../game/Game';
import { ShipModel, CannonSide, CannonMount, SIDE_YAW, disposeShipModel } from '../models/ShipModel';
import { Character } from '../models/Character';
import { WakeTrail } from '../systems/Wakes';
import { audio } from '../core/Audio';
import { clamp, damp, rand, angleDiff, choose, dampT, dampAngle } from '../core/math';
import { landSDFFast, landGradient, WORLD_SOFT_EDGE, WORLD_HALF } from '../world/WorldData';
import { flagMaterial, FlagKind } from '../models/Flags';
import type { AmmoId } from '../game/Data';

export type Team = 'player' | 'merchant' | 'navy';

const holeGeo = (() => {
  const g = new THREE.CircleGeometry(0.42, 9);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 1; i < p.count; i++) {
    const k = 0.75 + Math.random() * 0.5;
    p.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
  return g;
})();
const holeMat = new THREE.MeshBasicMaterial({ color: 0x1b120b, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
const ringGeo = new THREE.RingGeometry(0.38, 0.62, 9);
const _stern = new THREE.Vector3();
const ringMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 });

/** Shared boat behaviour: arcade physics, buoyancy, cannons, damage, sinking. */
export class Ship {
  game: Game;
  model!: ShipModel;
  root = new THREE.Group();
  body = new THREE.Group();
  heading = 0;
  speed = 0;
  throttle = 0;
  steer = 0;
  boostMul = 1;
  maxSpeed = 20;
  accel = 6;
  turnRate = 0.9;
  hp = 100;
  maxHp = 100;
  team: Team;
  name = '';
  typeLabel = '';
  alive = true;
  sinking = false;
  sinkT = 0;
  removeMe = false;
  roll = 0;
  rollV = 0;
  pitch = 0;
  pitchV = 0;
  shake = 0;
  flash = 0;
  wake = new WakeTrail();
  crew: Character[] = [];
  captain: Character | null = null;
  reloadT: Record<CannonSide, number> = { L: 0, R: 0, F: 0, B: 0 };
  reloadTime = 2.2;
  damage = 10;
  range = 70;
  velocity = new THREE.Vector3();
  lastHitBy: Ship | null = null;
  lastHitTime = -99;
  private smokeT = 0;
  private funnelT = 0;
  private wakeDt = 0;
  private wakeFrame = 0;
  private smokeVents: THREE.Vector3[] = [];
  private sprayT = 0;
  private holes: THREE.Object3D[] = [];
  private prevSpeed = 0;
  collideRadius = 6;
  steerVisual = 0;
  flagKind: FlagKind = 'pirate';
  /** whether to show crew (LOD) */
  crewVisible = true;
  bumpCooldown = 0;
  ammo: AmmoId = 'round';

  constructor(game: Game, model: ShipModel, team: Team) {
    this.game = game;
    this.team = team;
    this.root.add(this.body);
    this.setModel(model);
    game.scene.add(this.root);
    game.scene.add(this.wake.mesh);
  }

  get pos() {
    return this.root.position;
  }

  setModel(model: ShipModel) {
    if (this.model) {
      this.body.remove(this.model.group);
      for (const h of this.holes) h.removeFromParent();
      this.holes = [];
      // the old model (e.g. before an upgrade or a new ship) would otherwise leak its GPU buffers
      if (this.model !== model) disposeShipModel(this.model);
    }
    this.model = model;
    this.smokeVents = [];
    this.body.add(model.group);
    this.collideRadius = model.beam * 0.5 + model.length * 0.22;
    this.wake.width = model.beam * 0.38;
    this.wake.spread = 1.2 + model.beam * 0.08;
  }

  setFlag(kind: FlagKind) {
    this.flagKind = kind;
    this.model.flag.material = flagMaterial(kind);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** Local (ship space) point to world, including tilt. */
  localToWorld(v: THREE.Vector3) {
    return this.body.localToWorld(v);
  }

  // ---------------------------------------------------------------------
  update(dt: number) {
    if (this.sinking) {
      this.updateSinking(dt);
      return;
    }
    this.updatePhysics(dt);
    this.updateVisual(dt);
  }

  protected updatePhysics(dt: number) {
    const target = this.throttle * this.maxSpeed * this.boostMul;
    const a = target > this.speed ? this.accel * (this.boostMul > 1 ? 1.8 : 1) : this.accel * (this.throttle < 0 ? 1.4 : 0.7);
    if (Math.abs(target - this.speed) < a * dt) this.speed = target;
    else this.speed += Math.sign(target - this.speed) * a * dt;

    const speedK = clamp(0.35 + Math.abs(this.speed) / this.maxSpeed, 0.35, 1.15);
    this.steerVisual = damp(this.steerVisual, this.steer, 6, dt);
    this.heading += this.steerVisual * this.turnRate * speedK * dt * (this.speed < -0.5 ? -1 : 1);

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.velocity.set(fx * this.speed, 0, fz * this.speed);
    this.pos.x += this.velocity.x * dt;
    this.pos.z += this.velocity.z * dt;

    // land collision: test centre, bow and stern
    this.bumpCooldown -= dt;
    const L = this.model.length;
    const hw = this.model.beam * 0.5 + 0.6;
    for (const off of [0, L * 0.38, -L * 0.38]) {
      const px = this.pos.x + fx * off;
      const pz = this.pos.z + fz * off;
      const sd = landSDFFast(px, pz);
      if (sd < hw) {
        const g = landGradient(px, pz);
        const push = hw - sd;
        this.pos.x += g.x * push;
        this.pos.z += g.y * push;
        const impact = Math.abs(this.speed);
        if (impact > 6 && this.bumpCooldown <= 0) {
          this.bumpCooldown = 1;
          this.onBump(impact);
        }
        this.speed *= 0.6;
      }
    }
    // soft world boundary: a square like the map, easing ships back inside (never off the map)
    for (const axis of ['x', 'z'] as const) {
      const a = Math.abs(this.pos[axis]);
      if (a <= WORLD_SOFT_EDGE) continue;
      const pulled = a - (a - WORLD_SOFT_EDGE) * 2.5 * dt;
      this.pos[axis] = Math.sign(this.pos[axis]) * Math.min(WORLD_HALF - 30, Math.max(WORLD_SOFT_EDGE, pulled));
    }

    for (const s of ['L', 'R', 'F', 'B'] as CannonSide[]) this.reloadT[s] = Math.max(0, this.reloadT[s] - dt);
  }

  protected onBump(impact: number) {
    this.shake = 0.4;
    this.rollV += rand(-1, 1) * 0.4;
    this.pitchV -= 0.6;
    const p = this.pos.clone().add(this.forward().multiplyScalar(this.model.length * 0.45));
    this.game.particles.dust(p.setY(1), 1);
    this.game.particles.splash(p.setY(0.2), 0.8);
    audio.play('impact', { pos: p, volume: 0.6 });
    if (impact > 10) this.applyDamage(Math.round(impact * 0.4), p, null, false);
  }

  protected updateVisual(dt: number) {
    const ocean = this.game.ocean;
    const L = this.model.length;
    const B = this.model.beam;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);
    const x = this.pos.x;
    const z = this.pos.z;
    // far-away ships (crew hidden) bob on the cheap wave estimate
    const h = (px: number, pz: number) => (this.crewVisible ? ocean.heightAt(px, pz) : ocean.heightApprox(px, pz));
    const hb = h(x + fx * L * 0.4, z + fz * L * 0.4);
    const hs = h(x - fx * L * 0.4, z - fz * L * 0.4);
    const hp = h(x + rx * B * 0.5, z + rz * B * 0.5);
    const hst = h(x - rx * B * 0.5, z - rz * B * 0.5);
    const hc = h(x, z);
    const heave = (hb + hs + hp + hst + hc * 2) / 6;
    this.pos.y = damp(this.pos.y, heave - 0.1, 8, dt);

    const accelK = (this.speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = this.speed;
    const pitchT = Math.atan2(hb - hs, L * 0.8) * 0.8 + clamp(accelK * 0.006, -0.06, 0.06);
    const turnLean = -this.steerVisual * clamp(Math.abs(this.speed) / this.maxSpeed, 0, 1) * 0.14;
    const rollT = Math.atan2(hp - hst, B) * 0.7 + turnLean;
    const k = 30;
    const c = 6;
    this.rollV += ((rollT - this.roll) * k - this.rollV * c) * dt;
    this.pitchV += ((pitchT - this.pitch) * k - this.pitchV * c) * dt;
    this.roll += this.rollV * dt;
    this.pitch += this.pitchV * dt;
    this.root.rotation.y = this.heading;
    this.body.rotation.set(-this.pitch, 0, this.roll);
    // impact shake
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shake * this.shake;
    this.body.position.set(rand(-1, 1) * s * 0.4, rand(-1, 1) * s * 0.25, rand(-1, 1) * s * 0.4);
    // hit flash
    this.flash = Math.max(0, this.flash - dt * 5);
    this.model.hullMat.emissive.setRGB(this.flash * 0.9, this.flash * 0.75, this.flash * 0.6);

    // sails fill with speed + wind
    const spK = clamp(Math.abs(this.speed) / this.maxSpeed, 0, 1.3);
    this.model.sailUniforms.uBillow.value = damp(this.model.sailUniforms.uBillow.value, 0.25 + spK * 0.85, 2, dt);

    // wheel spin
    if (this.model.wheel) this.model.wheel.rotation.z = damp(this.model.wheel.rotation.z, -this.steerVisual * 2.4, 5, dt);

    // cannon recoil
    for (const m of this.model.cannons) this.animateRecoil(m, dt);
    // paddle wheels turn with the ship, radar spins
    for (const sp of this.model.spinners) sp.obj.rotation[sp.axis] += (sp.bySpeed ? this.speed * sp.rate : sp.rate) * dt;
    // gun turrets swing to the side they're firing on, then back to rest
    for (const t of this.model.turrets) {
      t.idle += dt;
      if (t.idle > 3.5) t.target = t.rest;
      t.obj.rotation.y = dampAngle(t.obj.rotation.y, t.target, 7, dt);
    }
    // steamship smokestacks
    if (this.model.funnels.length && this.crewVisible && this.alive) {
      this.funnelT -= dt;
      if (this.funnelT <= 0) {
        const k = clamp(Math.abs(this.speed) / this.maxSpeed, 0, 1.4);
        this.funnelT = 0.16 - k * 0.09;
        // smoke keeps some of the ship's way so it streams back gently instead of smothering the deck
        const carry = this.velocity.clone().multiplyScalar(0.75);
        for (const f of this.model.funnels) this.game.particles.plume(this.body.localToWorld(f.clone()), 0.24 + (1 - Math.min(1, k)) * 0.1, 0.55 + L * 0.008 + k * 0.2, 1.0, carry);
      }
    }

    // wake + spray
    const stern = this.root.localToWorld(_stern.set(0, 0, -L * 0.45));
    // far-away wakes are rebuilt every third frame (same ageing, a third of the work)
    this.wakeDt += dt;
    if (this.crewVisible || ++this.wakeFrame % 3 === 0) {
      this.wake.update(this.wakeDt, stern.x, stern.z, clamp(Math.abs(this.speed) / 14, 0, 1), ocean);
      this.wakeDt = 0;
    }
    this.sprayT -= dt;
    if (Math.abs(this.speed) > 9 && this.sprayT <= 0 && this.crewVisible) {
      this.sprayT = 0.05 / (Math.abs(this.speed) / 20);
      const side = Math.random() < 0.5 ? 1 : -1;
      const bow = this.root.localToWorld(new THREE.Vector3(side * B * 0.3, 0, L * 0.42));
      bow.y = hc + 0.3;
      const out = new THREE.Vector3(rx * side * 4, 0, rz * side * 4).addScaledVector(this.velocity, 0.3);
      this.game.particles.spray(bow, out, 0.7 + Math.abs(this.speed) / 40);
    }

    // damage smoke: columns rising from one or two fixed spots on deck (not scattered puffs)
    const dmg = 1 - this.hp / this.maxHp;
    if (dmg < 0.3) this.smokeVents.length = 0;
    if (dmg > 0.45 && this.smokeVents.length === 0) this.addSmokeVent();
    if (dmg > 0.72 && this.smokeVents.length === 1) this.addSmokeVent();
    if (dmg > 0.45) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.07;
        const heavy = dmg > 0.72;
        for (const v of this.smokeVents) {
          const p = this.body.localToWorld(v.clone());
          this.game.particles.plume(p, heavy ? 0.26 : 0.42, 0.6 + L * 0.02);
          if (heavy && Math.random() < 0.5) this.game.particles.fire(p, 0.9);
        }
      }
    }
    this.model.sailUniforms.uDamage.value = clamp((dmg - 0.15) * 1.2, 0, 1);

    // crew animation
    if (this.crewVisible) {
      for (const c of this.crew) c.update(dt);
      this.captain?.update(dt);
    }
  }

  private animateRecoil(m: CannonMount, dt: number) {
    if (m.obj === this.model.group || m.turret !== undefined) return;
    m.recoil = Math.max(0, m.recoil - dt * 2.2);
    const r = m.recoil > 0.75 ? (1 - m.recoil) / 0.25 : m.recoil / 0.75;
    m.obj.position.copy(m.basePos).addScaledVector(m.dir, -r * 0.6);
  }

  // ---------------------------------------------------------------------
  cannonsOn(side: CannonSide) {
    return this.model.cannons.filter((c) => c.side === side);
  }

  canFire(side: CannonSide) {
    return this.reloadT[side] <= 0 && this.cannonsOn(side).length > 0;
  }

  /** Fire a volley from one side; aim is a predicted world point (optional). */
  fire(side: CannonSide, aim: THREE.Vector3 | null, spread = 1.5) {
    if (!this.canFire(side)) return false;
    const mounts = this.cannonsOn(side);
    this.reloadT[side] = this.reloadTime;
    // turrets swing round first
    let delay = 0;
    for (const m of mounts) {
      if (m.turret === undefined) continue;
      const t = this.model.turrets[m.turret];
      t.idle = 0;
      if (Math.abs(angleDiff(t.obj.rotation.y, SIDE_YAW[side])) > 0.15) delay = 0.32;
      t.target = SIDE_YAW[side];
    }
    mounts.forEach((m, i) => this.game.after(delay + i * 0.09 + rand(0, 0.03), () => this.fireMount(m, aim, spread)));
    return true;
  }

  private fireMount(m: CannonMount, aim: THREE.Vector3 | null, spread: number) {
    if (!this.alive || this.sinking) return;
    const muzzle = this.body.localToWorld(m.muzzle.clone());
    const dir = m.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    let target: THREE.Vector3;
    if (aim) {
      target = aim.clone();
      const to = target.clone().sub(muzzle).setY(0);
      const d = to.length();
      const ang = Math.acos(clamp(to.clone().normalize().dot(dir), -1, 1));
      if (ang > 0.85 || d < 4) {
        target = muzzle.clone().addScaledVector(dir, this.range * 0.85).setY(0);
      } else if (d > this.range) {
        target = muzzle.clone().addScaledVector(to.normalize(), this.range).setY(0);
      }
      const sp = spread * (0.4 + d / 60);
      target.x += rand(-sp, sp);
      target.z += rand(-sp, sp);
    } else {
      target = muzzle.clone().addScaledVector(dir, this.range * 0.85).setY(0);
    }
    const g = 28;
    const H = 72;
    const flat = target.clone().sub(muzzle).setY(0);
    const dist = Math.max(4, flat.length());
    const T = dist / H;
    const vy = (target.y + 0.6 - muzzle.y + 0.5 * g * T * T) / T;
    const vel = flat.normalize().multiplyScalar(H).setY(vy).add(this.velocity.clone().multiplyScalar(0.5));
    this.game.projectiles.fire(muzzle, vel, this, this.damage * rand(0.85, 1.15), this.ammo);
    this.game.particles.muzzle(muzzle, dir, 0.8 + this.model.length * 0.015);
    m.recoil = 1;
    audio.play(this.team === 'player' ? 'cannon' : 'cannonFar', { pos: muzzle, volume: this.team === 'player' ? 0.9 : 1, pitch: rand(0.9, 1.1) });
    // ship kicks away from the shot
    this.rollV += (m.side === 'L' ? -1 : m.side === 'R' ? 1 : 0) * 0.15;
    if (m.side === 'F') this.pitchV += 0.1;
    this.onFired(m);
  }

  protected onFired(_m: CannonMount) {}

  // ---------------------------------------------------------------------
  /** Called by projectiles. */
  applyDamage(dmg: number, point: THREE.Vector3, from: Ship | null, showFx = true) {
    if (!this.alive || this.sinking) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.lastHitBy = from;
    this.lastHitTime = this.game.time;
    this.shake = Math.min(1, this.shake + 0.5);
    this.flash = 1;
    const local = this.body.worldToLocal(point.clone());
    this.rollV += (local.x > 0 ? -1 : 1) * clamp(dmg / this.maxHp, 0.02, 0.2) * 3;
    if (showFx) {
      this.game.particles.explosion(point, 0.9, this.model.hullMat ? '#9a6a40' : '#9a6a40');
      audio.play('impact', { pos: point, pitch: rand(0.85, 1.15) });
      this.addHole(local);
    }
    this.game.ui.damageNumber(point, Math.round(dmg), this.team === 'player' ? 'player' : 'enemy');
    // a few crew react
    const reactors = [...this.crew, ...(this.captain ? [this.captain] : [])];
    for (const c of reactors) if (Math.random() < 0.6) c.trigger(Math.random() < 0.5 ? 'hit' : 'flinch');
    if (Math.random() < 0.5) audio.playVoice(Math.random() < 0.6 ? 'oof' : 'hey', point, this.team === 'player' ? 0.9 : 1.15);
    this.onDamaged(dmg, from);
    if (this.hp <= 0) this.destroy(from);
  }

  protected onDamaged(_dmg: number, _from: Ship | null) {}

  private addSmokeVent() {
    const L = this.model.length;
    const z = rand(-0.3, 0.3) * L;
    const x = rand(-0.4, 0.4) * this.model.halfWidthAt(z);
    this.smokeVents.push(new THREE.Vector3(x, this.model.deckYAt(z) + 0.3, z));
  }

  private addHole(local: THREE.Vector3) {
    if (this.holes.length >= 10) return;
    const z = clamp(local.z, -this.model.length * 0.42, this.model.length * 0.4);
    const side = local.x >= 0 ? 1 : -1;
    const deck = this.model.deckYAt(z);
    const y = clamp(local.y, 0.5, Math.max(0.6, deck - 0.1));
    const hw = this.model.halfWidthAt(z);
    const g = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.position.z = 0.01;
    g.add(ring, hole);
    g.position.set(side * (hw + 0.06), y, z);
    g.rotation.y = side * Math.PI * 0.5;
    g.rotation.z = Math.random() * 3;
    const sc = rand(0.7, 1.1);
    g.scale.setScalar(sc);
    this.model.group.add(g);
    this.holes.push(g);
  }

  destroy(by: Ship | null) {
    if (this.sinking) return;
    this.sinking = true;
    this.alive = false;
    this.sinkT = 0;
    this.throttle = 0;
    audio.play('sink', { pos: this.pos.clone() });
    this.game.particles.explosion(this.pos.clone().setY(2), 1.6);
    for (const c of this.crew) c.play('panic');
    this.captain?.play('defeat');
    this.game.onShipSunk(this, by);
  }

  protected updateSinking(dt: number) {
    this.sinkT += dt;
    const t = this.sinkT;
    this.speed = damp(this.speed, 0, 1, dt);
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    const k = Math.min(1, t / 7);
    this.body.rotation.x = damp(this.body.rotation.x, 0.45, 0.6, dt);
    this.body.rotation.z = damp(this.body.rotation.z, 0.35, 0.5, dt);
    this.pos.y = -k * k * (this.model.topY + 4);
    this.model.sailUniforms.uFurl.value = Math.min(1, t * 0.3);
    if (Math.random() < dt * 12) this.game.particles.bubbles(this.pos.clone().setY(0.2), this.model.length * 0.3);
    if (t < 3 && Math.random() < dt * 8) this.game.particles.smoke(this.pos.clone().setY(this.model.deckYAt(0) + this.pos.y + 1), 0.25, 1.4);
    if (this.crewVisible) for (const c of this.crew) c.update(dt);
    this.wake.update(dt, this.pos.x, this.pos.z, 0, this.game.ocean);
    if (t > 8) this.removeMe = true;
  }

  dispose() {
    this.root.removeFromParent();
    this.wake.dispose();
    for (const c of this.crew) c.dispose();
    this.captain?.dispose();
    disposeShipModel(this.model);
  }

  /** Helper: steer toward a heading with AI-style proportional control. */
  steerTo(targetHeading: number, gain = 2.2) {
    this.steer = clamp(angleDiff(this.heading, targetHeading) * gain, -1, 1);
  }

  addCrew(c: Character, spot: THREE.Vector3, facing = 0) {
    c.root.position.copy(spot);
    c.root.rotation.y = facing;
    this.model.group.add(c.root);
    this.crew.push(c);
  }

  setCrewVisible(v: boolean) {
    if (v === this.crewVisible) return;
    this.crewVisible = v;
    // far-away crews are detached so their skeletons aren't updated every frame
    for (const c of [...this.crew, ...(this.captain ? [this.captain] : [])]) {
      c.root.visible = v;
      if (v && !c.root.parent) this.model.group.add(c.root);
      else if (!v && c.root.parent === this.model.group) c.root.removeFromParent();
    }
  }

  /** Random crew member reaction helper. */
  crewDo(fn: (c: Character) => void, chance = 1) {
    for (const c of this.crew) if (Math.random() < chance) fn(c);
  }

  shout() {
    if (this.crew.length) audio.randomCrewShout(this.pos);
    void choose;
    void dampT;
  }
}
