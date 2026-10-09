import * as THREE from 'three';
import type { Game } from './Game';
import { audio } from '../core/Audio';
import { zoneAt } from '../world/WorldData';
import { rand } from '../core/math';
import type { AIShip } from '../entities/AIShip';

/**
 * How quickly the navy notices you. Piracy is slow to be noticed, but a long cannon battle
 * is always heard.
 */
export const DETECTION = {
  /** heat from attacking merchants is scaled by this (lower = slower to be noticed) */
  crimeHeat: 0.6,
  /** a merchant's distress flare takes this long (s) to reach the navy… */
  distressDelay: 20,
  /** …and then adds this much heat */
  distressHeat: 0.6,
  /** seconds a navy patrol must keep you in sight before giving chase */
  patrolSpot: 4,
  /** the first pursuit ship arrives this long (s) after you become wanted */
  firstPursuit: 14,
  /** a firefight ends after this many seconds without a shot */
  fightGap: 15,
  /** a warning appears after this many seconds of firefight */
  fightWarn: 25,
  /** a firefight this long (s) is always heard: you get at least this many stars */
  fightHeard: [
    { t: 40, stars: 1 },
    { t: 80, stars: 2 },
  ],
};

/** Navy pursuit levels driven by piracy "heat". */
export class Wanted {
  heat = 0;
  lastCrime = -99;
  private spawnT = 8;
  private prevLevel = 0;
  surviveT = 0;
  // the current firefight
  private fightStart = -1;
  private lastShot = -99;
  private fightStars = 0;
  private fightWarned = false;

  constructor(private game: Game) {}

  get level() {
    return Math.max(0, Math.min(5, Math.floor(this.heat)));
  }

  /** 0..1 progress to next level (for HUD). */
  get frac() {
    return this.heat - Math.floor(this.heat);
  }

  /**
   * Add piracy heat. Crimes against merchants are scaled down by DETECTION.crimeHeat;
   * `direct` heat (attacking the navy itself, distress flares they've seen) is not.
   */
  addHeat(amount: number, pos?: THREE.Vector3, direct = false) {
    let k = this.game.profile.items.includes('smugglerCharts') ? 0.7 : 1;
    if (!direct) k *= DETECTION.crimeHeat;
    if (pos && zoneAt(pos.x, pos.z, 'patrol')) k *= 1.6;
    this.heat = Math.min(5.99, this.heat + amount * k);
    this.lastCrime = this.game.time;
    this.checkLevel();
  }

  private checkLevel(reason?: string) {
    const l = this.level;
    if (l > this.prevLevel) {
      audio.play('alarm', { volume: 0.5 });
      const msg = reason ?? ['', 'The navy has noticed you!', 'Patrols are hunting you!', 'Fast cutters dispatched!', 'Multiple warships incoming!', 'FULL NAVAL PURSUIT!'][l];
      this.game.ui.toast(`WANTED ${'★'.repeat(l)}`, msg, 'danger');
      // the navy takes a while to get here the first time
      this.spawnT = this.prevLevel === 0 ? Math.max(this.spawnT, DETECTION.firstPursuit) : Math.min(this.spawnT, 6);
    }
    if (l < this.prevLevel && l === 0) this.game.ui.toast('Lost them!', 'Your wanted level has cleared.', 'good');
    this.prevLevel = l;
  }

  callForHelp(ship: AIShip) {
    const g = this.game;
    g.ui.toast('📯 Distress flare!', `${ship.name} fired a flare – the navy will see it in about ${DETECTION.distressDelay} seconds!`, 'danger');
    audio.play('bell', { pos: ship.pos, volume: 0.6 });
    g.particles.fire(ship.pos.clone().setY(ship.model.mastTop + 4), 1.4);
    const at = ship.pos.clone();
    // the flare takes a while to be seen; then a cutter heads for it
    g.after(DETECTION.distressDelay, () => {
      if (g.inPort) return;
      this.addHeat(DETECTION.distressHeat, at, true);
      g.ui.toast('⚓ The navy saw the flare!', 'A cutter is on its way.', 'danger');
      g.after(rand(4, 8), () => g.spawnNavy('navyCutter', at));
    });
  }

  clear() {
    this.heat = 0;
    this.surviveT = 0;
    this.fightStart = -1;
    this.checkLevel();
  }

  /** Cannons fired by or at you: keeps the firefight clock running. */
  gunfire() {
    const t = this.game.time;
    if (this.fightStart < 0 || t - this.lastShot > DETECTION.fightGap) {
      this.fightStart = t;
      this.fightStars = 0;
      this.fightWarned = false;
    }
    this.lastShot = t;
  }

  /** How long the current firefight has lasted (0 when there isn't one). */
  get fightTime() {
    const t = this.game.time;
    return this.fightStart >= 0 && t - this.lastShot <= DETECTION.fightGap ? t - this.fightStart : 0;
  }

  update(dt: number) {
    const g = this.game;
    // a long firefight is always heard by the navy
    const ft = this.fightTime;
    if (ft > DETECTION.fightWarn && !this.fightWarned && this.level < DETECTION.fightHeard[0].stars) {
      this.fightWarned = true;
      g.ui.toast('🔭 Gunfire echoes across the sea…', 'Finish this fight quickly or the navy will hear it!', 'info');
    }
    for (const h of DETECTION.fightHeard) {
      if (ft < h.t || this.fightStars >= h.stars) continue;
      this.fightStars = h.stars;
      if (this.heat < h.stars + 0.05) {
        this.heat = h.stars + 0.05;
        this.lastCrime = g.time;
        this.checkLevel('The navy heard the gunfire!');
      }
    }

    const navy = g.ships.filter((s) => s.team === 'navy' && s.alive);
    const hunting = navy.filter((s) => s.state === 'chase' || s.state === 'attack');
    const nearest = navy.reduce((m, s) => Math.min(m, s.pos.distanceTo(g.player.pos)), 1e9);

    // decay when lying low
    if (this.heat > 0 && g.time - this.lastCrime > 18 && (nearest > 170 || hunting.length === 0)) {
      this.heat = Math.max(0, this.heat - dt * (hunting.length ? 0.03 : 0.07));
      this.checkLevel();
    }
    // survive tracking for missions
    if (this.level >= 2 && hunting.length > 0) {
      this.surviveT += dt;
      g.missions.event('survive', { seconds: this.surviveT });
    } else if (this.level < 2) this.surviveT = 0;

    // pursuit spawning
    const lvl = this.level;
    if (lvl === 0 || g.inPort) return;
    const want = [0, 1, 2, 2, 3, 4][lvl];
    const pursuers = navy.filter((s) => s.state !== 'leave' && s.state !== 'patrol').length;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && pursuers < want) {
      this.spawnT = Math.max(10, 26 - lvl * 4);
      const frigate = lvl >= 5 && !navy.some((s) => s.type.id === 'navyFrigate') ? true : lvl >= 4 && Math.random() < 0.3;
      g.spawnNavy(frigate ? 'navyFrigate' : 'navyCutter', null, true);
    }
  }
}
