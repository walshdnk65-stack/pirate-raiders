import * as THREE from 'three';
import type { Game } from '../game/Game';
import { Ship } from './Ship';
import { buildShip, CannonSide } from '../models/ShipModel';
import { npcDesign } from '../models/ShipDesigns';
import { Character } from '../models/Character';
import { SHIP_TYPES, ShipType, ShipTypeId, CargoId, shipName } from '../game/Data';
import { audio } from '../core/Audio';
import { clamp, angleDiff, rand, randInt, chance, headingTo, wrapAngle } from '../core/math';
import { landSDFFast, ROUTES, PORTS, ZONES } from '../world/WorldData';
import { DETECTION } from '../game/Wanted';
import type { FlagKind } from '../models/Flags';

export type AIState = 'sail' | 'flee' | 'fight' | 'disabled' | 'captured' | 'patrol' | 'chase' | 'attack' | 'leave';

const _toP = new THREE.Vector3();
const _off = new THREE.Vector3();

export class AIShip extends Ship {
  type: ShipType;
  state: AIState;
  route: THREE.Vector3[] = [];
  wp = 0;
  dir = 1;
  stateT = 0;
  thinkT = 0;
  alerted = false;
  calledHelp = false;
  disabled = false;
  captured = false;
  boarded = false;
  cargo: { id: CargoId; qty: number }[] = [];
  coffers: number;
  crewCount: number;
  zigzag = Math.random() * 10;
  patrolCenter = new THREE.Vector3();
  alertIcon = 0;
  private fleeBurst = 0;
  private lostT = 0;
  private sideBias = Math.random() < 0.5 ? 1 : -1;
  private prizeT = 0;
  baseFlag: FlagKind = 'merchantA';
  /** rival pirates spawned for a contract */
  contractId: string | null = null;
  rivalName = '';
  slowT = 0;
  burnT = 0;
  /** how long a navy patrol has had a wanted player in sight */
  private spotT = 0;
  private burnTick = 0;

  constructor(game: Game, typeId: ShipTypeId) {
    const type = SHIP_TYPES[typeId];
    super(game, buildShip(npcDesign(type.design)), type.team);
    this.type = type;
    this.name = shipName(type.team);
    this.typeLabel = type.label;
    const lvlK = 1 + (game.profile.level - 1) * 0.08;
    this.maxHp = this.hp = Math.round(type.hp * lvlK);
    this.maxSpeed = type.speed;
    this.turnRate = type.turn;
    this.accel = 4 + type.speed * 0.12;
    this.damage = type.damage * (1 + (game.profile.level - 1) * 0.06);
    this.reloadTime = type.reload;
    this.range = type.range;
    this.coffers = Math.round(rand(type.coffers[0], type.coffers[1]) * lvlK);
    this.crewCount = type.crew + Math.floor((game.profile.level - 1) * type.crew * 0.1);
    for (const c of type.cargo) this.cargo.push({ id: c.id, qty: randInt(c.min, c.max) });
    this.state = type.team === 'navy' ? 'patrol' : 'sail';
    this.baseFlag = npcDesign(type.design).flag;
    this.flagKind = this.baseFlag;
    this.setupCrew();
  }

  get cargoValue() {
    return this.cargo.reduce((s, c) => s + c.qty * (this.game.cargoPrice(c.id) ?? 0), 0);
  }

  private setupCrew() {
    const navy = this.type.team === 'navy';
    const rival = this.type.id === 'rivalPirate';
    this.captain = new Character(navy ? (this.type.id === 'navyCutter' ? 'navy' : 'navyCaptain') : rival ? 'pirateB' : 'merchant');
    this.captain.root.position.copy(this.model.captainPos);
    this.model.group.add(this.captain.root);
    this.captain.play('steer');
    this.captain.express(navy ? 'determined' : 'neutral');
    const n = Math.min(this.model.crewSpots.length, navy ? 3 : this.type.id === 'smallMerchant' ? 1 : 2);
    for (let i = 0; i < n; i++) {
      const spot = this.model.crewSpots[i];
      const c = new Character(navy ? 'navy' : rival ? (i % 2 ? 'pirateC' : 'pirateA') : 'sailor', !navy && !rival && i === 0 ? 'mop' : rival ? 'cutlass' : 'none');
      this.addCrew(c, spot, rand(-3, 3));
      c.play(i === 0 && !navy ? 'idle' : 'idle');
    }
  }

