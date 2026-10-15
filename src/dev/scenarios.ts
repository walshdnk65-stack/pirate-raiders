import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { AIShip } from '../entities/AIShip';
import type { Ship } from '../entities/Ship';
import { landSDF, PORTS, ISLANDS } from '../world/WorldData';
import { Character, type AnimState, type PropKind } from '../models/Character';
import type { EnemyId } from '../game/combat/EnemyTypes';
import type { Enemy } from '../game/combat/Enemy';
import { makeWeapon, type WeaponBaseId, type Rarity } from '../game/combat/Weapons';
import { Navigator } from '../game/combat/Nav';
import { SHIP_CLASSES, type ShipClassId } from '../game/ShipClasses';

/**
 * Dev-only scripted scenarios for automated screenshots:
 *   ?autoplay=1&scenario=land|market|shipwright|gunsmith|tavern|board|warehouse|black|night|port:royal|townmap|inventory|trade
 *   ?autoplay=1&scenario=sail|combat|board-ship|capture|storm|wanted|sink|upgraded|map|bot
 *   ?autoplay=1&scenario=ship:<class>|dock:<class>:<port>|shipyard:<class>|buyship:<class>|progress|boardtest:<crew>:<enemyCrew>[:<class>:<enemyType>]
 *   ?autoplay=1&scenario=fight:<foes>[:<port>[:<tier>]]|fightbot|gunbot|site:<id>|sitebot:<id>:<lvl>:<weapon>:<rarity>|ashore:<island>|arms|poses
 */
