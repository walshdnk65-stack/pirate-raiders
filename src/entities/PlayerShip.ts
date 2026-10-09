import * as THREE from 'three';
import type { Game } from '../game/Game';
import { Ship } from './Ship';
import { buildShip, CannonMount, CannonSide, SIDE_YAW } from '../models/ShipModel';
import { classDesign, type ClassLook } from '../models/ShipDesigns';
import { Character } from '../models/Character';
import { Profile, AMMO, AMMO_IDS, cosmeticById, flagKindOf, officerSkill, hasItem } from '../game/Data';
import { shipClass, shipStats } from '../game/ShipClasses';
import { audio } from '../core/Audio';
import { clamp, angleDiff, rand } from '../core/math';
import type { AIShip } from './AIShip';

const CREW_SPECS = ['pirateA', 'pirateB', 'pirateC', 'pirateA', 'pirateB'];

export class PlayerShip extends Ship {
  boost = 100;
  boostCooldown = 0;
  boosting = false;
  target: AIShip | null = null;
  controlsEnabled = true;
  lantern: THREE.PointLight;
  lastFireTime = -99;
  private celebrateT = 0;
  private profile: Profile;

  constructor(game: Game, profile: Profile) {
    super(game, buildShip(classDesign(PlayerShip.look(profile))), 'player');
    this.profile = profile;
    this.lantern = new THREE.PointLight(0xffb060, 0, 26, 1.6);
    this.root.add(this.lantern);
    this.applyProfile(profile, true);
  }

  static look(p: Profile): ClassLook {
    const sail = cosmeticById(p.sail);
    return {
      cls: p.ship,
      perSide: shipStats(p.ship, p.upgrades).perSide,
      hullLvl: p.upgrades.hull,
      sailLvl: p.upgrades.sails,
      cannonLvl: p.upgrades.cannons,
      rangeLvl: p.upgrades.range,
      steerLvl: p.upgrades.steering,
      cargoLvl: p.upgrades.cargo,
      cannonSkin: cosmeticById(p.cannonSkin ?? 'cannon-auto').value,
      sailColor: sail.value,
      sailStripe: sail.stripe,
      hullPaint: cosmeticById(p.hull).value,
      flag: flagKindOf(p),
    };
  }

  /** Apply upgrade stats and rebuild the 3D model so upgrades are visible. */
  applyProfile(p: Profile, rebuild: boolean) {
    this.profile = p;
    const cls = shipClass(p.ship);
    const st = shipStats(cls.id, p.upgrades);
    this.name = cls.shipName;
    this.typeLabel = cls.name;
    // officers and special gear stack on top of the ship class and its upgrades
    const nav = 1 + officerSkill(p, 'navigator') * 0.04;
    const ammo = AMMO[p.ammoSel] ?? AMMO.round;
    this.ammo = ammo.id;
    this.maxHp = Math.round(st.maxHp * (1 + officerSkill(p, 'engineer') * 0.08));
    this.hp = Math.min(p.hp, this.maxHp);
    this.maxSpeed = st.speed * nav * (hasItem(p, 'stormSails') ? 1.08 : 1);
    this.turnRate = 0.95 * st.turn * nav;
    this.accel = st.accel;
    this.damage = st.damage * ammo.dmg * (hasItem(p, 'dragonCannons') ? 1.2 : 1);
    this.range = st.range * ammo.range;
    this.reloadTime = st.reload * ammo.reload * (1 - officerSkill(p, 'gunner') * 0.07);
    if (rebuild) {
      const keep = { roll: this.roll, pitch: this.pitch };
      for (const c of this.crew) c.dispose();
      this.crew = [];
      this.captain?.dispose();
      this.setModel(buildShip(classDesign(PlayerShip.look(p))));
      this.flagKind = flagKindOf(p);
      this.roll = keep.roll;
      this.pitch = keep.pitch;
      this.lantern.position.copy(this.model.lanternPos);
      // captain at the wheel
      if (!this.captain) this.captain = new Character('captain');
      this.captain.root.position.copy(this.model.captainPos);
      this.captain.root.rotation.y = 0;
      this.model.group.add(this.captain.root);
      this.captain.play('steer');
      this.captain.express('determined');
      // crew at the cannons – more crew = more pirates on deck
      const n = Math.min(this.model.crewSpots.length, 1 + Math.floor(st.crew / 4));
      for (let i = 0; i < n; i++) {
        const spot = this.model.crewSpots[i];
        const c = new Character(CREW_SPECS[i % CREW_SPECS.length]);
        this.addCrew(c, spot, spot.x > 0 ? Math.PI / 2 : -Math.PI / 2);
        c.play('idle');
      }
    }
  }

  get crewCount() {
    return this.profile.crew;
  }