  /** Put on a shipping lane, starting at waypoint index. */
  setRoute(routeIdx: number, wpIdx: number, dir: 1 | -1) {
    this.route = ROUTES[routeIdx];
    this.dir = dir;
    this.wp = wpIdx;
  }

  get playerDist() {
    return this.pos.distanceTo(this.game.player.pos);
  }

  // -----------------------------------------------------------------------
  get isRival() {
    return this.type.id === 'rivalPirate';
  }

  update(dt: number) {
    if (!this.sinking) {
      this.think(dt);
      // chain shot shreds sails, fire shot burns
      if (this.slowT > 0) {
        this.slowT -= dt;
        this.throttle *= 0.4;
        this.boostMul = 1;
      }
      if (this.burnT > 0) {
        this.burnT -= dt;
        this.burnTick -= dt;
        if (this.burnTick <= 0) {
          this.burnTick = 0.5;
          const p = this.body.localToWorld(new THREE.Vector3((Math.random() - 0.5) * this.model.beam * 0.6, this.model.deckYAt(0) + 0.4, (Math.random() - 0.5) * this.model.length * 0.6));
          this.game.particles.fire(p, 1.1);
          if (this.hp > this.maxHp * 0.31 || this.type.team === 'navy' || this.disabled) this.applyDamage(2, p, this.game.player, false);
        }
      }
    }
    super.update(dt);
    this.alertIcon = Math.max(0, this.alertIcon - dt);
  }

