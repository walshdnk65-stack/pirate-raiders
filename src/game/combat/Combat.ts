import * as THREE from 'three';
import type { Game } from '../Game';
import type { Input } from '../../core/Input';
import { audio } from '../../core/Audio';
import { angleDiff, clamp, headingTo, rand, choose, fmtMoney } from '../../core/math';
import { LandArea } from '../../world/LandArea';
import type { CircleCol } from '../../world/TownTypes';
import { ISLANDS, PORTS } from '../../world/WorldData';
import { buildSite, findIslandSpot, findPortSpot, openChest, closeChest, type SiteGeo } from '../../world/Sites';
import { CARGO, saveProfile, type CargoId } from '../Data';
import type { WalkMods } from '../Walker';
import { Fighter, type Swing, type Action } from './Fighter';
import { Enemy, Ally, type CombatCtx } from './Enemy';
import { tierScale, type EnemyId } from './EnemyTypes';
import { SITES, type SiteDef } from './Encounters';
import { Loot, type Pickup } from './Loot';
import { Trail } from './Trails';
import { meleeStep, heavyStrike, rollAction, staggerAction, knockdownAction, deathAction } from './Moves';
import { weaponStats, weaponName, rollWeapon, makeWeapon, weaponDps, upgradePrice, RARITIES, EFFECTS, type WeaponItem, type Rarity } from './Weapons';
import { CombatHUD } from '../../ui/CombatHUD';
import { propGeometry } from '../../models/Character';

/** Runtime state of an encounter site. */
export interface SiteRun {
  def: SiteDef;
  geo: SiteGeo;
  /** which land it's on ('port:<idx>' or 'isle:<name>') */
  land: string;
  area: LandArea;
  status: 'dormant' | 'active' | 'cleared';
  enemies: Enemy[];
  /** captain's position when this fight started (retry spot) */
  engagedAt: THREE.Vector3 | null;
  engagedHeading: number;
  chestOpen: boolean;
  triggered: boolean;
  bossIntro: boolean;
  tier: number;
  escort?: { npc: Ally | null; phase: 'waiting' | 'walking' | 'done'; wave: number; start: THREE.Vector3; t: number; failT: number };
}

interface Bullet {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Fighter;
  dmg: number;
  kb: number;
  life: number;
  pierce: boolean;
  hits: Set<Fighter>;
}

const ROLL_COST = 22;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/** Tip flags (profile.land.tut) */
const TIP = { basics: 1, gun: 2, lock: 4, ashore: 8 };

/**
 * Real-time land combat: the captain's sword-and-pistol controls, enemy and crew AI, hit
 * resolution (arcs, blocks, parries, rolls, poise, knockback), bullets, loot and the encounter
 * sites dotted around ports and islands.
 */
