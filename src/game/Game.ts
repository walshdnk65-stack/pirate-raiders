import * as THREE from 'three';
import { Input } from '../core/Input';
import { audio } from '../core/Audio';
import { clamp, rand, choose, weightedChoice, fmtMoney, angleDiff, headingTo, lerp, dampT } from '../core/math';
import { globalUniforms, M } from '../render/Materials';
import { GeoBuilder, T, cyl } from '../render/GeoBuilder';
import { CameraRig } from '../render/CameraRig';
import { PostFX } from '../render/PostFX';
import { PlanarReflection } from '../render/Reflection';
import { Ocean } from '../world/Ocean';
import { Environment } from '../world/Environment';
import { buildIslands, IslandBuild, Treasure, groundHeight } from '../world/Islands';
import { buildTowns } from '../world/TownPlans';
import { LandArea, SHORE_Y } from '../world/LandArea';
import type { TownBuild, Interactable, Interior, CircleCol } from '../world/TownTypes';
import { bakeShoreTexture, PORTS, PIERS, ROUTES, ZONES, ISLANDS, landSDF, zoneAt, insideWorld, portById, WORLD_SOFT_EDGE, coastRadius, type IslandDef } from '../world/WorldData';
import { Particles } from '../systems/Particles';
import { Projectiles } from '../systems/Projectiles';
import { Character, warmCharacterCache } from '../models/Character';
import { PlayerShip } from '../entities/PlayerShip';
import { AIShip } from '../entities/AIShip';
import { Ship } from '../entities/Ship';
import { Wanted } from './Wanted';
import { Missions } from './Missions';
import { Contracts } from './Contracts';
import { Boarding } from './Boarding';
import { Raid, RAID_PORTS } from './Raid';
import { Economy, STALLS } from './Economy';
import { TownLife, Npc } from './TownLife';
import { Walker } from './Walker';
import { HUD, WorldMarker } from '../ui/HUD';
import { ShopUI, ShopKind } from '../ui/ShopUI';
import { Inventory } from '../ui/Inventory';
import { Screens } from '../ui/Screens';
import { Birds } from '../systems/Birds';
import { Combat } from './combat/Combat';
import { settings } from './Settings';
import type { MapArea } from '../ui/Minimap';
import { PAL } from '../models/Props';
import {
  Profile,
  newProfile,
  loadProfile,
  saveProfile,
  clearSave,
  CARGO,
  CARGO_IDS,
  CargoId,
  ShipTypeId,
  UPGRADES,
  UpgradeId,
  COSMETICS,
  SHIP_TYPES,
  AMMO,
  AmmoId,
  SPECIAL_ITEMS,
  Officer,
  ROLES,
  recruitsFor,
  xpForLevel,
} from './Data';
import { buildShip, type CannonSide } from '../models/ShipModel';
import { npcDesign } from '../models/ShipDesigns';
import { SHIP_CLASSES, SHIP_CLASS_IDS, shipStats, shipClass, upgradeCost, upgradeValue, upgradeLabel, ROMAN, type ShipClassId, type ShipStats } from './ShipClasses';

/**
 * playing = sailing · docking = gliding into a berth · docked = moored, captain at the wheel
 * land = on foot in a port · shop / dialogue = talking to someone in a port
 * ashore = rowed onto an island without a port (ship at anchor offshore)
 * deck = fighting on the deck of a ship you're boarding
 */
type GameState = 'loading' | 'title' | 'playing' | 'docking' | 'docked' | 'land' | 'shop' | 'dialogue' | 'ashore' | 'deck' | 'dead';

const RUMOURS = [
  "They say a sea monster lives in the Kraken's Teeth, north-east of here.",
  'A one-legged parrot runs the Port Royal black market. After dark, mind you.',
  'Luxury ships carry gold, but they outrun almost everything.',
  'Armoured cargo ships hit hard. Bring a crew of at least a dozen.',
  'Mermaid Lagoon traders sell charms that heal a ship at sea!',
  'Treasure maps turn up in black markets now and then.',
  'Navy frigates only come out when you’re very, very wanted.',
];

