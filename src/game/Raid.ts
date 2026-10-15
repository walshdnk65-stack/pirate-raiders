import * as THREE from 'three';
import type { Game } from './Game';
import type { Ship } from '../entities/Ship';
import { audio } from '../core/Audio';
import { clamp, rand, headingTo, dampAngle, fmtMoney } from '../core/math';
import { GeoBuilder, T, cyl } from '../render/GeoBuilder';
import { M } from '../render/Materials';
import { PAL } from '../models/Props';
import { PORTS } from '../world/WorldData';
import { groundHeight } from '../world/Islands';
import { saveProfile } from './Data';
import { SITES } from './combat/Encounters';

/**
 * Port raids. Ports you can raid, how tough their garrison is and how many shore batteries guard
 * the harbour. (Skull Cove is a pirate haven: nobody raids it.)
 */
export const RAID_PORTS: Record<string, { tier: number; batteries: number }> = {
  salt: { tier: 2, batteries: 2 },
  lagoon: { tier: 3, batteries: 2 },
  royal: { tier: 4, batteries: 3 },
  gold: { tier: 5, batteries: 3 },
};
/** days a looted port stays shut to you (and its batteries take to rebuild) */
export const RAID_COOLDOWN = 5;
/** sail this far from a port mid-raid and the raid is called off */
const ABANDON_DIST = 480;
const RANGE = 150;

interface Battery {
  port: number;
  pos: THREE.Vector3;
  group: THREE.Group;
  barrel: THREE.Object3D;
  baseYaw: number;
  hp: number;
  maxHp: number;
  reload: number;
  alive: boolean;
  smokeT: number;
}

const _v = new THREE.Vector3();

/**
 * A raid: bombard a port's shore batteries from the sea (they fire back), land a raiding party,
 * fight the garrison through town to the treasury, crack the chest and get away with the navy
 * on your tail. The port won't let you dock for a few days afterwards.
 */
export class Raid {
  batteries: Battery[] = [];
  /** port index being raided, or -1 */
  port = -1;
  phase: 'none' | 'bombard' | 'landing' | 'looted' = 'none';
  /** stands in as the "ship" that fired a battery's cannonballs */
  private gunner = { team: 'navy', alive: true, sinking: false } as unknown as Ship;

  constructor(private game: Game) {}

  /** Build the shore batteries on either side of each raidable harbour. */
  init() {
    const g = this.game;
    PORTS.forEach((port, idx) => {
      const rp = RAID_PORTS[port.id];
      if (!rp) return;
      const town = g.towns[idx];
      const area = g.areas[idx];
      const sea = new THREE.Vector3(port.berth.x - town.center.x, 0, port.berth.z - town.center.z).normalize();
      const right = new THREE.Vector3(sea.z, 0, -sea.x);
      const offsets = [-38, 38, -66, 66].slice(0, rp.batteries);
      for (const off0 of offsets) {
        let spot: THREE.Vector3 | null = null;
        for (let k = 0; k < 8 && !spot; k++) {
          const off = off0 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 9;
          const base = town.center.clone().addScaledVector(right, off);
          for (let t = 0; t < 260; t += 1) {
            const x = base.x + sea.x * t;
            const z = base.z + sea.z * t;
            if (groundHeight(x, z) > 0.9) continue;
            // just inland of where the land meets the water
            const p = new THREE.Vector3(base.x + sea.x * (t - 5), 0, base.z + sea.z * (t - 5));
            const y = groundHeight(p.x, p.z);
            const tooClose = p.distanceTo(port.berth) < 22 || p.distanceTo(town.landing) < 16 || this.batteries.some((b) => b.pos.distanceTo(p) < 18);
            if (y > 0.9 && y < 9 && !area.blocked(p.x, p.z, 4.6) && !tooClose) spot = p.setY(y);
            break;
          }
        }
        if (spot) this.batteries.push(this.build(idx, spot, headingTo(sea.x, sea.z), rp.tier));
      }
    });
    // ports looted recently still have their batteries in ruins
    for (const b of this.batteries) if (this.cooling(b.port)) this.wreck(b, true);
  }