export function runScenario(game: Game, name: string) {
  const g = game;
  // private Game methods, reached for testing only
  const P = game as unknown as Record<string, (...a: unknown[]) => unknown>;
  const press = (code: string, ms: number, delay = 0) => {
    setTimeout(() => g.input.simulate(code, true), delay);
    setTimeout(() => g.input.simulate(code, false), delay + ms);
  };
  const toSea = () => {
    g.walker.visible = false;
    if (g.player.captain) g.player.captain.root.visible = true;
    P.castOff.call(g);
  };
  const goPort = (id: string) => {
    const idx = PORTS.findIndex((p) => p.id === id);
    P.dockAt.call(g, idx, true);
    P.disembark.call(g, true);
  };
  /** Teleport the walker in front of an interactable and use it. */
  const use = (id: string, delay = 600) =>
    setTimeout(() => {
      const it = g.town.interactables.find((i) => i.id === `${g.currentPortId}-${id}` || i.id === id);
      if (!it) return console.warn('no interactable', id);
      g.walker.place(it.pos.clone(), Math.atan2(it.look.x - it.pos.x, it.look.z - it.pos.z));
      g.camRig.walk(Math.atan2(it.pos.x - it.look.x, it.pos.z - it.look.z), 0.01);
      setTimeout(() => P.interact.call(g, it), 300);
    }, delay);
  const nearestMerchant = () => {
    let best: AIShip | null = null;
    let bd = 1e9;
    for (const s of g.ships) {
      if (s.team !== 'merchant' || s.isRival) continue;
      if (landSDF(s.pos.x, s.pos.z) < 70) continue;
      const d = s.pos.distanceTo(g.player.pos);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best!;
  };
  const placeBeside = (m: AIShip, dist: number, behind = 0) => {
    const right = new THREE.Vector3(Math.cos(m.heading), 0, -Math.sin(m.heading));
    const fwd = new THREE.Vector3(Math.sin(m.heading), 0, Math.cos(m.heading));
    g.player.pos.copy(m.pos).addScaledVector(right, dist).addScaledVector(fwd, -behind);
    g.player.heading = m.heading;
    g.player.speed = m.speed;
    g.camRig.follow(g.player.heading);
  };
  const [base, arg, arg2, arg3, arg4] = name.split(':');
  /** Own a ship class (and the level it needs) and make it the active ship. */
  const own = (id: ShipClassId) => {
    const p = g.profile;
    p.level = Math.max(p.level, SHIP_CLASSES[id].requiredLevel);
    p.shipsUnlocked = Object.keys(SHIP_CLASSES) as ShipClassId[];
    p.fleet[id] ??= { upgrades: { hull: 0, sails: 0, steering: 0, cannons: 0, range: 0, crew: 0, cargo: 0 }, hp: 99999 };
    g.switchShip(id);
    g.player.hp = g.player.maxHp;
    p.crew = g.maxCrew;
  };
  /** Wait for an element to appear (the game loads at its own pace), then act on it. */
  const whenEl = (sel: string, fn: (e: HTMLElement) => void, tries = 300) => {
    const e = document.querySelector(sel) as HTMLElement | null;
    if (e) fn(e);
    else if (tries > 0) setTimeout(() => whenEl(sel, fn, tries - 1), 100);
  };
  const shipsTab = (sel?: string, then?: () => void) =>
    whenEl('.shop[data-kind="shipwright"] [data-act="tab"][data-arg="ships"]', (tab) => {
      tab.click();
      if (sel) whenEl(`.shop [data-act="shipSel"][data-arg="${sel}"]`, (c) => {
        c.click();
        then?.();
      });
    });
  /** The roomiest open ground in the current town (for fight tests). */
  const openSpot = () => {
    const area = g.area;
    let best: THREE.Vector3 | null = null;
    let bs = -1;
    for (const n of g.town.nav.nodes) {
      let clear = 0;
      for (let r = 1.5; r <= 9; r += 1.5) {
        let ok = true;
        for (let k = 0; k < 10 && ok; k++) {
          const a = (k / 10) * Math.PI * 2;
          const x = n.x + Math.cos(a) * r;
          const z = n.z + Math.sin(a) * r;
          if (area.blocked(x, z, 0.5) || area.surface(x, z, n.y + 1, 1.2) === null) ok = false;
        }
        if (!ok) break;
        clear = r;
      }
      const sc = clear * 10 - n.distanceTo(g.town.center) * 0.15;
      if (sc > bs) {
        bs = sc;
        best = n;
      }
    }
    return best;
  };
  /** A simple fighting bot: locks on, closes in, attacks, blocks or rolls away from wind-ups. */
  const startBot = (log: string[], opts: { gun?: boolean } = {}) => {
    const inp = g.input;
    let blockT = 0;
    const t0 = g.time;
    const stats = { attacks: 0, blocks: 0, rolls: 0 };
    const nav = new Navigator();
    const dirV = new THREE.Vector3();
    const tick = () => {
      const cb = g.combat;
      const f = cb.player;
      if (f.dead || cb.defeated) return;
      const foes = cb.enemies.filter((e) => !e.f.dead && !e.hidden);
      if (!foes.length) return;
      foes.sort((a, b) => a.f.pos.distanceTo(f.pos) - b.f.pos.distanceTo(f.pos));
      const t = foes[0];
      if (!cb.lock || cb.lock.f.dead) {
        inp.simulate('KeyQ', true);
        setTimeout(() => inp.simulate('KeyQ', false), 30);
      }
      const d = t.f.pos.distanceTo(f.pos);
      // head for the target, routing round obstacles like the AI does
      nav.steer(cb.area, f.pos, t.f.pos, 0.1, dirV);
      const ang = Math.atan2(dirV.x, dirV.z);
      const cam = g.camRig.walkYaw;
      // walk toward the target (camera-relative keys)
      const rel = ang - (cam + Math.PI);
      const fwd = Math.cos(rel);
      const side = Math.sin(rel);
      if (opts.gun) {
        // pistol: keep 6-14 m away, shoot from the hip at the locked foe
        if (!f.useGun) {
          inp.simulate('Digit2', true);
          setTimeout(() => inp.simulate('Digit2', false), 30);
        }
        for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) inp.simulate(k, false);
        if (d < 6) inp.simulate(fwd > 0 ? 'KeyS' : 'KeyW', true);
        else if (d > 14) inp.simulate(fwd > 0 ? 'KeyW' : 'KeyS', true);
        else if (f.loaded > 0 && f.free) {
          inp.simulateMouse(0, true);
          setTimeout(() => inp.simulateMouse(0, false), 40);
          stats.attacks++;
        }
        return;
      }
      const threat = foes.find((e) => e.f.action && (e.f.action.kind === 'attack' || e.f.action.kind === 'special') && e.f.progress < (e.f.action.active?.[0] ?? 0) && e.f.pos.distanceTo(f.pos) < 4);
      for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) inp.simulate(k, false);
      if (threat && blockT <= 0) {
        if (threat.f.action?.swing?.heavy || Math.random() < 0.3) {
          inp.simulate('Space', true);
          setTimeout(() => inp.simulate('Space', false), 30);
          inp.simulate('KeyS', true);
          stats.rolls++;
        } else {
          inp.simulateMouse(2, true);
          blockT = 0.7;
          stats.blocks++;
        }
      } else if (blockT > 0) {
        blockT -= 0.1;
        if (blockT <= 0) inp.simulateMouse(2, false);
      } else if (d > 2.3) {
        if (fwd > 0.3) inp.simulate('KeyW', true);
        if (fwd < -0.3) inp.simulate('KeyS', true);
        if (side > 0.3) inp.simulate('KeyD', true);
        if (side < -0.3) inp.simulate('KeyA', true);
      } else {
        inp.simulateMouse(0, true);
        setTimeout(() => inp.simulateMouse(0, false), 40);
        stats.attacks++;
      }
    };
    setInterval(tick, 100);
    setInterval(() => {
      const cb = g.combat;
      log.push(`t=${(g.time - t0).toFixed(0)} hp=${Math.round(cb.player.hp)}/${cb.player.maxHp} st=${Math.round(cb.player.stamina)} foes=${cb.enemies.filter((e) => !e.f.dead).map((e) => `${e.type.id}:${Math.round(e.f.hp)}:${e.state}`).join(',')} kills=${g.profile.land.kills} money=${g.profile.money} atk=${stats.attacks} blk=${stats.blocks} roll=${stats.rolls} defeated=${cb.defeated}`);
    }, 3000);
  };
  if (base !== 'tutorial') g.profile.landTutorial = 5;
  switch (base) {
    // ---------------- on land ----------------
    case 'land':
      press('KeyW', 3500, 500);
      break;
    case 'tutorial':
      break;
    case 'port':
      goPort(arg ?? 'royal');
      press('KeyW', 2500, 800);
      break;
    case 'market':
      g.profile.money = 5000;
      g.profile.cargo = { pepper: 3, fish: 4 };
      use(arg ?? 'spice');
      break;
    case 'shipwright':
      g.profile.money = 20000;
      use('shipwright');
      break;
    case 'gunsmith':
      g.profile.money = 20000;
      if (arg) goPort(arg);
      use('gunsmith');
      if (arg) break;
      setTimeout(() => (document.querySelector('.shop [data-arg="ammo"]') as HTMLElement)?.click(), 2500);
      break;
    case 'tavern': {
      if (arg === 'night') g.env.hour = 21.5;
      setTimeout(() => {
        const it = g.town.interactables.find((i) => i.id === `${g.currentPortId}-tavern-bar`)!;
        const door = g.town.spots.get(`${g.currentPortId}-tavern-door-in`)!;
        g.walker.place(door.pos.clone(), Math.atan2(it.pos.x - door.pos.x, it.pos.z - door.pos.z));
        g.camRig.walk(door.facing, 0.01);
      }, 500);
      break;
    }
    case 'board':
      use('tavern-board');
      break;
    case 'recruit':
      g.profile.money = 9000;
      use('tavern-recruit0');
      break;
    case 'warehouse':
      g.profile.cargo = { metal: 6, rope: 4 };
      use('warehouse');
      break;
    case 'black':
      g.profile.money = 9000;
      use('black');
      break;
    case 'night':
      g.env.hour = 21.2;
      press('KeyW', 2000, 600);
      break;
    case 'talk':
      setTimeout(() => {
        const n = g.life.npcs.find((x) => x.def.role === 'chatter' && x.state === 'idle') ?? g.life.npcs.find((x) => x.def.role === 'walker' && x.c.root.visible)!;
        const dir = new THREE.Vector3(Math.sin(n.heading), 0, Math.cos(n.heading));
        g.walker.place(n.pos.clone().addScaledVector(dir, 1.8), n.heading + Math.PI);
        P.startDialogue.call(g, n);
      }, 800);
      break;
    case 'hop':
      setTimeout(() => P.embark.call(g), 300);
      break;
    case 'townmap':
      if (arg) goPort(arg);
      g.profile.blackMarkets = PORTS.map((p) => p.id);
      setTimeout(() => press('KeyM', 100), 1200);
      break;
    case 'inventory':
      g.profile.cargo = { pepper: 5, silk: 2, fish: 6, sealed: 3 };
      setTimeout(() => press('Tab', 100), 1000);
      break;
    case 'trade': {
      // buy cheap spices in Skull Cove, sail to Port Royal, sell them
      const log: string[] = [];
      (window as unknown as { tradeLog: string[] }).tradeLog = log;
      setTimeout(() => {
        const err = g.buyGood('pepper', 10);
        log.push(`bought pepper err=${err}: money=${g.profile.money} cargo=${JSON.stringify(g.profile.cargo)}`);
        toSea();
        const royal = PORTS.find((p) => p.id === 'royal')!;
        g.player.pos.set(royal.berth.x + royal.fx * 30, 0, royal.berth.z + royal.fz * 30);
      }, 800);
      setTimeout(() => press('KeyE', 80), 2000);
      setTimeout(() => press('KeyE', 80), 4500);
      setTimeout(() => {
        const it = g.town.interactables.find((i) => i.id === 'royal-spice')!;
        g.walker.place(it.pos.clone(), 0);
        P.interact.call(g, it);
        (document.querySelector('.shop [data-arg="sell"]') as HTMLElement)?.click();
      }, 6200);
      setTimeout(() => {
        log.push(`state=${g.state} port=${g.currentPortId}`);
        const err = g.sellGood('pepper', 99, 1);
        log.push(`sold: err=${err} money=${g.profile.money} profit=${g.profile.stats.tradeProfit}`);
      }, 7000);
      break;
    }
    // ---------------- ship classes ----------------
    case 'ship': {
      own((arg ?? 'galleon') as ShipClassId);
      toSea();
      g.player.pos.set(150, 0, 300);
      g.player.heading = 0.4;
      g.camRig.follow(0.4);
      if (arg2 === 'side' || arg2 === 'close') {
        // hove-to, filmed from off the bow quarter
        setTimeout(() => {
          const p = g.player;
          const L = p.model.length;
          const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
          const right = new THREE.Vector3(Math.cos(p.heading), 0, -Math.sin(p.heading));
          const k = arg2 === 'close' ? 0.55 : 1;
          g.camRig.setCinematic(p.pos.clone().addScaledVector(right, (L * 1.15 + 8) * k).addScaledVector(fwd, L * 0.55 * k).setY((L * 0.38 + 4) * k + 2), p.pos.clone().setY(L * 0.16 + 2), 3, true);
          if (arg3 === 'fire') for (let i = 0; i < 3; i++) setTimeout(() => p.fire('L', null), 600 + i * 2600);
        }, 600);
        break;
      }
      press('KeyW', 9000, 300);
      if (arg2 === 'fire') for (let i = 0; i < 3; i++) press('Space', 80, 2500 + i * 2500);
      break;
    }
    case 'dock': {
      own((arg ?? 'galleon') as ShipClassId);
      goPort(arg2 ?? 'royal');
      // look back down the pier at the ship
      setTimeout(() => {
        const b = g.berth();
        const me = g.walker.pos;
        g.camRig.walk(Math.atan2(me.x - b.pos.x, me.z - b.pos.z), 0.01);
        g.camRig.walkTargetDist = 14;
        g.camRig.walkPitch = 0.42;
      }, 400);
      break;
    }
    case 'shipyard':
      g.profile.level = Number(arg2 ?? 12);
      g.profile.money = 30000;
      g.checkShipUnlocks();
      use('shipwright');
      shipsTab(arg);
      break;
    case 'buyship': {
      const id = (arg ?? 'schooner') as ShipClassId;
      const log: string[] = [];
      (window as unknown as { shipLog: string[] }).shipLog = log;
      g.profile.level = SHIP_CLASSES[id].requiredLevel;
      g.profile.money = SHIP_CLASSES[id].purchasePrice * 1.5 + 2000;
      g.checkShipUnlocks();
      use('shipwright');
      shipsTab(id, () =>
        whenEl(`.shop [data-act="buyShip"][data-arg="${id}"]`, (b) => {
          log.push(`before: ship=${g.profile.ship} money=${g.profile.money} hp=${g.player.maxHp} cargo=${g.cargoCapacity} crew=${g.maxCrew} len=${g.player.model.length} berth=${g.berth().pos.toArray().map((v) => v.toFixed(1)).join(',')}`);
          b.click();
          log.push(`after: ship=${g.profile.ship} money=${g.profile.money} hp=${g.player.maxHp} cargo=${g.cargoCapacity} crew=${g.maxCrew} len=${g.player.model.length} fleet=${Object.keys(g.profile.fleet).join(',')} berth=${g.berth().pos.toArray().map((v) => v.toFixed(1)).join(',')}`);
          // walk out to the pier to see her
          if (arg2 === 'look')
            setTimeout(() => {
              g.closeShop();
              const b2 = g.berth();
              g.walker.place(g.landing.clone(), 0);
              g.camRig.walk(Math.atan2(g.landing.x - b2.pos.x, g.landing.z - b2.pos.z) + 0.5, 0.01);
              g.camRig.walkTargetDist = 15;
              g.camRig.walkPitch = 0.4;
            }, 2500);
        }),
      );
      break;
    }
    case 'progress':
      g.profile.level = Number(arg ?? 23);
      g.profile.money = 52000;
      own('brigantine');
      own('galleon');
      g.profile.upgrades.hull = 2;
      g.profile.upgrades.cannons = 1;
      setTimeout(() => press('Tab', 100), 1000);
      break;
    case 'boardtest': {
      // ?scenario=boardtest:100:20  – a bot plays the timing game like an average player
      const pc = Number(arg ?? 10);
      const ec = Number(arg2 ?? 10);
      if (arg3) own(arg3 as ShipClassId);
      toSea();
      g.profile.crew = pc;
      const m = arg4 ? g.spawnMerchant(arg4 as never, 0, 1, 1, g.player.pos.clone().add(new THREE.Vector3(60, 0, 0))) : nearestMerchant();
      const target = (m as unknown as AIShip | undefined) ?? nearestMerchant();
      target.crewCount = ec;
      placeBeside(target, 16, 0);
      target.applyDamage(target.hp * 0.75, target.pos.clone().setY(2), g.player);
      setTimeout(() => press('KeyE', 100), 1200);
      const log: string[] = [];
      (window as unknown as { boardLog: string[] }).boardLog = log;
      let t0 = 0;
      let nextStrike = 0;
      let last = '';
      const iv = setInterval(() => {
        const b = g.boarding;
        if (!b.active) {
          if (t0 && !last.startsWith('done')) {
            last = `done after ${(g.time - t0).toFixed(1)}s won=${b.phase === 'return'} crewLeft=${g.profile.crew}`;
            log.push(last);
            clearInterval(iv);
          }
          return;
        }
        if (b.phase !== 'brawl') {
          if (b.phase === 'victory' || b.phase === 'defeat') {
            if (!last.startsWith('end')) {
              last = `end ${b.phase} after ${(g.time - t0).toFixed(1)}s crew=${b.view.playerCrew} enemy=${b.view.enemyCrew}`;
              log.push(last);
            }
          }
          return;
        }
        if (!t0) {
          t0 = g.time;
          nextStrike = g.time + 1.3;
          log.push(`brawl: ${b.view.playerCrew} vs ${b.view.enemyCrew} power ${b.view.playerPower.toFixed(1)} vs ${b.view.enemyPower.toFixed(1)}`);
        }
        // average player: strikes every ~1.3 s, lands it ~70% of the time
        if (g.time >= nextStrike) {
          nextStrike = g.time + 1.3;
          if (Math.random() < 0.7) b.view.needle = b.view.zoneC + (Math.random() < 0.35 ? 0 : b.view.zoneW * 0.3);
          else b.view.needle = b.view.zoneC + 0.45 > 1 ? b.view.zoneC - 0.45 : b.view.zoneC + 0.45;
          // strike straight away (a keypress could land a slow frame later, after the needle has moved on)
          (b as unknown as { strike: () => void }).strike();
        }
        const k = `${Math.round(b.view.progress * 20)}`;
        if (k !== last) {
          last = k;
          log.push(`t=${(g.time - t0).toFixed(1)} progress=${Math.round(b.view.progress * 100)}% rate=${b.view.rate.toFixed(2)} crew=${b.view.playerCrew} enemy=${b.view.enemyCrew}`);
        }
      }, 30);
      break;
    }
    // ---------------- navy detection & protection ----------------
    case 'firefight': {
      // a long exchange of fire: cannons go off every 2 s (game time); log the wanted level
      toSea();
      g.player.pos.set(150, 0, 300);
      const log: string[] = [];
      (window as unknown as { fightLog: string[] }).fightLog = log;
      let next = 0;
      let lastLvl = -1;
      const iv = setInterval(() => {
        if (g.state !== 'playing') return;
        if (g.time >= next) {
          next = g.time + 2;
          g.wanted.gunfire();
        }
        const lvl = g.wanted.level;
        if (lvl !== lastLvl) {
          lastLvl = lvl;
          log.push(`fight ${g.wanted.fightTime.toFixed(1)}s → wanted ★${lvl}`);
        }
        if (g.wanted.fightTime > 85) clearInterval(iv);
      }, 50);
      break;
    }
    case 'protect': {
      // ?scenario=protect:board | protect:dock | protect:sea – navy shots at a boarding / docked / sailing player
      const log: string[] = [];
      (window as unknown as { protectLog: string[] }).protectLog = log;
      const shoot = (tag: string) => {
        const p = g.player;
        const navy = g.spawnNavy('navyFrigate', p.pos.clone().add(new THREE.Vector3(70, 0, 0)), false, true);
        const hp0 = p.hp;
        let fired = 0;
        const iv = setInterval(() => {
          // direct hits: balls dropped right onto the deck
          g.projectiles.fire(p.pos.clone().add(new THREE.Vector3(0, 12, 0)), new THREE.Vector3(0, -20, 0), navy as unknown as Ship, 60);
          if (++fired >= 6) {
            clearInterval(iv);
            setTimeout(() => log.push(`${tag}: protected=${g.playerProtected} hp before=${Math.round(hp0)} after=${Math.round(p.hp)}`), 1500);
          }
        }, 300);
      };
      if (arg === 'dock') {
        setTimeout(() => shoot('docked'), 1500);
      } else if (arg === 'sea') {
        // control: out at sea, not boarding – these shots should hurt
        toSea();
        g.player.pos.set(150, 0, 300);
        setTimeout(() => shoot('at sea'), 1500);
      } else {
        toSea();
        const m = nearestMerchant();
        placeBeside(m, 16, 0);
        m.applyDamage(m.hp * 0.75, m.pos.clone().setY(2), g.player);
        setTimeout(() => press('KeyE', 100), 1200);
        const wait = setInterval(() => {
          if (g.boarding.active && g.boarding.phase === 'brawl') {
            clearInterval(wait);
            shoot('boarding');
          }
        }, 100);
      }
      break;
    }
    case 'treasure': {
      // ?scenario=treasure:<0-3> – sail out to a hidden island from 220 m inside it and try to dig
      const t = g.islands.treasures[Number(arg ?? 0)];
      toSea();
      const dir = new THREE.Vector3(t.pos.x, 0, t.pos.z).normalize();
      g.player.pos.copy(t.pos).setY(0).addScaledVector(dir, -220);
      const log: string[] = [];
      (window as unknown as { treasureLog: string[] }).treasureLog = log;
      let best = 1e9;
      g.input.simulate('KeyW', true);
      const iv = setInterval(() => {
        const p = g.player;
        p.heading = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        best = Math.min(best, d);
        const dig = (document.querySelector('#prompt')?.textContent ?? '').includes('DIG UP TREASURE');
        if (dig || g.time > 120) {
          clearInterval(iv);
          g.input.simulate('KeyW', false);
          log.push(`${t.island.name} at (${Math.round(t.pos.x)}, ${Math.round(t.pos.z)}): closest ${best.toFixed(0)} m, dig prompt ${dig ? 'YES' : 'no'}`);
        }
      }, 50);
      break;
    }
    // ---------------- at sea ----------------
    case 'sail':
      toSea();
      press('KeyW', 6000, 300);
      press('KeyA', 1200, 2500);
      break;
    case 'combat': {
      toSea();
      const m = nearestMerchant();
      placeBeside(m, 30, 4);
      press('KeyW', 8000, 100);
      for (let i = 0; i < 6; i++) press('Space', 80, 400 + i * 2300);
      break;
    }
    case 'board-ship':
    case 'capture': {
      toSea();
      const m = nearestMerchant();
      placeBeside(m, 16, 0);
      m.applyDamage(m.hp * 0.75, m.pos.clone().setY(2), g.player);
      setTimeout(() => press('KeyE', 100), 1200);
      if (base === 'capture')
        for (let i = 0; i < 14; i++)
          setTimeout(() => {
            const b = g.boarding;
            if (b.active && b.phase === 'brawl') {
              b.view.needle = b.view.zoneC;
              press('Space', 60);
            }
          }, 4500 + i * 400);
      break;
    }
    case 'storm':
      toSea();
      g.env.setWeather('storm');
      g.env.cur.waves = 1.8;
      press('KeyW', 6000, 300);
      break;
    case 'wanted':
      toSea();
      g.player.pos.set(150, 0, 300);
      g.player.heading = 0;
      g.camRig.follow(0);
      g.wanted.addHeat(3.2);
      press('KeyW', 12000, 200);
      break;
    case 'sink':
      toSea();
      g.player.pos.set(150, 0, 300);
      g.player.heading = 0.5;
      g.camRig.follow(0.5);
      g.profile.cargo = { goldware: 3 };
      setTimeout(() => g.player.applyDamage(500, g.player.pos.clone().setY(2), null), 1500);
      break;
    case 'upgraded':
      g.profile.money = 200000;
      for (let i = 0; i < 4; i++) for (const id of ['hull', 'sails', 'steering', 'cannons', 'range', 'crew', 'cargo'] as const) g.buyUpgrade(id);
      g.buyOrEquipCosmetic('sail-red');
      g.buyOrEquipCosmetic('hull-black');
      use('shipwright', 800);
      break;
    case 'rival': {
      toSea();
      g.player.pos.set(150, 0, 300);
      g.player.heading = 0;
      g.camRig.follow(0);
      const r = g.spawnRival('test-rival', 'Black Bess')!;
      r.pos.set(150, 0, 420);
      r.patrolCenter.copy(r.pos);
      press('KeyW', 9000, 300);
      for (let i = 0; i < 4; i++) press('Space', 80, 3000 + i * 2300);
      break;
    }
    case 'map':
      toSea();
      setTimeout(() => press('KeyM', 100), 1500);
      break;
    case 'bot': {
      toSea();
      const keys = new Set<string>();
      const hold = (code: string, on: boolean) => {
        if (on && !keys.has(code)) {
          keys.add(code);
          g.input.simulate(code, true);
        } else if (!on && keys.has(code)) {
          keys.delete(code);
          g.input.simulate(code, false);
        }
      };
      const log: string[] = [];
      (window as unknown as { botLog: string[] }).botLog = log;
      let phase = 'hunt';
      const tick = () => {
        const p = g.player;
        if (g.state === 'docked' || g.onLand) {
          if (phase !== 'docked') log.push(`docked t=${g.time.toFixed(0)} money=${g.profile.money}`);
          phase = 'docked';
          return;
        }
        if (g.boarding.active) {
          const b = g.boarding;
          if (b.phase === 'brawl' && Math.abs(b.view.needle - b.view.zoneC) < b.view.zoneW * 0.35) press('Space', 50);
          return;
        }
        const angTo = (x: number, z: number) => {
          const a = Math.atan2(x - p.pos.x, z - p.pos.z) - p.heading;
          return Math.atan2(Math.sin(a), Math.cos(a));
        };
        let goal: THREE.Vector3 | null = null;
        if (g.profile.stats.captures > 0) {
          if (phase !== 'home') log.push(`heading home t=${g.time.toFixed(0)}`);
          phase = 'home';
          goal = PORTS[0].berth.clone();
          if (p.pos.distanceTo(goal) < 40) press('KeyE', 60);
        } else {
          const t = p.target;
          if (t) {
            const d = t.pos.distanceTo(p.pos);
            if (t.disabled) {
              goal = t.pos.clone();
              if (d < 30) press('KeyE', 60);
            } else if (d < p.range * 0.9) {
              const a = angTo(t.pos.x, t.pos.z);
              const want = a > 0 ? a - Math.PI / 2 : a + Math.PI / 2;
              hold('KeyA', want > 0.1);
              hold('KeyD', want < -0.1);
              hold('KeyW', true);
              press('Space', 40);
              return;
            } else goal = t.pos.clone();
          } else goal = new THREE.Vector3(60, 0, 260);
        }
        const a = angTo(goal.x, goal.z);
        hold('KeyA', a > 0.08);
        hold('KeyD', a < -0.08);
        hold('KeyW', true);
        hold('ShiftLeft', p.boost > 60 && Math.abs(a) < 0.3);
      };
      setInterval(tick, 100);
      setInterval(() => {
        const t = g.player.target;
        log.push(`t=${g.time.toFixed(0)} st=${g.state} hp=${Math.round(g.player.hp)} tgt=${t ? t.typeLabel + ':' + Math.round(t.hp) + '/' + t.state : '-'} wanted=${g.wanted.level} caps=${g.profile.stats.captures} money=${g.profile.money}`);
      }, 5000);
      break;
    }
    // ---------------- land combat ----------------
    case 'poses': {
      // a row of frozen characters showing combat poses: poses:<prop>:<states,comma>:<k>
      const prop = (arg ?? 'cutlass') as PropKind;
      const states = (arg2 ?? 'guard,slash1,slash2,slash3,thrust,charge,heavy,block,roll,aim,reload,death').split(',') as AnimState[];
      const k = Number(arg3 ?? 0.45);
      setTimeout(() => {
        const me = g.walker.pos.clone();
        const h = g.walker.heading;
        const fwd = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
        const right = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
        const base = me.clone().addScaledVector(fwd, 6);
        states.forEach((st, i) => {
          const c = new Character(i % 2 ? 'foeGrunt1' : 'captain');
          c.setProp(st === 'aim' || st === 'reload' ? 'pistol' : prop);
          c.root.position.copy(base).addScaledVector(right, (i - (states.length - 1) / 2) * 1.6);
          c.root.rotation.y = h + Math.PI + (st === 'roll' || st === 'death' ? Math.PI / 2 : Number(arg4 ?? 0.5));
          c.params.armed = 1;
          c.params.gun = st === 'aim' || st === 'reload';
          c.params.k = st === 'death' ? 1 : k;
          c.play(st, true, 0.001);
          c.update(0.05);
          g.scene.add(c.root);
        });
        g.walker.visible = false;
        const camPos = base.clone().addScaledVector(fwd, -(2.4 + states.length * 1.15)).setY(base.y + 1.7);
        g.camRig.setCinematic(camPos, base.clone().setY(base.y + 1.1), 50, true);
      }, 800);
      break;
    }
    case 'fight': {
      // fight:<foe,foe,…>[:<port>[:<tier>]] – spawn foes around the captain in town
      const ids = (arg ?? 'grunt').split(',') as EnemyId[];
      if (arg2 && arg2 !== '-') goPort(arg2);
      const tier = Number(arg3 ?? 1);
      setTimeout(() => {
        const c = g.combat as unknown as { spawnEnemy: (id: EnemyId, tier: number, p: THREE.Vector3, f: number, site: string) => Enemy; findSpot: (c: THREE.Vector3, a: number, b: number, a0?: number) => THREE.Vector3 | null };
        // stand in the open part of town
        const sq = openSpot();
        if (sq) g.walker.place(sq.clone(), 0);
        const me = g.walker.pos;
        ids.forEach((id, i) => {
          const p = c.findSpot(me, 7, 10, (i / ids.length) * Math.PI * 2) ?? me.clone().add(new THREE.Vector3(6, 0, i));
          const e = c.spawnEnemy(id, tier, p, Math.atan2(me.x - p.x, me.z - p.z), 'test');
          setTimeout(() => e.notice(g.combat), 600);
        });
        g.camRig.walk(Math.PI, 0.01);
      }, 1200);
      break;
    }
    case 'ashore': {
      // ashore:<island name>
      const isl = ISLANDS.find((i) => i.name === (arg ?? 'Coconut Key'))!;
      setTimeout(() => {
        toSea();
        const a = Math.atan2(g.player.pos.z - isl.z, g.player.pos.x - isl.x);
        g.player.pos.set(isl.x + Math.cos(a) * (isl.maxR! + 30), 0, isl.z + Math.sin(a) * (isl.maxR! + 30));
        g.player.heading = Math.atan2(isl.x - g.player.pos.x, isl.z - g.player.pos.z);
        g.player.speed = 0;
        g.goAshore(isl, true);
      }, 800);
      break;
    }
    case 'site': {
      // site:<id>[:<dist>] – go to an encounter site and stand a little way off it
      const run = g.combat.sites.find((x) => x.def.id === arg);
      if (!run) {
        console.warn('no site', arg, g.combat.sites.map((x) => x.def.id).join(','));
        break;
      }
      const dist = Number(arg2 ?? 22);
      setTimeout(() => {
        if (run.def.port) goPort(run.def.port);
        else {
          const isl = ISLANDS.find((i) => i.name === run.def.island)!;
          toSea();
          const a = Math.atan2(run.geo.center.z - isl.z, run.geo.center.x - isl.x);
          g.player.pos.set(isl.x + Math.cos(a) * (isl.maxR! + 30), 0, isl.z + Math.sin(a) * (isl.maxR! + 30));
          g.player.speed = 0;
          g.goAshore(isl, true);
        }
        setTimeout(() => {
          const c = run.geo.center;
          const area = g.combat.area;
          for (let i = 0; i < 40; i++) {
            const a = run.geo.rot + (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.25;
            const x = c.x + Math.sin(a) * dist;
            const z = c.z + Math.cos(a) * dist;
            const y = area.surface(x, z);
            if (y === null || area.blocked(x, z, 0.6)) continue;
            g.walker.place(new THREE.Vector3(x, y, z), Math.atan2(c.x - x, c.z - z));
            g.camRig.walk(Math.atan2(x - c.x, z - c.z), 0.01);
            break;
          }
        }, 900);
      }, 900);
      break;
    }
    case 'arms': {
      // give the captain a weapon and open the armoury: arms:<base>:<rarity>
      const w = makeWeapon((arg ?? 'axe') as WeaponBaseId, (arg2 ?? 'epic') as Rarity, undefined, 2);
      g.profile.weapons.push(w);
      g.profile.level = Math.max(g.profile.level, 12);
      g.profile.scrap = 20;
      g.profile.money = 50000;
      setTimeout(() => {
        g.combat.equip(w);
        g.inventory.toggle(true);
        (document.querySelector('.inventory [data-arg="arms"]') as HTMLElement)?.click();
      }, 1200);
      break;
    }
    case 'gunbot': {
      // gunbot:<foes>:<tier> – fight with the pistol only
      const ids = (arg ?? 'grunt,grunt').split(',') as EnemyId[];
      const log: string[] = [];
      (window as unknown as { botLog: string[] }).botLog = log;
      g.profile.shot = 30;
      setTimeout(() => {
        const c = g.combat as unknown as { spawnEnemy: (id: EnemyId, tier: number, p: THREE.Vector3, f: number, site: string) => Enemy; findSpot: (c: THREE.Vector3, a: number, b: number, a0?: number) => THREE.Vector3 | null };
        const sq = openSpot();
        if (sq) g.walker.place(sq.clone(), 0);
        const me = g.walker.pos;
        ids.forEach((id, i) => {
          const p = c.findSpot(me, 12, 15, (i / ids.length) * Math.PI * 2) ?? me.clone().add(new THREE.Vector3(10, 0, i));
          const e = c.spawnEnemy(id, Number(arg2 ?? 1), p, Math.atan2(me.x - p.x, me.z - p.z), 'test');
          setTimeout(() => e.notice(g.combat), 500);
        });
        startBot(log, { gun: true });
      }, 1200);
      break;
    }
    case 'sitebot': {
      // sitebot:<siteId>:<level>:<weapon>:<rarity> – a levelled-up captain clears a site on his own
      const run = g.combat.sites.find((x) => x.def.id === arg);
      if (!run) break;
      const log: string[] = [];
      (window as unknown as { botLog: string[] }).botLog = log;
      g.profile.level = Number(arg2 ?? 20);
      g.profile.crew = 12;
      const w = makeWeapon((arg3 ?? 'axe') as WeaponBaseId, (arg4 ?? 'epic') as Rarity, undefined, 3);
      g.profile.weapons.push(w);
      g.profile.melee = w.uid;
      setTimeout(() => {
        if (run.def.port) goPort(run.def.port);
        else {
          const isl = ISLANDS.find((i) => i.name === run.def.island)!;
          toSea();
          const a = Math.atan2(run.geo.center.z - isl.z, run.geo.center.x - isl.x);
          g.player.pos.set(isl.x + Math.cos(a) * (isl.maxR! + 30), 0, isl.z + Math.sin(a) * (isl.maxR! + 30));
          g.player.speed = 0;
          g.goAshore(isl, true);
        }
        setTimeout(() => {
          const c = run.geo.center;
          const area = g.combat.area;
          for (let i = 0; i < 40; i++) {
            const a = run.geo.rot + (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.25;
            const x = c.x + Math.sin(a) * 14;
            const z = c.z + Math.cos(a) * 14;
            const y = area.surface(x, z);
            if (y === null || area.blocked(x, z, 0.6)) continue;
            g.walker.place(new THREE.Vector3(x, y, z), Math.atan2(c.x - x, c.z - z));
            for (const al of g.combat.allies) al.f.pos.set(x + 1, y, z + 1);
            g.camRig.walk(Math.atan2(x - c.x, z - c.z), 0.01);
            break;
          }
          startBot(log);
          const t0 = g.time;
          setInterval(() => {
            if (run.status === 'cleared' && !log.some((l) => l.startsWith('CLEARED'))) log.push(`CLEARED in ${(g.time - t0).toFixed(0)}s hp=${Math.round(g.combat.player.hp)} kills=${g.profile.land.kills} money=${g.profile.money} level=${g.profile.level} weapons=${g.profile.weapons.length}`);
          }, 500);
        }, 900);
      }, 900);
      break;
    }
    case 'deckfight': {
      // deckfight:<crew>:<shipType>[:<level>[:bot]] – board a ship in sword-fight mode (a bot fights if asked)
      const pf = g.profile;
      pf.level = Math.max(pf.level, Number(arg3 ?? 1));
      toSea();
      pf.crew = Number(arg ?? 10);
      const type = (arg2 ?? 'mediumMerchant') as never;
      const isNavy = String(arg2).startsWith('navy');
      const m = isNavy ? (g.spawnNavy(type, g.player.pos.clone().add(new THREE.Vector3(60, 0, 0))) as unknown as AIShip) : (g.spawnMerchant(type, 0, 1, 1, g.player.pos.clone().add(new THREE.Vector3(60, 0, 0))) as unknown as AIShip);
      placeBeside(m, 16, 0);
      m.applyDamage(m.hp * 0.75, m.pos.clone().setY(2), g.player);
      if (isNavy) m.disable();
      setTimeout(() => press('KeyE', 100), 1200);
      const log: string[] = [];
      (window as unknown as { botLog: string[] }).botLog = log;
      const t0 = g.time;
      let seen = '';
      const iv = setInterval(() => {
        const b = g.boarding;
        const k = `${b.active ? b.phase : 'done'}:${g.state}`;
        if (k !== seen) {
          seen = k;
          log.push(`t=${(g.time - t0).toFixed(1)} ${k} foes=${g.combat.enemies.filter((e) => !e.f.dead).length} allies=${g.combat.allies.length} hp=${Math.round(g.combat.player.hp)} crew=${pf.crew} captured=${m.captured}`);
          if (b.phase === 'fight' && arg4 === 'bot') startBot(log);
        }
        if (!b.active && g.time - t0 > 5) clearInterval(iv);
      }, 100);
      break;
    }
    case 'raid':
    case 'raidland': {
      // raid:<port>[:<level>] – sail up to a port and start a raid (batteries open fire)
      // raidland:<port>[:<level>[:bot]] – skip the bombardment: land and fight to the treasury
      const pf = g.profile;
      pf.level = Math.max(pf.level, Number(arg2 ?? 6));
      pf.crew = 14;
      const idx = PORTS.findIndex((p) => p.id === (arg ?? 'royal'));
      const port = PORTS[idx];
      toSea();
      const sea = port.berth.clone().sub(g.towns[idx].center).setY(0).normalize();
      g.player.pos.copy(port.berth).addScaledVector(sea, 95);
      g.player.heading = Math.atan2(-sea.x, -sea.z) + Math.PI / 2;
      g.player.speed = 0;
      g.camRig.follow(g.player.heading);
      const log: string[] = [];
      (window as unknown as { botLog: string[] }).botLog = log;
      const raid = g.raid as unknown as { start: (i: number) => void; wreck: (b: unknown, q?: boolean) => void; batteries: { port: number; alive: boolean }[]; phase: string };
      setTimeout(() => {
        raid.start(idx);
        log.push(`batteries=${raid.batteries.filter((b) => b.port === idx).length} phase=${raid.phase}`);
        if (base === 'raidland') {
          for (const b of raid.batteries) if (b.port === idx && b.alive) raid.wreck(b);
          log.push(`phase=${raid.phase}`);
          P.dockAt.call(g, idx, true, true);
          P.disembark.call(g, true);
          setTimeout(() => {
            log.push(`landed state=${g.state} foes=${g.combat.enemies.length}`);
            if (arg3 === 'bot') startBot(log);
          }, 1500);
          const iv = setInterval(() => {
            const site = g.combat.sites.find((s) => s.def.raid && s.def.port === port.id);
            // the bot only fights what's near: once the pier is clear, march it up to the treasury
            if (arg3 === 'bot' && site && site.status === 'active' && !site.triggered && !g.combat.engaged && g.time > 8) {
              const c = g.combat as unknown as { findSpot: (c: THREE.Vector3, a: number, b: number, a0?: number) => THREE.Vector3 | null };
              const me = g.walker.pos;
              const p = c.findSpot(site.geo.center, 10, 14, Math.atan2(me.x - site.geo.center.x, me.z - site.geo.center.z));
              if (p) {
                g.walker.place(p, Math.atan2(site.geo.center.x - p.x, site.geo.center.z - p.z));
                for (const a of g.combat.allies) a.f.pos.copy(p);
                log.push(`marched to the treasury t=${g.time.toFixed(0)}`);
              }
            }
            if (site?.status === 'cleared' && !log.some((l) => l.startsWith('CLEARED'))) {
              // open the chest
              setTimeout(() => {
                g.walker.place(site.geo.chest!.clone(), 0);
                setTimeout(() => press('KeyE', 100), 600);
                setTimeout(() => log.push(`LOOTED phase=${g.raid.phase} money=${pf.money} wanted=${g.wanted.level} objective=${!!g.landObjective}`), 4000);
              }, 3000);
              log.push(`CLEARED t=${g.time.toFixed(0)} hp=${Math.round(g.combat.player.hp)} money=${pf.money}`);
              clearInterval(iv);
            }
          }, 500);
        }
      }, 1500);
      break;
    }
    case 'fightbot': {
      // fightbot:<foes>[:<tier>] – the captain fights on his own (combos, blocks, rolls); logs to window.botLog
      const ids = (arg ?? 'grunt,grunt,gunner').split(',') as EnemyId[];
      const tier = Number(arg2 ?? 1);
      const log: string[] = [];
      (window as unknown as { botLog: string[] }).botLog = log;
      setTimeout(() => {
        const c = g.combat as unknown as { spawnEnemy: (id: EnemyId, tier: number, p: THREE.Vector3, f: number, site: string) => Enemy; findSpot: (c: THREE.Vector3, a: number, b: number, a0?: number) => THREE.Vector3 | null };
        const sq = openSpot();
        if (sq) g.walker.place(sq.clone(), 0);
        const me = g.walker.pos;
        ids.forEach((id, i) => {
          const p = c.findSpot(me, 8, 11, (i / ids.length) * Math.PI * 2) ?? me.clone().add(new THREE.Vector3(6, 0, i));
          const e = c.spawnEnemy(id, tier, p, Math.atan2(me.x - p.x, me.z - p.z), 'test');
          setTimeout(() => e.notice(g.combat), 500);
        });
        startBot(log);
      }, 1200);
      break;
    }
  }
}