  private think(dt: number) {
    this.stateT += dt;
    const player = this.game.player;
    const toP = _toP.subVectors(player.pos, this.pos);
    const dist = toP.length();
    const angP = Math.atan2(toP.x, toP.z);
    const wanted = this.game.wanted.level;
    const playerHostile = player.alive && !this.game.inPort;
    if (this.isRival && !this.disabled && !this.captured) {
      this.rivalThink(dist, angP, playerHostile);
      return;
    }

    switch (this.state) {
      // ---------------- merchants ----------------
      case 'sail': {
        const wpPos = this.route[this.wp] ?? this.pos;
        if (this.pos.distanceTo(wpPos) < 30) this.advanceWaypoint();
        this.steerAvoid(headingTo(wpPos.x - this.pos.x, wpPos.z - this.pos.z));
        this.throttle = 0.62;
        // detection
        const recentlyFired = this.game.time - player.lastFireTime < 6 && dist < this.type.detect * 1.4;
        const suspicious = (wanted > 0 && dist < this.type.detect) || recentlyFired || (dist < this.type.detect * 0.45 && Math.abs(player.speed) > 8);
        if (playerHostile && suspicious) this.alert();
        break;
      }
      case 'flee': {
        // run away from the player, zig-zagging, occasionally sprint
        this.zigzag += dt;
        const away = wrapAngle(angP + Math.PI + Math.sin(this.zigzag * 0.8) * 0.35);
        this.steerAvoid(away);
        this.fleeBurst -= dt;
        if (this.fleeBurst <= 0 && chance(dt * 0.15)) this.fleeBurst = 3;
        this.throttle = 1;
        this.boostMul = this.fleeBurst > 0 ? 1.15 : 1;
        // armed merchants fire their stern chaser
        if (this.type.armed && dist < this.range && Math.abs(angleDiff(this.heading + Math.PI, angP)) < 0.5) this.tryFire('B', player);
        // armed + brave: turn and fight
        if (this.type.armed && this.stateT > 6 && chance(dt * this.type.aggression * 0.25) && this.hp > this.maxHp * 0.5) this.setState('fight');
        if (dist > this.type.detect * 2.6) {
          this.lostT += dt;
          if (this.lostT > 6) this.calmDown();
        } else this.lostT = 0;
        break;
      }
      case 'fight': {
        this.broadsideManoeuvre(dt, dist, angP);
        if (this.hp < this.maxHp * 0.45 && this.type.team === 'merchant') this.setState('flee');
        if (dist > this.type.detect * 2.2) this.calmDown();
        break;
      }
      case 'disabled': {
        this.throttle = 0;
        this.steer = 0;
        this.boostMul = 1;
        // left alone long enough, the crew patches her up and limps away
        if (this.stateT > 80 && dist > 260 && !this.boarded) this.recover();
        break;
      }
      case 'captured': {
        // prize crew sails her home to Skull Cove
        this.prizeT += dt;
        const home = PORTS[0].exit;
        this.steerAvoid(headingTo(home.x - this.pos.x, home.z - this.pos.z));
        this.throttle = this.prizeT > 2.5 ? 0.45 : 0;
        if ((this.prizeT > 25 && dist > 160) || this.pos.distanceTo(home) < 40) {
          this.removeMe = true;
        }
        break;
      }
      // ---------------- navy ----------------
      case 'patrol': {
        // circle the patrol centre
        const c = this.patrolCenter;
        const off = _off.subVectors(this.pos, c);
        const r = off.length();
        const tang = Math.atan2(off.x, off.z) + Math.PI / 2 * this.sideBias;
        const radial = r > 140 ? Math.atan2(-off.x, -off.z) : tang;
        this.steerAvoid(r > 140 ? radial : wrapAngle(tang + (r < 90 ? 0.4 * this.sideBias : 0)));
        this.throttle = 0.5;
        if (this.spotted(dt, wanted > 0 && playerHostile && dist < this.type.detect)) this.setState('chase');
        break;
      }
      case 'chase': {
        const T = dist / Math.max(8, this.maxSpeed);
        const pred = player.pos.clone().addScaledVector(player.velocity, T * 0.6);
        this.steerAvoid(headingTo(pred.x - this.pos.x, pred.z - this.pos.z));
        this.throttle = 1;
        this.boostMul = this.game.wanted.level >= 3 ? 1.2 : 1;
        if (dist < this.range * 1.05) this.setState('attack');
        if (wanted === 0 || !playerHostile) this.setState('leave');
        break;
      }
      case 'attack': {
        if (this.type.id === 'navyCutter') {
          // point the bow chasers at the player, keep some distance
          const want = dist < 22 ? wrapAngle(angP + Math.PI / 2 * this.sideBias) : angP;
          this.steerAvoid(want);
          this.throttle = dist < 30 ? 0.5 : 1;
          this.boostMul = this.game.wanted.level >= 3 ? 1.2 : 1;
          if (Math.abs(angleDiff(this.heading, angP)) < 0.3 && dist < this.range) this.tryFire('F', player);
          for (const s of ['L', 'R'] as CannonSide[]) this.tryBroadside(s, player, dist, angP);
        } else this.broadsideManoeuvre(dt, dist, angP);
        if (dist > this.range * 1.6) this.setState('chase');
        if (wanted === 0 || !playerHostile) this.setState('leave');
        break;
      }
      case 'leave': {
        this.steerAvoid(wrapAngle(angP + Math.PI));
        this.throttle = 0.8;
        this.boostMul = 1;
        if (this.spotted(dt, wanted > 0 && playerHostile && dist < this.type.detect)) this.setState('chase');
        if (dist > 380) this.removeMe = true;
        break;
      }
    }
  }

  /** Patrols need to keep you in sight for a few seconds before they give chase. */
  private spotted(dt: number, inSight: boolean) {
    this.spotT = inSight ? this.spotT + dt : Math.max(0, this.spotT - dt * 0.5);
    if (inSight && this.spotT > 1) this.alertIcon = Math.max(this.alertIcon, 0.3);
    if (this.spotT < DETECTION.patrolSpot) return false;
    this.spotT = 0;
    return true;
  }

  /** Rival pirates prowl their waters and pick a fight with you on sight. */
  private rivalThink(dist: number, angP: number, hostile: boolean) {
    if (hostile && dist < 380) {
      if (!this.alerted) {
        this.alerted = true;
        this.alertIcon = 2.5;
        this.captain?.express('angry');
        this.crewDo((c) => c.play('load'));
        audio.playVoice('arr', this.pos, 0.8);
        this.game.ui.toast(`🏴‍☠️ ${this.rivalName} attacks!`, 'Damage the rival brig until she strikes her colours, then board her!', 'danger');
      }
      this.state = 'fight';
      this.broadsideManoeuvre(0, dist, angP);
      return;
    }
    // circle the hunting ground
    this.state = 'sail';
    const c = this.patrolCenter;
    const off = _off.subVectors(this.pos, c);
    const r = off.length();
    const tang = Math.atan2(off.x, off.z) + Math.PI / 2;
    this.steerAvoid(r > 120 ? Math.atan2(-off.x, -off.z) : wrapAngle(tang + (r < 70 ? 0.4 : 0)));
    this.throttle = 0.55;
  }

