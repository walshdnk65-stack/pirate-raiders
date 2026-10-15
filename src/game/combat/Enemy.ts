import * as THREE from 'three';
import type { AnimState } from '../../models/Character';
import { angleDiff, clamp, dampAngle, headingTo, lerp, rand, choose } from '../../core/math';
import type { LandArea } from '../../world/LandArea';
import type { CircleCol } from '../../world/TownTypes';
import { Fighter } from './Fighter';
import { ENEMIES, tierScale, type EnemyId, type EnemyType, type BossMove } from './EnemyTypes';
import { makeWeapon, weaponStats } from './Weapons';
import { meleeStep, rollAction, type MeleeOpts } from './Moves';
import { Navigator } from './Nav';
import { difficultyMul } from '../Settings';

/** What the AI needs from the combat system. */
export interface CombatCtx {
  time: number;
  area: LandArea;
  player: Fighter;
  enemies: Enemy[];
  allies: Ally[];
  extraCols: CircleCol[];
  /** may this enemy take a melee attack slot? */
  wantToken(e: Enemy): boolean;
  /** may this enemy start a strike right now (attacks are spaced out)? */
  canStrike(e: Enemy): boolean;
  /** may this enemy start aiming a shot? */
  wantShot(e: Enemy): boolean;
  fireGun(f: Fighter, dir: THREE.Vector3, dmg: number, spread: number, pellets: number, speed: number): void;
  /** the group around this enemy hears the alarm */
  alert(e: Enemy): void;
  telegraph(f: Fighter, heavy: boolean): void;
  summon(e: Enemy, ids: EnemyId[]): void;
  bossPhase(e: Enemy, phase: number): void;
  los(a: THREE.Vector3, b: THREE.Vector3): boolean;
}

export type AIState = 'idle' | 'patrol' | 'notice' | 'chase' | 'attack' | 'defend' | 'reposition' | 'retreat' | 'ambush' | 'return' | 'dead';