/** scratch vectors for per-frame maths (no allocations) */
const _tA = new THREE.Vector3();
const _tB = new THREE.Vector3();

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camRig: CameraRig;
  post!: PostFX;
  reflection!: PlanarReflection;
  input: Input;
  env!: Environment;
  ocean!: Ocean;
  particles = new Particles();
  projectiles: Projectiles;
  ui!: HUD;
  shop!: ShopUI;
  inventory!: Inventory;
  screens!: Screens;
  islands!: IslandBuild;
  towns: TownBuild[] = [];
  lives: TownLife[] = [];
  areas: LandArea[] = [];
  player!: PlayerShip;
  walker!: Walker;
  ships: AIShip[] = [];
  profile: Profile;
  economy: Economy;
  wanted: Wanted;
  missions!: Missions;
  contracts: Contracts;
  boarding: Boarding;
  raid!: Raid;
  birds!: Birds;
  combat!: Combat;
  /** island you've rowed onto (state 'ashore') */
  isle: IslandDef | null = null;
  time = 0;
  state: GameState = 'loading';
  paused = false;
  inPort = true;
  navTarget: THREE.Vector3 | null = null;
  displayMoney = 0;
  aimSide: CannonSide | null = null;
  zoneLabel = '';
  quality: 'high' | 'medium' | 'low' = 'high';
  /** port index where the ship is moored / the player is ashore */
  townIdx = 0;
  lastRumour = '';
  landObjective: THREE.Vector3 | null = null;
  activeInterior: Interior | null = null;
  private qualityLocked = false;
  private adaptT = 0;
  private adaptChecks = 0;
  private shadowFrame = 0;
  private timers: { t: number; fn: () => void }[] = [];
  private spawnT = 4;
  private saveT = 30;
  private dockT = 0;
  private dockFrom = new THREE.Vector3();
  private dockFromHeading = 0;
  private deadT = 0;
  private portraitRenderer: THREE.WebGLRenderer | null = null;
  private portraitScene = new THREE.Scene();
  private portraitCam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private portraitChar: Character | null = null;
  private portraitT = 0;
  private tutorialStep = 0;
  private tutorialT = 0;
  private clock = new THREE.Timer();
  private smokeT = 0;
  private lighthouseT = 0;
  private bigMapOpen = false;
  /** the port we last sailed from (no docking prompt until we've left its harbour) */
  private harbourIdx = 0;
  private leftHarbour = false;
  private townT = 0;
  private prevHour = 0;
  private focusIt: Interactable | null = null;
  private talk: { npc: Npc; lines: string[]; i: number } | null = null;
  private shopNpc: Npc | null = null;
  private embarking = false;
  private interiorLight = new THREE.PointLight(0xffa24a, 0, 16, 1.6);
  private npcCols: CircleCol[] = [];
  private raidScareT = 0;
  private seaColliders: THREE.Object3D[] = [];
  private shadowLand = false;
  private reachT = 0;
  private placeT = 0;
  private anchor = new THREE.Vector3();
  private anchorHeading = 0;
  private rowboat!: THREE.Object3D;
  private isleMaps = new Map<string, MapArea>();
  private deckMap: MapArea = { port: { id: 'deck', name: 'Boarding' }, center: new THREE.Vector3(), radius: 32, platforms: [], map: { footprints: [], marks: [] } };
  private fadeEl: HTMLElement | null = null;
  fps = 60;
  frameTimes = new Float32Array(180);
  frameIdx = 0;
  /** median & p95 frame time (ms) over the last ~3 s */
  frameStats() {
    const a = Array.from(this.frameTimes).filter((x) => x > 0).sort((x, y) => x - y);
    return { med: +a[Math.floor(a.length / 2)].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1), max: +a[a.length - 1].toFixed(1) };
  }
  hudFrame = 0;
  perf = { update: 0, render: 0 };

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.domElement.id = 'game';
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.info.autoReset = false;
    // synchronous shader error checks stall the GPU pipeline; only enable with ?debug
    this.renderer.debug.checkShaderErrors = new URLSearchParams(location.search).has('debug');
    document.body.appendChild(this.renderer.domElement);
    this.camRig = new CameraRig(innerWidth / innerHeight);
    this.input = new Input(this.renderer.domElement);
    this.input.setBindings(settings.keys);
    this.projectiles = new Projectiles(this);
    this.wanted = new Wanted(this);
    this.boarding = new Boarding(this);
    this.contracts = new Contracts(this);
    const saved = loadProfile();
    this.profile = saved ?? newProfile();
    this.economy = new Economy(this.profile);
    this.displayMoney = this.profile.money;
    this.screens = new Screens(
      {
        onPlay: (fresh) => this.play(fresh),
        onResume: () => this.setPaused(false),
        onQuality: (q) => this.setQuality(q),
        getQuality: () => this.quality,
        onKeys: () => {
          this.input.setBindings(settings.keys);
          this.ui?.setHintMode(this.onLand ? 'land' : 'sea', true);
        },
        onRespawn: () => this.respawn(),
        onCloseMap: () => this.toggleMap(false),
      },
      !!saved,
    );
    window.addEventListener('resize', () => this.onResize());
    new ResizeObserver(() => this.onResize()).observe(this.renderer.domElement);
  }

  // =====================================================================
  // Setup
  // =====================================================================
  private stepT = performance.now();
  loadTimes: string[] = [];
  private async step(text: string) {
    const now = performance.now();
    this.loadTimes.push(`${Math.round(now - this.stepT)}ms`);
    this.stepT = now;
    this.screens.setLoading(text);
    await new Promise((r) => setTimeout(r, 30));
  }

  async init() {
    await this.step('Filling the ocean…');
    const shore = bakeShoreTexture(1024);
    this.reflection = new PlanarReflection(innerWidth * this.renderer.getPixelRatio(), innerHeight * this.renderer.getPixelRatio());
    this.ocean = new Ocean(shore, this.reflection.rt.texture);
    this.scene.add(this.ocean.mesh);
    this.env = new Environment(this.scene);
    this.env.hour = this.profile.hour ?? 9.5;
    this.prevHour = this.env.hour;
    this.env.onThunder = (d, i) => audio.thunder(d, i);
    this.env.onWeatherChange = (w) => {
      if (this.state !== 'playing') return;
      const msg: Record<string, [string, string]> = {
        storm: ['⛈️ A storm is brewing!', 'Big waves and lightning – merchants struggle in rough seas.'],
        rain: ['🌧️ Rain clouds roll in', 'Visibility is dropping.'],
        fog: ['🌫️ Thick fog', 'Perfect weather for an ambush…'],
        clear: ['☀️ The skies clear', 'Fair winds, Captain!'],
      };
      const m = msg[w];
      if (m) this.ui.toast(m[0], m[1], 'info');
    };

    await this.step('Raising islands…');
    this.islands = buildIslands();
    this.scene.add(this.islands.group);

    await this.step('Building the ports…');
    warmCharacterCache(['captain']);
    this.towns = buildTowns(this.islands.obstacles);
    for (const t of this.towns) {
      this.scene.add(t.group);
      // towns are static: compute their matrices once (only the gangplank and lighthouse beams move)
      const moving = new Set<THREE.Object3D>();
      for (const o of [t.gangplank, ...t.beams]) o.traverse((x) => moving.add(x));
      t.group.updateMatrixWorld(true);
      t.group.traverse((o) => {
        if (!moving.has(o)) o.matrixAutoUpdate = false;
      });
      const area = new LandArea(t.boxes, t.circles, t.platforms);
      this.areas.push(area);
      this.lives.push(new TownLife(t, area, this.scene));
    }
    this.seaColliders = [...this.islands.colliders, ...this.towns.flatMap((t) => t.camColliders)];
    this.camRig.colliders = this.seaColliders;
    this.interiorLight.castShadow = false;
    this.scene.add(this.interiorLight);

    await this.step('Waking up the townsfolk…');
    warmCharacterCache();

    this.scene.add(this.particles.group);
    this.scene.add(this.projectiles.group);
    this.birds = new Birds(this.scene);

    await this.step('Rigging the ships…');
    this.player = new PlayerShip(this, this.profile);
    this.walker = new Walker(this.scene);
    this.townIdx = Math.max(0, PORTS.findIndex((p) => p.id === this.profile.lastPort));
    const port = PORTS[this.townIdx];
    const b0 = this.berth(this.townIdx);
    this.player.resetAt(b0.pos, b0.heading);
    this.camRig.setShipSize(this.player.model.length);
    this.missions = new Missions(this);
    this.ui = new HUD(this);
    this.shop = new ShopUI(this);
    this.inventory = new Inventory(this);
    this.combat = new Combat(this);
    this.raid = new Raid(this);
    this.raid.init();
    this.combat.init();
    this.rowboat = this.buildRowboat();
    this.scene.add(this.rowboat);
    // capture the mouse for free-look while fighting (pointer lock needs a click to start)
    this.input.onCanvasDown = (b) => {
      if ((b === 0 || b === 2) && this.combat.wantsPointerLock && !this.inventory.open && !this.bigMapOpen && !this.paused) this.input.lockPointer();
    };

    this.populate();

    await this.step('Hoisting the sails…');
    this.post = new PostFX(this.renderer, this.scene, this.camRig.camera);
    this.setupPortrait();
    this.applyQuality(this.pickInitialQuality());
    this.camRig.setOrbit(new THREE.Vector3(port.berth.x, 0, port.berth.z).addScaledVector(new THREE.Vector3(port.fx, 0, port.fz), -30), 80, 30, 0.05, 6);
    this.lives[this.townIdx].activate(this.env.hour);
    // warm-up: pre-build every ship design and fire off each effect once (offscreen)
    for (const t of Object.keys(SHIP_TYPES) as ShipTypeId[]) buildShip(npcDesign(SHIP_TYPES[t].design));
    const far = new THREE.Vector3(0, -500, 0);
    this.particles.explosion(far);
    this.particles.splash(far);
    this.particles.coins(far, 2);
    this.particles.confettiBurst(far, 2);
    this.particles.muzzle(far, new THREE.Vector3(1, 0, 0));
    this.projectiles.fire(far, new THREE.Vector3(0, -1, 0), this.player, 0);
    this.env.update(0.016, port.berth, this.camRig.camera, this.ocean);
    await this.step('Loading cannons…');
    await this.renderer.compileAsync(this.scene, this.camRig.camera);
    this.post.render(0.016);
    await this.step('done');
    this.state = 'title';
    this.screens.showTitle();
    this.clock.connect(document);
    requestAnimationFrame((t) => this.loop(t));
    const params = new URLSearchParams(location.search);
    if (params.get('autoplay')) {
      this.play(false);
      const sc = params.get('scenario');
      if (sc) import('../dev/scenarios').then((m) => m.runScenario(this, sc));
    }
  }

  private setupPortrait() {
    const wrap = document.getElementById('portrait')!;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border-radius:50%';
    wrap.appendChild(canvas);
    this.portraitRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.portraitRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.portraitRenderer.setSize(84, 84, false);
    this.portraitRenderer.toneMapping = THREE.NeutralToneMapping;
    this.portraitChar = new Character('captain');
    this.portraitChar.play('idle');
    this.portraitScene.add(this.portraitChar.root);
    this.portraitScene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 4);
    this.portraitScene.add(key);
    this.portraitCam.position.set(0.15, 1.85, 3.6);
    this.portraitCam.lookAt(0, 1.78, 0);
  }

  /** Initial ships: easy merchants close to Skull Cove, more further out, and port patrols. */
  private populate() {
    this.spawnMerchant('smallMerchant', 0, 2, -1, new THREE.Vector3(70, 0, 240));
    this.spawnMerchant('mediumMerchant', 3, 1, 1, new THREE.Vector3(-90, 0, 160));
    this.spawnMerchant('smallMerchant', 3, 3, 1);
    this.spawnMerchant('largeCargo', 0, 4, 1);
    this.spawnMerchant('luxury', 4, 2, 1);
    this.spawnMerchant('mediumMerchant', 1, 2, 1);
    this.spawnMerchant('smallMerchant', 2, 3, -1);
    this.spawnMerchant('armoured', 1, 4, -1);
    for (const z of ZONES.filter((z) => z.kind === 'patrol')) this.spawnNavy('navyCutter', new THREE.Vector3(z.x, 0, z.z), false, true);
    // rivals from accepted contracts come back after a reload
    for (const c of this.profile.contracts) if (c.kind === 'rival') this.spawnRival(c.id, c.island!);
  }

  // =====================================================================
  // Spawning
  // =====================================================================
  private pickMerchantType(): ShipTypeId {
    const L = this.profile.level;
    return weightedChoice<ShipTypeId>([
      { item: 'smallMerchant', w: Math.max(1, 6 - L) },
      { item: 'mediumMerchant', w: 4 },
      { item: 'largeCargo', w: L >= 2 ? 3 : 1 },
      { item: 'luxury', w: L >= 2 ? 2 : 0.5 },
      { item: 'armoured', w: L >= 3 ? 2 + L * 0.3 : 0.3 },
      // the age of steam reaches the trade lanes
      { item: 'steamFreighter', w: L >= SHIP_TYPES.steamFreighter.minLevel ? 1.5 + (L - SHIP_TYPES.steamFreighter.minLevel) * 0.2 : 0 },
    ]);
  }

  spawnMerchant(type?: ShipTypeId, routeIdx?: number, wp?: number, dir?: 1 | -1, at?: THREE.Vector3) {
    const t = type ?? this.pickMerchantType();
    const ri = routeIdx ?? Math.floor(Math.random() * ROUTES.length);
    const route = ROUTES[ri];
    let w = wp ?? Math.floor(Math.random() * route.length);
    const d: 1 | -1 = dir ?? (Math.random() < 0.5 ? 1 : -1);
    let pos = at?.clone();
    if (!pos) {
      // choose a waypoint that is out of the player's sight
      for (let i = 0; i < route.length; i++) {
        const cand = route[(w + i) % route.length];
        if (!this.player || cand.distanceTo(this.player.pos) > 260) {
          w = (w + i) % route.length;
          break;
        }
      }
      pos = route[w].clone().add(new THREE.Vector3(rand(-20, 20), 0, rand(-20, 20)));
    }
    if (landSDF(pos.x, pos.z) < 15) pos = route[w].clone();
    const s = new AIShip(this, t);
    s.setRoute(ri, w, d);
    const next = route[clamp(w + d, 0, route.length - 1)];
    s.pos.copy(pos);
    s.heading = headingTo(next.x - pos.x, next.z - pos.z);
    s.speed = s.maxSpeed * 0.5;
    s.wp = clamp(w + d, 0, route.length - 1);
    this.ships.push(s);
    return s;
  }

  /** The navy modernises as you level up: ironclads, then interceptors. */
  private eraNavy(t: ShipTypeId): ShipTypeId {
    const L = this.profile.level;
    const iron = SHIP_TYPES.navyIronclad.minLevel;
    const inter = SHIP_TYPES.navyInterceptor.minLevel;
    if (t === 'navyFrigate') return L >= inter && Math.random() < 0.6 ? 'navyInterceptor' : L >= iron ? 'navyIronclad' : t;
    if (t === 'navyCutter') return L >= inter && Math.random() < 0.4 ? 'navyInterceptor' : L >= iron + 4 && Math.random() < 0.35 ? 'navyIronclad' : t;
    return t;
  }

  spawnNavy(type: ShipTypeId, near: THREE.Vector3 | null, pursuit = false, patrol = false) {
    type = this.eraNavy(type);
    const p = this.player?.pos ?? new THREE.Vector3();
    let pos = new THREE.Vector3();
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const base = near && !pursuit ? near : p;
      const r = patrol ? rand(40, 120) : rand(200, 270);
      pos.set(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r);
      if (landSDF(pos.x, pos.z) > 25 && insideWorld(pos.x, pos.z, 50)) break;
    }
    const s = new AIShip(this, type);
    s.pos.copy(pos);
    s.heading = headingTo(p.x - pos.x, p.z - pos.z) + rand(-0.3, 0.3);
    s.speed = s.maxSpeed * 0.6;
    s.patrolCenter.copy(near ?? pos);
    if (pursuit || (!patrol && this.wanted.level > 0)) s.setState('chase');
    this.ships.push(s);
    return s;
  }

  /** A rival pirate brig for a contract, prowling open water a fair way from port. */
  spawnRival(contractId: string, name: string) {
    if (this.ships.some((s) => s.contractId === contractId)) return;
    const from = PORTS[this.townIdx].berth;
    let pos = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(320, 560);
      pos.set(from.x + Math.cos(a) * r, 0, from.z + Math.sin(a) * r);
      if (landSDF(pos.x, pos.z) > 60 && insideWorld(pos.x, pos.z, 120)) break;
    }
    const s = new AIShip(this, 'rivalPirate');
    s.pos.copy(pos);
    s.patrolCenter.copy(pos);
    s.contractId = contractId;
    s.rivalName = name;
    s.name = `${name}'s Brig`;
    s.heading = Math.random() * 6;
    s.speed = s.maxSpeed * 0.5;
    this.ships.push(s);
    return s;
  }

  allShips(): Ship[] {
    return [this.player, ...this.ships];
  }

  after(delay: number, fn: () => void) {
    this.timers.push({ t: this.time + delay, fn });
  }

  // =====================================================================
  // Accessors
  // =====================================================================
  /** on foot (in a port, on an island, or on the deck of a ship you're boarding) */
  get onLand() {
    return this.state === 'land' || this.state === 'shop' || this.state === 'dialogue' || this.state === 'ashore' || this.state === 'deck';
  }
  /** on foot in a port town (not on a wild island) */
  get inTown() {
    return this.state === 'land' || this.state === 'shop' || this.state === 'dialogue';
  }
  /** What the on-foot map shows: the town, or the island you rowed to. */
  get mapArea(): MapArea {
    if (this.state === 'deck') {
      // the boarding fight: just the two ships on open water
      this.deckMap.center.copy(this.player.pos);
      return this.deckMap;
    }
    if (this.state !== 'ashore' || !this.isle) return this.town;
    const isl = this.isle;
    let m = this.isleMaps.get(isl.name);
    if (!m) {
      m = { port: { id: `isle:${isl.name}`, name: isl.name }, center: new THREE.Vector3(isl.x, 0, isl.z), radius: isl.maxR! * 1.05, platforms: [], map: { footprints: [], marks: [] } };
      this.isleMaps.set(isl.name, m);
    }
    return m;
  }
  get town(): TownBuild {
    return this.towns[this.townIdx];
  }
  get life() {
    return this.lives[this.townIdx];
  }
  get area() {
    return this.areas[this.townIdx];
  }
  get currentPortId() {
    return PORTS[this.townIdx].id;
  }
  get tavernName() {
    return this.town.interiors.find((i) => i.kind === 'tavern')?.name ?? 'Tavern';
  }
  /** The game state in plain words (ON_BOAT, ON_LAND, IN_SHOP, IN_DIALOGUE, IN_TAVERN, IN_WAREHOUSE). */
  get gameState() {
    if (this.state === 'shop') return this.shop.kind === 'warehouse' ? 'IN_WAREHOUSE' : 'IN_SHOP';
    if (this.state === 'dialogue') return 'IN_DIALOGUE';
    if (this.state === 'land') return this.activeInterior?.kind === 'tavern' ? 'IN_TAVERN' : 'ON_LAND';
    if (this.state === 'ashore') return 'ON_LAND';
    return 'ON_BOAT';
  }

  // =====================================================================
  // Game flow
  // =====================================================================
  play(fresh: boolean) {
    if (fresh) {
      clearSave();
      location.reload();
      return;
    }
    audio.init();
    this.screens.title.classList.add('hidden');
    this.ui.show(true);
    // start ashore at the last port (Skull Cove for a new game)
    this.dockAt(this.townIdx, true);
    this.disembark(true, false);
    audio.play('bell', { volume: 0.6 });
    const port = PORTS[this.townIdx];
    this.ui.banner(port.name.toUpperCase(), this.profile.landTutorial < 5 && port.id === 'skull' ? 'Explore the town, trade, then set sail!' : port.blurb, [], '', 3);
    if (port.id === 'skull' && this.profile.landTutorial < 5) this.after(3.2, () => this.landTutorial());
    // saves from before ship classes may already have unlocked some
    this.checkShipUnlocks(4.5);
  }

  setPaused(p: boolean) {
    if (this.state === 'loading' || this.state === 'title' || this.state === 'dead') return;
    this.paused = p;
    if (p) this.input.unlockPointer();
    this.screens.pause.classList.toggle('hidden', !p);
    if (audio.ctx) {
      if (p) audio.ctx.suspend();
      else audio.ctx.resume();
    }
  }

  /** Graphics presets – Medium is picked automatically for integrated GPUs. */
  applyQuality(q: 'high' | 'medium' | 'low', announce = false) {
    this.quality = q;
    const high = q === 'high';
    const pr = high ? Math.min(devicePixelRatio, 1.5) : q === 'medium' ? 1 : 0.8;
    this.renderer.setPixelRatio(pr);
    this.reflection.enabled = high;
    this.ocean.material.uniforms.uReflStrength.value = high ? 1 : 0;
    this.post.bloom.enabled = q !== 'low';
    this.post.setSamples(high ? 4 : 0);
    this.post.fxaa.enabled = !high;
    const sm = q === 'high' ? 2048 : 1024;
    this.env.sun.shadow.mapSize.set(sm, sm);
    this.env.sun.shadow.map?.dispose();
    this.env.sun.shadow.map = null;
    this.onResize();
    try {
      localStorage.setItem('pirate-raiders-quality', q);
    } catch {
      /* ignore */
    }
    if (announce) this.ui.toast(`🖥️ Graphics: ${q.toUpperCase()}`, 'Change this any time from the pause menu (Esc).', 'info');
  }

  setQuality(q: 'high' | 'medium' | 'low') {
    this.qualityLocked = true;
    this.applyQuality(q);
    audio.play('click');
  }

  private pickInitialQuality(): 'high' | 'medium' | 'low' {
    try {
      const saved = localStorage.getItem('pirate-raiders-quality');
      if (saved === 'high' || saved === 'medium' || saved === 'low') {
        this.qualityLocked = true;
        return saved;
      }
    } catch {
      /* ignore */
    }
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /intel|uhd|iris|hd graphics|mali|adreno|powervr|swiftshader|llvmpipe|microsoft basic/i.test(name) ? 'medium' : 'high';
  }

  /** Step quality down if the game is struggling during the first minute of play. */
  private adaptQuality(dt: number) {
    if (this.qualityLocked || (this.state !== 'playing' && this.state !== 'land' && this.state !== 'ashore')) return;
    this.adaptT += dt;
    if (this.adaptT < 6) return;
    this.adaptT = 0;
    this.adaptChecks++;
    if (this.adaptChecks > 10) {
      this.qualityLocked = true;
      return;
    }
    const { med } = this.frameStats();
    if (med > 24 && this.quality !== 'low') {
      this.applyQuality(this.quality === 'high' ? 'medium' : 'low', true);
      this.frameTimes.fill(0);
    }
  }

  /**
   * Size everything from the canvas's real laid-out size. The canvas is sized by CSS
   * (100% of the viewport) and we never write pixel sizes into its style, so the 3D view
   * and the HUD can't drift apart when the window or browser pane is resized.
   */
  private viewW = 0;
  private viewH = 0;
  private onResize() {
    const c = this.renderer.domElement;
    const w = Math.max(1, c.clientWidth || innerWidth);
    const h = Math.max(1, c.clientHeight || innerHeight);
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    this.camRig.camera.aspect = w / h;
    this.camRig.camera.updateProjectionMatrix();
    this.post?.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.reflection?.setSize(w * pr, h * pr);
  }

  /** Catch any size change we weren't told about (pane resizes, zoom, device emulation). */
  private sizeCheckT = 0;
  private checkSize() {
    // the ResizeObserver catches almost everything; this safety net only needs to look twice a second
    // (reading layout every frame can force a reflow after the HUD has touched the page)
    if (++this.sizeCheckT < 30) return;
    this.sizeCheckT = 0;
    const c = this.renderer.domElement;
    if (c.clientWidth !== this.viewW || c.clientHeight !== this.viewH) this.onResize();
  }

  // =====================================================================
  // Economy & progression API
  // =====================================================================
  /** Nobody fires on you while you're boarding a ship or docked in a port. */
  get playerProtected() {
    return this.inPort || this.boarding.active || this.state === 'ashore';
  }

  /** Stats of the ship you're sailing (class + shipwright upgrades). */
  get shipStats(): ShipStats {
    return shipStats(this.profile.ship, this.profile.upgrades);
  }
  get shipClass() {
    return shipClass(this.profile.ship);
  }
  get maxCrew() {
    return this.shipStats.crew;
  }
  get cargoCapacity() {
    return this.shipStats.cargo;
  }
  get cargoCount() {
    return CARGO_IDS.reduce((s, id) => s + (this.profile.cargo[id] ?? 0), 0);
  }
  get cargoValue() {
    return CARGO_IDS.reduce((s, id) => s + (this.profile.cargo[id] ?? 0) * this.cargoPrice(id), 0);
  }
  get repairCost() {
    return Math.ceil((this.player.maxHp - this.player.hp) * 4);
  }
  /** Typical value of a crate (average across all ports). */
  cargoPrice(id: CargoId) {
    return CARGO[id].cat === 'quest' ? 0 : this.economy.avgPrice(id);
  }

  addMoney(amount: number, earned = true) {
    this.profile.money += amount;
    if (earned && amount > 0) {
      this.profile.stats.earned += amount;
      this.missions.event('earn', { amount });
    }
  }

  addXp(xp: number) {
    const p = this.profile;
    p.xp += xp;
    while (p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level++;
      audio.play('levelup');
      this.ui.toast(`⭐ LEVEL ${p.level}!`, 'Richer prizes are sailing the seas…', 'mission');
      this.player.captain?.express('happy', 2);
      this.walker?.c.express('happy', 2);
    }
    this.checkShipUnlocks();
  }

  /** Fanfare for ship classes that just became available (one banner, however many unlocked). */
  checkShipUnlocks(delay = 3.8) {
    const p = this.profile;
    const fresh = SHIP_CLASS_IDS.filter((id) => SHIP_CLASSES[id].requiredLevel <= p.level && !p.shipsUnlocked.includes(id));
    if (!fresh.length) return;
    p.shipsUnlocked.push(...fresh);
    const c = SHIP_CLASSES[fresh[fresh.length - 1]];
    const more = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : '';
    this.after(delay, () => {
      audio.play('fanfare', { volume: 0.7 });
      this.ui.banner('NEW SHIP UNLOCKED!', `${c.icon} Class ${ROMAN[c.tier]} · ${c.name}${more} – visit any shipyard`, [{ text: `💰 ${fmtMoney(c.purchasePrice)}`, gold: true }], '', 4);
    });
    saveProfile(p);
  }

  private coinsAtShop(n: number) {
    const it = this.shop.it;
    if (!it) return;
    this.particles.coins(it.look.clone().setY(it.look.y - 0.3), Math.min(30, 4 + n));
  }

  /** Buy crates at the current stall. Returns an error message, or null on success. */
  buyGood(id: CargoId, n: number, _black = false): string | null {
    const p = this.profile;
    const port = this.currentPortId;
    const space = this.cargoCapacity - this.cargoCount;
    if (space <= 0) return 'Your hold is full!';
    let qty = Math.min(n, space);
    while (qty > 0 && this.economy.quoteBuy(port, id, qty) > p.money) qty--;
    if (qty <= 0) return "You can't afford that.";
    const total = this.economy.quoteBuy(port, id, qty);
    const had = p.cargo[id] ?? 0;
    const basis = p.costBasis[id] ?? 0;
    p.money -= total;
    p.cargo[id] = had + qty;
    p.costBasis[id] = Math.round((basis * had + total) / (had + qty));
    this.economy.traded(port, id, qty);
    p.stats.traded += qty;
    audio.play('coin', { volume: 0.7 });
    this.coinsAtShop(qty);
    this.ui.toast(`${CARGO[id].icon} Bought ${qty} × ${CARGO[id].name}`, `−${fmtMoney(total)} · ${this.cargoCount}/${this.cargoCapacity} crates`, 'info');
    this.landTutorialEvent('buy');
    saveProfile(p);
    return null;
  }

  /** Sell crates to the current vendor. */
  sellGood(id: CargoId, n: number, rate = 1): string | null {
    const p = this.profile;
    const port = this.currentPortId;
    const have = p.cargo[id] ?? 0;
    const qty = Math.min(n, have);
    if (qty <= 0) return 'You have none of that.';
    const total = this.economy.quoteSell(port, id, qty, rate);
    const paid = p.costBasis[id];
    const profit = total - (paid ?? 0) * qty;
    p.cargo[id] = have - qty;
    if (!p.cargo[id]) {
      delete p.cargo[id];
      delete p.costBasis[id];
    }
    this.addMoney(total);
    this.economy.traded(port, id, -qty);
    p.stats.traded += qty;
    p.stats.tradeProfit += Math.max(0, profit);
    this.missions.event('sell');
    audio.play('cash');
    this.coinsAtShop(qty * 2);
    const xp = Math.round(Math.max(0, profit) / 8);
    if (xp > 0) this.addXp(xp);
    this.ui.toast(`💰 +${fmtMoney(total)}`, `Sold ${qty} × ${CARGO[id].name}${paid !== undefined ? ` · profit ${profit >= 0 ? '+' : ''}${fmtMoney(profit)}` : ''}${xp > 0 ? ` · +${xp} XP` : ''}`, 'good');
    saveProfile(p);
    return null;
  }

  storeGood(id: CargoId, n: number): string | null {
    const p = this.profile;
    const wh = (p.warehouses[this.currentPortId] ??= {});
    const qty = Math.min(n, p.cargo[id] ?? 0);
    if (qty <= 0) return 'Nothing to store.';
    p.cargo[id] = (p.cargo[id] ?? 0) - qty;
    if (!p.cargo[id]) delete p.cargo[id];
    wh[id] = (wh[id] ?? 0) + qty;
    audio.play('bonk', { volume: 0.5 });
    saveProfile(p);
    return null;
  }

  takeGood(id: CargoId, n: number): string | null {
    const p = this.profile;
    const wh = (p.warehouses[this.currentPortId] ??= {});
    const space = this.cargoCapacity - this.cargoCount;
    const qty = Math.min(n, wh[id] ?? 0, space);
    if (space <= 0) return 'Your hold is full!';
    if (qty <= 0) return 'Nothing stored.';
    wh[id] = (wh[id] ?? 0) - qty;
    if (!wh[id]) delete wh[id];
    p.cargo[id] = (p.cargo[id] ?? 0) + qty;
    audio.play('bonk', { volume: 0.5 });
    saveProfile(p);
    return null;
  }

  repairShip() {
    const cost = this.repairCost;
    if (cost <= 0) return;
    const p = this.profile;
    if (p.money >= cost) {
      p.money -= cost;
      this.player.hp = this.player.maxHp;
    } else {
      const hp = Math.floor(p.money / 4);
      p.money -= hp * 4;
      this.player.hp += hp;
    }
    p.hp = this.player.hp;
    audio.play('hammer');
    saveProfile(p);
  }

  private celebrateShip() {
    this.particles.confettiBurst(this.player.pos.clone().setY(6), 40);
    this.player.celebrate(2);
    this.walker.c.express('happy', 2);
  }

  buyUpgrade(id: UpgradeId, mul = 1): string | null {
    const p = this.profile;
    const lvl = p.upgrades[id];
    const cost = upgradeCost(p.ship, id, lvl, mul);
    if (cost === undefined) return 'Already maxed out.';
    if (p.money < cost) return "You can't afford that upgrade.";
    const crewBefore = this.maxCrew;
    p.money -= cost;
    p.upgrades[id]++;
    if (id === 'hull') p.hp = this.shipStats.maxHp;
    if (id === 'crew') p.crew = Math.min(p.crew + (this.maxCrew - crewBefore), this.maxCrew);
    p.fleet[p.ship] = { upgrades: { ...p.upgrades }, hp: p.hp };
    const keep = this.player.captain?.root.visible ?? true;
    this.player.applyProfile(p, true);
    if (this.player.captain) this.player.captain.root.visible = keep;
    this.player.hp = id === 'hull' ? this.player.maxHp : this.player.hp;
    audio.play('hammer');
    audio.play('levelup', { delay: 0.3, volume: 0.6 });
    this.celebrateShip();
    const lab = upgradeLabel(p.ship, id);
    this.ui.toast(`${lab.icon} ${lab.levels[p.upgrades[id]] ?? lab.name}!`, `${UPGRADES[id].stat}: ${UPGRADES[id].fmt(upgradeValue(p.ship, id, p.upgrades[id]))}`, 'good');
    this.landTutorialEvent('upgrade');
    saveProfile(p);
    return null;
  }

  // ---------------------------------------------------------------------
  // Ship classes: buy, switch and sell at any shipyard
  // ---------------------------------------------------------------------
  /** What a shipyard charges for a class (portMul: the yard's price level). */
  shipPrice(id: ShipClassId, portMul = 1) {
    return Math.round((SHIP_CLASSES[id].purchasePrice * portMul) / 50) * 50;
  }
  /** What a shipyard pays for one of your ships: its sell price plus a share of its refits. */
  shipResale(id: ShipClassId) {
    const u = this.profile.ship === id ? this.profile.upgrades : this.profile.fleet[id]?.upgrades;
    let refits = 0;
    if (u) for (const k of Object.keys(u) as UpgradeId[]) for (let l = 0; l < u[k]; l++) refits += upgradeCost(id, k, l) ?? 0;
    return SHIP_CLASSES[id].sellPrice + Math.round((refits * 0.3) / 10) * 10;
  }

  buyShip(id: ShipClassId, portMul = 1): string | null {
    const p = this.profile;
    const c = SHIP_CLASSES[id];
    if (p.fleet[id]) return 'You already own one – switch to it instead.';
    if (p.level < c.requiredLevel) return `Reach level ${c.requiredLevel} to unlock the ${c.name}.`;
    const price = this.shipPrice(id, portMul);
    if (p.money < price) return "You can't afford that ship.";
    p.money -= price;
    const stock = { hull: 0, sails: 0, steering: 0, cannons: 0, range: 0, crew: 0, cargo: 0 };
    p.fleet[id] = { upgrades: stock, hp: shipStats(id, stock).maxHp };
    this.switchShip(id, true);
    audio.play('fanfare');
    audio.play('cash', { delay: 0.2 });
    this.ui.banner('NEW SHIP!', `${c.shipName} – ${c.name} (Class ${ROMAN[c.tier]})`, [{ text: `−${fmtMoney(price)}`, gold: true }, { text: `❤️ ${this.player.maxHp}` }, { text: `📦 ${this.cargoCapacity}` }, { text: `👥 ${this.maxCrew}` }], '', 4);
    return null;
  }

  /** Make another ship from your fleet the active one (the old one stays moored at the shipyard). */
  switchShip(id: ShipClassId, bought = false): string | null {
    const p = this.profile;
    const next = p.fleet[id];
    if (!next) return "You don't own that ship.";
    if (id === p.ship) return null;
    p.fleet[p.ship] = { upgrades: { ...p.upgrades }, hp: Math.round(this.player.hp) };
    p.ship = id;
    p.upgrades = { ...next.upgrades };
    p.hp = next.hp;
    // the crew walks across; any that don't fit wait ashore
    const ashore = Math.max(0, p.crew - this.maxCrew);
    p.crew = Math.min(p.crew, this.maxCrew);
    // cargo that doesn't fit goes into this port's warehouse
    let over = this.cargoCount - this.cargoCapacity;
    if (over > 0) {
      const wh = (p.warehouses[this.currentPortId] ??= {});
      for (const g of CARGO_IDS) {
        if (over <= 0) break;
        const n = Math.min(over, p.cargo[g] ?? 0);
        if (n <= 0) continue;
        p.cargo[g] = (p.cargo[g] ?? 0) - n;
        if (!p.cargo[g]) delete p.cargo[g];
        wh[g] = (wh[g] ?? 0) + n;
        over -= n;
      }
      this.after(1.5, () => this.ui.toast('📦 Hold too small', 'Cargo that didn\'t fit was put in this port\'s warehouse.', 'info'));
    }
    if (ashore > 0) this.after(2, () => this.ui.toast(`👥 ${ashore} pirates stayed ashore`, 'Your new ship has fewer hammocks.', 'info'));
    const keep = this.player.captain?.root.visible ?? true;
    this.player.applyProfile(p, true);
    this.player.hp = Math.min(p.hp, this.player.maxHp);
    if (this.player.captain) this.player.captain.root.visible = keep;
    // the new ship ties up at the dock (bigger ships moor further out)
    this.berthCache = null;
    const b = this.berth(this.townIdx);
    this.player.resetAt(b.pos, b.heading);
    this.player.update(0);
    if (this.inTown) this.placeGangplank(true);
    this.camRig.setShipSize(this.player.model.length);
    this.celebrateShip();
    if (!bought) {
      audio.play('bell');
      this.ui.toast(`${this.shipClass.icon} Now sailing ${this.shipClass.shipName}`, `${this.shipClass.name} · Class ${ROMAN[this.shipClass.tier]}`, 'good');
    }
    saveProfile(p);
    return null;
  }

  sellShip(id: ShipClassId): string | null {
    const p = this.profile;
    if (id === p.ship) return "You can't sell the ship you're sailing!";
    if (!p.fleet[id]) return "You don't own that ship.";
    const price = this.shipResale(id);
    delete p.fleet[id];
    this.addMoney(price, false);
    audio.play('cash');
    this.ui.toast(`💰 Sold the ${SHIP_CLASSES[id].name}`, `+${fmtMoney(price)}`, 'good');
    saveProfile(p);
    return null;
  }

  hireCrew() {
    const p = this.profile;
    const n = Math.min(this.maxCrew - p.crew, Math.floor(p.money / 40));
    if (n <= 0) return;
    p.crew += n;
    p.money -= n * 40;
    audio.playVoice('arr', undefined, 1);
    audio.play('cash', { volume: 0.5 });
    saveProfile(p);
  }

  buyOrEquipCosmetic(id: string): string | null {
    const p = this.profile;
    const c = COSMETICS.find((x) => x.id === id)!;
    if (!p.owned.includes(id)) {
      if (c.special) return 'Only found in special places…';
      if (p.money < c.cost) return "You can't afford that.";
      p.money -= c.cost;
      p.owned.push(id);
      audio.play('cash');
    } else audio.play('click');
    if (c.kind === 'sail') p.sail = id;
    if (c.kind === 'hull') p.hull = id;
    if (c.kind === 'flag') p.flag = id;
    if (c.kind === 'cannon') p.cannonSkin = id;
    this.rebuildShip();
    saveProfile(p);
    return null;
  }

  private rebuildShip() {
    const keepHp = this.player.hp;
    const keep = this.player.captain?.root.visible ?? true;
    this.player.applyProfile(this.profile, true);
    this.player.hp = keepHp;
    if (this.player.captain) this.player.captain.root.visible = keep;
  }

  buyOrEquipAmmo(id: AmmoId): string | null {
    const p = this.profile;
    if (!p.ammo.includes(id)) {
      if (p.money < AMMO[id].cost) return "You can't afford that.";
      p.money -= AMMO[id].cost;
      p.ammo.push(id);
      audio.play('cash');
    }
    p.ammoSel = id;
    const hp = this.player.hp;
    this.player.applyProfile(p, false);
    this.player.hp = hp;
    audio.play('reload');
    saveProfile(p);
    return null;
  }

  /** Hidden islands with treasure still undiscovered and unmapped. */
  unmappedTreasure() {
    const p = this.profile;
    return ISLANDS.filter((i) => i.kind === 'hidden' && !p.treasuresFound.includes(i.name) && !p.maps.includes(i.name));
  }

  buyItem(id: string): string | null {
    const p = this.profile;
    const it = SPECIAL_ITEMS.find((i) => i.id === id)!;
    if (!it.repeatable && p.items.includes(id)) return 'You already own that.';
    if (p.money < it.cost) return "You can't afford that.";
    if (id === 'treasureMap') {
      const left = this.unmappedTreasure();
      if (!left.length) return 'No more maps for sale.';
      const isl = choose(left);
      p.maps.push(isl.name);
      p.money -= it.cost;
      audio.play('treasure');
      this.ui.toast('🗺️ Treasure map!', `X marks the spot on ${isl.name}. It's on your map now.`, 'mission');
      saveProfile(p);
      return null;
    }
    p.money -= it.cost;
    p.items.push(id);
    if (it.unlocks && !p.owned.includes(it.unlocks)) {
      p.owned.push(it.unlocks);
      const c = COSMETICS.find((x) => x.id === it.unlocks)!;
      if (c.kind === 'sail') p.sail = c.id;
      if (c.kind === 'hull') p.hull = c.id;
      if (c.kind === 'flag') p.flag = c.id;
      if (c.kind === 'cannon') p.cannonSkin = c.id;
    }
    this.rebuildShip();
    audio.play('cash');
    audio.play('treasure', { delay: 0.2, volume: 0.6 });
    this.ui.toast(`${it.icon} ${it.name}`, it.desc, 'good');
    saveProfile(p);
    return null;
  }

  hireOfficer(r: Officer): string | null {
    const p = this.profile;
    if (!r || p.hiredRecruits.includes(r.id)) return 'They already joined a crew.';
    if (p.money < r.cost) return "You can't afford their fee.";
    p.money -= r.cost;
    const old = p.officers.find((o) => o.role === r.role);
    p.officers = p.officers.filter((o) => o.role !== r.role);
    p.officers.push(r);
    p.hiredRecruits.push(r.id);
    this.rebuildShip();
    this.syncRecruits();
    audio.playVoice('yay', this.walker.pos, 1.1);
    audio.play('fanfare', { volume: 0.6 });
    this.particles.confettiBurst(this.walker.pos.clone().setY(this.walker.pos.y + 2), 30);
    this.ui.toast(`🤝 ${r.name} joins your crew!`, `${ROLES[r.role].icon} ${ROLES[r.role].name}: ${ROLES[r.role].bonus(r.skill)}${old ? ` (replaces ${old.name})` : ''}`, 'good');
    this.landTutorialEvent('recruit');
    saveProfile(p);
    return null;
  }

  restUntilMorning(): string | null {
    const p = this.profile;
    if (p.money < 25) return "You can't afford a room.";
    p.money -= 25;
    const night = this.env.hour >= 19 || this.env.hour < 6;
    const target = night ? 7 : 19.5;
    const hours = (target - this.env.hour + 24) % 24;
    const fade = document.createElement('div');
    fade.className = 'sleep-fade';
    fade.innerHTML = `<span>💤 ${night ? 'Sleeping until morning…' : 'Napping until evening…'}</span>`;
    document.body.appendChild(fade);
    setTimeout(() => {
      this.advanceTime(hours);
      this.player.hp = Math.max(this.player.hp, this.player.maxHp * 0.6);
      this.ui.toast(night ? '☀️ Good morning, Captain!' : '🌙 Evening falls', night ? 'The markets are opening.' : 'The tavern is filling up.', 'info');
    }, 900);
    setTimeout(() => fade.remove(), 2400);
    return null;
  }

  /** Skip the clock forward (prices drift, the day counter ticks, townsfolk move). */
  private advanceTime(hours: number) {
    const before = this.env.hour;
    this.env.hour = (this.env.hour + hours) % 24;
    if (this.env.hour < before || hours >= 24) this.newDay();
    this.prevHour = this.env.hour;
    this.economy.update(hours);
    if (this.lives[this.townIdx].active) this.lives[this.townIdx].activate(this.env.hour);
    this.syncRecruits();
  }

  private newDay() {
    this.profile.day++;
    this.syncRecruits();
  }

  buyRumour(): string | null {
    const p = this.profile;
    if (p.money < 30) return "You can't afford a round.";
    p.money -= 30;
    audio.play('cash', { volume: 0.5 });
    audio.playVoice('yay', this.walker.pos, 1.2);
    // half the time, a real trade tip computed from current prices
    if (Math.random() < 0.6) {
      let best = { k: 0, good: 'fish' as CargoId, from: PORTS[0], to: PORTS[0] };
      for (const id of CARGO_IDS) {
        if (CARGO[id].cat === 'quest') continue;
        for (const a of PORTS)
          for (const b of PORTS) {
            if (a === b) continue;
            const k = this.economy.sellPrice(b.id, id) - this.economy.buyPrice(a.id, id);
            if (k > best.k) best = { k, good: id, from: a, to: b };
          }
      }
      this.lastRumour = `Word is, ${CARGO[best.good].name.toLowerCase()} ${CARGO[best.good].icon} sells for about ${fmtMoney(best.k)} more in ${best.to.name} than it costs in ${best.from.name}!`;
    } else this.lastRumour = choose(RUMOURS);
    return null;
  }

  setCourseHome() {
    // nearest port that will let you in
    let best = PORTS[0];
    let bd = Infinity;
    for (const p of PORTS) {
      if (p.lawful && this.wanted.level >= 2) continue;
      const d = p.berth.distanceTo(this.player.pos);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    this.navTarget = best.berth.clone();
    this.ui.toast(`🧭 Course set for ${best.name}`, 'Follow the gold marker and the dotted line on your map.', 'info');
  }

  // =====================================================================
  // Events
  // =====================================================================
  onProjectileHit(owner: Ship, target: Ship, ammo: AmmoId = 'round') {
    if (owner === this.player) {
      this.camRig.combatPulse();
      if (target instanceof AIShip) {
        this.player.target = target;
        if (ammo === 'chain') {
          target.slowT = 6;
          this.ui.comicText(target.pos.clone().setY(target.model.mastTop * 0.6), 'SAILS SHREDDED!', 'good');
        } else if (ammo === 'grape' && target.crewCount > 1) {
          target.crewCount--;
          this.ui.comicText(target.pos.clone().setY(target.model.deckYAt(0) + 3), '−1 CREW', 'good');
        } else if (ammo === 'fire') target.burnT = 5;
      }
    }
  }

  onShipDisabled(ship: AIShip) {
    this.ui.toast(`🏳️ ${ship.name} surrenders!`, 'Sail alongside and press <b>E</b> to board her!', 'good');
    audio.play('bell', { pos: ship.pos, volume: 0.5 });
    if (!ship.isRival) this.wanted.addHeat(0.12, ship.pos);
    if (this.tutorialStep > 0 && this.tutorialStep < 5) this.tutorialStep = 5;
  }

  onCapture(ship: AIShip) {
    const p = this.profile;
    const t = ship.type;
    const xp = Math.round(t.xp * (1 + (p.level - 1) * 0.1));
    const money = ship.coffers;
    this.addMoney(money);
    this.addXp(xp);
    let space = this.cargoCapacity - this.cargoCount;
    const got: string[] = [];
    let lost = 0;
    for (const c of ship.cargo) {
      const take = Math.min(space, c.qty);
      if (take > 0) {
        p.cargo[c.id] = (p.cargo[c.id] ?? 0) + take;
        space -= take;
        got.push(`${CARGO[c.id].icon} ${take}`);
      }
      lost += c.qty - take;
    }
    p.stats.captures++;
    p.stats.byType[t.id] = (p.stats.byType[t.id] ?? 0) + 1;
    this.missions.event('capture', { typeId: t.id });
    this.contracts.capture(t.id, ship.contractId ?? undefined);
    if (!ship.isRival) this.wanted.addHeat(0.35, ship.pos);
    this.player.celebrate(4);
    const rewards = [{ text: `💰 +${fmtMoney(money)}`, gold: true }, ...got.map((g) => ({ text: g })), { text: `⭐ +${xp} XP` }];
    this.ui.banner('SHIP CAPTURED!', `${ship.name} is yours!`, rewards, '', 4);
    if (lost > 0) this.after(1.5, () => this.ui.toast('📦 Hold full!', `${lost} crates had to be left behind. Upgrade your cargo hold!`, 'danger'));
    this.ui.coinText(ship.pos.clone().setY(8), `+${fmtMoney(money)}`);
    if (this.tutorialStep > 0) {
      this.tutorialStep = 0;
      this.profile.tutorialDone = true;
      this.after(5, () => this.ui.toast('🏴‍☠️ Well done, Captain!', 'Sail to any port to sell your loot – different ports pay different prices!', 'info'));
    }
    saveProfile(p);
  }

  onShipSunk(ship: Ship, by: Ship | null) {
    if (ship === this.player) {
      this.state = 'dead';
      this.deadT = 0;
      this.player.captain?.play('defeat');
      this.player.captain?.express('sad');
      this.ui.banner('SHIP SUNK!', 'Abandon ship!', [], 'bad', 3);
      return;
    }
    if (!(ship instanceof AIShip)) return;
    if (this.player.target === ship) this.player.target = null;
    if (ship.contractId && by === this.player) this.contracts.rivalDefeated(ship.contractId);
    if (by === this.player) {
      if (ship.type.team === 'navy') {
        const bounty = ship.coffers;
        this.addMoney(bounty);
        this.addXp(ship.type.xp);
        this.profile.stats.navySunk++;
        this.missions.event('sinkNavy');
        this.wanted.addHeat(0.6, ship.pos, true);
        this.ui.toast('💥 Navy ship sunk!', `+${fmtMoney(bounty)} bounty · +${ship.type.xp} XP`, 'good');
        this.ui.coinText(ship.pos.clone().setY(8), `+${fmtMoney(bounty)}`);
      } else {
        this.profile.stats.sunk++;
        this.addXp(Math.round(ship.type.xp * (ship.isRival ? 1 : 0.25)));
        if (!ship.isRival) {
          this.wanted.addHeat(0.4, ship.pos);
          this.ui.toast('💀 She sank!', 'The cargo went down with her. Board ships before they sink!', 'danger');
        }
      }
    }
  }

  private collectTreasure(t: Treasure) {
    t.collected = true;
    this.profile.treasuresFound.push(t.island.name);
    this.profile.stats.treasures++;
    this.addMoney(t.value);
    this.addXp(300);
    this.missions.event('treasure');
    this.contracts.treasure(t.island.name);
    audio.play('treasure');
    audio.play('cash', { delay: 0.4 });
    this.particles.coins(t.pos.clone().setY(t.pos.y + 1), 40);
    this.particles.confettiBurst(t.pos.clone().setY(t.pos.y + 1), 50);
    t.mesh.visible = false;
    this.ui.banner('TREASURE!', `You dug up a chest on ${t.island.name}!`, [{ text: `💰 +${fmtMoney(t.value)}`, gold: true }, { text: '⭐ +300 XP' }]);
    this.player.celebrate(3);
    saveProfile(this.profile);
  }

  // =====================================================================
  // Docking, disembarking, boarding your ship
  // =====================================================================
  /** Moor the ship at a port's berth (glides in unless instant). */
  private berthCache: { key: string; pos: THREE.Vector3; heading: number; landing: THREE.Vector3 } | null = null;

  /** Where your ship ties up at a port: big ships moor further out along the pier, clear of the shore. */
  berth(idx = this.townIdx) {
    const key = `${idx}:${this.profile.ship}:${this.player.model.length}:${this.player.model.outerHalfWidth}`;
    if (this.berthCache?.key === key) return this.berthCache;
    const port = PORTS[idx];
    const m = this.player.model;
    const fwd = new THREE.Vector3(Math.sin(port.berthHeading), 0, Math.cos(port.berthHeading));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const pier = PIERS.filter((q) => q.port === port.id).reduce((a, q) => (Math.hypot(q.x - port.berth.x, q.z - port.berth.z) < Math.hypot(a.x - port.berth.x, a.z - port.berth.z) ? q : a));
    const off = (port.berth.x - pier.x) * right.x + (port.berth.z - pier.z) * right.z;
    const pos = port.berth.clone().addScaledVector(right, Math.sign(off) * Math.max(0, pier.hw + 0.9 + m.outerHalfWidth - Math.abs(off)));
    const L = m.length;
    const hw = m.outerHalfWidth;
    let shift = 0;
    for (; shift < 40; shift++) {
      let ok = true;
      for (const k of [-0.5, -0.25, 0, 0.25, 0.5])
        for (const j of [-1, 0, 1]) if (landSDF(pos.x + fwd.x * L * k + right.x * hw * j, pos.z + fwd.z * L * k + right.z * hw * j) < 1.2) ok = false;
      if (ok) break;
      pos.addScaledVector(fwd, 1);
    }
    // the gangplank lands further along the pier too
    const town = this.towns[idx];
    const along0 = (town.landing.x - pier.x) * fwd.x + (town.landing.z - pier.z) * fwd.z;
    const landing = town.landing.clone().addScaledVector(fwd, Math.max(0, Math.min(shift, pier.hl - 2 - along0)));
    this.berthCache = { key, pos, heading: port.berthHeading, landing };
    return this.berthCache;
  }
  /** Gangplank spot on the pier beside your ship. */
  get landing() {
    return this.berth(this.townIdx).landing;
  }

  /** raid landing: you tie up, but nobody's welcoming you (no wanted reset, no contracts) */
  private raidDock = false;
  private dockAt(idx: number, instant = false, raid = false) {
    this.raidDock = raid;
    this.townIdx = idx;
    this.inPort = true;
    this.player.controlsEnabled = false;
    this.navTarget = null;
    this.projectiles.clear();
    this.dockT = 0;
    this.dockFrom.copy(this.player.pos);
    this.dockFromHeading = this.player.heading;
    this.ui.prompt(null);
    if (!this.lives[idx].active) this.lives[idx].activate(this.env.hour);
    this.syncRecruits();
    if (instant) {
      const b = this.berth(idx);
      this.player.resetAt(b.pos, b.heading);
      this.player.speed = 0;
      this.state = 'docked';
      this.arrive(idx, true);
    } else {
      this.state = 'docking';
      audio.play('bell');
      this.player.captain?.play('wave');
      this.player.captain?.express('happy');
      this.player.crewDo((c) => c.play('cheer'));
    }
  }

  /** Things that happen when you reach a port. */
  private arrive(idx: number, quiet = false) {
    const port = PORTS[idx];
    if (this.raidDock) {
      this.player.crewIdle();
      this.ui.place(`RAID ON ${port.name.toUpperCase()}`, 'Fight your way to the treasury!');
      this.ui.toast('⚔️ Raiding party ashore!', 'Press <b>E</b> to go ashore. Townsfolk will flee and the shops are shut.', 'danger');
      return;
    }
    this.wanted.clear();
    for (const s of this.ships) if (s.type.team === 'navy' && s.state !== 'patrol') s.setState('leave');
    const value = this.cargoValue;
    if (value > 0) this.missions.event('cargoReturn', { value });
    this.contracts.arrive(port.id);
    this.profile.lastPort = port.id;
    this.player.crewIdle();
    if (!quiet) {
      this.ui.place(port.name.toUpperCase(), port.blurb);
      this.ui.toast(`⚓ Docked at ${port.name}`, 'Press <b>E</b> to disembark · <b>W</b> to set sail', 'info');
    }
    this.profile.hp = this.player.hp;
    saveProfile(this.profile);
  }

  private captainWorldPos() {
    const c = this.player.captain;
    const v = new THREE.Vector3();
    if (c) c.root.getWorldPosition(v);
    else v.copy(this.player.pos).setY(2.5);
    return v;
  }

  /** Climb out of the ship onto the pier and start walking. */
  private disembark(instant = false, announce = true) {
    const town = this.town;
    const from = this.captainWorldPos();
    const to = this.landing.clone();
    this.player.controlsEnabled = false;
    this.player.captain && (this.player.captain.root.visible = false);
    this.walker.visible = true;
    this.walker.locked = false;
    this.placeGangplank(true);
    const faceTown = headingTo(town.center.x - to.x, town.center.z - to.z);
    // camera behind the captain, looking up the pier into town
    this.camRig.walk(faceTown + Math.PI, instant ? 0.01 : 1.6);
    this.camRig.walkPitch = 0.32;
    this.state = 'land';
    this.ui.setHintMode('land');
    this.ui.setHintVisible(true);
    // a raid brings a landing party (one pirate in four, up to four)
    const party = this.raidDock ? Math.min(4, Math.max(1, Math.floor(this.profile.crew / 4))) : 0;
    this.combat.enterLand(`port:${this.townIdx}`, this.area, to, town.port.name, party);
    // point the raiders at the treasury
    const vault = this.raidDock ? this.combat.sites.find((s) => s.def.raid && s.def.port === town.port.id && s.status !== 'cleared') : null;
    if (vault) this.landObjective = vault.geo.center.clone();
    if (instant) this.walker.place(to, faceTown);
    else {
      this.walker.locked = true;
      this.walker.hopTo(from, to, () => {
        this.walker.locked = false;
        this.walker.heading = faceTown;
      });
      audio.playVoice('arr', from, 1);
    }
    if (announce) this.ui.place(town.port.name.toUpperCase(), town.port.blurb);
  }

  /** Walk up the gangplank and take the wheel. */
  private embark() {
    this.combat.leaveLand();
    this.embarking = true;
    this.walker.locked = true;
    const to = this.captainWorldPos();
    this.walker.hopTo(this.walker.pos.clone(), to, () => {
      this.embarking = false;
      this.walker.visible = false;
      if (this.player.captain) this.player.captain.root.visible = true;
      this.placeGangplank(false);
      this.setActiveInterior(null);
      this.castOff();
      this.landTutorialEvent('embark');
    });
  }

  /** Leave the berth (from the docked state, or after boarding). */
  private castOff() {
    this.state = 'playing';
    this.inPort = false;
    this.harbourIdx = this.townIdx;
    this.leftHarbour = false;
    this.player.controlsEnabled = true;
    this.player.captain?.play('steer');
    this.player.crewIdle();
    this.camRig.follow(this.player.heading);
    this.camRig.colliders = this.seaColliders;
    this.ui.setHintMode('sea');
    this.ui.setHintVisible(true);
    this.ui.prompt(null);
    audio.playVoice('arr', undefined, 0.95);
    if (!this.profile.tutorialDone && this.tutorialStep === 0) this.tutorialStep = 1;
    this.profile.hour = this.env.hour;
    saveProfile(this.profile);
  }

  private placeGangplank(on: boolean) {
    for (const t of this.towns) t.gangplank.visible = false;
    if (!on) return;
    const town = this.town;
    const a = this.landing.clone();
    const ship = this.player;
    const toShip = new THREE.Vector3(ship.pos.x - a.x, 0, ship.pos.z - a.z);
    const dist = toShip.length();
    toShip.normalize();
    const reach = Math.max(1.5, dist - ship.model.beam * 0.5 + 0.6);
    const b = a.clone().addScaledVector(toShip, reach);
    b.y = ship.pos.y + ship.model.deckYAt(0) + 0.1;
    a.y = 1.86;
    const g = town.gangplank;
    g.position.copy(a).lerp(b, 0.5);
    g.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
    g.rotateX(-Math.atan2(b.y - a.y, reach));
    g.scale.set(1, 1, reach / 2.8);
    g.visible = true;
  }

  private respawn() {
    const p = this.profile;
    const loss = Math.round(p.money * 0.2);
    p.money -= loss;
    p.cargo = {};
    p.costBasis = {};
    p.crew = Math.max(p.crew, Math.ceil(this.maxCrew * 0.5));
    p.hp = this.shipStats.maxHp;
    this.screens.over.classList.add('hidden');
    this.player.applyProfile(p, true);
    this.player.hp = this.player.maxHp;
    this.player.root.position.y = 0;
    this.wanted.clear();
    // dragged back to the nearest friendly port
    const idx = Math.max(0, PORTS.findIndex((x) => x.id === p.lastPort));
    this.dockAt(idx, true);
    this.disembark(true);
  }

  // =====================================================================
  // Shops & dialogue
  // =====================================================================
  private keeperNpc(it: Interactable) {
    return it.keeper ? this.life.npcById(it.keeper) : null;
  }

  private openHours(it: Interactable) {
    if (it.kind === 'stall' && it.stall) return STALLS[it.stall].hours;
    if (it.nightOnly) return [20, 5] as [number, number];
    return null;
  }

  private interact(it: Interactable) {
    if (it.kind === 'boat') {
      this.embark();
      return;
    }
    if (it.kind === 'recruit') {
      const r = recruitsFor(this.currentPortId, this.profile.day)[it.recruitIdx ?? 0];
      if (!r || this.profile.hiredRecruits.includes(r.id)) {
        this.ui.toast('🪑 Empty seat', 'That recruit already joined a crew.', 'info');
        return;
      }
      this.openShop('recruit', it, r.name, `${ROLES[r.role].icon} ${r.line}`);
      return;
    }
    if (it.kind === 'board') {
      this.openShop('board', it, 'Notices', '');
      return;
    }
    const npc = this.keeperNpc(it);
    if (it.keeper && !this.life.isPresent(it.keeper)) {
      const h = this.openHours(it);
      this.ui.toast(`🌙 ${it.label} is closed`, h ? `Open ${String(h[0]).padStart(2, '0')}:00 – ${String(h[1]).padStart(2, '0')}:00. Rest at a tavern to skip time.` : 'Nobody is here right now.', 'danger');
      audio.play('error');
      return;
    }
    const kind = it.kind as ShopKind;
    const lines = npc?.def.lines ?? ['Ahoy!'];
    const greet = it.kind === 'stall' ? choose(STALLS[it.stall!].greet) : choose(lines);
    if (it.kind === 'black' && !this.profile.blackMarkets.includes(this.currentPortId)) this.profile.blackMarkets.push(this.currentPortId);
    this.openShop(kind, it, npc?.def.name ?? it.label, greet);
  }

  private openShop(kind: ShopKind, it: Interactable, name: string, greeting: string) {
    this.state = 'shop';
    this.input.unlockPointer();
    this.walker.faceTo(it.look);
    this.walker.interact();
    this.shopNpc = it.keeper ? this.life.npcById(it.keeper) : kind === 'recruit' ? this.recruitNpc(it.recruitIdx ?? 0) : null;
    if (this.shopNpc) this.life.greet(this.shopNpc, this.walker.pos);
    audio.playVoice('hey', it.look, 1.15);
    this.ui.prompt(null);
    this.ui.setHintVisible(false);
    this.shop.show(kind, it, name, greeting);
    this.frameConversation(it.look, 1.6);
    this.landTutorialEvent(kind);
  }

  closeShop() {
    if (this.state !== 'shop') return;
    this.shop.hide();
    if (this.shopNpc) this.life.resume(this.shopNpc);
    this.shopNpc = null;
    this.state = 'land';
    this.returnWalkCam();
    this.ui.setHintVisible(true);
    saveProfile(this.profile);
  }

  /** Over-the-shoulder framing that puts the person you're talking to left of centre. */
  private frameConversation(look: THREE.Vector3, shift: number) {
    const me = this.walker.pos;
    const dx = look.x - me.x;
    const dz = look.z - me.z;
    const h = Math.atan2(dx, dz);
    const fwd = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const screenRight = new THREE.Vector3(-Math.cos(h), 0, Math.sin(h));
    // camera over the captain's right shoulder: captain at the left edge, vendor left of centre,
    // and the right side of the screen free for the shop panel
    const target = look.clone().addScaledVector(screenRight, shift * 0.75).setY(look.y - 0.5);
    const camPos = me.clone().addScaledVector(fwd, -3.0).addScaledVector(screenRight, 2.2 + shift * 0.75).setY(me.y + 2.6);
    this.camRig.setCinematic(camPos, target, 3);
  }

  private returnWalkCam() {
    const cam = this.camRig.camera.position;
    this.camRig.walk(Math.atan2(cam.x - this.walker.pos.x, cam.z - this.walker.pos.z), 1.0);
  }

  private startDialogue(npc: Npc) {
    this.state = 'dialogue';
    this.input.unlockPointer();
    this.life.startTalk(npc, this.walker.pos);
    this.walker.faceTo(npc.pos);
    this.walker.interact();
    const lines = npc.def.lines.length ? npc.def.lines : ['Ahoy, Captain!'];
    this.talk = { npc, lines, i: 0 };
    this.ui.prompt(null);
    this.ui.setHintVisible(false);
    this.ui.showTalk(npc.def.name, lines[0], lines.length > 1);
    audio.playVoice(choose(['hey', 'arr', 'yay'] as const), npc.pos, npc.c.spec.height > 1 ? 0.9 : 1.2);
    this.frameConversation(npc.pos.clone().setY(npc.pos.y + 1.7), 0.4);
  }

  private advanceDialogue() {
    const t = this.talk!;
    t.i++;
    if (t.i >= t.lines.length) {
      this.endDialogue();
      return;
    }
    this.ui.showTalk(t.npc.def.name, t.lines[t.i], t.i < t.lines.length - 1);
    audio.playVoice('hey', t.npc.pos, 1.1);
  }

  private endDialogue() {
    this.talk = null;
    this.ui.hideTalk();
    this.life.endTalk();
    this.state = 'land';
    this.returnWalkCam();
    this.ui.setHintVisible(true);
  }

  private recruitNpc(idx: number) {
    return this.life.npcById(`${this.currentPortId}-tavern-r${idx}`);
  }

  /** Recruit NPCs in the tavern match today's recruits (and vanish once hired). */
  private syncRecruits() {
    const life = this.lives[this.townIdx];
    if (!life?.active) return;
    const list = recruitsFor(PORTS[this.townIdx].id, this.profile.day);
    list.forEach((r, i) => {
      const n = life.npcById(`${PORTS[this.townIdx].id}-tavern-r${i}`);
      if (!n) return;
      if (n.c.spec.id !== r.spec) life.setSpec(n, r.spec);
      n.def.name = r.name;
      n.def.lines = [r.line];
      const hired = this.profile.hiredRecruits.includes(r.id);
      life.setHidden(n, hired);
    });
  }

  // =====================================================================
  // Land tutorial
  // =====================================================================
  private landTutorial() {
    const p = this.profile;
    if (this.currentPortId !== 'skull' || p.landTutorial >= 5) {
      this.landObjective = null;
      return;
    }
    const find = (id: string) => this.town.interactables.find((i) => i.id === id)?.pos ?? null;
    switch (p.landTutorial) {
      case 0:
        this.ui.toast('🚶 Welcome ashore, Captain!', 'Walk with <b>WASD</b>, run with <b>SHIFT</b>, drag the mouse to look around.', 'info');
        p.landTutorial = 1;
        this.after(4, () => this.landTutorial());
        break;
      case 1:
        this.landObjective = find('skull-spice');
        this.ui.toast('🌶️ Visit the Spice Stall', 'Spices are cheap in Skull Cove – and pricey in Port Royal!', 'mission');
        break;
      case 2:
        this.landObjective = find('skull-shipwright');
        this.ui.toast('🔨 Visit the Shipwright', 'Upgrade your ship – the changes show on the hull!', 'mission');
        break;
      case 3:
        this.landObjective = find('skull-tavern-board');
        this.ui.toast('🍺 Visit the Salty Skull tavern', 'Recruit officers and take a contract from the mission board.', 'mission');
        break;
      case 4:
        this.landObjective = this.landing.clone();
        this.ui.toast('⛵ Back to your ship!', 'Walk down the pier and press <b>E</b> at the gangplank.', 'mission');
        break;
    }
  }

  private landTutorialEvent(ev: string) {
    const p = this.profile;
    if (p.landTutorial >= 5 || this.currentPortId !== 'skull') return;
    const step = p.landTutorial;
    if (step === 1 && (ev === 'stall' || ev === 'buy')) p.landTutorial = 2;
    else if (step === 2 && (ev === 'shipwright' || ev === 'upgrade')) p.landTutorial = 3;
    else if (step === 3 && (ev === 'board' || ev === 'recruit' || ev === 'bartender')) p.landTutorial = 4;
    else if (ev === 'embark') {
      p.landTutorial = 5;
      this.landObjective = null;
      return;
    } else return;
    if (p.landTutorial !== step) this.after(ev === 'stall' || ev === 'shipwright' || ev === 'board' ? 0.5 : 1.5, () => this.state !== 'shop' && this.landTutorial());
    if (p.landTutorial !== step) this.pendingTutorial = true;
  }
  private pendingTutorial = false;

  // =====================================================================
  // Main loop
  // =====================================================================
  private loop(t: number) {
    requestAnimationFrame((tt) => this.loop(tt));
    this.clock.update(t);
    const raw = this.clock.getDelta();
    if (raw > 0) this.fps = lerp(this.fps, 1 / raw, 0.05);
    this.frameTimes[this.frameIdx++ % this.frameTimes.length] = raw * 1000;
    const dt = Math.min(raw, 0.05);
    const t0 = performance.now();
    if (!this.paused) this.update(dt);
    this.input.endFrame();
    const t1 = performance.now();
    this.render(dt);
    const t2 = performance.now();
    this.perf.update = lerp(this.perf.update, t1 - t0, 0.05);
    this.perf.render = lerp(this.perf.render, t2 - t1, 0.05);
  }

  private update(dt: number) {
    this.time += dt;
    globalUniforms.uTime.value = this.time;
    const input = this.input;

    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.time >= this.timers[i].t) {
        const fn = this.timers[i].fn;
        this.timers.splice(i, 1);
        fn();
      }
    }

    const active = this.state !== 'loading' && this.state !== 'title' && this.state !== 'dead';
    if (active) {
      if (input.pressed('Escape')) {
        if (this.bigMapOpen) this.toggleMap(false);
        else if (this.inventory.open) this.inventory.toggle(false);
        else if (this.state === 'shop') this.closeShop();
        else if (this.state === 'dialogue') this.endDialogue();
        else this.setPaused(true);
        return;
      }
      if (input.pressed('KeyM') && this.state !== 'shop') this.toggleMap(!this.bigMapOpen);
      // during a fight on land TAB locks on to enemies (I still opens the inventory)
      const tabInv = input.pressed('Tab') && !(this.onLand && this.combat.claimsTab);
      if ((tabInv || input.pressed('KeyI')) && this.state !== 'shop' && this.state !== 'dialogue') {
        this.inventory.toggle();
        if (this.inventory.open) this.input.unlockPointer();
      }
    }
    if (this.pendingTutorial && this.state === 'land') {
      this.pendingTutorial = false;
      this.landTutorial();
    }

    // ---------- clock, economy ----------
    if (active) {
      let dh = this.env.hour - this.prevHour;
      if (dh < 0) {
        dh += 24;
        this.newDay();
      }
      this.prevHour = this.env.hour;
      this.economy.update(dh);
    }

    const p = this.player;
    // ---------- player & AI ----------
    switch (this.state) {
      case 'playing':
        p.update(dt);
        this.updateTargeting();
        this.updateInteractions();
        this.updateTutorial(dt);
        this.reachT -= dt;
        if (this.reachT <= 0) {
          this.reachT = 0.5;
          this.contracts.checkReach(p.pos.x, p.pos.z);
        }
        break;
      case 'docking':
        this.updateDocking(dt);
        break;
      case 'docked':
        this.holdAtBerth(dt);
        if (input.pressed('KeyE')) this.disembark();
        else if (input.pressed('KeyW', 'ArrowUp')) this.castOff();
        else this.ui.prompt('PRESS <kbd>E</kbd> TO DISEMBARK &nbsp; <kbd>W</kbd>⛵ SET SAIL', 'blue');
        break;
      case 'land':
      case 'shop':
      case 'dialogue':
        this.holdAtBerth(dt);
        this.updateLand(dt);
        break;
      case 'ashore':
        this.holdAtAnchor(dt);
        this.updateAshore(dt);
        break;
      case 'deck':
        p.update(dt);
        this.updateDeck(dt);
        break;
      case 'dead':
        p.update(dt);
        this.deadT += dt;
        if (this.deadT > 4 && this.screens.over.classList.contains('hidden')) {
          this.screens.over.classList.remove('hidden');
          document.getElementById('overLoss')!.textContent = `Lost all cargo and ${fmtMoney(this.profile.money * 0.2)}.`;
        }
        break;
      default:
        // title: ship bobs at the berth
        p.throttle = 0;
        p.steer = 0;
        p.update(dt);
    }

    for (const s of this.ships) {
      s.update(dt);
      const d = s.pos.distanceTo(this.camRig.camera.position);
      s.setCrewVisible(d < 150);
      s.wake.mesh.visible = d < 450;
    }
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      if (s.removeMe) {
        s.dispose();
        this.ships.splice(i, 1);
        if (p.target === s) p.target = null;
      }
    }
    this.resolveShipCollisions();
    this.boarding.update(dt);
    this.raid.update(dt);
    this.projectiles.update(dt);
    this.particles.update(dt);
    if (this.state === 'playing') this.wanted.update(dt);
    this.updateSpawning(dt);
    this.adaptQuality(dt);
    this.updateTowns(dt);
    this.updateAmbientFx(dt);
    this.birds.update(dt, this.onLand ? this.walker.pos : p.pos);

    // ---------- camera ----------
    const focus = this.onLand ? this.walker.pos : p.pos;
    this.camRig.boost = lerp(this.camRig.boost, p.boosting ? 1 : 0, dampT(4, dt));
    if (this.state === 'dead') this.camRig.setOrbit(p.pos.clone(), 40, 18, 0.12, 0);
    const camInput = (this.state === 'playing' && !this.boarding.active) || ((this.state === 'land' || this.state === 'ashore' || this.state === 'deck') && !this.inventory.open && !this.walker.hopping && !this.combat.defeated) ? input : null;
    const camTarget = this.onLand ? { pos: this.walker.pos, heading: this.walker.heading, speed: this.walker.speed } : p;
    this.camRig.update(dt, camTarget, camInput, this.ocean);
    // tighter, crisper shadows while walking around town
    const wantLand = this.onLand;
    if (wantLand !== this.shadowLand) {
      this.shadowLand = wantLand;
      const sc = this.env.sun.shadow.camera;
      const s = wantLand ? 32 : 55;
      sc.left = sc.bottom = -s;
      sc.right = sc.top = s;
      sc.updateProjectionMatrix();
    }
    this.env.update(dt, this.state === 'title' ? PORTS[this.townIdx].berth : focus, this.camRig.camera, this.ocean);
    this.ocean.update(dt, this.camRig.camera);
    this.ocean.material.uniforms.uReflMatrix.value.copy(this.reflection.textureMatrix);

    // ---------- audio ----------
    audio.setListener(this.camRig.camera.position, this.camRig.viewYaw);
    const combat = this.time - p.lastFireTime < 6 || this.wanted.level > 0 || this.ships.some((s) => s.state === 'fight' || s.state === 'attack');
    const nearPort = PORTS.reduce((m, x) => Math.min(m, x.berth.distanceTo(focus)), Infinity);
    audio.update(dt, {
      speed: this.onLand ? 0 : Math.abs(p.speed),
      wind: this.env.cur.wind,
      rain: this.env.cur.rain,
      portProximity: this.onLand ? (this.activeInterior?.kind === 'tavern' ? 1.6 : 0.8 * (1 - this.env.night * 0.6)) : clamp(1 - nearPort / 200, 0, 1),
      combat: (combat && this.state === 'playing') || this.combat.engaged,
      inPort: this.state !== 'playing' && !this.combat.engaged,
      tavern: this.activeInterior?.kind === 'tavern',
      turning: this.onLand ? 0 : p.steerVisual,
    });

    // ---------- HUD ----------
    const root = this.ui.root.classList;
    root.toggle('is-docked', this.state === 'docked' || this.state === 'docking');
    root.toggle('is-land', this.onLand);
    root.toggle('is-shop', this.state === 'shop' || this.state === 'dialogue');
    if (this.state !== 'title' && this.state !== 'loading') {
      this.displayMoney = lerp(this.displayMoney, this.profile.money, dampT(6, dt));
      if (Math.abs(this.displayMoney - this.profile.money) < 1) this.displayMoney = this.profile.money;
      if (this.state === 'ashore') this.zoneLabel = this.isle?.name ?? '';
      else if (this.state === 'deck') this.zoneLabel = `⚔️ ${this.boarding.enemy.name}`;
      else if (this.onLand) this.zoneLabel = this.activeInterior ? `${this.activeInterior.name}` : PORTS[this.townIdx].name;
      else {
        const zone = zoneAt(p.pos.x, p.pos.z);
        this.zoneLabel = this.env.danger > 0.2 ? "☠ KRAKEN'S TEETH ☠" : zone ? zone.name : '';
      }
      this.ui.update(dt);
      this.hudFrame++;
      this.ui.markers(this.buildMarkers());
      if (this.bigMapOpen) {
        const c = this.screens.bigmapCanvas;
        const ctx = c.getContext('2d')!;
        if (this.onLand) this.ui.minimap.drawTown(ctx, c.width, this.mapArea, true);
        // the whole sailable sea, corners and all (that's where the treasure isles hide)
        else this.ui.minimap.drawTo(ctx, c.width, 0, 0, WORLD_SOFT_EDGE + 70, true);
      }
      this.shop.update(dt);
      if (this.talk) this.ui.moveTalk(this.talk.npc.pos.clone().setY(this.talk.npc.pos.y + 2.75));
      if (this.inventory.open && this.hudFrame % 30 === 0) this.inventory.render();
    }
    this.saveT -= dt;
    if (this.saveT <= 0 && (this.state === 'playing' || this.state === 'land' || this.state === 'ashore')) {
      this.saveT = 30;
      this.profile.hp = p.hp;
      this.profile.hour = this.env.hour;
      saveProfile(this.profile);
    }
  }

  private toggleMap(on: boolean) {
    this.bigMapOpen = on;
    if (on) this.input.unlockPointer();
    this.screens.bigmap.classList.toggle('hidden', !on);
    audio.play('click');
  }

  /** Keep the moored ship bobbing at its berth. */
  private holdAtBerth(dt: number) {
    const p = this.player;
    const b = this.berth(this.townIdx);
    p.pos.x = b.pos.x;
    p.pos.z = b.pos.z;
    p.heading = b.heading;
    p.speed = 0;
    p.throttle = 0;
    p.steer = 0;
    p.update(dt);
  }

  private updateDocking(dt: number) {
    const p = this.player;
    this.dockT += dt;
    const k = clamp(this.dockT / 1.6, 0, 1);
    const e = k * k * (3 - 2 * k);
    const b = this.berth(this.townIdx);
    p.pos.x = lerp(this.dockFrom.x, b.pos.x, e);
    p.pos.z = lerp(this.dockFrom.z, b.pos.z, e);
    p.heading = this.dockFromHeading + angleDiff(this.dockFromHeading, b.heading) * e;
    p.speed = 0;
    p.throttle = 0;
    p.steer = 0;
    p.update(dt);
    if (k >= 1) {
      this.state = 'docked';
      this.arrive(this.townIdx);
    }
  }

  // ---------------------------------------------------------------------
  // On foot
  // ---------------------------------------------------------------------
  private updateLand(dt: number) {
    const input = this.input;
    const town = this.town;
    const life = this.life;
    this.npcCols.length = 0;
    life.colliders(this.npcCols);
    const canMove = this.state === 'land' && !this.inventory.open && !this.bigMapOpen;
    const mods = this.combat.playerMods(dt, input, canMove && !this.walker.hopping && !this.embarking);
    this.walker.update(dt * this.combat.timeScale, canMove ? input : null, this.camRig.walkYaw, this.area, this.npcCols, this.particles, mods);
    this.combat.update(dt, this.npcCols);
    // a raid: the town empties as you fight through it, and every shop is shut
    const raiding = this.raid.landedHere;
    if (raiding) {
      this.raidScareT -= dt;
      if (this.raidScareT <= 0) {
        this.raidScareT = 1;
        life.scare(this.walker.pos, 45);
      }
    }

    // which building are we in? (roof + near walls get cut away)
    let inside: Interior | null = null;
    for (const it of town.interiors) {
      const { lx, lz } = LandArea.local(it, this.walker.pos.x, this.walker.pos.z);
      if (Math.abs(lx) < it.hx && Math.abs(lz) < it.hz && this.walker.pos.y > it.floorY - 0.6) {
        inside = it;
        break;
      }
    }
    if (inside !== this.activeInterior) this.setActiveInterior(inside);
    if (inside) {
      const cam = this.camRig.camera.position;
      for (const w of inside.walls) w.obj.visible = (cam.x - inside.x) * w.nx + (cam.z - inside.z) * w.nz < 0.5;
      const fire = town.fires.find((f) => LandArea.local(inside!, f.x, f.z).lx ** 2 < inside!.hx ** 2 && Math.abs(LandArea.local(inside!, f.x, f.z).lz) < inside!.hz);
      if (fire) {
        this.interiorLight.position.copy(fire).setY(fire.y + 0.6);
        this.interiorLight.intensity = 22 + Math.sin(this.time * 13) * 3 + Math.sin(this.time * 7.3) * 2;
      } else this.interiorLight.intensity = 0;
    }

    if (this.state === 'dialogue') {
      if (input.pressed('KeyE', 'Space', 'Enter')) this.advanceDialogue();
      return;
    }
    if (this.state !== 'land' || this.walker.hopping || this.embarking) {
      if (this.state === 'land') this.ui.prompt(null);
      return;
    }
    // fighting: no shopping or chatting, but chests / loot still prompt
    if (this.combat.defeated) {
      this.ui.prompt(null);
      return;
    }
    if (this.combat.prompt) {
      this.ui.prompt(this.combat.prompt, 'blue');
      return;
    }
    if (this.combat.engaged) {
      this.ui.prompt(null);
      return;
    }

    // ---- find what's in front of us ----
    const me = this.walker.pos;
    const fx = Math.sin(this.walker.heading);
    const fz = Math.cos(this.walker.heading);
    let best: Interactable | null = null;
    let bestNpc: Npc | null = null;
    let bs = Infinity;
    const consider = (pos: THREE.Vector3, radius: number) => {
      const dx = pos.x - me.x;
      const dz = pos.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d > radius || Math.abs(pos.y - me.y) > 1.6) return Infinity;
      const facing = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < -0.2 && d > radius * 0.5) return Infinity;
      return d * (1.4 - facing * 0.4);
    };
    for (const it of town.interactables) {
      if (raiding) break;
      if (it.kind === 'recruit') {
        const r = recruitsFor(this.currentPortId, this.profile.day)[it.recruitIdx ?? 0];
        if (!r || this.profile.hiredRecruits.includes(r.id)) continue;
      }
      // finding a hidden black market
      if (it.secret && !this.profile.blackMarkets.includes(this.currentPortId) && it.pos.distanceTo(me) < 6) {
        this.profile.blackMarkets.push(this.currentPortId);
        audio.play('treasure', { volume: 0.6 });
        this.ui.toast('🕵️ You found a hidden black market!', it.nightOnly ? 'The dealer only shows up after dark.' : 'Rare goods and very special items…', 'mission');
      }
      const s = consider(it.pos, it.radius);
      if (s < bs) {
        bs = s;
        best = it;
        bestNpc = null;
      }
    }
    // boat (gangplank)
    const landing = this.landing;
    const boat: Interactable = { id: 'boat', kind: 'boat', pos: landing, radius: 3.0, label: 'Board your ship', icon: '⛵', look: landing };
    const sb = consider(landing, 3.0);
    if (sb < bs) {
      bs = sb;
      best = boat;
      bestNpc = null;
    }
    // chatty townsfolk (they've all run off during a raid)
    for (const n of raiding ? [] : life.npcs) {
      if (n.state === 'home' || !n.c.root.visible) continue;
      const role = n.def.role;
      if (role === 'vendor' || role === 'keeper' || role === 'recruit' || role === 'smuggler') continue;
      const s = consider(n.pos, 2.4);
      if (s < bs) {
        bs = s;
        best = null;
        bestNpc = n;
      }
    }
    this.focusIt = best;
    if (best) {
      let open = true;
      if (best.keeper && !life.isPresent(best.keeper)) open = false;
      const label = best.kind === 'recruit' ? `Talk to ${recruitsFor(this.currentPortId, this.profile.day)[best.recruitIdx ?? 0]?.name ?? 'recruit'}` : best.kind === 'boat' ? 'BOARD YOUR SHIP' : best.label.toUpperCase();
      if (open) this.ui.prompt(`<kbd>E</kbd>${best.icon} ${label}`, best.kind === 'boat' ? 'blue' : '');
      else this.ui.prompt(`🌙 ${best.label.toUpperCase()} · CLOSED`, 'red');
      if (input.pressed('KeyE')) this.interact(best);
    } else if (bestNpc) {
      this.ui.prompt(`<kbd>E</kbd>💬 TALK TO ${bestNpc.def.name.toUpperCase()}`, '');
      if (input.pressed('KeyE')) this.startDialogue(bestNpc);
    } else this.ui.prompt(null);
  }

  private setActiveInterior(it: Interior | null) {
    const prev = this.activeInterior;
    if (prev) {
      prev.roof.visible = true;
      for (const w of prev.walls) w.obj.visible = true;
    }
    this.activeInterior = it;
    this.interiorLight.intensity = 0;
    if (it) {
      it.roof.visible = false;
      this.camRig.indoor = true;
      const shell = new Set(it.shell);
      this.camRig.colliders = [...this.town.camColliders.filter((m) => !shell.has(m)), ...this.islands.colliders];
      audio.play('creak', { volume: 0.5 });
    } else {
      this.camRig.indoor = false;
      this.camRig.colliders = this.inTown ? [...this.town.camColliders, ...this.islands.colliders] : this.state === 'ashore' ? this.islands.colliders : this.seaColliders;
    }
  }

  /** Turn towns on/off as you approach; only the nearest port is simulated. */
  private updateTowns(dt: number) {
    this.townT -= dt;
    const focus = this.onLand ? this.walker.pos : this.player.pos;
    if (this.townT <= 0) {
      this.townT = 0.5;
      this.towns.forEach((t, i) => {
        const d = Math.hypot(t.center.x - focus.x, t.center.z - focus.z);
        t.group.visible = d < 950;
        for (const o of t.group.children) if (o.userData.farHide) o.visible = d < 260;
        // furniture inside buildings is only drawn when you're on foot near them (walls hide it otherwise)
        const me = this.walker?.pos;
        for (const int of t.interiors) {
          const near = this.inTown && i === this.townIdx && !!me && Math.hypot(int.x - me.x, int.z - me.z) < 45 + Math.max(int.hx, int.hz);
          for (const o of int.contents) o.visible = near;
        }
        const life = this.lives[i];
        if (!life.active && d < 300 && this.state !== 'title') {
          life.activate(this.env.hour);
          if (i === this.townIdx) this.syncRecruits();
        } else if (life.active && d > 420 && !(this.inTown && i === this.townIdx)) life.deactivate();
      });
      if (this.inTown && !this.activeInterior) this.camRig.colliders = [...this.town.camColliders, ...this.islands.colliders];
      else if (this.state === 'ashore') this.camRig.colliders = this.islands.colliders;
      this.combat.updateSiteVisibility(focus);
    }
    const cam = this.camRig.camera.position;
    this.lives.forEach((l) => l.update(dt, this.env.hour, this.onLand ? this.walker.pos : this.player.pos, cam));
    // the walker's own animation when not on land is idle
  }

  private updateTargeting() {
    const p = this.player;
    const camDir = this.camRig.camera.getWorldDirection(_tA).setY(0).normalize();
    let best: AIShip | null = null;
    let bestScore = 1e9;
    for (const s of this.ships) {
      if (!s.alive || s.captured || s.sinking) continue;
      const to = _tB.subVectors(s.pos, p.pos);
      const d = to.length();
      if (d > 240) continue;
      to.normalize();
      const facing = 1 - Math.max(0, to.dot(camDir));
      let score = d * (0.6 + facing * 1.6);
      if (s.team === 'navy' && s.state !== 'patrol') score *= 0.8;
      if (s.disabled) score *= 0.7;
      if (s.isRival) score *= 0.7;
      if (s === p.target) score *= 0.7;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    // a raid: the nearest shore battery beats a ship further away
    const bat = this.raid.siegeTarget(p.pos);
    if (bat && (!best || bat.dist < best.pos.distanceTo(p.pos) * 0.8)) best = null;
    p.siege = bat && !best ? bat.pos : null;
    p.target = best;
    this.aimSide = null;
    const aimAt = best ? best.pos : p.siege;
    if (aimAt) {
      const to = _tB.subVectors(aimAt, p.pos);
      const ang = angleDiff(p.heading, Math.atan2(to.x, to.z));
      this.aimSide = Math.abs(ang) < 0.6 ? 'F' : ang > 0 ? 'L' : 'R';
    }
  }

  private updateInteractions() {
    const p = this.player;
    if (this.boarding.active || !p.alive) {
      this.ui.prompt(null);
      return;
    }
    const input = this.input;
    // boarding
    let boardable: AIShip | null = null;
    let bd = 1e9;
    for (const s of this.ships) {
      if (!s.disabled || s.captured || s.sinking || s.boarded) continue;
      const d = s.pos.distanceTo(p.pos);
      const range = 14 + (s.model.beam + p.model.beam) * 0.5 + s.model.length * 0.25;
      if (d < range && d < bd) {
        bd = d;
        boardable = s;
      }
    }
    if (boardable) {
      if (this.profile.crew <= 0) {
        this.ui.prompt('🏴‍☠️ No crew left to board! Hire pirates at a tavern', 'red');
      } else {
        this.ui.prompt('<kbd>E</kbd>⚔️ BOARD SHIP');
        if (input.pressed('KeyE')) this.boarding.start(boardable);
      }
      return;
    }
    // docking at any port
    if (p.pos.distanceTo(PORTS[this.harbourIdx].berth) > 75) this.leftHarbour = true;
    const raid = this.raid;
    for (let i = 0; i < PORTS.length; i++) {
      const port = PORTS[i];
      const d = p.pos.distanceTo(port.berth);
      const raidingHere = raid.port === i && raid.phase !== 'none';
      // a raid: offer it from further out, then track how it's going
      if (d < 170 && (raidingHere || (RAID_PORTS[port.id] && raid.phase === 'none' && (d > 45 || i !== this.harbourIdx || this.leftHarbour)))) {
        if (raidingHere && raid.phase === 'bombard') {
          const n = raid.aliveBatteries(i).length;
          this.ui.prompt(`💣 Silence the shore batteries! (${n} left)`, 'red');
          return;
        }
        if (raidingHere && raid.phase === 'landing') {
          if (d < 45) {
            this.ui.prompt(`<kbd>E</kbd>⚔️ LAND THE RAIDING PARTY`, 'red');
            if (input.pressed('KeyE')) this.dockAt(i, false, true);
          } else this.ui.prompt(`⚓ Sail into ${port.name} harbour to land`, 'blue');
          return;
        }
        if (d > 45 && !raidingHere) {
          if (raid.cooling(i)) this.ui.prompt(`🏚️ ${port.name} is still licking its wounds (${raid.daysLeft(i)} days)`, 'blue');
          else {
            this.ui.prompt(`<kbd>R</kbd>💣 RAID ${port.name.toUpperCase()} ${'☠'.repeat(RAID_PORTS[port.id].tier)}`, 'red');
            if (input.pressed('KeyR')) raid.start(i);
          }
          return;
        }
      }
      if (d > 45 || (i === this.harbourIdx && !this.leftHarbour)) continue;
      const hostile = this.ships.some((s) => s.team === 'navy' && (s.state === 'chase' || s.state === 'attack') && s.pos.distanceTo(p.pos) < 110);
      if (raid.cooling(i)) this.ui.prompt(`⚠️ ${port.name} won't let you dock after your raid (${raid.daysLeft(i)} days)`, 'red');
      else if (hostile) this.ui.prompt('⚠️ Navy too close to dock!', 'red');
      else if (port.lawful && this.wanted.level >= 2) this.ui.prompt(`⚠️ ${port.name} won't let wanted pirates dock!`, 'red');
      else {
        this.ui.prompt(`<kbd>E</kbd>⚓ DOCK AT ${port.name.toUpperCase()}${RAID_PORTS[port.id] ? ' &nbsp; <kbd>R</kbd>💣 RAID' : ''}`, 'blue');
        if (input.pressed('KeyE')) this.dockAt(i);
        else if (RAID_PORTS[port.id] && input.pressed('KeyR')) raid.start(i);
      }
      return;
    }
    // treasure
    for (const t of this.islands.treasures) {
      if (t.collected) continue;
      const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      if (d < 30) {
        this.ui.prompt('<kbd>E</kbd>💎 DIG UP TREASURE', 'blue');
        if (input.pressed('KeyE')) this.collectTreasure(t);
        return;
      }
      if (d < 120 && Math.random() < 0.15) this.particles.sparkle(t.pos.clone().setY(t.pos.y + 1));
    }
    if (this.navTarget && p.pos.distanceTo(this.navTarget) < 60) this.navTarget = null;
    // row ashore on islands without a port
    const isl = this.shoreIsland();
    if (isl) {
      const hostile = this.ships.some((s) => s.team === 'navy' && (s.state === 'chase' || s.state === 'attack') && s.pos.distanceTo(p.pos) < 120);
      if (hostile) this.ui.prompt('⚠️ Too dangerous to go ashore – the navy is on your tail!', 'red');
      else if (Math.abs(p.speed) > 9) this.ui.prompt(`🏝️ Slow down to go ashore on ${isl.name}`, 'blue');
      else {
        this.ui.prompt(`<kbd>E</kbd>🚣 GO ASHORE · ${isl.name.toUpperCase()}`, 'blue');
        if (input.pressed('KeyE')) this.goAshore(isl);
      }
      return;
    }
    this.ui.prompt(null);
  }

  /** An island without a port close enough to row to. */
  private shoreIsland() {
    const p = this.player.pos;
    for (const isl of ISLANDS) {
      if (isl.kind === 'port' || isl.kind === 'pirate') continue;
      const dx = p.x - isl.x;
      const dz = p.z - isl.z;
      const d = Math.hypot(dx, dz);
      if (d > isl.maxR! + 80) continue;
      if (d - coastRadius(isl, Math.atan2(dz, dx)) < 60) return isl;
    }
    return null;
  }

  // =====================================================================
  // Going ashore on islands
  // =====================================================================
  private buildRowboat() {
    const gb = new GeoBuilder();
    gb.add(new THREE.CylinderGeometry(0.78, 0.78, 3.4, 12, 1, true, Math.PI / 2, Math.PI), PAL.wood, T(0, 0.55, 0, Math.PI / 2, 0, Math.PI));
    gb.add(new THREE.BoxGeometry(1.4, 0.07, 0.3), PAL.woodDark, T(0, 0.5, 0.5));
    gb.add(new THREE.BoxGeometry(1.4, 0.07, 0.3), PAL.woodDark, T(0, 0.5, -0.6));
    gb.add(new THREE.BoxGeometry(1.5, 0.1, 0.12), PAL.woodRed, T(0, 0.55, 1.62));
    for (const s of [-1, 1]) {
      gb.add(cyl(0.035, 0.035, 2.4, 5), PAL.woodLight, T(s * 0.9, 0.62, -0.1, 0.12, 0, s * 1.3));
      gb.add(new THREE.BoxGeometry(0.06, 0.5, 0.18), PAL.woodLight, T(s * 1.95, 0.25, -0.15, 0.12, 0, s * 1.3));
    }
    const m = gb.mesh(M.vc);
    m.visible = false;
    return m;
  }

  /** Beach landing spot on the island, on the side facing the ship. */
  private findBeach(isl: IslandDef) {
    const p = this.player.pos;
    const area = this.combat.islandArea(isl.name);
    let best: { landing: THREE.Vector3; boat: THREE.Vector3; heading: number } | null = null;
    // try straight in, then fan out round the coast
    for (const off of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5, Math.PI]) {
      const a0 = Math.atan2(p.z - isl.z, p.x - isl.x) + off;
      const ox = isl.x + Math.cos(a0) * (isl.maxR! + 40);
      const oz = isl.z + Math.sin(a0) * (isl.maxR! + 40);
      const dx = isl.x - ox;
      const dz = isl.z - oz;
      const L = Math.hypot(dx, dz);
      const ux = dx / L;
      const uz = dz / L;
      let shoreT = -1;
      for (let t = 0; t < L; t += 0.5) {
        if (groundHeight(ox + ux * t, oz + uz * t) >= SHORE_Y + 0.25) {
          shoreT = t;
          break;
        }
      }
      if (shoreT < 0) continue;
      for (let k = 2; k < 9; k += 0.5) {
        const lx = ox + ux * (shoreT + k);
        const lz = oz + uz * (shoreT + k);
        const y = area.surface(lx, lz);
        if (y === null || y < SHORE_Y + 0.3 || area.blocked(lx, lz, 0.8)) continue;
        best = { landing: new THREE.Vector3(lx, y, lz), boat: new THREE.Vector3(ox + ux * (shoreT - 1.4), 0.1, oz + uz * (shoreT - 1.4)), heading: Math.atan2(ux, uz) };
        break;
      }
      if (best) break;
    }
    return best;
  }

  /** Fade out, run fn, fade back in (for scene changes driven from outside, like boarding). */
  fadeTo(fn: () => void) {
    this.fade(fn);
  }

  // =====================================================================
  // Boarding fights: on foot on the deck of a ship you're boarding
  // =====================================================================
  /** Swing across from the wheel onto her deck; your boarders start on your own deck. */
  enterDeck(area: LandArea, own: THREE.Vector3, onto: THREE.Vector3, name: string, allies: number) {
    const from = this.captainWorldPos();
    this.state = 'deck';
    if (this.player.captain) this.player.captain.root.visible = false;
    this.walker.visible = true;
    this.walker.locked = true;
    if (this.inventory.open) this.inventory.toggle(false);
    this.combat.enterLand('deck', area, own, name, allies);
    const face = headingTo(onto.x - from.x, onto.z - from.z);
    this.walker.hopTo(from, onto, () => {
      this.walker.locked = false;
      this.walker.heading = face;
    }, 1.0);
    this.camRig.walk(face + Math.PI, 1.2);
    // a little higher than ashore, to look down over the rails and rigging
    this.camRig.walkPitch = 0.58;
    this.ui.setHintMode('land');
    this.ui.setHintVisible(true);
    this.ui.prompt(null);
    audio.playVoice('arr', from, 1);
  }

  /** Back to the wheel of your own ship (the boarding takes it from there). */
  leaveDeck() {
    this.combat.leaveLand();
    this.walker.visible = false;
    this.walker.locked = false;
    if (this.player.captain) this.player.captain.root.visible = true;
    this.state = 'playing';
    this.camRig.colliders = this.seaColliders;
    this.ui.setHintMode('sea');
    this.ui.prompt(null);
  }

  private updateDeck(dt: number) {
    const input = this.input;
    this.npcCols.length = 0;
    const canMove = !this.inventory.open && !this.bigMapOpen;
    const mods = this.combat.playerMods(dt, input, canMove && !this.walker.hopping);
    this.walker.update(dt * this.combat.timeScale, canMove ? input : null, this.camRig.walkYaw, this.combat.area, this.npcCols, this.particles, mods);
    this.combat.update(dt, this.npcCols);
    this.ui.prompt(this.combat.defeated ? null : this.combat.prompt, 'blue');
  }

  /** Quick fade to black and back (scene changes like rowing ashore). */
  private fade(fn: () => void) {
    if (!this.fadeEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;background:#05070c;opacity:0;pointer-events:none;transition:opacity .35s;z-index:30';
      document.body.appendChild(el);
      this.fadeEl = el;
    }
    const el = this.fadeEl;
    el.style.opacity = '1';
    setTimeout(() => {
      fn();
      setTimeout(() => (el.style.opacity = '0'), 120);
    }, 360);
  }

  /** Drop anchor and row the captain (and a few crew) onto the beach. */
  goAshore(isl: IslandDef, instant = false) {
    const spot = this.findBeach(isl);
    if (!spot) {
      this.ui.toast('🪨 No place to land', 'The shore is all rocks here – try another side.', 'danger');
      return;
    }
    const p = this.player;
    p.controlsEnabled = false;
    p.speed = 0;
    p.throttle = 0;
    this.navTarget = null;
    this.ui.prompt(null);
    audio.play('splash', { volume: 0.5 });
    const go = () => {
      this.isle = isl;
      this.state = 'ashore';
      this.anchor.copy(p.pos);
      this.anchorHeading = p.heading;
      this.projectiles.clear();
      if (p.captain) p.captain.root.visible = false;
      this.walker.visible = true;
      this.walker.locked = false;
      this.walker.place(spot.landing, spot.heading);
      this.rowboat.position.copy(spot.boat);
      this.rowboat.rotation.set(0, spot.heading, 0);
      this.rowboat.visible = true;
      this.camRig.walk(spot.heading + Math.PI, instant ? 0.01 : 0.6);
      this.camRig.walkPitch = 0.34;
      this.camRig.colliders = this.islands.colliders;
      this.ui.setHintMode('land');
      this.ui.setHintVisible(true);
      this.ui.place(isl.name.toUpperCase(), isl.kind === 'hidden' ? 'A secret isle · X marks the spot' : 'Uncharted island · watch your back');
      const crew = Math.min(3, Math.floor(this.profile.crew / 4));
      this.combat.enterLand(`isle:${isl.name}`, this.combat.islandArea(isl.name), spot.landing, isl.name, crew);
      audio.playVoice('arr', spot.landing, 1);
    };
    if (instant) go();
    else this.fade(go);
  }

  /** Row back out and take the wheel again. */
  private rowBack(instant = false) {
    const go = () => {
      this.combat.leaveLand();
      this.rowboat.visible = false;
      this.walker.visible = false;
      this.isle = null;
      this.landObjective = null;
      const p = this.player;
      if (p.captain) p.captain.root.visible = true;
      this.state = 'playing';
      this.inPort = false;
      p.controlsEnabled = true;
      p.captain?.play('steer');
      this.camRig.follow(p.heading);
      this.camRig.colliders = this.seaColliders;
      this.ui.setHintMode('sea');
      this.ui.setHintVisible(true);
      this.ui.prompt(null);
      this.profile.hour = this.env.hour;
      saveProfile(this.profile);
    };
    if (instant) go();
    else this.fade(go);
  }

  /** Keep the ship riding at anchor while the captain is ashore. */
  private holdAtAnchor(dt: number) {
    const p = this.player;
    p.pos.x = this.anchor.x;
    p.pos.z = this.anchor.z;
    p.heading = this.anchorHeading;
    p.speed = 0;
    p.throttle = 0;
    p.steer = 0;
    p.update(dt);
  }

  private updateAshore(dt: number) {
    const input = this.input;
    this.npcCols.length = 0;
    const canMove = !this.inventory.open && !this.bigMapOpen;
    const mods = this.combat.playerMods(dt, input, canMove);
    this.walker.update(dt * this.combat.timeScale, canMove ? input : null, this.camRig.walkYaw, this.combat.area, this.npcCols, this.particles, mods);
    this.combat.update(dt, this.npcCols);
    if (this.combat.defeated) {
      this.ui.prompt(null);
      return;
    }
    if (this.combat.prompt) {
      this.ui.prompt(this.combat.prompt, 'blue');
      return;
    }
    const me = this.walker.pos;
    for (const t of this.islands.treasures) {
      if (t.collected || t.island !== this.isle || t.pos.distanceTo(me) > 3.2) continue;
      this.ui.prompt('<kbd>E</kbd>💎 DIG UP TREASURE', 'blue');
      if (input.pressed('KeyE')) {
        this.walker.interact();
        this.collectTreasure(t);
      }
      return;
    }
    if (me.distanceTo(this.rowboat.position) < 3.6) {
      if (this.combat.engaged) this.ui.prompt('⚠️ Shake off the pirates before you row away!', 'red');
      else {
        this.ui.prompt('<kbd>E</kbd>🚣 ROW BACK TO YOUR SHIP', 'blue');
        if (input.pressed('KeyE')) this.rowBack();
      }
      return;
    }
    this.ui.prompt(null);
  }

  /** Defeated on land: patched up back in port (a doctor's fee, nothing else lost). */
  combatReturnToPort() {
    const p = this.profile;
    const fee = Math.min(p.money, Math.round(p.money * 0.1));
    p.money -= fee;
    this.displayMoney = p.money;
    const msg = fee > 0 ? `The doctor charged ${fmtMoney(fee)} to patch you up.` : 'The doctor patched you up for free.';
    this.combat.hud.hideDefeat();
    this.fade(() => {
      if (this.state === 'ashore') {
        this.combat.leaveLand();
        this.rowboat.visible = false;
        this.isle = null;
        this.landObjective = null;
        const idx = Math.max(0, PORTS.findIndex((x) => x.id === p.lastPort));
        this.dockAt(idx, true);
        this.disembark(true);
      } else {
        this.combat.resetFights();
        const faceTown = headingTo(this.town.center.x - this.landing.x, this.town.center.z - this.landing.z);
        this.combat.revivePlayer(this.landing.clone(), faceTown);
      }
      this.ui.toast('🩹 Back on your feet', msg, 'info');
      saveProfile(p);
    });
  }

  /** Labels over encounter sites near the captain. */
  private siteMarkers(list: WorldMarker[], me: THREE.Vector3) {
    for (const s of this.combat.landSites()) {
      const d = s.geo.center.distanceTo(me);
      if (s.geo.chest && s.status === 'cleared' && !s.chestOpen && d < 50) list.push({ key: 'chest-' + s.def.id, pos: s.geo.chest.clone().setY(s.geo.chest.y + 1.8), kind: 'poi', text: '🧰 Loot!' });
      if (d > 70 || d < 12 || s.status === 'cleared') continue;
      list.push({ key: 'site-' + s.def.id, pos: s.geo.center.clone().setY(s.geo.center.y + 5), kind: 'poi', text: `${s.def.icon} ${s.def.name} ${'☠'.repeat(Math.min(5, s.def.tier))}` });
    }
  }

  private updateTutorial(dt: number) {
    if (this.tutorialStep <= 0) return;
    this.tutorialT -= dt;
    if (this.tutorialT > 0) return;
    const p = this.player;
    switch (this.tutorialStep) {
      case 1:
        this.ui.toast('⛵ Hold <b>W</b> to set sail', 'Steer with A / D. Hold SHIFT for a speed boost!', 'info');
        this.tutorialStep = 2;
        this.tutorialT = 6;
        break;
      case 2:
        if (p.pos.distanceTo(PORTS[this.harbourIdx].berth) > 50) {
          this.ui.toast('🔭 Find a merchant ship', 'Yellow arrows on the minimap are merchants. Chase one down!', 'info');
          this.tutorialStep = 3;
          this.tutorialT = 6;
        }
        break;
      case 3:
        if (p.target && p.target.pos.distanceTo(p.pos) < p.range * 1.2) {
          this.ui.toast('💣 Press <b>SPACE</b> to fire!', 'Cannons fire from the side facing your target – turn to line up a broadside.', 'info');
          this.tutorialStep = 4;
          this.tutorialT = 8;
        }
        break;
      case 4:
        this.tutorialT = 3;
        break;
      case 5:
        this.ui.toast('⚔️ Board her!', 'Get close to the surrendered ship and press E.', 'good');
        this.tutorialStep = 6;
        this.tutorialT = 20;
        break;
    }
  }

  private resolveShipCollisions() {
    const all = this.allShips();
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.sinking) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (b.sinking) continue;
        if (this.boarding.active && (a === this.player || b === this.player) && (a === this.boarding.enemy || b === this.boarding.enemy)) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.collideRadius + b.collideRadius;
        if (d >= min || d < 0.001) continue;
        // the moored player ship doesn't get shoved around
        const pinned = this.state !== 'playing';
        const ma = a === this.player && pinned ? 1e9 : a.model.length * a.model.length;
        const mb = b === this.player && pinned ? 1e9 : b.model.length * b.model.length;
        const push = min - d;
        const nx = dx / d;
        const nz = dz / d;
        a.pos.x -= nx * push * (mb / (ma + mb));
        a.pos.z -= nz * push * (mb / (ma + mb));
        b.pos.x += nx * push * (ma / (ma + mb));
        b.pos.z += nz * push * (ma / (ma + mb));
        const rel = Math.abs(a.speed - b.speed) + Math.abs(a.speed) * 0.3;
        if (!pinned && (a === this.player || b === this.player) && rel > 7 && a.bumpCooldown <= 0 && b.bumpCooldown <= 0) {
          a.bumpCooldown = b.bumpCooldown = 1.2;
          const pt = a.pos.clone().lerp(b.pos, 0.5).setY(1.5);
          this.particles.explosion(pt, 0.6);
          audio.play('impact', { pos: pt });
          this.camRig.addShake(0.4);
          const dmg = Math.round(rel * 0.6);
          a.applyDamage(dmg, pt, b, false);
          b.applyDamage(dmg, pt, a, false);
        }
        a.speed *= 0.97;
        b.speed *= 0.97;
      }
    }
  }

  private updateSpawning(dt: number) {
    if (this.state === 'title' || this.state === 'loading') return;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 6;
    const merchants = this.ships.filter((s) => s.team === 'merchant' && !s.captured && !s.isRival).length;
    if (merchants < 9) this.spawnMerchant();
    for (const z of ZONES.filter((z) => z.kind === 'patrol')) {
      const has = this.ships.some((s) => s.team === 'navy' && s.state === 'patrol' && s.patrolCenter.distanceTo(new THREE.Vector3(z.x, 0, z.z)) < 50);
      if (!has && this.player.pos.distanceTo(new THREE.Vector3(z.x, 0, z.z)) > 320) this.spawnNavy('navyCutter', new THREE.Vector3(z.x, 0, z.z), false, true);
    }
    for (const s of this.ships) {
      if (s.pos.distanceTo(this.player.pos) > 1100 && s.state !== 'patrol' && !s.contractId) s.removeMe = true;
    }
  }

  private updateAmbientFx(dt: number) {
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.25;
      const cam = this.camRig.camera.position;
      for (const v of this.islands.smokeVents) if (v.distanceTo(cam) < 700) this.particles.smoke(v.clone().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2))), 0.35, 3);
      // chimneys and torches in the nearby town
      const town = this.town;
      if (town && Math.hypot(town.center.x - cam.x, town.center.z - cam.z) < 160) {
        for (const s of town.smoke) if (Math.random() < 0.5) this.particles.smoke(s.clone(), 0.55, 1.2);
        for (const f of town.fires) if (Math.random() < 0.35 && f.distanceTo(cam) < 60) this.particles.fire(f.clone(), 0.35);
      }
    }
    this.lighthouseT += dt;
    for (const town of this.towns)
      for (const b of town.beams) {
        b.rotation.y = this.lighthouseT * 0.8;
        const m = (b.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = this.env.night * 0.18;
        b.visible = this.env.night > 0.05;
      }
    // place-name card fades on its own; nothing to do
    this.placeT += dt;
  }

  private buildMarkers(): WorldMarker[] {
    const list: WorldMarker[] = [];
    const p = this.player;
    if (this.state === 'docking' || this.state === 'docked' || this.boarding.active || this.state === 'shop' || this.state === 'dialogue') return list;
    if (this.state === 'ashore') {
      const me = this.walker.pos;
      if (this.combat.defeated) return list;
      this.siteMarkers(list, me);
      if (this.landObjective && this.landObjective.distanceTo(me) > 4) list.push({ key: 'goal', pos: this.landObjective.clone().setY(this.landObjective.y + 3.2), kind: 'goal', text: `${Math.round(this.landObjective.distanceTo(me))}m`, edge: true });
      else if (this.rowboat.position.distanceTo(me) > 22) list.push({ key: 'boat', pos: this.rowboat.position.clone().setY(this.rowboat.position.y + 2.5), kind: 'poi', text: '🚣 Your boat' });
      for (const t of this.islands.treasures) if (!t.collected && t.island === this.isle && t.pos.distanceTo(me) < 40) list.push({ key: 'tr', pos: t.pos.clone().setY(t.pos.y + 2.2), kind: 'poi', text: '💎 Treasure!' });
      return list;
    }
    if (this.onLand) {
      // labels over nearby shops, plus the current objective
      const me = this.walker.pos;
      if (this.combat.defeated) return list;
      this.siteMarkers(list, me);
      const found = this.profile.blackMarkets.includes(this.currentPortId);
      for (const it of this.town.interactables) {
        if (it === this.focusIt || it.kind === 'recruit') continue;
        if (it.secret && !found) continue;
        const d = it.look.distanceTo(me);
        if (d > 24 || d < 2.5) continue;
        if (this.activeInterior ? it.interior !== this.activeInterior.id : !!it.interior) continue;
        const open = !it.keeper || this.life.isPresent(it.keeper);
        list.push({ key: 'poi-' + it.id, pos: it.look.clone().setY(it.look.y + 1.5), kind: 'poi', text: `${it.icon} ${it.label}${open ? '' : ' · closed'}` });
      }
      if (this.landObjective && this.landObjective.distanceTo(me) > 4) list.push({ key: 'goal', pos: this.landObjective.clone().setY(this.landObjective.y + 3.2), kind: 'goal', text: `${Math.round(this.landObjective.distanceTo(me))}m`, edge: true });
      if (this.landing.distanceTo(me) > 30 && !this.landObjective) list.push({ key: 'ship', pos: this.landing.clone().setY(5), kind: 'poi', text: '⛵ Your ship' });
      return list;
    }
    for (const b of this.raid.markers()) list.push({ key: b.key, pos: b.pos, kind: 'poi', text: `💣 Battery ${Math.round(b.hp * 100)}%` });
    if (p.siege) list.push({ key: 'target', pos: p.siege.clone().setY(p.siege.y + 2.5), kind: 'target' });
    for (const s of this.ships) {
      if (s.sinking || s.removeMe) continue;
      const d = s.pos.distanceTo(p.pos);
      if (d > 300) continue;
      const top = s.pos.clone().setY(s.model.mastTop + 3);
      if (s.alertIcon > 0) list.push({ key: 'a' + s.root.id, pos: top, kind: 'alert' });
      else if (s.disabled && !s.captured) list.push({ key: 'b' + s.root.id, pos: top, kind: 'board' });
      else if (s.calledHelp && s.state === 'flee' && Math.floor(this.time * 2) % 4 === 0) list.push({ key: 'h' + s.root.id, pos: top, kind: 'help' });
    }
    if (p.target && !p.target.sinking) {
      list.push({ key: 'target', pos: p.target.pos.clone().setY(p.target.model.deckYAt(0) + 2), kind: p.target.disabled ? 'targetCapt' : 'target' });
    }
    if (this.navTarget) {
      const b = this.navTarget;
      if (p.pos.distanceTo(b) > 80) list.push({ key: 'port', pos: b.clone().setY(14), kind: 'port', text: `${Math.round(p.pos.distanceTo(b))}m`, edge: true });
    } else {
      // first contract with somewhere to go
      for (const c of this.profile.contracts) {
        const t = this.contracts.targetOf(c);
        if (!t) continue;
        const v = new THREE.Vector3(t.x, 14, t.z);
        const d = Math.hypot(t.x - p.pos.x, t.z - p.pos.z);
        if (d > 80) list.push({ key: 'goal-' + c.id, pos: v, kind: 'goal', text: `${c.title} ${Math.round(d)}m`, edge: true });
        break;
      }
    }
    return list;
  }

  // =====================================================================
  // Render
  // =====================================================================
  drawCalls = 0;
  private render(dt: number) {
    if (this.state === 'loading') return;
    this.checkSize();
    this.drawCalls = this.renderer.info.render.calls;
    this.renderer.info.reset();
    const cam = this.camRig.camera;
    if (this.reflection.enabled && !this.activeInterior) {
      cam.updateMatrixWorld();
      this.reflection.update(this.renderer, this.scene, cam);
    }
    this.shadowFrame++;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = this.quality === 'high' || this.shadowFrame % 2 === 0;
    this.post.grade.uniforms.uDamage.value = Math.max(0, this.post.grade.uniforms.uDamage.value - dt * 2);
    if (this.player.flash > 0.9 && this.state === 'playing') this.post.grade.uniforms.uDamage.value = 0.6;
    this.post.render(dt);

    // HUD captain portrait (separate tiny renderer, ~30fps)
    this.portraitT += dt;
    if (this.portraitRenderer && this.portraitChar && this.portraitT > 1 / 30 && this.state !== 'title') {
      const c = this.portraitChar;
      const src = this.onLand ? this.walker.c : this.player.captain;
      if (src) c.express(src.expression);
      c.update(this.portraitT);
      this.portraitT = 0;
      this.portraitRenderer.render(this.portraitScene, this.portraitCam);
    }
  }
}

export { portById };