  private build(port: number, pos: THREE.Vector3, yaw: number, tier: number): Battery {
    const stone = '#a59a8c';
    const stoneD = '#857a6e';
    const gb = new GeoBuilder();
    gb.add(cyl(2.5, 2.9, 2.0, 14), stoneD, T(0, 0.2, 0));
    gb.add(cyl(2.35, 2.5, 0.35, 14), stone, T(0, 1.35, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      // leave a gap for the gun at the front
      if (Math.abs(Math.sin(a / 2)) < 0.25) continue;
      gb.add(new THREE.BoxGeometry(1.1, 0.7, 0.5), stone, T(Math.sin(a) * 2.2, 1.85, Math.cos(a) * 2.2, 0, a, 0));
    }
    gb.add(new THREE.BoxGeometry(1.1, 0.45, 1.5), PAL.wood, T(0, 1.75, 0.1));
    gb.add(cyl(0.05, 0.05, 3.2, 5), PAL.woodDark, T(-1.6, 3.1, -1.4));
    gb.add(new THREE.BoxGeometry(0.04, 0.7, 1.0), '#c0262b', T(-1.6, 4.3, -0.9));
    const group = new THREE.Group();
    group.add(gb.mesh(M.vc));
    const bb = new GeoBuilder();
    bb.add(cyl(0.26, 0.36, 2.3, 10), PAL.iron, T(0, 0, 0.9, Math.PI / 2, 0, 0));
    bb.add(cyl(0.36, 0.36, 0.25, 10), PAL.ironDark, T(0, 0, 2.0, Math.PI / 2, 0, 0));
    const barrel = bb.mesh(M.vcMetal);
    barrel.position.set(0, 2.15, 0.2);
    group.add(barrel);
    group.position.copy(pos);
    group.rotation.y = yaw;
    this.game.scene.add(group);
    const hp = Math.round(150 * (1 + 0.3 * (tier - 1)));
    return { port, pos: pos.clone(), group, barrel, baseYaw: yaw, hp, maxHp: hp, reload: rand(1, 3), alive: true, smokeT: 0 };
  }

  get profile() {
    return this.game.profile;
  }

  /** Looted within the last few days (shut to you, batteries in ruins). */
  cooling(idx: number) {
    const day = this.profile.land.raids[PORTS[idx].id];
    return day !== undefined && this.profile.day < day + RAID_COOLDOWN;
  }

  daysLeft(idx: number) {
    const day = this.profile.land.raids[PORTS[idx].id] ?? -99;
    return Math.max(1, day + RAID_COOLDOWN - this.profile.day);
  }

  canRaid(idx: number) {
    return !!RAID_PORTS[PORTS[idx].id] && !this.cooling(idx) && this.phase === 'none';
  }

  /** The raid's garrison site for a port. */
  siteOf(idx: number) {
    return SITES.find((s) => s.raid && s.port === PORTS[idx].id) ?? null;
  }

  aliveBatteries(idx = this.port) {
    return this.batteries.filter((b) => b.port === idx && b.alive);
  }

  /** On land in the town you're raiding. */
  get landedHere() {
    return this.phase === 'landing' && this.game.inTown && this.game.townIdx === this.port;
  }

  /** Is the garrison of this port out in force? (Combat spawns the treasury guards.) */
  landed(portId: string) {
    return this.phase === 'landing' && PORTS[this.port]?.id === portId && this.game.townIdx === this.port && this.game.onLand;
  }

  start(idx: number) {
    if (!this.canRaid(idx)) return;
    const g = this.game;
    const port = PORTS[idx];
    this.port = idx;
    this.phase = 'bombard';
    for (const b of this.aliveBatteries(idx)) b.reload = rand(1.5, 3.5);
    g.wanted.addHeat(port.lawful ? 1.4 : 0.9, port.berth, true);
    g.ui.place(`RAID ON ${port.name.toUpperCase()}!`, 'Silence the shore batteries, then land your raiding party');
    g.ui.toast('💣 Battle stations!', `${this.aliveBatteries(idx).length} shore batteries guard the harbour. Pound them with cannon fire.`, 'danger');
    audio.play('alarm', { volume: 0.6 });
    audio.play('bell', { pos: port.berth, volume: 0.6 });
  }

  /** All batteries down: the harbour is open to a landing. */
  private batteriesDown() {
    const g = this.game;
    this.phase = 'landing';
    const port = PORTS[this.port];
    g.ui.place('DEFENCES DOWN!', `Dock at ${port.name} and storm the treasury`);
    g.ui.toast('⚓ The harbour is open!', 'Sail to the berth and press <b>E</b> to land your raiding party.', 'mission');
    audio.play('fanfare');
  }

  /** The treasury chest was cracked open. */
  onLooted(gold: number) {
    const g = this.game;
    const port = PORTS[this.port];
    this.phase = 'looted';
    this.profile.land.raids[port.id] = this.profile.day;
    this.profile.land.raided++;
    g.landObjective = null;
    g.wanted.heat = Math.max(g.wanted.heat, port.lawful ? 3.3 : 2.3);
    g.wanted.lastCrime = g.time;
    g.after(4.5, () => g.ui.toast('🏴‍☠️ Get out of here!', `${port.name} is sending for the navy. Back to your ship and run! (+${fmtMoney(gold)})`, 'danger'));
    saveProfile(this.profile);
  }

  /** Sailed away: the raid is over (or called off). */
  private end() {
    const was = this.port;
    if (this.phase === 'bombard' || this.phase === 'landing') {
      // called off: the garrison patches up its guns
      for (const b of this.batteries) if (b.port === was) this.repair(b);
      this.game.ui.toast('🏳️ Raid called off', `${PORTS[was].name} will rebuild its defences.`, 'info');
    }
    this.port = -1;
    this.phase = 'none';
  }

  private wreck(b: Battery, quiet = false) {
    b.alive = false;
    b.hp = 0;
    b.barrel.rotation.set(0.55, 0.4, 0);
    b.barrel.position.y = 1.6;
    b.group.scale.set(1, 0.72, 1);
    if (quiet) return;
    const g = this.game;
    const at = b.pos.clone().setY(b.pos.y + 2);
    g.particles.explosion(at, 1.6);
    g.particles.debris_(at, 14, '#857a6e');
    audio.play('impact', { pos: at, pitch: 0.55, volume: 1 });
    audio.play('thud', { pos: at, delay: 0.2 });
    g.camRig.addShake(0.3);
    const left = this.aliveBatteries(b.port).length;
    g.ui.comicText(at.setY(at.y + 2), left ? `BATTERY DOWN! ${left} LEFT` : 'LAST BATTERY DOWN!', 'good');
    g.addXp(60);
    if (!left && this.phase === 'bombard' && b.port === this.port) this.batteriesDown();
  }

  private repair(b: Battery) {
    b.alive = true;
    b.hp = b.maxHp;
    b.barrel.rotation.set(0, 0, 0);
    b.barrel.position.y = 2.15;
    b.group.scale.set(1, 1, 1);
  }

  /** A player cannonball at `p`: does it hit a battery? (Shooting one starts a raid.) */
  hitTest(p: THREE.Vector3, dmg: number) {
    for (const b of this.batteries) {
      if (!b.alive) continue;
      const dx = p.x - b.pos.x;
      const dz = p.z - b.pos.z;
      const dy = p.y - (b.pos.y + 1.4);
      if (dx * dx + dz * dz > 3.4 * 3.4 || Math.abs(dy) > 2.6) continue;
      const g = this.game;
      if (this.phase === 'none' && this.canRaid(b.port)) this.start(b.port);
      if (this.port !== b.port) {
        // a port you're not raiding (cooling down): the shot just bounces off
        g.particles.dust(p.clone(), 0.8);
        return true;
      }
      b.hp -= dmg;
      g.particles.explosion(p.clone(), 0.8, '#9a8a7a');
      g.particles.debris_(p.clone(), 5, '#a59a8c');
      audio.play('impact', { pos: p, pitch: 0.7 });
      g.ui.damageNumber(p, Math.round(dmg), 'enemy');
      if (b.hp <= 0) this.wreck(b);
      return true;
    }
    return false;
  }

  /** Nearest live battery worth aiming at (the player's cannons lock on to it). */
  siegeTarget(from: THREE.Vector3) {
    if (this.phase !== 'bombard') return null;
    let best: Battery | null = null;
    let bd = RANGE * 1.3;
    for (const b of this.aliveBatteries()) {
      const d = Math.hypot(b.pos.x - from.x, b.pos.z - from.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best ? { pos: best.pos.clone().setY(best.pos.y + 1.4), dist: bd } : null;
  }

  /** Labels over the batteries while you're attacking them. */
  markers() {
    if (this.phase !== 'bombard') return [];
    return this.aliveBatteries().map((b, i) => ({ key: 'bat' + i + b.pos.x, pos: b.pos.clone().setY(b.pos.y + 6), hp: b.hp / b.maxHp }));
  }

  update(dt: number) {
    const g = this.game;
    // ruined batteries smoke; rebuilt ones come back once the port's grudge has cooled
    for (const b of this.batteries) {
      if (b.alive) continue;
      if (b.port !== this.port && !this.cooling(b.port)) {
        this.repair(b);
        continue;
      }
      b.smokeT -= dt;
      if (b.smokeT <= 0 && b.pos.distanceTo(g.camRig.camera.position) < 400) {
        b.smokeT = 0.3;
        g.particles.smoke(b.pos.clone().setY(b.pos.y + 2), 0.4, 1.6);
      }
    }
    if (this.phase === 'none') return;
    const port = PORTS[this.port];
    const p = g.player;
    const focus = g.onLand ? g.walker.pos : p.pos;
    if (g.state === 'playing' && Math.hypot(focus.x - port.berth.x, focus.z - port.berth.z) > ABANDON_DIST) {
      this.end();
      return;
    }
    if (this.phase !== 'bombard' || g.state !== 'playing' || !p.alive) return;
    // the batteries fire on you
    const tier = RAID_PORTS[port.id].tier;
    for (const b of this.aliveBatteries()) {
      const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
      const want = headingTo(p.pos.x - b.pos.x, p.pos.z - b.pos.z) - b.baseYaw;
      b.barrel.rotation.y = dampAngle(b.barrel.rotation.y, clamp(want, -1.4, 1.4), 3, dt);
      b.reload -= dt;
      if (b.reload > 0 || d > RANGE || g.playerProtected) continue;
      b.reload = rand(4.2, 5.6) - tier * 0.2;
      this.fire(b, tier);
    }
  }

  private fire(b: Battery, tier: number) {
    const g = this.game;
    const p = g.player;
    b.barrel.updateWorldMatrix(true, false);
    const muzzle = b.barrel.localToWorld(_v.set(0, 0, 2.2)).clone();
    const d = muzzle.distanceTo(p.pos);
    const Tt = d / 70;
    const aim = p.pos.clone().addScaledVector(p.velocity, Tt * rand(0.7, 1.1));
    aim.x += rand(-2.5, 2.5);
    aim.z += rand(-2.5, 2.5);
    aim.y = 0.8;
    const flat = aim.clone().sub(muzzle).setY(0);
    const vel = flat.divideScalar(Tt);
    vel.y = (aim.y - muzzle.y + 0.5 * 28 * Tt * Tt) / Tt;
    g.projectiles.fire(muzzle, vel, this.gunner, Math.round(7 * (1 + 0.2 * (tier - 1))));
    g.particles.muzzle(muzzle, vel.clone().setY(0).normalize(), 0.9);
    audio.play('cannonFar', { pos: muzzle });
    g.wanted.gunfire();
    g.camRig.combatPulse();
  }
}