  private broadsideManoeuvre(dt: number, dist: number, angP: number) {
    const player = this.game.player;
    // choose the broadside closest to current heading
    const a1 = wrapAngle(angP + Math.PI / 2);
    const a2 = wrapAngle(angP - Math.PI / 2);
    let want = Math.abs(angleDiff(this.heading, a1)) < Math.abs(angleDiff(this.heading, a2)) ? a1 : a2;
    if (dist > this.range * 0.85) want = angP;
    else if (dist < 24) want = wrapAngle(angP + Math.PI);
    this.steerAvoid(want);
    this.throttle = dist > this.range ? 1 : 0.6;
    this.boostMul = 1;
    for (const s of ['L', 'R'] as CannonSide[]) this.tryBroadside(s, player, dist, angP);
    if (Math.abs(angleDiff(this.heading + Math.PI, angP)) < 0.5) this.tryFire('B', player);
    void dt;
  }

  private tryBroadside(side: CannonSide, player: Ship, dist: number, angP: number) {
    const sideAng = this.heading + (side === 'L' ? Math.PI / 2 : -Math.PI / 2);
    if (Math.abs(angleDiff(sideAng, angP)) < 0.45 && dist < this.range) this.tryFire(side, player);
  }

  private tryFire(side: CannonSide, target: Ship) {
    if (!this.canFire(side) || this.disabled) return;
    // hold fire while the player is boarding or docked in port
    const atPlayer = target === this.game.player;
    if (atPlayer && this.game.playerProtected) return;
    const d = this.pos.distanceTo(target.pos);
    const T = d / 72;
    const aim = target.pos.clone().addScaledVector(target.velocity, T * rand(0.7, 1.1));
    aim.y = 0.8;
    // navy/merchant gunners are a bit less accurate than you
    if (this.fire(side, aim, 2.4 + (this.type.team === 'merchant' ? 1.5 : 0))) {
      if (atPlayer) this.game.wanted.gunfire();
      this.captain?.trigger('fire', 0.6);
      this.game.camRig.combatPulse();
    }
  }

  /** Steering with island and ship avoidance. */
  steerAvoid(desired: number) {
    const look = 22 + Math.abs(this.speed) * 2.2;
    const margin = this.model.beam + 10;
    const probe = (a: number, d = look) => landSDFFast(this.pos.x + Math.sin(a) * d, this.pos.z + Math.cos(a) * d);
    let h = desired;
    const ahead = probe(this.heading);
    const dAhead = probe(desired);
    if (ahead < margin || dAhead < margin) {
      const l = Math.min(probe(this.heading + 0.6), probe(this.heading + 1.1, look * 0.7));
      const r = Math.min(probe(this.heading - 0.6), probe(this.heading - 1.1, look * 0.7));
      h = this.heading + (l > r ? 1.0 : -1.0);
      if (ahead < margin * 0.4) this.throttle = Math.min(this.throttle, 0.35);
    }
    // separation from other ships
    for (const o of this.game.ships) {
      if (o === this || o.sinking) continue;
      const dx = o.pos.x - this.pos.x;
      const dz = o.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const minD = this.collideRadius + o.collideRadius + 8;
      if (d < minD && d > 0.01) {
        const ang = angleDiff(this.heading, Math.atan2(dx, dz));
        if (Math.abs(ang) < 1.2) h += (ang > 0 ? -0.5 : 0.5) * (1 - d / minD);
      }
    }
    this.steerTo(h);
  }

  private advanceWaypoint() {
    this.wp += this.dir;
    if (this.wp >= this.route.length || this.wp < 0) {
      // reached the end of the lane: turn around (or despawn if out of sight)
      if (this.playerDist > 280) {
        this.removeMe = true;
        return;
      }
      this.dir = (this.dir * -1) as 1 | -1;
      this.wp = clamp(this.wp + this.dir * 2, 0, this.route.length - 1);
    }
  }