const _d = new THREE.Vector3();
const _g = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Steering on foot over a LandArea: obstacle probing, separation, ground following. */
export function stepMove(f: Fighter, vel: THREE.Vector3, want: THREE.Vector3, accel: number, dt: number, ctx: CombatCtx, others: Fighter[]) {
  const area = ctx.area;
  // separation from other fighters (no stacking)
  for (const o of others) {
    if (o === f || o.dead) continue;
    const dx = f.pos.x - o.pos.x;
    const dz = f.pos.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    const min = f.radius + o.radius + 0.55;
    if (d < min && d > 1e-4) {
      const k = ((min - d) / min) * 4;
      want.x += (dx / d) * k;
      want.z += (dz / d) * k;
    }
  }
  // obstacle probe: steer around trunks, crates and walls
  const sp = Math.hypot(want.x, want.z);
  if (sp > 0.2) {
    const look = 0.9 + sp * 0.15;
    const ux = want.x / sp;
    const uz = want.z / sp;
    if (area.blocked(f.pos.x + ux * look, f.pos.z + uz * look, f.radius * 0.9) || area.surface(f.pos.x + ux * look, f.pos.z + uz * look, f.pos.y, 0.7) === null) {
      for (const a of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const rx = ux * c + uz * s;
        const rz = -ux * s + uz * c;
        if (!area.blocked(f.pos.x + rx * look, f.pos.z + rz * look, f.radius * 0.9) && area.surface(f.pos.x + rx * look, f.pos.z + rz * look, f.pos.y, 0.7) !== null) {
          want.x = rx * sp;
          want.z = rz * sp;
          break;
        }
      }
    }
  }
  const k = clamp(accel * dt, 0, 1);
  vel.x = lerp(vel.x, want.x, k);
  vel.z = lerp(vel.z, want.z, k);
  const mx = (vel.x + f.push.x) * dt;
  const mz = (vel.z + f.push.z) * dt;
  const ox = f.pos.x;
  const oz = f.pos.z;
  const ok = (x: number, z: number) => area.surface(x, z, f.pos.y, 0.7) !== null;
  if (ok(ox + mx, oz + mz)) {
    f.pos.x += mx;
    f.pos.z += mz;
  } else if (ok(ox + mx, oz)) f.pos.x += mx;
  else if (ok(ox, oz + mz)) f.pos.z += mz;
  area.resolve(f.pos, f.radius, ctx.extraCols);
  const y = area.surface(f.pos.x, f.pos.z, f.pos.y, 0.7);
  if (y === null) {
    f.pos.x = ox;
    f.pos.z = oz;
  } else f.pos.y = lerp(f.pos.y, y, clamp(dt * 16, 0, 1));
  return Math.hypot(vel.x + f.push.x, vel.z + f.push.z);
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export class Enemy {
  f: Fighter;
  type: EnemyType;
  tier: number;
  state: AIState = 'idle';
  stateT = 0;
  home: THREE.Vector3;
  homeFacing = 0;
  restAnim: AnimState = 'guard';
  route: THREE.Vector3[] = [];
  routeIdx = 0;
  target: Fighter | null = null;
  token = false;
  /** where to circle while waiting for an attack slot (angle around the target) */
  slot = rand(0, Math.PI * 2);
  /** encounter this foe belongs to */
  siteId = '';
  vel = new THREE.Vector3();
  private think = 0;
  private comboLeft = 0;
  private comboStep = 0;
  private cooldown = rand(0.3, 1);
  private strafe = Math.random() < 0.5 ? 1 : -1;
  private aimT = 0;
  private holdT = 0;
  private reloadT = 0;
  private wantCounter = false;
  private defendCD = 0;
  /** the captain's swing we've already reacted to */
  private seenSwing: object | null = null;
  // bosses
  phase = 1;
  private moveIdx = 0;
  private summoned = new Set<number>();
  private volleyLeft = 0;
  private volleyT = 0;
  enraged = false;
  /** lies in wait (ambush) until triggered */
  hidden = false;
  /** first time this foe spotted the captain */
  noticedAt = -1;
  /** finds a way round boulders, tents and walls */
  nav = new Navigator();
  private _go = new THREE.Vector3();

  /** Walk toward a point, routing round obstacles when the straight line is blocked. */
  private goToward(ctx: CombatCtx, goal: THREE.Vector3, speed: number, dt: number, want: THREE.Vector3) {
    return want.copy(this.nav.steer(ctx.area, this.f.pos, goal, dt, this._go)).multiplyScalar(speed);
  }

  constructor(id: EnemyId, tier: number, pos: THREE.Vector3, facing: number) {
    const t = ENEMIES[id];
    this.type = t;
    this.tier = tier;
    const sc = tierScale(tier);
    const f = new Fighter('enemy', choose(t.specs), t.name);
    this.f = f;
    f.maxHp = f.hp = Math.round(t.hp * sc.hp * difficultyMul().foeHp);
    f.maxPoise = f.poise = t.poise * (t.kind === 'boss' ? 1 + (tier - 1) * 0.2 : 1);
    f.kbResist = t.kbResist;
    f.radius = t.radius;
    f.height = 1.95 * (f.c.spec.height ?? 1);
    f.dmgMul = sc.dmg;
    f.maxStamina = f.stamina = 999;
    f.setWeapons(weaponStats(makeWeapon(t.weapon)), t.gun ? weaponStats(makeWeapon(t.gun)) : null);
    f.loaded = f.gun ? f.gun.mag : 0;
    f.pos.copy(pos);
    f.heading = facing;
    f.c.root.rotation.y = facing;
    this.home = pos.clone();
    this.homeFacing = facing;
    f.setDrawn(true);
    if (t.gun && t.kind === 'gunner') f.useGun = true;
    f.refreshProp();
    f.c.express('angry');
  }

  get kind() {
    return this.type.kind;
  }
  get isBoss() {
    return this.type.kind === 'boss';
  }
  get engaged() {
    return this.state !== 'idle' && this.state !== 'patrol' && this.state !== 'ambush' && this.state !== 'return' && this.state !== 'dead';
  }

  setState(s: AIState) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
  }

  /** Put the foe at rest at its post (sitting by the fire, standing guard…). */
  rest(anim: AnimState) {
    this.restAnim = anim;
    const f = this.f;
    const sitting = anim === 'sit' || anim === 'sitDrink';
    f.setDrawn(!sitting);
    f.c.play(anim, true);
    if (sitting) f.c.express('happy');
  }

  meleeOpts(): MeleeOpts {
    const t = this.type;
    const w = this.f.melee!;
    const enr = this.enraged ? 0.75 : 1;
    return {
      dmg: t.dmg,
      speed: w.base.speed * t.tempo * (this.enraged ? 1.2 : 1),
      reach: t.reach,
      arc: w.arc,
      knockback: w.knockback * (t.kind === 'bruiser' || t.kind === 'boss' ? 1.4 : 1),
      style: w.base.style,
      sound: w.base.sound,
      windup: t.windup * enr * rand(0.9, 1.15),
      armor: t.kind === 'bruiser' || t.kind === 'boss',
    };
  }

  private pickTarget(ctx: CombatCtx) {
    const me = this.f.pos;
    let best: Fighter | null = ctx.player.dead ? null : ctx.player;
    let bd = best ? best.pos.distanceTo(me) : Infinity;
    for (const a of ctx.allies) {
      if (a.f.dead || a.escort) continue;
      const d = a.f.pos.distanceTo(me) + 2.5; // the captain is the favourite target
      if (d < bd) {
        bd = d;
        best = a.f;
      }
    }
    // escorts are juicy targets for ambushers
    for (const a of ctx.allies) if (a.escort && !a.f.dead && a.f.pos.distanceTo(me) + 1 < bd && Math.random() < 0.5) best = a.f;
    return best;
  }

  /** Can this foe see the captain? */
  private spots(ctx: CombatCtx) {
    const p = ctx.player;
    if (p.dead) return false;
    const d = p.pos.distanceTo(this.f.pos);
    if (d > this.type.sight) return false;
    const ang = Math.abs(angleDiff(this.f.heading, headingTo(p.pos.x - this.f.pos.x, p.pos.z - this.f.pos.z)));
    const resting = this.restAnim === 'sit' || this.restAnim === 'sitDrink';
    const cone = resting ? 1.2 : 1.9;
    // close by, in the cone, or making a racket with a drawn sword
    if (d < 4.5 || ang < cone || (p.drawn && d < this.type.sight * 0.6)) return ctx.los(this.f.chest(_n), p.chest());
    return false;
  }

  notice(ctx: CombatCtx) {
    if (this.engaged || this.f.dead) return;
    this.hidden = false;
    this.setState('notice');
    if (this.noticedAt < 0) this.noticedAt = ctx.time;
    this.f.setDrawn(true);
    this.f.c.express('angry');
    this.f.c.play('point', true, 0.15);
    ctx.alert(this);
  }

  update(dt: number, ctx: CombatCtx, near: boolean) {
    const f = this.f;
    if (f.dead) {
      this.state = 'dead';
      this.token = false;
      return 0;
    }
    if (this.hidden) return 0;
    this.stateT += dt;
    this.think -= dt;
    this.cooldown -= dt;
    this.reloadT -= dt;
    // far away and not fighting: think rarely
    if (!near && !this.engaged) {
      if (this.think > 0) return 0;
      this.think = 0.5;
    }
    const want = _d.set(0, 0, 0);
    let face: number | null = null;
    let speed = 0;
    const tgt = this.target;
    const t = this.type;

    switch (this.state) {
      case 'idle':
        if (this.think <= 0) {
          this.think = rand(0.15, 0.25);
          if (this.spots(ctx)) this.notice(ctx);
        }
        // drift back onto the post if pushed
        if (f.pos.distanceTo(this.home) > 0.6) {
          want.subVectors(this.home, f.pos).setY(0).normalize().multiplyScalar(1.6);
          face = headingTo(want.x, want.z);
        } else face = this.homeFacing;
        break;
      case 'patrol': {
        if (this.think <= 0) {
          this.think = rand(0.15, 0.25);
          if (this.spots(ctx)) this.notice(ctx);
        }
        const wp = this.route[this.routeIdx];
        if (wp) {
          if (Math.hypot(wp.x - f.pos.x, wp.z - f.pos.z) < 0.8) this.routeIdx = (this.routeIdx + 1) % this.route.length;
          this.goToward(ctx, wp, 1.7, dt, want);
          face = headingTo(want.x, want.z);
        }
        break;
      }
      case 'notice':
        if (tgt || (this.target = this.pickTarget(ctx))) face = headingTo(this.target!.pos.x - f.pos.x, this.target!.pos.z - f.pos.z);
        if (this.stateT > 0.65) {
          f.c.play(f.drawn ? 'guard' : 'idle', true, 0.15);
          this.setState('chase');
        }
        break;
      case 'return': {
        if (f.pos.distanceTo(this.home) < 0.8) {
          this.setState(this.route.length ? 'patrol' : 'idle');
          f.hp = f.maxHp;
          this.rest(this.restAnim);
        }
        this.goToward(ctx, this.home, t.speed * 0.7, dt, want);
        face = headingTo(want.x, want.z);
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.15 * dt);
        break;
      }
      default:
        this.fight(dt, ctx, want);
        face = this.faceWhileFighting(ctx, want);
    }

    // actions own the body: no walking during swings except lunges
    const a = f.action;
    if (a) {
      want.set(0, 0, 0);
      if ((a.kind === 'attack' || a.kind === 'heavy' || a.kind === 'special') && a.tag !== 'spin' && a.tag !== 'volley') face = null;
      if (a.tag === 'spin' && this.target) {
        want.subVectors(this.target.pos, f.pos).setY(0).normalize().multiplyScalar(2.6);
        f.heading += dt * 13;
      }
    }
    if (a?.kind === 'roll' || a?.kind === 'knockdown' || a?.kind === 'hit') face = null;
    others.length = 0;
    for (const e of ctx.enemies) others.push(e.f);
    for (const al of ctx.allies) others.push(al.f);
    others.push(ctx.player);
    speed = stepMove(f, this.vel, want, 9, dt, ctx, others);
    if (face !== null) f.heading = dampAngle(f.heading, face, a?.tag === 'spin' ? 0 : 9, dt);
    f.c.root.rotation.y = a?.tag === 'spin' ? f.heading : dampAngle(f.c.root.rotation.y, f.heading, 14, dt);
    return speed;
  }

  private faceWhileFighting(ctx: CombatCtx, want: THREE.Vector3) {
    const tg = this.target;
    if (this.state === 'retreat' && !tg) return headingTo(want.x, want.z);
    if (tg) return headingTo(tg.pos.x - this.f.pos.x, tg.pos.z - this.f.pos.z);
    return null;
  }

  /** The fighting brain: chase, take turns attacking, circle, defend, retreat. */
  private fight(dt: number, ctx: CombatCtx, want: THREE.Vector3) {
    const f = this.f;
    const t = this.type;
    if (this.think <= 0) {
      this.think = rand(0.1, 0.18);
      if (!this.target || this.target.dead || Math.random() < 0.08) this.target = this.pickTarget(ctx);
    }
    const tg = this.target;
    if (!tg) {
      this.token = false;
      this.setState('return');
      return;
    }
    const to = _g.subVectors(tg.pos, f.pos).setY(0);
    const dist = to.length();
    const dir = dist > 1e-3 ? to.clone().divideScalar(dist) : to.set(0, 0, 1).clone();
    // leash: too far from home and the captain isn't chasing → go back
    if (f.pos.distanceTo(this.home) > (this.isBoss ? 34 : 46) && dist > 10) {
      this.token = false;
      this.setState('return');
      return;
    }
    this.defendCD -= dt;
    // defend: read each swing the captain starts (one decision per swing)
    const pa = tg === ctx.player ? tg.action : null;
    if (pa && (pa.kind === 'attack' || pa.kind === 'heavy') && pa !== this.seenSwing && dist < 3.8 && this.defendCD <= 0 && !this.isBoss) {
      this.seenSwing = pa;
      const facingMe = Math.abs(angleDiff(tg.heading, headingTo(f.pos.x - tg.pos.x, f.pos.z - tg.pos.z))) < 0.9;
      const heavy = pa.kind === 'heavy' || pa.combo === 3;
      if (facingMe && (f.free || f.inRecovery)) {
        if (heavy && Math.random() < t.dodge) {
          // roll out of the way, sideways and back
          f.heading = headingTo(-dir.x + dir.z * this.strafe, -dir.z - dir.x * this.strafe);
          rollAction(f);
          this.defendCD = 0.8;
          return;
        }
        if (!heavy && f.free && Math.random() < t.block) {
          this.setState('defend');
          this.holdT = rand(0.5, 0.9);
          f.blocking = true;
          f.useGun = false;
          f.refreshProp();
          this.defendCD = 0.6;
          return;
        }
      }
    }
    if (!f.free) return;

    if (this.isBoss) {
      this.bossBrain(dt, ctx, tg, dist, dir, want);
      return;
    }

    switch (this.state) {
      case 'defend':
        f.blocking = true;
        this.holdT -= dt;
        // creep back while guarding
        want.copy(dir).multiplyScalar(-0.8);
        if (this.holdT <= 0 || this.wantCounter) {
          f.blocking = false;
          f.blockCD = 0.2;
          if (this.wantCounter && dist < t.reach + 1.2) {
            this.wantCounter = false;
            this.startCombo(ctx, 2);
          } else this.setState('chase');
        }
        return;
      case 'retreat': {
        want.copy(dir).multiplyScalar(-t.speed * 0.8);
        // sideways a bit so they don't back into a wall forever
        want.x += dir.z * this.strafe * 1.5;
        want.z -= dir.x * this.strafe * 1.5;
        if (this.stateT > (t.kind === 'gunner' ? 1.2 : 2.2) || (t.keep && dist > t.keep[0] + 1)) this.setState('chase');
        return;
      }
      case 'reposition': {
        this.circle(ctx, tg, dist, dir, want, 5.2);
        if (this.stateT > rand(0.9, 1.6)) this.setState('chase');
        return;
      }
    }

    // ---- gunners keep their distance and shoot from behind the melee line ----
    if (t.kind === 'gunner' && f.gun) {
      const [near, far] = t.keep!;
      if (dist < 2.4 && this.cooldown <= 0) {
        // too close: pistol-whip
        f.useGun = false;
        f.refreshProp();
        this.comboLeft = 0;
        this.startCombo(ctx, 1);
        this.cooldown = 1.4;
        return;
      }
      if (!f.useGun && !f.action) {
        f.useGun = true;
        f.refreshProp();
      }
      if (dist < near) {
        this.setState('retreat');
        return;
      }
      if (this.reloadT > 0) {
        this.circle(ctx, tg, dist, dir, want, (near + far) / 2);
        return;
      }
      const clear = ctx.los(f.chest(_n), tg.chest());
      if (dist > far || !clear) {
        // stand behind the melee crowd: approach (round obstacles) with a sidestep
        this.goToward(ctx, tg.pos, t.speed * 0.8, dt, want);
        if (!this.nav.routing) {
          want.x += dir.z * this.strafe * 2;
          want.z -= dir.x * this.strafe * 2;
        }
        return;
      }
      if (this.aimT > 0) {
        this.aimT -= dt;
        f.aiming = true;
        if (this.aimT <= 0) {
          f.aiming = false;
          const inacc = 0.035 + (tg.speed > 3 ? 0.03 : 0);
          const aimDir = _n.subVectors(tg.chest(), f.muzzle(new THREE.Vector3())).normalize();
          ctx.fireGun(f, aimDir, t.gunDmg ?? 12, inacc, 1, 55);
          this.reloadT = rand(2.0, 2.8);
          this.strafe = -this.strafe;
          this.setState('reposition');
        }
        return;
      }
      if (ctx.wantShot(this)) {
        this.aimT = (t.aim ?? 0.9) * rand(0.9, 1.15);
        f.aiming = true;
        ctx.telegraph(f, false);
        return;
      }
      this.circle(ctx, tg, dist, dir, want, (near + far) / 2);
      return;
    }

    // ---- melee: take a turn if a slot is free, otherwise circle and wait ----
    if (t.kind === 'grunt' && f.hp < f.maxHp * 0.2 && this.stateT > 1 && Math.random() < 0.004) {
      this.token = false;
      this.setState('retreat');
      return;
    }
    // bruisers charge from mid range
    if (t.kind === 'bruiser' && dist > 4.5 && dist < 10 && this.cooldown <= 0 && ctx.wantToken(this)) {
      this.token = true;
      this.startRush(ctx, 0.65);
      this.cooldown = rand(4, 6);
      return;
    }
    if (this.token || ctx.wantToken(this)) {
      this.token = true;
      if (dist > t.reach * 0.85) {
        this.goToward(ctx, tg.pos, t.speed, dt, want);
        this.setState('chase');
        return;
      }
      if (this.cooldown <= 0 && ctx.canStrike(this)) {
        this.comboLeft = 1 + Math.floor(Math.random() * t.combo);
        this.startCombo(ctx, 1);
      }
      return;
    }
    this.circle(ctx, tg, dist, dir, want, rand(4.4, 5.6));
  }

  /** Orbit the target at a radius, sidestepping now and then (waiting for an opening). */
  private circle(ctx: CombatCtx, tg: Fighter, dist: number, dir: THREE.Vector3, want: THREE.Vector3, radius: number) {
    const t = this.type;
    // spread round the target in our own slot
    this.slot += this.strafe * 0.35 * (1 / 60);
    const gx = tg.pos.x + Math.sin(this.slot) * radius;
    const gz = tg.pos.z + Math.cos(this.slot) * radius;
    want.set(gx - this.f.pos.x, 0, gz - this.f.pos.z);
    const L = want.length();
    if (L > 0.3) want.multiplyScalar(Math.min(t.speed * 0.6, L * 2) / L);
    else want.set(0, 0, 0);
    // don't get too close while waiting
    if (dist < radius - 1.2) want.addScaledVector(dir, -1.6);
    if (Math.random() < 0.006) this.strafe = -this.strafe;
  }

  /** Square up to the target before a strike. */
  private faceTarget() {
    const tg = this.target;
    if (tg) this.f.heading = headingTo(tg.pos.x - this.f.pos.x, tg.pos.z - this.f.pos.z);
  }

  private startCombo(ctx: CombatCtx, step: number) {
    this.faceTarget();
    const o = this.meleeOpts();
    this.comboStep = step;
    meleeStep(this.f, step, o);
    ctx.telegraph(this.f, !!o.armor && this.type.kind !== 'boss');
    this.setState('attack');
  }

  /** Called when an action finishes. */
  onActionDone(kind: string, ctx: CombatCtx) {
    const f = this.f;
    if (f.dead) return;
    if (kind === 'attack' && this.state === 'attack') {
      this.comboLeft--;
      const tg = this.target;
      if (this.comboLeft > 0 && tg && !tg.dead && tg.pos.distanceTo(f.pos) < this.type.reach + 1.4 && this.comboStep < 3) {
        this.startCombo(ctx, this.comboStep + 1);
        return;
      }
      // done: give someone else a go and back off a little
      this.token = this.isBoss;
      this.cooldown = this.isBoss ? rand(0.4, 0.9) : rand(1.2, 2.2) / this.type.tempo;
      if (this.type.kind === 'gunner') {
        f.useGun = true;
        f.refreshProp();
      }
      this.setState(this.isBoss ? 'chase' : 'reposition');
      return;
    }
    if (kind === 'special' || kind === 'heavy') {
      this.token = this.isBoss;
      this.setState(this.isBoss ? 'chase' : 'reposition');
      return;
    }
    if (kind === 'hit' || kind === 'knockdown') {
      this.token = this.isBoss;
      this.setState(this.type.kind === 'gunner' ? 'retreat' : 'chase');
    }
    if (kind === 'roll') this.setState('chase');
  }

  /** Our guard held against a swing: elites counter-attack. */
  onBlocked() {
    if (this.type.kind === 'elite' || this.isBoss) this.wantCounter = true;
  }

  /** Was hit: drop guard, lose the attack slot. */
  onHurt(ctx: CombatCtx, by: Fighter) {
    if (!this.engaged) this.notice(ctx);
    if (by && !by.dead && Math.random() < 0.5) this.target = by;
    if (!this.isBoss) this.token = false;
    this.f.blocking = false;
    this.aimT = 0;
    this.f.aiming = false;
  }

  private startRush(ctx: CombatCtx, windup: number) {
    this.faceTarget();
    const f = this.f;
    const o = this.meleeOpts();
    const runT = 0.85;
    const dur = windup + runT;
    f.start({
      kind: 'special',
      tag: 'rush',
      anim: 'rush',
      dur,
      active: [windup / dur, 1],
      swing: { dmg: o.dmg * 1.3, reach: 1.5, arc: 0.8, knockback: 13, stun: 0.9, heavy: true, sound: 'heavy' },
      armor: true,
      lunge: 10.5,
      cancelAt: 1,
    });
    ctx.telegraph(f, true);
    f.telegraph = windup;
    this.setState('attack');
  }

  // ---------------- bosses ----------------
  private bossBrain(dt: number, ctx: CombatCtx, tg: Fighter, dist: number, dir: THREE.Vector3, want: THREE.Vector3) {
    const f = this.f;
    const t = this.type;
    const b = t.boss!;
    // phase changes at 65% and 33% health
    const k = f.hp / f.maxHp;
    const ph = k > 0.65 ? 1 : k > 0.33 ? 2 : 3;
    if (ph > this.phase) {
      this.phase = ph;
      this.enraged = ph === 3;
      f.poise = f.maxPoise;
      ctx.bossPhase(this, ph);
      f.start({ kind: 'special', tag: 'roar', anim: 'cheer', dur: 1.1, armor: true, cancelAt: 1 });
      this.cooldown = 0.3;
      return;
    }
    // volley in progress
    if (this.volleyLeft > 0) {
      f.useGun = true;
      f.refreshProp();
      f.aiming = true;
      want.set(0, 0, 0);
      this.volleyT -= dt;
      if (this.volleyT <= 0) {
        this.volleyLeft--;
        this.volleyT = this.enraged ? 0.22 : 0.32;
        const aim = _n.subVectors(tg.chest(), f.muzzle(new THREE.Vector3())).normalize();
        ctx.fireGun(f, aim, t.gunDmg ?? 14, 0.06, 1, 60);
        f.start({ kind: 'shoot', anim: 'shoot', dur: 0.2, cancelAt: 0.3, blend: 0.03 });
        if (this.volleyLeft <= 0) {
          f.aiming = false;
          f.useGun = false;
          f.refreshProp();
          this.cooldown = 0.8;
        }
      }
      return;
    }
    if (this.cooldown > 0) {
      // menacing approach between moves
      if (dist > t.reach * 0.9) this.goToward(ctx, tg.pos, t.speed * (this.enraged ? 1.15 : 0.85), dt, want);
      return;
    }
    const moves = b.moves[this.phase - 1];
    let mv: BossMove = moves[this.moveIdx % moves.length];
    if (mv === 'summon' && this.summoned.has(this.phase)) mv = 'combo';
    if (mv === 'summon' && !b.summon[this.phase - 1].length) mv = 'combo';
    switch (mv) {
      case 'combo':
        if (dist > t.reach * 0.9) {
          this.goToward(ctx, tg.pos, t.speed * (this.enraged ? 1.2 : 1), dt, want);
          return;
        }
        this.comboLeft = 2 + (this.enraged ? 1 : Math.floor(Math.random() * 2));
        this.startCombo(ctx, 1);
        break;
      case 'slam': {
        if (dist > 7.5) {
          this.goToward(ctx, tg.pos, t.speed, dt, want);
          return;
        }
        this.faceTarget();
        const windup = this.enraged ? 0.7 : 0.95;
        const dur = windup + 0.75;
        f.start({
          kind: 'special',
          tag: 'slam',
          anim: 'heavy',
          dur,
          knee: [windup / dur, 0.08],
          active: [windup / dur, windup / dur + 0.12],
          swing: { dmg: t.dmg * 1.7, reach: 0, arc: Math.PI, aoe: this.enraged ? 4.8 : 4.0, aoeAt: 1.4, knockback: 15, stun: 1, heavy: true, sound: 'heavy' },
          armor: true,
          cancelAt: 0.95,
        });
        f.telegraph = windup;
        ctx.telegraph(f, true);
        this.setState('attack');
        break;
      }
      case 'rush':
        if (dist < 4) {
          this.moveIdx++;
          return;
        }
        this.startRush(ctx, this.enraged ? 0.45 : 0.6);
        break;
      case 'spin': {
        const dur = 2.0;
        f.start({
          kind: 'special',
          tag: 'spin',
          anim: 'spin',
          dur,
          active: [0.1, 0.95],
          swing: { dmg: t.dmg * 0.75, reach: 3.3, arc: Math.PI, knockback: 9, stun: 0.5, sound: 'medium' },
          armor: true,
          cancelAt: 1,
          blend: 0.12,
        });
        f.telegraph = 0.5;
        ctx.telegraph(f, true);
        this.setState('attack');
        break;
      }
      case 'volley':
        if (!f.gun) {
          this.moveIdx++;
          return;
        }
        this.volleyLeft = this.enraged ? 5 : 3;
        this.volleyT = this.enraged ? 0.55 : 0.75;
        ctx.telegraph(f, false);
        break;
      case 'summon':
        this.summoned.add(this.phase);
        f.start({ kind: 'special', tag: 'roar', anim: 'point', dur: 0.9, armor: true, cancelAt: 1 });
        ctx.summon(this, b.summon[this.phase - 1]);
        break;
    }
    this.moveIdx++;
    this.cooldown = this.enraged ? rand(0.2, 0.5) : rand(0.5, 1.0);
  }
}