export class Combat implements CombatCtx {
  time = 0;
  area!: LandArea;
  player: Fighter;
  enemies: Enemy[] = [];
  allies: Ally[] = [];
  extraCols: CircleCol[] = [];
  loot = new Loot();
  sites: SiteRun[] = [];
  hud: CombatHUD;
  /** on foot somewhere combat can happen */
  active = false;
  land = '';
  onIsland = false;
  landName = '';
  /** where the rowboat / gangplank is (escort destination, return point) */
  landing = new THREE.Vector3();
  lock: Enemy | null = null;
  /** weapon drawn, fighting */
  combatMode = false;
  defeated = false;
  /** contextual prompt for the game to show (open chest, talk to castaway…) */
  prompt: string | null = null;
  boss: Enemy | null = null;
  /** time scale for hit-stop (the game slows the walker with it too) */
  timeScale = 1;
  /** freshly looted weapon the G key equips */
  pendingEquip: { uid: string; t: number } | null = null;
  private calmT = 0;
  private comboStep = 0;
  private comboQueued = false;
  private queuedAt = 0;
  private comboIdle = 0;
  private lmbT = 0;
  private charging = false;
  private chargeT = 0;
  private chargeGlint = false;
  private trails: Trail[] = [];
  private bullets: Bullet[] = [];
  private bulletPool: THREE.Mesh[] = [];
  private bulletGeo = new THREE.SphereGeometry(0.07, 6, 4);
  private bulletMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 1.2), toneMapped: false });
  private hitStop = 0;
  private shotGate = 0;
  private defeatT = 0;
  private islandAreas = new Map<string, LandArea>();
  private mods: WalkMods = { speed: 1, combat: false, sprint: true, face: null, push: new THREE.Vector3(), anim: false, noJump: false };
  private siteT = 0;
  private scareT = 0;
  private telegraphs = new Map<Fighter, number>();
  private fireT = 0;
  private retrySites: SiteRun[] = [];
  private retryPos: THREE.Vector3 | null = null;
  private retryHeading = 0;

  constructor(private game: Game) {
    this.player = new Fighter('player', game.walker.c, 'Captain');
    this.player.radius = 0.42;
    this.player.maxPoise = this.player.poise = 30;
    this.player.poiseDelay = 0.6;
    game.scene.add(this.loot.group);
    for (let i = 0; i < 8; i++) {
      const t = new Trail();
      this.trails.push(t);
      game.scene.add(t.mesh);
    }
    this.hud = new CombatHUD(game, this);
    this.warmUp();
    this.applyProfile();
    const g = this.player.gun;
    this.player.loaded = g ? g.mag : 0;
  }

  /**
   * Put one of every combat effect (trail, bullet, loot beams, weapons) far below the world
   * so the loading screen compiles their shaders instead of the first fight hitching.
   */
  private warm: THREE.Object3D[] = [];
  private warmUp() {
    const far = new THREE.Vector3(0, -600, 0);
    const t = this.trails[0];
    t.mesh.visible = true;
    t.mesh.position.copy(far);
    this.warm.push(t.mesh);
    const b = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    b.position.copy(far);
    this.game.scene.add(b);
    this.warm.push(b);
    const w = this.loot.spawn('weapon', far, 1, { weapon: makeWeapon('pistol', 'legendary') });
    this.loot.spawn('rare', far, 1, { rare: 'map' });
    for (const k of ['gold', 'shot', 'scrap', 'cargo', 'heal'] as const) this.loot.spawn(k, far, 1);
    void w;
    for (const id of ['cutlass', 'sword', 'axe', 'rapier', 'anchor', 'pistol', 'blunderbuss', 'revolver'] as const) propGeometry(id);
    this.game.particles.ring.spawn({ x: 0, y: -600, z: 0, size: 1, max: 0.5, curve: 'grow' });
  }

  /** Called on the first frame after loading: the warm-up props go away. */
  private unwarm() {
    if (!this.warm.length) return;
    for (const o of this.warm) {
      if (o instanceof THREE.Mesh && o.geometry === this.bulletGeo) o.removeFromParent();
    }
    this.trails[0].mesh.position.set(0, 0, 0);
    this.trails[0].mesh.visible = false;
    this.warm.length = 0;
    this.loot.clear();
  }

  // =====================================================================
  // Setup: encounter sites around the world
  // =====================================================================
  init() {
    const g = this.game;
    for (const def of SITES) {
      let geo: SiteGeo | null = null;
      let land = '';
      let area: LandArea;
      const seed = def.id.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);
      if (def.port) {
        const idx = PORTS.findIndex((p) => p.id === def.port);
        if (idx < 0) continue;
        const town = g.towns[idx];
        area = g.areas[idx];
        const avoid = [...town.interactables.map((i) => i.pos), town.landing, ...[...town.spots.values()].map((s) => s.pos)];
        const c = findPortSpot(area, town.center, town.radius, town.nav.nodes, avoid, 9, seed);
        if (!c) continue;
        const rot = headingTo(town.center.x - c.x, town.center.z - c.z);
        geo = buildSite(def.site, c, rot, seed);
        for (const b of geo.boxes) area.addBox(b);
        for (const ci of geo.circles) area.addCircle(ci);
        land = `port:${idx}`;
      } else {
        const isl = ISLANDS.find((i) => i.name === def.island);
        if (!isl) continue;
        const ring = def.ring ?? [0.25, 0.6];
        const c = findIslandSpot(isl, ring[0], ring[1], def.site === 'fort' ? 11 : 8, g.islands.obstacles, seed);
        if (!c) continue;
        const rot = headingTo(c.x - isl.x, c.z - isl.z);
        geo = buildSite(def.site, c, rot, seed);
        land = `isle:${isl.name}`;
        area = this.islandArea(isl.name, geo);
      }
      g.scene.add(geo.group);
      const cleared = g.profile.land.cleared[def.id];
      const run: SiteRun = { def, geo, land, area, status: 'dormant', enemies: [], engagedAt: null, engagedHeading: 0, chestOpen: false, triggered: false, bossIntro: false, tier: def.tier };
      if (cleared !== undefined && g.profile.day < cleared + def.respawnDays) {
        run.status = 'cleared';
        run.chestOpen = true;
        openChest(geo);
      }
      this.sites.push(run);
    }
  }

  /** Walkable ground + obstacles for an island without a port (built on demand). */
  islandArea(name: string, extra?: SiteGeo) {
    let a = this.islandAreas.get(name);
    if (!a) {
      const isl = ISLANDS.find((i) => i.name === name)!;
      const circles = this.game.islands.obstacles.filter((o) => Math.hypot(o.x - isl.x, o.z - isl.z) < isl.maxR! * 1.1);
      a = new LandArea([], [...circles], []);
      this.islandAreas.set(name, a);
    }
    if (extra) {
      for (const b of extra.boxes) a.addBox(b);
      for (const c of extra.circles) a.addCircle(c);
    }
    return a;
  }

  get profile() {
    return this.game.profile;
  }

  /** Captain's health, stamina and weapons from the profile (level, equipped arms). */
  applyProfile() {
    const p = this.profile;
    const f = this.player;
    const hpK = f.maxHp > 0 ? f.hp / f.maxHp : 1;
    f.maxHp = Math.min(420, 120 + (p.level - 1) * 6);
    f.hp = Math.min(f.maxHp, Math.max(1, Math.round(f.maxHp * hpK)));
    f.maxStamina = 100 + Math.min(30, p.level * 0.6);
    f.dmgMul = 1 + (p.level - 1) * 0.015;
    const melee = p.weapons.find((w) => w.uid === p.melee);
    const gun = p.weapons.find((w) => w.uid === p.ranged);
    f.setWeapons(melee ? weaponStats(melee) : null, gun ? weaponStats(gun) : null);
  }

  // =====================================================================
  // Entering / leaving land
  // =====================================================================
  enterLand(land: string, area: LandArea, landing: THREE.Vector3, name: string, crew: number) {
    this.unwarm();
    this.leaveLand();
    this.active = true;
    this.land = land;
    this.area = area;
    this.landing.copy(landing);
    this.onIsland = land.startsWith('isle:');
    this.landName = name;
    this.applyProfile();
    const f = this.player;
    f.revive(1);
    f.setDrawn(false);
    f.useGun = false;
    f.refreshProp();
    this.combatMode = false;
    // crew come ashore on islands
    const specs = ['recruit0', 'recruit3', 'recruit6', 'recruit1'];
    const names = ['Bosun Bart', 'Salty Nell', 'One-Eyed Finn', 'Calico Rosa'];
    for (let i = 0; i < crew; i++) {
      const a = new Ally(specs[i % specs.length], names[i % names.length], (i - (crew - 1) / 2) * 0.9, this.profile.level);
      const off = new THREE.Vector3(Math.sin(i * 2.1) * 2.2, 0, Math.cos(i * 2.1) * 2.2);
      a.f.pos.copy(landing).add(off);
      const y = area.surface(a.f.pos.x, a.f.pos.z);
      if (y === null) a.f.pos.copy(landing);
      else a.f.pos.y = y;
      this.game.scene.add(a.f.c.root);
      this.allies.push(a);
    }
    this.siteT = 0;
    this.updateSites(0, true);
    this.tip(TIP.ashore, this.onIsland && crew > 0 ? ['🏝️ Ashore!', `${crew} of your crew came along. Explore – but watch out for rival pirates.`] : null);
  }

  leaveLand() {
    for (const s of this.sites) if (s.status === 'active') this.despawnSite(s);
    for (const e of this.enemies) this.removeEnemy(e);
    this.enemies.length = 0;
    for (const a of this.allies) a.f.dispose();
    this.allies.length = 0;
    for (const s of this.sites) if (s.escort?.npc) s.escort.npc = null;
    this.loot.clear();
    for (const b of this.bullets) this.freeBullet(b);
    this.bullets.length = 0;
    for (const t of this.trails) t.release();
    this.active = false;
    this.defeated = false;
    this.lock = null;
    this.boss = null;
    this.combatMode = false;
    this.player.setDrawn(false);
    this.player.blocking = false;
    this.player.aiming = false;
    this.player.endAction();
    this.player.push.set(0, 0, 0);
    this.telegraphs.clear();
    this.prompt = null;
    const cam = this.game.camRig;
    cam.lockOn = null;
    cam.aimK = 0;
    cam.fightK = 0;
    cam.followYaw = null;
    this.game.input.unlockPointer();
    this.hud.hideDefeat();
    this.hud.setBoss(null);
  }

  // =====================================================================
  // CombatCtx (used by the AI)
  // =====================================================================
  wantToken(e: Enemy) {
    if (e.token) return true;
    const max = this.player.hp < this.player.maxHp * 0.3 ? 1 : 2;
    let n = 0;
    for (const o of this.enemies) if (o.token && !o.f.dead && !o.isBoss && o.target === e.target) n++;
    return n < max;
  }

  /** Space attacks out so two foes never strike the same target in the same instant. */
  private lastStrike = new Map<Fighter, number>();
  canStrike(e: Enemy) {
    if (e.isBoss || !e.target) return true;
    const t = this.lastStrike.get(e.target) ?? -9;
    if (this.time - t < 0.75) return false;
    this.lastStrike.set(e.target, this.time);
    return true;
  }

  wantShot(_e: Enemy) {
    if (this.shotGate > 0) return false;
    this.shotGate = rand(1.0, 1.6);
    return true;
  }

  alert(e: Enemy) {
    for (const o of this.enemies) {
      if (o === e || o.f.dead || o.engaged) continue;
      if (o.siteId === e.siteId && o.f.pos.distanceTo(e.f.pos) < 32) o.notice(this);
    }
    const site = this.sites.find((s) => s.def.id === e.siteId);
    if (site && !site.engagedAt) {
      site.engagedAt = this.player.pos.clone();
      site.engagedHeading = this.game.walker.heading;
    }
    if (e.isBoss && site && !site.bossIntro) {
      site.bossIntro = true;
      this.boss = e;
      this.hud.setBoss(e);
      const b = e.type.boss!;
      this.game.ui.place(e.type.name.toUpperCase(), b.title);
      this.game.ui.toast(`💀 ${e.type.name}`, `“${b.intro}”`, 'danger');
      audio.play('roar', { pos: e.f.pos });
      this.game.camRig.addShake(0.35);
    }
    if (!this.player.drawn && this.player.pos.distanceTo(e.f.pos) < 26 && !this.defeated) this.drawWeapon();
    this.calmT = 0;
  }

  telegraph(f: Fighter, heavy: boolean) {
    const a = f.action;
    const until = this.time + (a?.active ? a.active[0] * a.dur : 0.8);
    this.telegraphs.set(f, until);
    // a glint on the weapon so you can read the wind-up
    const m = f.muzzle(_a);
    this.game.particles.sparkle(m.setY(m.y - 0.6));
    if (heavy) audio.play('swing', { pos: f.pos, pitch: 0.5, volume: 0.25 });
  }

  summon(e: Enemy, ids: EnemyId[]) {
    const site = this.sites.find((s) => s.def.id === e.siteId);
    ids.forEach((id, i) => {
      const a = (i / ids.length) * Math.PI * 2 + rand(0, 1);
      const p = this.findSpot(e.f.pos, 5, 8, a);
      if (!p) return;
      const m = this.spawnEnemy(id, site?.tier ?? e.tier, p, headingTo(this.player.pos.x - p.x, this.player.pos.z - p.z), e.siteId);
      site?.enemies.push(m);
      this.game.particles.dust(p.clone().setY(p.y + 0.2), 0.6);
      m.notice(this);
    });
    audio.play('roar', { pos: e.f.pos, pitch: 1.1 });
    this.game.ui.toast('📯 Reinforcements!', `${e.type.name} calls for help!`, 'danger');
  }

  bossPhase(e: Enemy, phase: number) {
    audio.play('roar', { pos: e.f.pos, pitch: phase === 3 ? 0.85 : 1 });
    this.game.camRig.addShake(0.45);
    this.game.ui.place(phase === 3 ? 'ENRAGED!' : 'PHASE 2', phase === 3 ? `${e.type.name} is furious – faster and fiercer!` : `${e.type.name} fights harder…`);
    this.ring(e.f.pos, 3.5, '#ff8a3a');
    e.f.c.express('angry');
  }

  los(a: THREE.Vector3, b: THREE.Vector3) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / 0.8);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.area.blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.05)) return false;
    }
    return true;
  }

  fireGun(f: Fighter, dir: THREE.Vector3, dmg: number, spread: number, pellets: number, speed: number) {
    const m = f.muzzle(new THREE.Vector3());
    const pierce = f.team === 'player' && f.gun?.effect === 'piercing';
    for (let i = 0; i < pellets; i++) {
      const d = dir.clone();
      if (spread > 0) {
        d.x += rand(-spread, spread);
        d.y += rand(-spread, spread) * 0.5;
        d.z += rand(-spread, spread);
        d.normalize();
      }
      this.spawnBullet(f, m, d, speed, dmg * f.dmgMul, (f.gun?.knockback ?? 6) * (pellets > 1 ? 0.5 : 1), pierce);
    }
    this.game.particles.muzzle(m, dir, pellets > 1 ? 0.7 : 0.45);
    audio.play(pellets > 1 ? 'blast' : 'pistol', { pos: f.pos, volume: f.team === 'player' ? 0.8 : 0.6, pitch: rand(0.92, 1.08) });
    if (f.team === 'player') this.game.camRig.addShake(pellets > 1 ? 0.28 : 0.14);
    f.c.trigger('fire', 0.3);
  }

  // =====================================================================
  // The captain's controls
  // =====================================================================
  /** Nearest awake foe (distance). */
  private nearestFoe(max = 999) {
    let best: Enemy | null = null;
    let bd = max;
    for (const e of this.enemies) {
      if (e.f.dead || e.hidden) continue;
      const d = e.f.pos.distanceTo(this.player.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** TAB belongs to lock-on while a fight is on. */
  get claimsTab() {
    return this.active && this.player.drawn && !!this.nearestFoe(26);
  }

  /** Foes are fighting near the captain (no shopping, combat music). */
  get engaged() {
    if (!this.active) return false;
    for (const e of this.enemies) if (!e.f.dead && e.engaged && e.f.pos.distanceTo(this.player.pos) < 35) return true;
    return false;
  }

  /** Capture the mouse for free look while fighting. */
  get wantsPointerLock() {
    return this.active && this.combatMode && !this.defeated;
  }

  private drawWeapon() {
    const f = this.player;
    if (f.drawn) return;
    f.setDrawn(true);
    if (f.free) f.start({ kind: 'draw', anim: 'draw', dur: 0.3, cancelAt: 0.5 });
    audio.play('swing', { volume: 0.25, pitch: 1.6 });
    this.combatMode = true;
    this.calmT = 0;
    this.tip(TIP.basics, ['⚔️ Fight!', '<b>LMB</b> attack (tap ×3 combo, hold = heavy) · <b>RMB</b> block · <b>SPACE</b> roll · <b>TAB/Q</b> lock on · <b>2</b> pistol']);
  }

  private sheathe() {
    const f = this.player;
    f.setDrawn(false);
    f.blocking = false;
    f.aiming = false;
    this.combatMode = false;
    this.lock = null;
    this.charging = false;
    this.game.input.unlockPointer();
  }

  private selectGun(on: boolean) {
    const f = this.player;
    if (on && !f.gun) {
      this.game.ui.toast('🔫 No gun', 'Buy a pistol from a gunsmith, or equip one in your inventory.', 'danger');
      return;
    }
    if (f.useGun === on && f.drawn) return;
    f.useGun = on;
    if (!f.drawn) this.drawWeapon();
    f.refreshProp();
    if (f.free) f.start({ kind: 'draw', anim: 'draw', dur: 0.26, cancelAt: 0.5 });
    audio.play('click', { pitch: on ? 0.8 : 1.2 });
    if (on) this.tip(TIP.gun, ['🔫 Pistol', '<b>RMB</b> aim · <b>LMB</b> fire · <b>R</b> reload · <b>1</b> back to the blade. Shot is limited – buy more at a gunsmith.']);
  }

  private reload() {
    const f = this.player;
    const g = f.gun;
    if (!g || f.loaded >= g.mag) return;
    if (this.profile.shot <= 0) {
      audio.play('dryFire');
      this.text(f.chest(), 'Out of shot!', 'warn');
      return;
    }
    if (!f.free && f.action?.kind !== 'shoot') return;
    f.start({ kind: 'reload', anim: 'reload', dur: g.reload, cancelAt: 1 });
    audio.play('reload', { volume: 0.6 });
  }

  private finishReload() {
    const f = this.player;
    const g = f.gun;
    if (!g) return;
    const n = Math.min(g.mag - f.loaded, this.profile.shot);
    f.loaded += n;
    this.profile.shot -= n;
  }

  /** Lock on to the foe nearest the middle of the screen, or cycle to the next one. */
  cycleLock() {
    const cam = this.game.camRig.camera;
    cam.getWorldDirection(_a).setY(0).normalize();
    const camYaw = Math.atan2(_a.x, _a.z);
    const list = this.enemies
      .filter((e) => !e.f.dead && !e.hidden && e.f.pos.distanceTo(this.player.pos) < 24)
      .map((e) => ({ e, ang: angleDiff(camYaw, headingTo(e.f.pos.x - this.player.pos.x, e.f.pos.z - this.player.pos.z)), d: e.f.pos.distanceTo(this.player.pos) }));
    if (!list.length) {
      this.lock = null;
      return;
    }
    if (!this.lock) {
      list.sort((a, b) => Math.abs(a.ang) * 8 + a.d - (Math.abs(b.ang) * 8 + b.d));
      this.lock = list[0].e;
    } else {
      // next foe clockwise from the current one
      list.sort((a, b) => a.ang - b.ang);
      const i = list.findIndex((x) => x.e === this.lock);
      const nx = list[(i + 1) % list.length].e;
      this.lock = nx === this.lock ? null : nx;
    }
    audio.play('tick', { volume: 0.6 });
    if (this.lock) this.tip(TIP.lock, ['🎯 Locked on', 'The camera keeps your foe in view and your swings home in on them. <b>TAB/Q</b> switches target.']);
  }

  /**
   * Which way to swing: at the locked foe when they're close enough to reach, otherwise at the
   * foe nearest the stick direction (anyone right next to you counts), else where you're heading.
   */
  private attackHeading(range: number, cone: number) {
    const f = this.player;
    const w = this.game.walker;
    const lk = this.lock && !this.lock.f.dead ? this.lock : null;
    if (lk && lk.f.pos.distanceTo(f.pos) < range + 1.5) return headingTo(lk.f.pos.x - f.pos.x, lk.f.pos.z - f.pos.z);
    // swings go where the captain (and so the camera) is facing
    const base = lk ? headingTo(lk.f.pos.x - f.pos.x, lk.f.pos.z - f.pos.z) : w.heading;
    let best: Enemy | null = null;
    let bs = Infinity;
    for (const e of this.enemies) {
      if (e.f.dead || e.hidden) continue;
      const d = e.f.pos.distanceTo(f.pos);
      if (d > range) continue;
      const ang = Math.abs(angleDiff(base, headingTo(e.f.pos.x - f.pos.x, e.f.pos.z - f.pos.z)));
      // in your face counts whichever way you're pointing
      if (ang > cone && d > 2.2) continue;
      const s = d + ang * 2.2;
      if (s < bs) {
        bs = s;
        best = e;
      }
    }
    return best ? headingTo(best.f.pos.x - f.pos.x, best.f.pos.z - f.pos.z) : base;
  }

  private startPlayerAttack() {
    const f = this.player;
    const w = f.melee;
    if (!w) return;
    const step = this.comboStep >= 3 ? 1 : this.comboStep + 1;
    const cost = w.stamina * (step === 3 ? 1.3 : 1);
    if (f.stamina < cost * 0.5) {
      this.hud.flashStamina();
      audio.play('oof', { volume: 0.4, pitch: 1.2 });
      return;
    }
    f.useStamina(cost, 0.8);
    const h = this.attackHeading(4.6, 1.3);
    f.heading = this.game.walker.heading = h;
    meleeStep(f, step, { dmg: w.damage, speed: w.speed, reach: w.range, arc: w.arc, knockback: w.knockback, style: w.base.style, sound: w.base.sound });
    this.comboStep = step;
    this.comboIdle = 0;
  }

  private releaseHeavy() {
    const f = this.player;
    const w = f.melee;
    this.charging = false;
    if (!w) return;
    const cost = w.stamina * 1.8;
    if (f.stamina < cost * 0.5) {
      f.endAction();
      this.hud.flashStamina();
      return;
    }
    f.useStamina(cost, 1);
    const h = this.attackHeading(5.2, 1.0);
    f.heading = this.game.walker.heading = h;
    heavyStrike(f, { dmg: w.damage, speed: w.speed, reach: w.range, arc: w.arc, knockback: w.knockback, style: w.base.style, sound: 'heavy' }, clamp(this.chargeT / 0.7, 0, 1));
    this.comboStep = 0;
    this.game.camRig.addShake(0.08);
  }

  /** Where the captain is aiming: what's under the crosshair, the locked foe, or straight ahead. */
  private aimDirection(out: THREE.Vector3) {
    const f = this.player;
    const g = f.gun!;
    const m = f.muzzle(_b);
    if (f.aiming) {
      const cam = this.game.camRig.camera;
      const ro = cam.position;
      const rd = cam.getWorldDirection(_c);
      // first foe whose body the screen-centre ray passes through
      let bestT = g.range + 12;
      for (const e of this.enemies) {
        if (e.f.dead || e.hidden) continue;
        const t = rayCylinder(ro, rd, e.f.pos, e.f.radius + 0.15, e.f.height);
        if (t !== null && t < bestT) bestT = t;
      }
      const target = _a.copy(ro).addScaledVector(rd, bestT);
      return out.subVectors(target, m).normalize();
    }
    const tg = this.lock && !this.lock.f.dead && this.lock.f.pos.distanceTo(f.pos) < g.range ? this.lock : null;
    let best = tg;
    if (!best) {
      let bs = Infinity;
      for (const e of this.enemies) {
        if (e.f.dead || e.hidden) continue;
        const d = e.f.pos.distanceTo(f.pos);
        if (d > g.range) continue;
        const ang = Math.abs(angleDiff(this.game.walker.heading, headingTo(e.f.pos.x - f.pos.x, e.f.pos.z - f.pos.z)));
        if (ang > 0.6) continue;
        if (d + ang * 10 < bs) {
          bs = d + ang * 10;
          best = e;
        }
      }
    }
    if (best) return out.subVectors(best.f.chest(_a), m).normalize();
    const h = this.game.walker.heading;
    return out.set(Math.sin(h), 0, Math.cos(h));
  }

  private firePlayerGun() {
    const f = this.player;
    const g = f.gun;
    if (!g) return;
    if (!(f.free || f.action?.kind === 'shoot')) return;
    if (f.gunCD > 0) return;
    if (f.loaded <= 0) {
      if (this.profile.shot > 0) this.reload();
      else {
        audio.play('dryFire');
        this.text(f.chest(), 'Out of shot!', 'warn');
      }
      return;
    }
    const dir = this.aimDirection(new THREE.Vector3());
    f.heading = this.game.walker.heading = Math.atan2(dir.x, dir.z);
    f.c.root.rotation.y = f.heading;
    f.start({ kind: 'shoot', anim: 'shoot', dur: 0.42, cancelAt: 0.45, blend: 0.03 });
    f.loaded--;
    f.gunCD = g.cooldown;
    // re-read the muzzle after turning
    f.c.root.updateMatrixWorld(true);
    this.fireGun(f, dir, g.damage, g.spread, g.pellets, 150);
  }

  /** Read input and decide what the captain does this frame; returns how the walker should move. */
  playerMods(dt: number, input: Input, canControl: boolean): WalkMods {
    const f = this.player;
    const m = this.mods;
    const w = this.game.walker;
    f.heading = w.heading;
    m.speed = 1;
    m.face = null;
    m.push = f.push;
    m.combat = f.drawn;
    m.anim = f.drawn || !!f.action || f.dead;
    m.noJump = f.drawn;
    m.sprint = f.stamina > 4;
    if (!this.active) {
      m.anim = false;
      m.combat = false;
      m.noJump = false;
      return m;
    }
    if (f.dead || this.defeated) {
      m.speed = 0;
      m.anim = true;
      m.noJump = true;
      return m;
    }
    if (!canControl) {
      f.blocking = false;
      f.aiming = false;
      if (this.charging) {
        this.charging = false;
        f.endAction();
      }
      this.applyMotion(m);
      return m;
    }

    // ---- weapons ----
    if (input.pressed('KeyX')) {
      if (f.drawn) this.sheathe();
      else this.drawWeapon();
    }
    if (input.pressed('Digit1')) this.selectGun(false);
    if (input.pressed('Digit2')) this.selectGun(true);
    if (input.pressed('KeyF') && f.drawn) this.selectGun(!f.useGun);
    if (input.pressed('KeyR')) this.reload();
    if (input.pressed('KeyG') && this.pendingEquip) this.equipPending();
    if (input.pressed('KeyQ') || (input.pressed('Tab') && this.claimsTab)) {
      if (!f.drawn) this.drawWeapon();
      this.cycleLock();
    }

    const lmbPressed = input.mousePressed(0);
    const lmbDown = input.mouseDown(0);
    const rmb = input.mouseDown(2);
    const foesNear = !!this.nearestFoe(24);
    if ((lmbPressed || input.mousePressed(2)) && !f.drawn && (foesNear || this.combatMode)) this.drawWeapon();
    if (!f.drawn) {
      // exploring: Space jumps, the mouse just looks around
      m.combat = false;
      m.anim = !!f.action;
      m.noJump = false;
      this.applyMotion(m);
      return m;
    }
    this.combatMode = true;
    m.combat = true;
    m.anim = true;
    m.noJump = true;

    // ---- block (melee) / aim (gun) on the right button ----
    const wantBlock = rmb && !f.useGun;
    const wantAim = rmb && f.useGun;
    if (wantBlock && f.blockCD <= 0 && !f.blocking && (f.free || f.action?.kind === 'charge' || f.action?.kind === 'reload')) {
      if (f.action) f.endAction();
      this.charging = false;
      f.blocking = true;
      f.blockT = 0;
    } else if (!wantBlock && f.blocking) {
      f.blocking = false;
      f.blockCD = 0.2;
    }
    f.aiming = wantAim && (f.free || f.action?.kind === 'shoot');

    // ---- dodge roll ----
    if (input.pressed('Space') && f.rollCD <= 0 && (f.free || f.inRecovery || f.blocking || f.action?.kind === 'charge' || f.action?.kind === 'reload' || f.action?.kind === 'draw' || f.action?.kind === 'shoot')) {
      if (f.stamina >= ROLL_COST * 0.6) {
        let h: number;
        if (w.moveDir.lengthSq() > 0.01) h = Math.atan2(w.moveDir.x, w.moveDir.z);
        else if (this.lock) h = headingTo(f.pos.x - this.lock.f.pos.x, f.pos.z - this.lock.f.pos.z);
        else h = w.heading + Math.PI;
        f.heading = w.heading = h;
        f.c.root.rotation.y = h;
        f.blocking = false;
        this.charging = false;
        rollAction(f);
        f.useStamina(ROLL_COST, 0.6);
        f.rollCD = 0.72;
        this.comboStep = 0;
        audio.play('whoosh', { volume: 0.45, pitch: 1.3 });
      } else this.hud.flashStamina();
    }

    // ---- attacks ----
    if (!f.useGun) {
      if (lmbPressed) {
        this.lmbT = 0;
        if (f.free && !f.blocking && f.action?.kind !== 'attack') this.startPlayerAttack();
        else if (!f.blocking) {
          // busy (mid-swing, drawing, rolling): remember the click and swing as soon as we can
          this.comboQueued = true;
          this.queuedAt = this.time;
        }
      }
      if (lmbDown) this.lmbT += dt;
      // keep holding after a swing to charge a heavy blow
      if (lmbDown && this.lmbT > 0.3 && !this.charging && f.free && !f.blocking && f.melee) {
        this.charging = true;
        this.chargeT = 0;
        this.chargeGlint = false;
        this.comboQueued = false;
        f.start({ kind: 'charge', anim: 'charge', dur: 99, cancelAt: 0, blend: 0.12 });
      }
      if (this.charging) {
        if (f.action?.kind !== 'charge') this.charging = false;
        else {
          this.chargeT += dt;
          if (this.chargeT > 0.7 && !this.chargeGlint) {
            this.chargeGlint = true;
            const mz = f.muzzle(_a);
            for (let i = 0; i < 5; i++) this.game.particles.sparkle(mz.clone().setY(mz.y - 0.8));
            audio.play('tick', { pitch: 1.6 });
          }
          if (!lmbDown) this.releaseHeavy();
        }
      }
      if (this.comboQueued && this.time - this.queuedAt > 0.65) this.comboQueued = false;
      if (this.comboQueued && f.free && !f.blocking && !this.charging) {
        this.comboQueued = false;
        this.startPlayerAttack();
      }
      if (!f.action) {
        this.comboIdle += dt;
        if (this.comboIdle > 0.45) {
          this.comboStep = 0;
          this.comboQueued = false;
        }
      }
    } else if (lmbPressed) this.firePlayerGun();
    // automatic reload once the gun is empty and nothing else is going on
    if (f.useGun && f.gun && f.loaded <= 0 && f.free && f.gunCD <= 0 && this.profile.shot > 0 && !input.mouseDown(0)) this.reload();

    // cheering after a win: walking off ends it
    if (f.action?.kind === 'victory' && f.free && w.moveDir.lengthSq() > 0.01) f.endAction();
    this.applyMotion(m);
    // facing
    const a = f.action;
    if (f.aiming) {
      const cam = this.game.camRig.camera;
      cam.getWorldDirection(_a);
      m.face = Math.atan2(_a.x, _a.z);
      m.speed = Math.min(m.speed, 0.5);
    } else if (this.lock && !this.lock.f.dead && (!a || a.kind === 'charge' || a.kind === 'reload' || a.kind === 'draw') && !w.sprinting) {
      m.face = headingTo(this.lock.f.pos.x - f.pos.x, this.lock.f.pos.z - f.pos.z);
    } else if (!a || a.kind === 'charge' || a.kind === 'reload' || a.kind === 'draw' || a.kind === 'victory') {
      // fighting: the captain faces where the camera looks (A/D strafe, S backs off), so the
      // camera always stays behind him; the mouse turns both
      m.face = this.game.camRig.walkYaw + Math.PI;
    }
    if (f.blocking) m.speed = Math.min(m.speed, 0.45);
    m.sprint = f.stamina > 4 && !f.blocking && !f.aiming && !a;
    return m;
  }

  /** Movement while the captain is busy (rooted in swings, rolling, staggering…). */
  private applyMotion(m: WalkMods) {
    const f = this.player;
    const a = f.action;
    if (!a) return;
    switch (a.kind) {
      case 'roll':
      case 'hit':
      case 'knockdown':
        m.speed = 0;
        m.face = f.heading;
        break;
      case 'victory':
        m.speed = 0.3;
        break;
      case 'attack':
      case 'heavy':
        m.speed = f.progress < (a.active?.[1] ?? 0.5) ? 0.12 : 0.45;
        m.face = f.heading;
        break;
      case 'charge':
        m.speed = 0.3;
        break;
      case 'shoot':
        m.speed = 0.35;
        m.face = f.heading;
        break;
      case 'reload':
        m.speed = 0.6;
        break;
      case 'draw':
        m.speed = 0.85;
        break;
    }
  }

  private equipPending() {
    const pe = this.pendingEquip;
    this.pendingEquip = null;
    if (!pe) return;
    const w = this.profile.weapons.find((x) => x.uid === pe.uid);
    if (w) this.equip(w);
  }

  /** Equip a weapon from the armoury (inventory or loot). */
  equip(w: WeaponItem) {
    const p = this.profile;
    const ranged = weaponStats(w).kind === 'ranged';
    if (ranged) p.ranged = w.uid;
    else p.melee = w.uid;
    const f = this.player;
    const oldMag = f.gun?.mag ?? 0;
    this.applyProfile();
    if (ranged && f.gun && f.gun.mag !== oldMag) {
      // swapping guns: unload into the pouch, the new one starts empty
      p.shot += f.loaded;
      f.loaded = 0;
    }
    f.refreshProp();
    audio.play('click');
    this.game.ui.toast(`${weaponStats(w).base.icon} Equipped`, `<span style="color:${RARITIES[w.rarity].color}">${weaponName(w)}</span>`, 'good');
    saveProfile(p);
  }

  // =====================================================================
  // Per-frame simulation
  // =====================================================================
  update(dt: number, npcCols: CircleCol[]) {
    if (!this.active) {
      this.timeScale = 1;
      return;
    }
    this.time += dt;
    this.hitStop -= dt;
    this.timeScale = this.hitStop > 0 ? 0.06 : 1;
    const sdt = dt * this.timeScale;
    this.shotGate -= sdt;
    this.extraCols = npcCols;
    const g = this.game;
    const f = this.player;
    const w = g.walker;

    // ---- the captain ----
    f.heading = w.heading;
    const pDone = f.update(sdt);
    if (pDone) this.onPlayerActionDone(pDone);
    if (w.sprinting && f.drawn) f.useStamina(17 * sdt, 0.5);
    this.drive(f, this.lock?.f ?? this.nearestFoe(3)?.f ?? null);
    if (f.drawn || f.action || f.dead) f.animate(sdt, w.speed, w.sprinting);
    else {
      f.c.params.armed = 0;
      f.c.params.move = 0;
    }

    // ---- foes ----
    for (const e of this.enemies) {
      if (e.hidden) continue;
      const near = e.f.pos.distanceTo(f.pos) < 60;
      this.drive(e.f, e.target);
      const sp = this.defeated ? 0 : e.update(sdt, this, near);
      const done = e.f.update(sdt);
      if (done) e.onActionDone(done.kind, this);
      // enemies keep tracking the target during the wind-up (but not the strike itself)
      const a = e.f.action;
      if (a && e.target && a.active && e.f.progress < a.active[0] && (a.kind === 'attack' || a.tag === 'slam')) e.f.heading = e.f.heading + clamp(angleDiff(e.f.heading, headingTo(e.target.pos.x - e.f.pos.x, e.target.pos.z - e.f.pos.z)), -4 * sdt, 4 * sdt);
      if (e.state === 'idle' && sp < 0.4 && !e.f.action && !e.f.dead) {
        if (e.f.c.state !== e.restAnim) e.f.c.play(e.restAnim, false, 0.3);
        e.f.c.params.armed = 0;
      } else if (e.state !== 'notice') {
        e.f.animate(sdt, sp, sp > 6);
        if (e.state === 'patrol') e.f.c.params.armed = 0.5;
      }
      if (near || e.engaged) e.f.c.update(sdt);
      else if (Math.floor(this.time * 30) % 3 === 0) e.f.c.update(sdt * 3);
    }

    // ---- crew ----
    for (const a of this.allies) {
      this.drive(a.f, a.target?.f ?? null);
      const sp = a.update(sdt, this, f);
      const done = a.f.update(sdt);
      if (done) a.onActionDone(done.kind);
      a.f.animate(sdt, sp, sp > 6.5);
      if (a.f.dead && a.f.c.state !== 'death' && a.f.c.state !== 'dizzy') a.f.c.play('dizzy', true);
      a.f.c.update(sdt);
      if (a.readyToStand && !this.engaged) a.standUp();
    }

    // ---- hits ----
    this.resolveSwings(f);
    for (const e of this.enemies) if (!e.hidden) this.resolveSwings(e.f);
    for (const a of this.allies) this.resolveSwings(a.f);
    this.updateBullets(sdt);
    this.updateBurns(sdt);
    this.updateTrails(sdt);

    // ---- the fallen ----
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.f.dead && e.f.deadT > 3.4) {
        this.game.particles.smoke(e.f.pos.clone().setY(e.f.pos.y + 0.5), 0.15, 1.2);
        this.removeEnemy(e);
        this.enemies.splice(i, 1);
        if (this.lock === e) this.lock = null;
      }
    }
    if (this.lock && (this.lock.f.dead || this.lock.f.pos.distanceTo(f.pos) > 28)) {
      // locked foe fell: hop to the next one close by
      const was = this.lock;
      this.lock = null;
      if (was.f.dead) {
        const n = this.nearestFoe(12);
        if (n) this.lock = n;
      }
    }

    // ---- loot ----
    for (const p of this.loot.update(sdt, f.pos, this.area)) this.collect(p);
    if (this.pendingEquip && (this.pendingEquip.t -= dt) <= 0) this.pendingEquip = null;

    // ---- sites, combat mode, camera, townsfolk ----
    this.siteT -= dt;
    if (this.siteT <= 0) {
      this.siteT = 0.25;
      this.updateSites(0.25, false);
    }
    this.updateSitePrompts();
    this.updateFires(dt);
    const engaged = this.engaged;
    if (f.drawn) {
      if (!engaged && f.sinceCombat > 3 && !f.aiming && !f.blocking && !f.action) this.calmT += dt;
      else this.calmT = 0;
      if (this.calmT > 4.5) this.sheathe();
    }
    const cam = g.camRig;
    cam.lockOn = this.lock && !this.lock.f.dead ? this.lock.f.pos : null;
    // when a swing or shot turns the captain toward a foe, the camera swings round behind him
    const pa = f.action;
    cam.followYaw = f.drawn && !cam.lockOn && !f.aiming && pa && (pa.kind === 'attack' || pa.kind === 'heavy' || pa.kind === 'shoot') ? f.heading : null;
    cam.aimK += ((f.aiming ? 1 : 0) - cam.aimK) * Math.min(1, dt * 10);
    cam.fightK += ((f.drawn ? 1 : 0) - cam.fightK) * Math.min(1, dt * 2);
    if (engaged && !this.onIsland) {
      this.scareT -= dt;
      if (this.scareT <= 0) {
        this.scareT = 0.6;
        for (const e of this.enemies) if (e.engaged && !e.f.dead) g.life.scare(e.f.pos, 16);
      }
    }
    for (const [fi, t] of this.telegraphs) if (t < this.time || fi.dead) this.telegraphs.delete(fi);
    this.updateTips(dt);

    // ---- defeat ----
    if (this.defeated) {
      this.defeatT += dt;
      if (this.defeatT > 1.8 && !this.hud.defeatShown) {
        this.hud.showDefeat(this.onIsland);
        g.input.unlockPointer();
      }
    }
    this.hud.update(dt);
  }

  /** Roll and lunge velocities from the current action. */
  private drive(f: Fighter, opp: Fighter | null) {
    const a = f.action;
    if (!a) return;
    const k = f.progress;
    if (a.kind === 'roll') {
      const sp = 11.5 * Math.pow(1 - clamp(k / 0.78, 0, 1), 0.65);
      f.push.set(Math.sin(f.heading) * sp, 0, Math.cos(f.heading) * sp);
      if (k > 0.3 && k < 0.36 && !a.began) {
        a.began = true;
        this.game.particles.dust(f.pos.clone().setY(f.pos.y + 0.1), 0.25);
      }
      return;
    }
    if (a.lunge && a.active) {
      const until = a.tag === 'rush' ? 1 : a.active[1];
      if (k >= Math.max(0, a.active[0] - 0.15) && k <= until) {
        let sp = a.lunge;
        if (opp && !opp.dead) {
          const d = Math.hypot(opp.pos.x - f.pos.x, opp.pos.z - f.pos.z) - f.radius - opp.radius;
          const ahead = Math.abs(angleDiff(f.heading, headingTo(opp.pos.x - f.pos.x, opp.pos.z - f.pos.z))) < 0.8;
          if (ahead && d < 0.5 && a.tag !== 'rush') sp = 0;
        }
        f.push.x = Math.sin(f.heading) * sp;
        f.push.z = Math.cos(f.heading) * sp;
        if (a.tag === 'rush' && Math.random() < 0.3) this.game.particles.dust(f.pos.clone().setY(f.pos.y + 0.1), 0.2);
      }
    }
  }

  private onPlayerActionDone(a: Action) {
    if (a.kind === 'reload') {
      this.finishReload();
      audio.play('click', { pitch: 0.7 });
    }
  }

  // =====================================================================
  // Hits
  // =====================================================================
  private opponents(f: Fighter): Fighter[] {
    if (f.team === 'enemy') {
      const list = [this.player];
      for (const a of this.allies) if (!a.f.dead) list.push(a.f);
      return list;
    }
    const list: Fighter[] = [];
    for (const e of this.enemies) if (!e.f.dead && !e.hidden) list.push(e.f);
    return list;
  }

  private resolveSwings(att: Fighter) {
    const a = att.action;
    if (!a?.swing || !a.active || att.dead) return;
    const k = att.progress;
    if (!a.began && k >= a.active[0]) {
      a.began = true;
      // the swing whooshes as it starts
      const snd = a.swing.sound ?? 'medium';
      audio.play('swing', { pos: att.pos, pitch: (snd === 'heavy' ? 0.6 : snd === 'light' ? 1.25 : 0.9) * rand(0.92, 1.08), volume: att.team === 'player' ? 0.6 : 0.4 });
      if (a.tag === 'slam') this.slamFx(att, a.swing);
    }
    if (!att.swingLive) return;
    // a whirlwind can hit the same person more than once
    if (a.tag === 'spin') {
      const ax = a as Action & { spinN?: number };
      const n = Math.floor(a.t / 0.45);
      if (ax.spinN !== n) {
        ax.spinN = n;
        a.hits.clear();
      }
    }
    const sw = a.swing;
    const fwd = att.forward(_a);
    for (const t of this.opponents(att)) {
      if (a.hits.has(t)) continue;
      const dy = t.pos.y - att.pos.y;
      if (Math.abs(dy) > 1.7) continue;
      if (sw.aoe) {
        const cx = att.pos.x + fwd.x * (sw.aoeAt ?? 0);
        const cz = att.pos.z + fwd.z * (sw.aoeAt ?? 0);
        if (Math.hypot(t.pos.x - cx, t.pos.z - cz) - t.radius > sw.aoe) continue;
      } else {
        const dx = t.pos.x - att.pos.x;
        const dz = t.pos.z - att.pos.z;
        const d = Math.hypot(dx, dz);
        if (d - t.radius > sw.reach) continue;
        if (sw.arc < Math.PI) {
          const ang = Math.abs(angleDiff(att.heading, Math.atan2(dx, dz)));
          if (ang > sw.arc + Math.atan2(t.radius, Math.max(d, 0.2))) continue;
        }
      }
      a.hits.add(t);
      this.applyHit(att, t, sw, false);
      // thunderclap finishers shake everyone around
      if (sw.finisher && att.team === 'player' && att.melee?.effect === 'thunder' && !a.tag) {
        a.tag = 'thunder';
        this.thunder(att, sw);
      }
    }
  }

  private thunder(att: Fighter, sw: Swing) {
    const c = att.pos.clone().addScaledVector(att.forward(_a), 1.2);
    this.ring(c, 3.4, '#9fd8ff');
    audio.play('thunder', { pos: c, volume: 0.5 });
    for (const t of this.opponents(att)) {
      if (t.pos.distanceTo(c) < 3.6 + t.radius) this.applyHit(att, t, { ...sw, dmg: sw.dmg * 0.6, knockback: sw.knockback * 0.8, finisher: false, heavy: true }, false, true);
    }
  }

  /**
   * One hit lands: dodges, parries, blocks, guard breaks, damage, poise, knockback, effects,
   * damage numbers and deaths all happen here.
   */
  applyHit(att: Fighter, t: Fighter, sw: Swing, ranged: boolean, splash = false) {
    if (t.dead) return;
    const hitPos = t.chest(new THREE.Vector3());
    const from = headingTo(att.pos.x - t.pos.x, att.pos.z - t.pos.z);
    if (t.invulnerable) {
      if (t.team === 'player' && !ranged) this.text(hitPos, 'DODGE!', 'dodge');
      return;
    }
    const isPlayer = t.team === 'player';
    const byPlayer = att.team === 'player';
    let dmg = sw.dmg * att.dmgMul * rand(0.92, 1.08);
    const crit = byPlayer && !splash && Math.random() < (att.weapon?.crit ?? 0.08);
    if (crit) dmg *= 1.6;
    dmg *= t.defMul;
    const facing = Math.abs(angleDiff(t.heading, from)) < 1.45;
    let blocked = false;
    const crushing = byPlayer && att.melee?.effect === 'crushing' && !ranged;
    if (t.blocking && facing && !sw.unblockable && !splash) {
      // a fresh guard against an ordinary swing: PARRY
      if (!ranged && !sw.heavy && t.blockT < 0.22) {
        this.parry(t, att, hitPos);
        return;
      }
      const cost = dmg * (sw.heavy ? 1.7 : 0.9) * (crushing ? 1.6 : 1) + 6;
      if (t.stamina >= cost) {
        t.useStamina(cost, 0.9);
        dmg *= sw.heavy ? 0.45 : ranged ? 0.25 : 0.15;
        blocked = true;
        this.sparks(hitPos, att.pos, '#bfe4ff', sw.heavy ? 16 : 10);
        audio.play('blockHit', { pos: t.pos, pitch: sw.heavy ? 0.7 : rand(0.95, 1.1), volume: 0.8 });
        t.push.x += Math.sin(from + Math.PI) * sw.knockback * 0.35;
        t.push.z += Math.cos(from + Math.PI) * sw.knockback * 0.35;
        this.text(hitPos, sw.heavy ? 'GUARD!' : 'BLOCKED', 'block');
        t.c.trigger('flinch', 0.25);
        if (t.team === 'enemy') this.enemyOf(t)?.onBlocked();
        if (isPlayer) this.game.camRig.addShake(sw.heavy ? 0.22 : 0.08);
        this.hitStop = Math.max(this.hitStop, 0.035);
      } else {
        // out of stamina: the guard breaks
        t.useStamina(t.stamina, 1.4);
        t.blocking = false;
        t.blockCD = 0.9;
        dmg *= 0.6;
        this.text(hitPos, 'GUARD BREAK!', 'warn');
        audio.play('blockHit', { pos: t.pos, pitch: 0.55 });
        staggerAction(t, 0.85);
      }
    }

    dmg = Math.max(1, Math.round(dmg));
    t.hp -= dmg;
    t.sinceCombat = 0;
    att.sinceCombat = 0;
    t.hitFlash(blocked ? 0.25 : 0.9);
    // knockback away from the attacker
    const kb = sw.knockback * (1 - t.kbResist) * (blocked ? 0.4 : 1) * (crit ? 1.2 : 1);
    t.push.x += Math.sin(from + Math.PI) * kb;
    t.push.z += Math.cos(from + Math.PI) * kb;
    if (byPlayer && att.weapon?.effect === 'secondWind') att.hp = Math.min(att.maxHp, att.hp + dmg * 0.07);
    if (byPlayer && att.weapon?.effect === 'embers' && !blocked) {
      t.burnT = 3;
      t.burnDps = 3 + dmg * 0.06;
      t.burnBy = att;
    }

    // effects
    if (!blocked) {
      const heavy = !!sw.heavy || !!sw.finisher;
      this.sparks(hitPos, att.pos, heavy ? '#ffd27a' : '#fff1c4', heavy ? 16 : 9);
      this.flashAt(hitPos, heavy ? 0.9 : 0.55);
      audio.play('hitFlesh', { pos: t.pos, pitch: (heavy ? 0.75 : 1) * rand(0.9, 1.1), volume: 0.9 });
      if (byPlayer || isPlayer) {
        this.hitStop = Math.max(this.hitStop, sw.heavy ? 0.1 : sw.finisher ? 0.08 : ranged ? 0.02 : 0.045);
        this.game.camRig.addShake(isPlayer ? (heavy ? 0.4 : 0.2) : heavy ? 0.28 : 0.1);
      }
      if (isPlayer) {
        this.game.ui.flashDamage();
        this.game.post.grade.uniforms.uDamage.value = Math.max(this.game.post.grade.uniforms.uDamage.value, heavy ? 0.6 : 0.35);
      }
    }
    if (isPlayer) this.text(hitPos, `-${dmg}`, 'hurt');
    else this.text(hitPos, crit ? `${dmg}!` : String(dmg), crit ? 'crit' : sw.finisher || sw.heavy ? 'big' : blocked ? 'chip' : t.team === 'ally' ? 'ally' : 'dmg');

    if (t.hp <= 0) {
      this.kill(t, att);
      return;
    }
    if (t.team === 'enemy') this.enemyOf(t)?.onHurt(this, att);
    if (blocked) return;
    // reaction: poise decides whether this interrupts
    const poiseDmg = dmg * (sw.heavy ? 1.6 : sw.finisher ? 1.3 : 1) * (crushing ? 1.5 : 1);
    const armored = !!t.action?.armor && t.action.kind !== 'charge';
    const broke = t.breakPoise(poiseDmg);
    if (broke && !(armored && !sw.heavy)) {
      t.blocking = false;
      if ((sw.heavy || (sw.finisher && t.maxPoise <= 0)) && t.kbResist < 0.7) {
        knockdownAction(t);
        audio.play('thud', { pos: t.pos, delay: 0.25, volume: 0.7 });
        this.game.particles.dust(t.pos.clone().setY(t.pos.y + 0.1), 0.45);
      } else staggerAction(t, sw.stun * (crushing ? 1.4 : 1));
      if (t.team === 'player') {
        this.charging = false;
        this.comboStep = 0;
      }
    } else t.c.trigger('hit', 0.3);
    if (t.team === 'player' || t.team === 'ally') t.c.express('hurt', 0.6);
    if (isPlayer && !this.player.drawn) this.drawWeapon();
  }

  private parry(t: Fighter, att: Fighter, at: THREE.Vector3) {
    this.sparks(at, att.pos, '#d8f4ff', 26);
    this.flashAt(at, 1.3);
    audio.play('parry', { pos: t.pos });
    this.text(at, 'PARRY!', 'parry');
    this.hitStop = Math.max(this.hitStop, 0.12);
    this.game.camRig.addShake(0.2);
    t.stamina = Math.min(t.maxStamina, t.stamina + 12);
    t.c.trigger('flinch', 0.2);
    // the attacker reels (bosses only lose poise)
    if (att.team === 'enemy' && this.enemyOf(att)?.isBoss) {
      if (att.breakPoise(45)) staggerAction(att, 0.9);
    } else staggerAction(att, 1.0);
    if (t.team === 'enemy') this.enemyOf(t)?.onBlocked();
  }

  private kill(t: Fighter, by: Fighter) {
    t.hp = 0;
    t.dead = true;
    t.blocking = false;
    t.aiming = false;
    t.burnT = 0;
    deathAction(t);
    t.push.multiplyScalar(1.3);
    audio.play('thud', { pos: t.pos, delay: 0.5, volume: 0.8 });
    if (t.team === 'enemy') {
      const e = this.enemyOf(t)!;
      e.token = false;
      t.c.express('hurt');
      this.onEnemyKilled(e);
    } else if (t.team === 'ally') {
      const al = this.allies.find((a) => a.f === t);
      if (al?.escort) this.escortDown();
      else this.game.ui.toast('🤕 Crew down!', `${t.name} is out cold – they'll get up after the fight.`, 'danger');
    } else {
      // the captain falls
      this.defeated = true;
      this.defeatT = 0;
      this.lock = null;
      this.charging = false;
      this.profile.land.defeats++;
      this.game.camRig.addShake(0.5);
      audio.play('oof', { pitch: 0.8 });
      for (const e of this.enemies) if (!e.f.dead && e.engaged) e.f.start({ kind: 'victory', anim: 'cheer', dur: 3, cancelAt: 1 });
      this.game.camRig.setOrbit(t.pos.clone(), 7, 3.2, 0.22, 0.6);
    }
  }

  private enemyOf(f: Fighter) {
    return this.enemies.find((e) => e.f === f) ?? null;
  }

  private updateBurns(dt: number) {
    const all: Fighter[] = [this.player];
    for (const e of this.enemies) all.push(e.f);
    for (const t of all) {
      if (t.burnT <= 0 || t.dead) continue;
      t.burnT -= dt;
      t.hp -= t.burnDps * dt;
      if (Math.random() < dt * 14) this.game.particles.fire(t.chest(_a).add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.5, 0.4), rand(-0.3, 0.3))), 0.25);
      if (t.hp <= 0) this.kill(t, t.burnBy ?? this.player);
    }
  }

  // =====================================================================
  // Bullets
  // =====================================================================
  private spawnBullet(owner: Fighter, from: THREE.Vector3, dir: THREE.Vector3, speed: number, dmg: number, kb: number, pierce: boolean) {
    const mesh = this.bulletPool.pop() ?? new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.visible = true;
    this.game.scene.add(mesh);
    mesh.position.copy(from);
    mesh.scale.set(1, 1, 4);
    mesh.quaternion.setFromUnitVectors(Z, dir);
    this.bullets.push({ mesh, pos: mesh.position, vel: dir.clone().multiplyScalar(speed), owner, dmg, kb, life: (owner.gun?.range ?? 30) / speed + 0.15, pierce, hits: new Set() });
  }

  private freeBullet(b: Bullet) {
    b.mesh.removeFromParent();
    this.bulletPool.push(b.mesh);
  }

  private updateBullets(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      let dead = b.life <= 0;
      const steps = Math.max(1, Math.ceil((b.vel.length() * dt) / 0.35));
      const sdt = dt / steps;
      const opp = this.opponents(b.owner);
      for (let s = 0; s < steps && !dead; s++) {
        b.pos.addScaledVector(b.vel, sdt);
        for (const t of opp) {
          if (b.hits.has(t) || t.dead) continue;
          const dx = b.pos.x - t.pos.x;
          const dz = b.pos.z - t.pos.z;
          if (dx * dx + dz * dz > (t.radius + 0.1) ** 2) continue;
          if (b.pos.y < t.pos.y + 0.15 || b.pos.y > t.pos.y + t.height) continue;
          if (t.invulnerable) {
            if (t.team === 'player') this.text(t.chest(), 'DODGE!', 'dodge');
            b.hits.add(t);
            continue;
          }
          b.hits.add(t);
          this.applyHit(b.owner, t, { dmg: b.dmg / b.owner.dmgMul, reach: 0, arc: 0, knockback: b.kb, stun: 0.35, sound: 'light' }, true);
          if (!b.pierce) {
            dead = true;
            break;
          }
        }
        if (dead) break;
        // walls, trees and the ground stop shots
        const ground = this.area.surface(b.pos.x, b.pos.z, b.pos.y + 0.2, 0.3);
        if ((ground !== null && b.pos.y < ground) || (b.pos.y < 3.5 && this.area.blocked(b.pos.x, b.pos.z, 0.02))) {
          this.game.particles.dust(b.pos.clone(), 0.12);
          this.sparks(b.pos, b.pos.clone().sub(b.vel), '#ffe2a0', 5);
          dead = true;
        }
      }
      if (Math.random() < 0.5) this.game.particles.smoke(b.pos.clone(), 0.1, 0.12);
      if (dead) {
        this.freeBullet(b);
        this.bullets.splice(i, 1);
      }
    }
  }

  // =====================================================================
  // Effects
  // =====================================================================
  private sparks(at: THREE.Vector3, from: THREE.Vector3, color: string, n: number) {
    const c = new THREE.Color(color);
    const away = _c.subVectors(at, from).setY(0).normalize();
    const glow = this.game.particles.glow;
    for (let i = 0; i < n; i++) {
      const sp = rand(5, 12);
      glow.spawn({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: (away.x + rand(-0.9, 0.9)) * sp,
        vy: rand(-1, 4),
        vz: (away.z + rand(-0.9, 0.9)) * sp,
        size: rand(0.03, 0.06),
        max: rand(0.16, 0.32),
        curve: 'shrink',
        stretch: 0.09,
        grav: 14,
        drag: 2,
        r: c.r * 3.2,
        g: c.g * 3.2,
        b: c.b * 3.2,
      });
    }
  }

  private flashAt(at: THREE.Vector3, size: number) {
    this.game.particles.glow.spawn({ x: at.x, y: at.y, z: at.z, size: size * 0.55, max: 0.09, curve: 'shrink', r: 4, g: 3.6, b: 2.6 });
  }

  private ring(at: THREE.Vector3, radius: number, color: string) {
    const c = new THREE.Color(color);
    this.game.particles.ring.spawn({ x: at.x, y: at.y + 0.15, z: at.z, size: radius, max: 0.45, curve: 'grow', rx: 0, ry: 0, rz: 0, r: c.r * 2, g: c.g * 2, b: c.b * 2 });
  }

  private slamFx(att: Fighter, sw: Swing) {
    const c = att.pos.clone().addScaledVector(att.forward(_a), sw.aoeAt ?? 0);
    const y = this.area.surface(c.x, c.z, att.pos.y + 1) ?? att.pos.y;
    c.y = y;
    this.ring(c, sw.aoe ?? 3, '#ffb36b');
    this.game.particles.dust(c.clone().setY(y + 0.1), 1.1);
    for (let i = 0; i < 8; i++) this.game.particles.fire(c.clone().add(new THREE.Vector3(rand(-2, 2), 0.2, rand(-2, 2))), 0.5);
    audio.play('slam', { pos: c });
    this.game.camRig.addShake(0.55);
  }

  private text(at: THREE.Vector3, s: string, cls: string) {
    this.game.ui.combatText(at, s, cls);
  }

  private updateTrails(dt: number) {
    const fighters: Fighter[] = [this.player];
    for (const e of this.enemies) if (!e.hidden) fighters.push(e.f);
    for (const a of this.allies) fighters.push(a.f);
    for (const f of fighters) {
      const a = f.action;
      const w = f.melee;
      const swinging = !!a?.swing && !!a.active && !f.useGun && f.progress >= a.active[0] - 0.08 && f.progress <= a.active[1] + 0.04 && !f.dead;
      let tr = this.trails.find((t) => t.owner === f);
      if (swinging && !tr && f.propObj && w) {
        tr = this.trails.find((t) => !t.busy);
        const near = f.pos.distanceTo(this.game.camRig.camera.position) < 40;
        if (tr && near) tr.start(f, f.propObj, w.base.blade, f.team === 'player' ? w.color === RARITIES.common.color ? w.base.trail : w.color : a?.swing?.heavy ? '#ff9a6a' : '#ffffff');
      } else if (!swinging && tr?.live) tr.stop();
    }
    for (const t of this.trails) t.update(dt);
  }

  /** Flickering campfires and torches at nearby sites. */
  private updateFires(dt: number) {
    this.fireT -= dt;
    if (this.fireT > 0) return;
    this.fireT = 0.12;
    const cam = this.game.camRig.camera.position;
    for (const s of this.sites) {
      if (s.land !== this.land) continue;
      for (const p of s.geo.fires) if (p.distanceTo(cam) < 70 && Math.random() < 0.7) this.game.particles.fire(p.clone(), 0.32);
    }
  }

  /** Hide far-away site scenery (called by the game a couple of times a second). */
  updateSiteVisibility(focus: THREE.Vector3) {
    for (const s of this.sites) s.geo.group.visible = s.geo.center.distanceTo(focus) < 260;
  }

  /** Every fight on this land starts over (after being patched up). */
  resetFights() {
    for (const s of this.sites) if (s.land === this.land && s.status === 'active') this.despawnSite(s);
    for (const e of this.enemies) this.removeEnemy(e);
    this.enemies.length = 0;
    this.lock = null;
  }

  // =====================================================================
  // Loot
  // =====================================================================
  private onEnemyKilled(e: Enemy) {
    const p = this.profile;
    const t = e.type;
    const sc = tierScale(e.tier);
    const rng = Math.random;
    p.land.kills++;
    this.game.addXp(Math.round(t.xp * sc.xp));
    const at = e.f.pos.clone().setY(e.f.pos.y + 1.1);
    // gold, in a few piles
    const gilded = this.player.weapon?.effect === 'gilded' || this.player.melee?.effect === 'gilded';
    let gold = rand(t.gold[0], t.gold[1]) * sc.gold * (gilded ? 1.5 : 1);
    const piles = e.isBoss ? 10 : 1 + Math.floor(rng() * 3);
    for (let i = 0; i < piles; i++) this.loot.spawn('gold', at, Math.max(1, Math.round(gold / piles)));
    const L = t.loot;
    if (rng() < L.shot) this.loot.spawn('shot', at, 2 + Math.floor(rng() * 3));
    if (rng() < L.scrap) this.loot.spawn('scrap', at, 1 + Math.floor(rng() * (e.isBoss ? 6 : 2)) + (e.isBoss ? 4 : 0));
    if (rng() < 0.12 && !e.isBoss) this.loot.spawn('heal', at, 1);
    if (rng() < L.weapon) {
      const firstBoss = e.isBoss && !p.land.bosses.includes(t.id);
      const min: Rarity = firstBoss ? 'legendary' : (L.min ?? 'common');
      this.loot.spawn('weapon', at, 1, { weapon: rollWeapon(rng, p.level, L.luck + e.tier * 0.12, min) });
    }
    if (rng() < L.cargo) {
      const pool: CargoId[] = e.isBoss ? ['goldware', 'jewels', 'rare'] : ['rum', 'silk', 'pepper', 'cloth', 'metal'];
      this.loot.spawn('cargo', at, e.isBoss ? 3 : 1, { cargo: choose(pool) });
    }
    if (rng() < L.rare) this.loot.spawn('rare', at, 1, { rare: 'map' });
    if (e.isBoss) {
      if (!p.land.bosses.includes(t.id)) p.land.bosses.push(t.id);
      this.hud.setBoss(null);
      this.boss = null;
      this.game.ui.banner(`${t.name.toUpperCase()} DEFEATED!`, t.boss!.title, [{ text: `⭐ +${Math.round(t.xp * sc.xp)} XP`, gold: true }], '', 4.5);
      audio.play('fanfare');
      for (const o of this.enemies) if (o.siteId === e.siteId && !o.f.dead && !o.isBoss) o.f.start({ kind: 'special', tag: 'roar', anim: 'panic', dur: 1, cancelAt: 1 });
    }
    saveProfile(p);
  }

  private collect(pk: Pickup) {
    const g = this.game;
    const p = this.profile;
    const at = this.player.chest().clone().setY(this.player.pos.y + 2.1);
    switch (pk.kind) {
      case 'gold':
        g.addMoney(pk.amount);
        audio.play('coin', { pitch: rand(0.95, 1.1), volume: 0.6 });
        g.ui.coinText(at, `+${fmtMoney(pk.amount)}`);
        break;
      case 'shot':
        p.shot += pk.amount;
        audio.play('click', { pitch: 0.8 });
        this.text(at, `+${pk.amount} shot`, 'pickup');
        break;
      case 'scrap':
        p.scrap += pk.amount;
        audio.play('clang', { volume: 0.4, pitch: 1.4 });
        this.text(at, `+${pk.amount} scrap`, 'pickup');
        break;
      case 'heal': {
        const f = this.player;
        const n = Math.round(f.maxHp * 0.35);
        f.hp = Math.min(f.maxHp, f.hp + n);
        audio.play('yay', { volume: 0.5 });
        this.text(at, `+${n} ❤️`, 'heal');
        break;
      }
      case 'cargo': {
        const id = pk.cargo!;
        const n = pk.amount;
        if (g.cargoCount + n <= g.cargoCapacity) {
          p.cargo[id] = (p.cargo[id] ?? 0) + n;
          p.costBasis[id] = p.costBasis[id] ?? 0;
          g.ui.toast(`📦 ${CARGO[id].icon} ${CARGO[id].name} ×${n}`, 'Hauled back to your ship’s hold.', 'good');
        } else {
          const v = CARGO[id].value * n;
          g.addMoney(v);
          g.ui.toast(`📦 ${CARGO[id].name}`, `Your hold is full – sold on the spot for ${fmtMoney(v)}.`, 'info');
        }
        audio.play('cash', { volume: 0.5 });
        break;
      }
      case 'weapon': {
        const w = pk.weapon!;
        p.weapons.push(w);
        const s = weaponStats(w);
        const cur = s.kind === 'ranged' ? this.player.gun : this.player.melee;
        const better = !cur || weaponDps(s) > weaponDps(cur) * 1.02;
        this.pendingEquip = { uid: w.uid, t: 12 };
        audio.play(w.rarity === 'legendary' || w.rarity === 'epic' ? 'fanfare' : 'treasure', { volume: 0.7 });
        g.ui.toast(
          `${s.base.icon} <span style="color:${RARITIES[w.rarity].color}">${weaponName(w)}</span>`,
          `${RARITIES[w.rarity].name} ${s.base.name}${w.effect ? ` · ${EFFECTS[w.effect].icon} ${EFFECTS[w.effect].name}` : ''}${better ? ' · <b>better than yours!</b>' : ''} — press <b>G</b> to equip`,
          'mission',
        );
        break;
      }
      case 'rare': {
        const left = g.unmappedTreasure();
        if (left.length) {
          const isl = choose(left);
          p.maps.push(isl.name);
          g.ui.toast('🗺️ Treasure map!', `X marks the spot on ${isl.name}. It's on your map now.`, 'mission');
        } else {
          p.cargo.rare = (p.cargo.rare ?? 0) + 1;
          g.ui.toast('🏺 Rare curio', 'A strange relic – collectors pay well.', 'mission');
        }
        audio.play('treasure');
        break;
      }
    }
  }

  /** Coins, shot and scrap bursting out of a site's chest. */
  private openSiteChest(s: SiteRun) {
    const g = this.game;
    const p = this.profile;
    s.chestOpen = true;
    openChest(s.geo);
    const at = s.geo.chest!.clone().setY(s.geo.chest!.y + 1.2);
    const sc = tierScale(s.tier);
    const boss = s.def.enc === 'boss';
    const gold = (boss ? 900 : 140) * sc.gold * rand(0.85, 1.2);
    for (let i = 0; i < (boss ? 12 : 5); i++) this.loot.spawn('gold', at, Math.round(gold / (boss ? 12 : 5)));
    this.loot.spawn('scrap', at, 2 + Math.floor(Math.random() * 3) + (boss ? 4 : 0));
    this.loot.spawn('shot', at, 4 + Math.floor(Math.random() * 4));
    const wChance = boss ? 1 : s.def.site === 'fort' ? 0.6 : 0.35;
    if (Math.random() < wChance) this.loot.spawn('weapon', at, 1, { weapon: rollWeapon(Math.random, p.level, 0.5 + s.tier * 0.25, boss ? 'rare' : 'common') });
    if (boss) this.loot.spawn('rare', at, 1, { rare: 'map' });
    else if (Math.random() < 0.3) this.loot.spawn('cargo', at, 2, { cargo: choose(['rum', 'silk', 'jewels', 'pepper'] as CargoId[]) });
    g.particles.coins(at, 30);
    g.particles.confettiBurst(at, boss ? 80 : 30);
    audio.play('treasure');
    audio.play('cash', { delay: 0.25 });
    saveProfile(p);
  }

  // =====================================================================
  // Encounter sites
  // =====================================================================
  private spawnEnemy(id: EnemyId, tier: number, pos: THREE.Vector3, facing: number, siteId: string) {
    const e = new Enemy(id, tier, pos, facing);
    e.siteId = siteId;
    this.game.scene.add(e.f.c.root);
    this.enemies.push(e);
    return e;
  }

  private removeEnemy(e: Enemy) {
    for (const t of this.trails) if (t.owner === e.f) t.release();
    this.telegraphs.delete(e.f);
    e.f.dispose();
  }

  /** A walkable spot at radius rMin..rMax from a point (around angle a0 if given). */
  private findSpot(c: THREE.Vector3, rMin: number, rMax: number, a0?: number) {
    for (let i = 0; i < 24; i++) {
      const a = a0 !== undefined ? a0 + rand(-0.6, 0.6) * (1 + i * 0.1) : rand(0, Math.PI * 2);
      const r = rand(rMin, rMax);
      const x = c.x + Math.sin(a) * r;
      const z = c.z + Math.cos(a) * r;
      const y = this.area.surface(x, z, c.y + 2, 3);
      if (y === null || y < 0.6 || this.area.blocked(x, z, 0.6)) continue;
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  /** Effective difficulty: the site's tier, nudged up as the captain levels. */
  private tierFor(def: SiteDef) {
    return clamp(Math.max(def.tier, Math.round(this.profile.level / 8)), 1, 7);
  }

  private spawnSite(s: SiteRun) {
    s.status = 'active';
    s.enemies = [];
    s.triggered = false;
    s.bossIntro = false;
    s.engagedAt = null;
    s.tier = this.tierFor(s.def);
    const geo = s.geo;
    const posts = geo.posts;
    const def = s.def;
    const foes: EnemyId[] = [...(def.boss ? [def.boss] : []), ...def.foes];
    if (def.enc === 'escort') {
      const post = posts[0];
      const npc = new Ally('castaway', 'Old Barnaby', 0, this.profile.level, true);
      npc.f.pos.copy(post.pos);
      npc.f.heading = post.facing;
      npc.f.c.root.rotation.y = post.facing;
      npc.f.c.play('wave', true);
      this.game.scene.add(npc.f.c.root);
      s.escort = { npc, phase: 'waiting', wave: 0, start: post.pos.clone(), t: 0, failT: 0 };
      return;
    }
    if (def.enc === 'patrol') {
      // a loop of waypoints around the site
      const route: THREE.Vector3[] = [];
      for (let i = 0; i < 6; i++) {
        const p = this.findSpot(geo.center, 9, 17, (i / 6) * Math.PI * 2);
        if (p) route.push(p);
      }
      foes.forEach((id, i) => {
        const start = route[0]?.clone().add(new THREE.Vector3((i - (foes.length - 1) / 2) * 1.4, 0, 0)) ?? geo.center.clone();
        const y = this.area.surface(start.x, start.z, start.y + 2, 3);
        if (y !== null) start.y = y;
        const e = this.spawnEnemy(id, s.tier, start, 0, def.id);
        e.route = route;
        e.routeIdx = 1 % Math.max(1, route.length);
        e.home = geo.center.clone();
        e.setState('patrol');
        e.f.setDrawn(true);
        s.enemies.push(e);
      });
      return;
    }
    foes.forEach((id, i) => {
      const post = posts[i % posts.length];
      let pos = post.pos.clone();
      if (i >= posts.length) pos = this.findSpot(geo.center, 3, 7) ?? pos;
      const e = this.spawnEnemy(id, s.tier, pos, post.facing, def.id);
      // the boss stands centre stage; the rest sit by the fire or stand guard
      e.rest(i === 0 && def.boss ? 'hips' : post.anim === 'wave' ? 'guard' : post.anim);
      if (def.enc === 'ambush') {
        e.hidden = true;
        e.f.c.root.removeFromParent();
        e.setState('ambush');
      }
      s.enemies.push(e);
    });
  }

  private despawnSite(s: SiteRun) {
    for (const e of s.enemies) {
      const i = this.enemies.indexOf(e);
      if (i >= 0) {
        this.enemies.splice(i, 1);
        this.removeEnemy(e);
      }
      if (this.lock === e) this.lock = null;
    }
    s.enemies = [];
    if (s.escort?.npc) {
      const i = this.allies.indexOf(s.escort.npc);
      if (i >= 0) this.allies.splice(i, 1);
      s.escort.npc.f.dispose();
    }
    s.escort = undefined;
    if (s.status === 'active') s.status = 'dormant';
    if (this.boss && !this.enemies.includes(this.boss)) {
      this.boss = null;
      this.hud.setBoss(null);
    }
  }

  /** Wake sites up as the captain approaches, clear them when everyone's down. */
  private updateSites(dt: number, entering: boolean) {
    const p = this.profile;
    const me = this.player.pos;
    for (const s of this.sites) {
      // camps re-occupy after a few days
      if (s.status === 'cleared') {
        const day = p.land.cleared[s.def.id];
        if (day !== undefined && p.day >= day + s.def.respawnDays && (s.land !== this.land || s.geo.center.distanceTo(me) > 90)) {
          s.status = 'dormant';
          s.chestOpen = false;
          closeChest(s.geo);
          delete p.land.cleared[s.def.id];
        }
      }
      if (s.land !== this.land) continue;
      const d = s.geo.center.distanceTo(me);
      if (s.status === 'dormant' && d < (entering ? 95 : 80)) this.spawnSite(s);
      else if (s.status === 'active') {
        const fighting = s.enemies.some((e) => !e.f.dead && e.engaged);
        if (d > 140 && !fighting && s.escort?.phase !== 'walking') this.despawnSite(s);
        else this.tickSite(s, dt);
      }
    }
  }

  private tickSite(s: SiteRun, dt: number) {
    const def = s.def;
    const me = this.player.pos;
    // ambush: they leap out when you walk into the clearing
    if (def.enc === 'ambush' && !s.triggered && me.distanceTo(s.geo.center) < 9 && !this.player.dead) {
      s.triggered = true;
      s.engagedAt = me.clone();
      s.engagedHeading = this.game.walker.heading;
      const n = s.enemies.length;
      s.enemies.forEach((e, i) => {
        const p = this.findSpot(me, 9, 13, (i / n) * Math.PI * 2 + rand(-0.3, 0.3)) ?? e.f.pos;
        e.f.pos.copy(p);
        e.home.copy(s.geo.center);
        e.f.heading = headingTo(me.x - p.x, me.z - p.z);
        e.f.c.root.rotation.y = e.f.heading;
        e.hidden = false;
        this.game.scene.add(e.f.c.root);
        e.f.c.play('jump', true);
        this.game.particles.dust(p.clone().setY(p.y + 0.2), 0.5);
        e.setState('idle');
        e.notice(this);
      });
      this.game.ui.place('AMBUSH!', def.name);
      audio.play('alarm', { volume: 0.6 });
      audio.playVoice('arr', me, 0.8);
      this.game.camRig.addShake(0.2);
      if (!this.player.drawn) this.drawWeapon();
    }
    if (def.enc === 'escort') this.tickEscort(s, dt);
    // everyone down: site cleared
    if (s.enemies.length && s.enemies.every((e) => e.f.dead) && def.enc !== 'escort') this.clearSite(s);
  }

  private clearSite(s: SiteRun) {
    if (s.status === 'cleared') return;
    s.status = 'cleared';
    const p = this.profile;
    p.land.cleared[s.def.id] = p.day;
    const sc = tierScale(s.tier);
    const xp = Math.round(60 * sc.xp * (s.def.enc === 'boss' ? 3 : 1));
    const gold = Math.round(100 * sc.gold * (s.def.enc === 'boss' ? 4 : 1));
    this.game.addXp(xp);
    this.game.addMoney(gold);
    const what = s.def.enc === 'ambush' ? 'AMBUSH SURVIVED!' : s.def.enc === 'patrol' ? 'PATROL DEFEATED!' : s.def.site === 'fort' ? 'FORT CAPTURED!' : s.def.enc === 'boss' ? 'LAIR CONQUERED!' : 'CAMP CLEARED!';
    this.game.ui.banner(what, s.def.name, [{ text: `💰 +${fmtMoney(gold)}`, gold: true }, { text: `⭐ +${xp} XP` }, ...(s.geo.chest ? [{ text: '🧰 Chest unlocked' }] : [])], '', 3.8);
    audio.play('mission');
    const f = this.player;
    if (!f.dead && f.free) f.start({ kind: 'victory', anim: 'victory', dur: 1.3, cancelAt: 0.4 });
    for (const a of this.allies) if (!a.f.dead && !a.escort) a.f.start({ kind: 'victory', anim: 'cheer', dur: 1.5, cancelAt: 0.5 });
    saveProfile(p);
  }

  // ---------------- escort ----------------
  private tickEscort(s: SiteRun, dt: number) {
    const es = s.escort;
    if (!es?.npc) return;
    const npc = es.npc;
    const me = this.player.pos;
    if (es.phase === 'walking') {
      es.t += dt;
      if (npc.f.dead) {
        es.failT += dt;
        if (es.failT > 3) {
          // back to the clearing to try again
          npc.f.revive(1);
          npc.f.pos.copy(es.start);
          es.phase = 'waiting';
          es.failT = 0;
          npc.f.c.play('wave', true);
          this.game.ui.toast('🧭 Old Barnaby', '“Ow… I’ll wait back at my camp. Try again?”', 'info');
        }
        return;
      }
      const total = es.start.distanceTo(this.landing);
      const left = npc.f.pos.distanceTo(this.landing);
      const waves = s.def.waves ?? [];
      // waylaid along the way
      if (es.wave < waves.length && (left < total * (1 - (es.wave + 1) / (waves.length + 1)) || es.t > 12 + es.wave * 16)) {
        const ids = waves[es.wave];
        es.wave++;
        const toBoat = headingTo(this.landing.x - me.x, this.landing.z - me.z);
        ids.forEach((id, i) => {
          const p = this.findSpot(me, 12, 16, toBoat + (i - (ids.length - 1) / 2) * 0.7) ?? this.findSpot(me, 10, 16);
          if (!p) return;
          const e = this.spawnEnemy(id, s.tier, p, headingTo(me.x - p.x, me.z - p.z), s.def.id);
          e.home.copy(p);
          s.enemies.push(e);
          e.notice(this);
        });
        this.game.ui.place('AMBUSH!', 'Protect the cartographer!');
        audio.play('alarm', { volume: 0.5 });
      }
      const foesUp = s.enemies.some((e) => !e.f.dead);
      if (left < 5 && !foesUp) {
        es.phase = 'done';
        const p = this.profile;
        p.land.escorts++;
        const sc = tierScale(s.tier);
        const gold = Math.round(450 * sc.gold);
        const xp = Math.round(160 * sc.xp);
        this.game.addMoney(gold);
        this.game.addXp(xp);
        const left2 = this.game.unmappedTreasure();
        let extra = '';
        if (left2.length) {
          const isl = choose(left2);
          p.maps.push(isl.name);
          extra = `🗺️ Map to ${isl.name}`;
        }
        this.game.ui.banner('ESCORT COMPLETE!', '“Thank ye, Captain! Here – take this for yer trouble.”', [{ text: `💰 +${fmtMoney(gold)}`, gold: true }, { text: `⭐ +${xp} XP` }, ...(extra ? [{ text: extra, gold: true }] : [])], '', 4.5);
        audio.play('fanfare');
        npc.f.c.play('cheer', true);
        p.land.cleared[s.def.id] = p.day;
        s.status = 'cleared';
        // he rows off with your crew's dinghy (and comes back later)
        setTimeout(() => {
          const i = this.allies.indexOf(npc);
          if (i >= 0) this.allies.splice(i, 1);
          this.game.particles.smoke(npc.f.pos.clone().setY(npc.f.pos.y + 0.6), 0.1, 1.4);
          npc.f.dispose();
        }, 2500);
        saveProfile(p);
      }
    }
  }

  private escortDown() {
    this.game.ui.toast('❌ The cartographer is down!', 'Escort failed – he’ll limp back to his camp.', 'danger');
    audio.play('error');
  }

  /** Prompts for chests and the castaway (the game shows them). */
  private updateSitePrompts() {
    this.prompt = null;
    if (this.player.dead || this.defeated) return;
    const me = this.player.pos;
    const input = this.game.input;
    if (this.pendingEquip) {
      const w = this.profile.weapons.find((x) => x.uid === this.pendingEquip!.uid);
      if (w) this.prompt = `<kbd>G</kbd>⚔️ EQUIP <span style="color:${RARITIES[w.rarity].color}">${weaponName(w).toUpperCase()}</span>`;
    }
    for (const s of this.sites) {
      if (s.land !== this.land) continue;
      if (s.geo.chest && !s.chestOpen && s.geo.chest.distanceTo(me) < 2.4) {
        if (s.status === 'cleared') {
          this.prompt = '<kbd>E</kbd>🧰 OPEN THE CHEST';
          if (input.pressed('KeyE')) this.openSiteChest(s);
        } else this.prompt = '🔒 Defeat the guards to open this chest';
      }
      const es = s.escort;
      if (es?.npc && es.phase === 'waiting' && !es.npc.f.dead && es.npc.f.pos.distanceTo(me) < 2.8) {
        this.prompt = '<kbd>E</kbd>💬 TALK TO THE CASTAWAY';
        if (input.pressed('KeyE')) {
          es.phase = 'walking';
          es.t = 0;
          es.wave = 0;
          es.start.copy(es.npc.f.pos);
          if (!this.allies.includes(es.npc)) this.allies.push(es.npc);
          es.npc.f.c.play('idle', true);
          this.game.ui.toast('🧭 Old Barnaby', '“Pirates marooned me! Get me to yer boat and I’ll share my maps!”', 'mission');
          this.game.landObjective = this.landing.clone();
          audio.playVoice('hey', es.npc.f.pos, 0.85);
        }
      }
    }
  }

  // =====================================================================
  // Defeat
  // =====================================================================
  /** Try the fight again from where it started (foes reset, full health). */
  retry() {
    const f = this.player;
    // the fight(s) near the captain start over
    const near = this.sites.filter((s) => s.land === this.land && s.status === 'active' && s.geo.center.distanceTo(f.pos) < 120);
    let spot: THREE.Vector3 | null = null;
    let heading = this.game.walker.heading;
    for (const s of near) {
      if (s.engagedAt && !spot) {
        spot = s.engagedAt.clone();
        heading = s.engagedHeading;
      }
      this.despawnSite(s);
    }
    for (const e of [...this.enemies]) {
      this.removeEnemy(e);
    }
    this.enemies.length = 0;
    // stand a safe distance back from where it began
    const start = spot ?? f.pos.clone();
    if (spot) {
      const back = start.clone().addScaledVector(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)), -4);
      const y = this.area.surface(back.x, back.z, back.y + 2, 3);
      if (y !== null && !this.area.blocked(back.x, back.z, 0.5)) start.set(back.x, y, back.z);
    }
    this.revivePlayer(start, heading);
    for (const s of near) this.spawnSite(s);
  }

  revivePlayer(at: THREE.Vector3, heading: number) {
    const f = this.player;
    this.defeated = false;
    this.defeatT = 0;
    this.hud.hideDefeat();
    this.hud.setBoss(null);
    this.boss = null;
    this.game.walker.place(at, heading);
    f.revive(1);
    f.setDrawn(false);
    this.combatMode = false;
    this.lock = null;
    for (const a of this.allies) if (a.f.dead) a.standUp();
    for (const a of this.allies) {
      a.f.pos.copy(at).add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2)));
      const y = this.area.surface(a.f.pos.x, a.f.pos.z);
      if (y === null) a.f.pos.copy(at);
      else a.f.pos.y = y;
    }
    this.game.camRig.walk(heading + Math.PI, 0.6);
  }

  /** Show a one-time combat tip (queued so they arrive one at a time). */
  private tips: [string, string][] = [];
  private tipT = 0;
  private tip(bit: number, msg: [string, string] | null) {
    if (!msg) return;
    const p = this.profile;
    if (p.land.tut & bit) return;
    p.land.tut |= bit;
    this.tips.push(msg);
  }
  private updateTips(dt: number) {
    this.tipT -= dt;
    if (this.tipT > 0 || !this.tips.length) return;
    const m = this.tips.shift()!;
    this.game.ui.toast(m[0], m[1], 'info');
    this.tipT = 4.5;
  }

  /** Fighter-to-telegraph lookup for the HUD ("!" over wind-ups). */
  telegraphing(f: Fighter) {
    return this.telegraphs.has(f);
  }

  // =====================================================================
  // Gunsmith & armoury (called from the shop and inventory)
  // =====================================================================
  /** Price of a weapon at a gunsmith. */
  static priceOf(base: WeaponItem['base'], rarity: Rarity, mul = 1) {
    const b = weaponStats(makeWeapon(base, rarity)).base;
    return Math.round((b.price * (rarity === 'uncommon' ? 2.3 : 1) * mul) / 10) * 10;
  }

  buyWeapon(base: WeaponItem['base'], rarity: Rarity, mul = 1): string | null {
    const p = this.profile;
    const w0 = makeWeapon(base, rarity);
    const st = weaponStats(w0);
    if (st.base.unlockLevel > p.level) return `Reach level ${st.base.unlockLevel} to buy that.`;
    const price = Combat.priceOf(base, rarity, mul);
    if (p.money < price) return "You can't afford that.";
    p.money -= price;
    p.weapons.push(w0);
    this.equip(w0);
    audio.play('cash');
    if (st.kind === 'ranged') {
      // a new gun comes loaded
      this.player.loaded = st.mag;
    }
    saveProfile(p);
    return null;
  }

  buyShot(n: number, price: number): string | null {
    const p = this.profile;
    if (p.money < price) return "You can't afford that.";
    p.money -= price;
    p.shot += n;
    audio.play('cash');
    saveProfile(p);
    return null;
  }

  upgradeWeapon(uid: string, mul = 1): string | null {
    const p = this.profile;
    const w = p.weapons.find((x) => x.uid === uid);
    if (!w) return 'Weapon not found.';
    const cost = upgradePrice(w);
    if (!cost) return 'Already at its finest.';
    const money = Math.round(cost.money * mul);
    if (p.money < money) return "You can't afford that.";
    if (p.scrap < cost.scrap) return `You need ${cost.scrap} iron scrap (you have ${p.scrap}). Foes and chests drop it.`;
    p.money -= money;
    p.scrap -= cost.scrap;
    w.level++;
    this.applyProfile();
    this.player.refreshProp();
    audio.play('hammer');
    saveProfile(p);
    return null;
  }

  /** Break a spare weapon down into iron scrap. */
  salvage(uid: string): string | null {
    const p = this.profile;
    if (uid === p.melee || uid === p.ranged) return "You can't salvage what you're carrying.";
    const i = p.weapons.findIndex((x) => x.uid === uid);
    if (i < 0) return 'Weapon not found.';
    const w = p.weapons[i];
    const n = 1 + ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(w.rarity) * 2 + w.level;
    p.weapons.splice(i, 1);
    p.scrap += n;
    audio.play('clang', { volume: 0.5 });
    this.game.ui.toast('🔩 Salvaged', `${weaponName(w)} → +${n} iron scrap`, 'info');
    saveProfile(p);
    return null;
  }

  /** Sites on this land for the minimap. */
  landSites() {
    return this.sites.filter((s) => s.land === this.land);
  }
}

/** Distance along a ray to a vertical cylinder (or null). */
function rayCylinder(ro: THREE.Vector3, rd: THREE.Vector3, base: THREE.Vector3, r: number, h: number) {
  const ox = ro.x - base.x;
  const oz = ro.z - base.z;
  const a = rd.x * rd.x + rd.z * rd.z;
  if (a < 1e-6) return null;
  const b = 2 * (ox * rd.x + oz * rd.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const y = ro.y + rd.y * t;
  if (y < base.y || y > base.y + h) return null;
  return t;
}