  private nearestWaypoint() {
    let best = 0;
    let bd = 1e9;
    this.route.forEach((p, i) => {
      const d = p.distanceTo(this.pos);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  setState(s: AIState) {
    if (this.state === s) return;
    if (this.disabled && s !== 'captured' && s !== 'disabled') return;
    this.state = s;
    this.stateT = 0;
    switch (s) {
      case 'flee':
        this.captain?.express('surprised', 2);
        this.crewDo((c) => c.play('panic'));
        break;
      case 'fight':
      case 'attack':
        this.captain?.express('angry');
        this.crewDo((c) => c.play('load'));
        break;
      case 'chase':
        this.captain?.express('angry');
        this.crewDo((c) => c.play('point'));
        this.alertIcon = 2.5;
        break;
      case 'sail':
      case 'patrol':
        this.captain?.express('neutral');
        this.crewDo((c) => c.play('idle'));
        break;
    }
  }

  alert() {
    if (this.alerted) return;
    this.alerted = true;
    this.alertIcon = 2.5;
    audio.playVoice('hey', this.pos, 1.2);
    if (this.type.armed && chance(this.type.aggression)) this.setState('fight');
    else this.setState('flee');
  }

  private calmDown() {
    this.alerted = false;
    this.lostT = 0;
    if (this.type.team === 'navy') this.setState('patrol');
    else {
      this.wp = this.nearestWaypoint();
      this.setState('sail');
    }
  }

  protected onDamaged(_dmg: number, from: Ship | null) {
    if (from?.team === 'player') {
      if (this.isRival) {
        if (!this.disabled && this.hp > 0 && this.hp <= this.maxHp * 0.3) this.disable();
        return;
      }
      if (this.type.team === 'merchant') {
        this.game.wanted.addHeat(0.06, this.pos);
        if (!this.alerted) this.alert();
        else if (this.state === 'sail') this.setState('flee');
        // call for help
        if (!this.calledHelp && this.hp < this.maxHp * 0.75) {
          this.calledHelp = true;
          if (chance(this.type.helpChance)) this.game.wanted.callForHelp(this);
        }
        // disabled: white flag
        if (!this.disabled && this.hp > 0 && this.hp <= this.maxHp * 0.3) this.disable();
      } else {
        this.game.wanted.addHeat(0.05, this.pos, true);
        if (this.state === 'patrol' || this.state === 'leave') this.setState('chase');
      }
    }
  }

  disable() {
    this.disabled = true;
    this.state = 'disabled';
    this.stateT = 0;
    this.model.sailUniforms.uFurl.value = 0.6;
    this.setFlag('white');
    this.captain?.play('panic');
    this.captain?.express('sad');
    this.crewDo((c) => {
      c.play('defeat');
      c.express('sad');
    });
    audio.playVoice('oof', this.pos, 1.2);
    this.game.onShipDisabled(this);
  }

  private recover() {
    this.disabled = false;
    this.hp = Math.max(this.hp, this.maxHp * 0.5);
    this.setFlag(this.baseFlag);
    this.model.sailUniforms.uFurl.value = 0;
    this.alerted = false;
    this.calledHelp = false;
    this.state = 'sail';
    this.wp = this.nearestWaypoint();
    this.captain?.play('steer');
    this.crewDo((c) => c.play('idle'));
  }

  /** After a successful boarding. */
  markCaptured() {
    this.captured = true;
    this.state = 'captured';
    this.prizeT = 0;
    this.setFlag(this.game.player.flagKind);
    this.model.sailUniforms.uFurl.value = 0;
    this.cargo = [];
    this.coffers = 0;
    // swap crew for a jolly prize crew
    for (const c of this.crew) c.dispose();
    this.crew = [];
    this.captain?.dispose();
    this.captain = new Character('pirateA');
    this.captain.root.position.copy(this.model.captainPos);
    this.model.group.add(this.captain.root);
    this.captain.play('steer');
    this.captain.express('happy');
    const c = new Character('pirateC');
    this.addCrew(c, this.model.crewSpots[0], 0);
    c.play('cheer');
    this.hp = Math.max(this.hp, this.maxHp * 0.35);
  }

  /** Place a patrol ship in a zone. */
  static patrolZone() {
    return ZONES.filter((z) => z.kind === 'patrol');
  }
}