const others: Fighter[] = [];

// ---------------------------------------------------------------------------
// Crew who come ashore with the captain (and castaways being escorted)
// ---------------------------------------------------------------------------

export class Ally {
  f: Fighter;
  vel = new THREE.Vector3();
  state: 'follow' | 'fight' | 'down' = 'follow';
  target: Enemy | null = null;
  slot: number;
  /** a castaway: follows, never fights */
  escort: boolean;
  private think = 0;
  private cooldown = rand(0.2, 0.8);
  private comboLeft = 0;
  private comboStep = 0;
  private downT = 0;
  private nav = new Navigator();
  private _go = new THREE.Vector3();

  constructor(spec: string, name: string, slot: number, level: number, escort = false) {
    this.escort = escort;
    this.slot = slot;
    const f = new Fighter('ally', spec, name);
    this.f = f;
    f.maxHp = f.hp = escort ? 150 + level * 4 : 80 + level * 4;
    f.maxPoise = f.poise = escort ? 0 : 8;
    f.dmgMul = 1 + level * 0.03;
    f.maxStamina = f.stamina = 999;
    if (!escort) {
      f.setWeapons(weaponStats(makeWeapon(slot % 2 ? 'sword' : 'cutlass')), null);
      f.setDrawn(true);
    }
    f.c.express(escort ? 'surprised' : 'determined');
  }