  update(dt: number) {
    const input = this.game.input;
    if (this.alive && !this.sinking && this.controlsEnabled) {
      let throttle = 0;
      if (input.forward) throttle = 1;
      else if (input.back) throttle = this.speed > 1 ? -0.6 : -0.4;
      else throttle = this.speed > 0.5 ? 0.15 : 0; // keep some way on
      this.throttle = throttle;
      this.steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      // boost
      this.boostCooldown -= dt;
      const wantBoost = input.boost && this.boost > 1 && throttle > 0;
      if (wantBoost && !this.boosting && this.boost > 15) {
        this.boosting = true;
        audio.play('boost', { volume: 0.7 });
        this.crewDo((c) => c.trigger('flinch'), 0.3);
      }
      if (!input.boost || this.boost <= 0) this.boosting = false;
      if (this.boosting) {
        this.boost = Math.max(0, this.boost - dt * 32);
        this.boostCooldown = 1.0;
        this.boostMul = 1.6;
      } else {
        this.boostMul = 1;
        if (this.boostCooldown <= 0) this.boost = Math.min(100, this.boost + dt * 14);
      }
      if (input.pressed('Space')) this.tryFire();
      if (input.pressed('KeyQ')) this.cycleAmmo();
    } else if (!this.controlsEnabled) {
      this.boostMul = 1;
    }
    super.update(dt);
    if (this.sinking) return;

    // turrets swing round to face the side your target is on
    if (this.model.turrets.length && this.target?.alive && this.controlsEnabled) {
      const to = this.target.pos.clone().sub(this.pos);
      if (to.length() < this.range * 1.4) {
        const ang = angleDiff(this.heading, Math.atan2(to.x, to.z));
        const side: CannonSide = Math.abs(ang) < 0.6 ? 'F' : ang > 0 ? 'L' : 'R';
        for (const m of this.cannonsOn(side)) {
          if (m.turret === undefined) continue;
          const t = this.model.turrets[m.turret];
          t.target = SIDE_YAW[side];
          t.idle = 0;
        }
      }
    }
    // captain animation tracks steering
    if (this.captain) {
      this.captain.params.steer = this.steerVisual;
      if (this.celebrateT > 0) {
        this.celebrateT -= dt;
        if (this.celebrateT <= 0) this.captain.play('steer');
      }
    }
    // lantern glows at night
    this.lantern.intensity = this.game.env.night * 40;
    // engineers and the mermaid charm patch the hull at sea
    const regen = officerSkill(this.profile, 'engineer') * 0.25 + (hasItem(this.profile, 'mermaidCharm') ? 0.5 : 0);
    if (regen > 0 && this.alive && this.hp < this.maxHp && this.game.time - this.lastHitTime > 6) {
      this.hp = Math.min(this.maxHp, this.hp + regen * dt);
      this.profile.hp = this.hp;
    }
  }

  /** Switch to the next unlocked ammunition type. */
  cycleAmmo() {
    const owned = AMMO_IDS.filter((a) => this.profile.ammo.includes(a));
    if (owned.length < 2) {
      audio.play('tick', { volume: 0.5 });
      this.game.ui.toast('⚫ Only round shot', 'Buy chain, grape, fire or heavy shot from a gunsmith.', 'info');
      return;
    }
    const i = owned.indexOf(this.profile.ammoSel);
    this.profile.ammoSel = owned[(i + 1) % owned.length];
    const keepHp = this.hp;
    this.applyProfile(this.profile, false);
    this.hp = keepHp;
    audio.play('reload', { volume: 0.7 });
    const a = AMMO[this.profile.ammoSel];
    this.game.ui.toast(`${a.icon} ${a.name} loaded`, a.desc, 'info');
  }

  /** Pick the best side to fire from given the current target. */
  tryFire() {
    const t = this.target;
    let side: CannonSide = 'F';
    let aim: THREE.Vector3 | null = null;
    if (t && t.alive) {
      const to = t.pos.clone().sub(this.pos);
      const ang = angleDiff(this.heading, Math.atan2(to.x, to.z));
      if (Math.abs(ang) < 0.6) side = 'F';
      else side = ang > 0 ? 'L' : 'R';
      // lead the target
      const d = to.length();
      const T = d / 72;
      aim = t.pos.clone().addScaledVector(t.velocity, T * 1.05);
      aim.y = 0.8;
      if (d > this.range * 1.25) aim = null;
    }
    if (!this.canFire(side)) {
      // fall back to any loaded side that can reach
      const order: CannonSide[] = side === 'F' ? ['F', 'L', 'R'] : side === 'L' ? ['L', 'F', 'R'] : ['R', 'F', 'L'];
      const alt = order.find((s) => this.canFire(s));
      if (!alt || (aim && alt !== side && alt !== 'F')) {
        audio.play('tick', { volume: 0.6 });
        return;
      }
      side = alt;
    }
    if (this.fire(side, aim, 1.2)) {
      this.lastFireTime = this.game.time;
      this.game.wanted.gunfire();
      this.game.camRig.addShake(0.35);
      this.game.camRig.combatPulse();
      this.captain?.trigger('fire', 0.6);
      if (Math.random() < 0.35) audio.playVoice('arr', this.pos, 0.95);
      this.game.after(this.reloadTime - 0.3, () => audio.play('reload', { volume: 0.5 }));
      this.game.ui.onFire(side);
    }
  }

  protected onFired(m: CannonMount) {
    // nearest crew member cheers / reacts
    let best: Character | null = null;
    let bd = 1e9;
    for (const c of this.crew) {
      const d = c.root.position.distanceTo(m.basePos);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    best?.trigger('flinch', 0.4);
  }

  protected onDamaged(dmg: number) {
    this.game.camRig.addShake(0.5 + dmg / 30);
    this.captain?.trigger('hit', 0.6);
    this.game.ui.flashDamage();
    this.game.profile.hp = this.hp;
  }

  celebrate(duration = 3.5) {
    this.celebrateT = duration;
    this.captain?.play('victory');
    this.captain?.express('happy', duration);
    this.crewDo((c) => {
      c.play('cheer');
      c.express('happy', duration);
      this.game.after(duration, () => c.play('idle'));
    });
  }

  crewIdle() {
    this.crewDo((c) => c.play('idle'));
  }

  resetAt(pos: THREE.Vector3, heading: number) {
    this.pos.copy(pos);
    this.heading = heading;
    this.speed = 0;
    this.roll = this.pitch = this.rollV = this.pitchV = 0;
    this.wake.reset();
    this.sinking = false;
    this.alive = true;
    this.removeMe = false;
    this.body.rotation.set(0, 0, 0);
    this.model.sailUniforms.uFurl.value = 0;
    this.captain?.play('steer');
    void rand;
    void clamp;
  }
}