  /** Enemies nearby that the crew should pile into. */
  update(dt: number, ctx: CombatCtx, leader: Fighter) {
    const f = this.f;
    this.think -= dt;
    this.cooldown -= dt;
    const want = _d.set(0, 0, 0);
    let face: number | null = null;
    if (f.dead) {
      // knocked out cold: sit there seeing stars until the fight is over
      this.state = 'down';
      this.downT += dt;
      return 0;
    }
    const d2l = f.pos.distanceTo(leader.pos);
    if (d2l > 45) {
      // got left behind: catch up instantly
      f.pos.copy(leader.pos).add(new THREE.Vector3(Math.sin(this.slot) * 2.5, 0, Math.cos(this.slot) * 2.5));
      const y = ctx.area.surface(f.pos.x, f.pos.z);
      if (y === null) f.pos.copy(leader.pos);
      else f.pos.y = y;
    }
    if (this.think <= 0) {
      this.think = rand(0.2, 0.35);
      if (!this.escort) {
        // nearest awake foe close to the captain
        let best: Enemy | null = null;
        let bd = 14;
        for (const e of ctx.enemies) {
          if (e.f.dead || e.hidden || !e.engaged) continue;
          const d = e.f.pos.distanceTo(leader.pos);
          const piled = ctx.allies.filter((a) => a !== this && a.target === e).length;
          const score = d + piled * 4 + (e.target === leader ? -2 : 0);
          if (score < bd) {
            bd = score;
            best = e;
          }
        }
        this.target = best;
        this.state = best ? 'fight' : 'follow';
      }
    }
    if (this.state === 'fight' && this.target && !this.target.f.dead && f.free) {
      const tg = this.target.f;
      const to = _g.subVectors(tg.pos, f.pos).setY(0);
      const dist = to.length();
      to.normalize();
      face = headingTo(to.x, to.z);
      if (dist > 2.1) want.copy(this.nav.steer(ctx.area, f.pos, tg.pos, dt, this._go)).multiplyScalar(5.2);
      else if (this.cooldown <= 0) {
        this.comboLeft = 1 + Math.floor(Math.random() * 3);
        this.attack(1);
      } else want.copy(to).multiplyScalar(-1.2);
    } else if (!f.action) {
      // follow in formation behind the captain
      const bh = leader.heading + Math.PI + this.slot;
      const gx = leader.pos.x + Math.sin(bh) * 3;
      const gz = leader.pos.z + Math.cos(bh) * 3;
      want.set(gx - f.pos.x, 0, gz - f.pos.z);
      const L = want.length();
      if (L > 0.6) {
        const goal = _n.set(gx, leader.pos.y, gz);
        want.copy(this.nav.steer(ctx.area, f.pos, goal, dt, this._go)).multiplyScalar(Math.min(L > 7 ? 8 : 5, L * 2.2));
        face = headingTo(want.x, want.z);
      } else {
        want.set(0, 0, 0);
        face = dampAngle(f.heading, leader.heading, 2, dt);
      }
    }
    if (f.action) {
      want.set(0, 0, 0);
      face = null;
    }
    others.length = 0;
    for (const e of ctx.enemies) others.push(e.f);
    for (const a of ctx.allies) others.push(a.f);
    others.push(ctx.player);
    const sp = stepMove(f, this.vel, want, 10, dt, ctx, others);
    if (face !== null) f.heading = dampAngle(f.heading, face, 10, dt);
    f.c.root.rotation.y = dampAngle(f.c.root.rotation.y, f.heading, 14, dt);
    return sp;
  }

  private attack(step: number) {
    const w = this.f.melee!;
    this.comboStep = step;
    meleeStep(this.f, step, { dmg: 9, speed: w.speed * 0.9, reach: w.range, arc: w.arc, knockback: w.knockback, style: w.base.style, sound: w.base.sound, windup: 0.28 });
  }

  onActionDone(kind: string) {
    if (kind !== 'attack') return;
    this.comboLeft--;
    const tg = this.target?.f;
    if (this.comboLeft > 0 && tg && !tg.dead && tg.pos.distanceTo(this.f.pos) < 2.8 && this.comboStep < 3) this.attack(this.comboStep + 1);
    else this.cooldown = rand(0.6, 1.3);
  }

  /** Back on their feet after the fight. */
  get readyToStand() {
    return this.f.dead && this.downT > 2.5;
  }
  standUp() {
    this.downT = 0;
    this.state = 'follow';
    this.f.revive(0.5);
    if (!this.escort) this.f.setDrawn(true);
  }
}
