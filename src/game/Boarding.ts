import * as THREE from 'three';
import { officerSkill, hasItem } from './Data';
import type { Game } from './Game';
import type { AIShip } from '../entities/AIShip';
import { Character } from '../models/Character';
import { audio } from '../core/Audio';
import { clamp, lerp, rand, choose, easeInOut, dampAngle, damp } from '../core/math';
import { beam } from '../render/GeoBuilder';
import { PAL } from '../models/Props';
import { shipClass } from './ShipClasses';
import { BOARDING, boardingPower, boardingAdvantage, boardingRate } from './BoardingBalance';
export { BOARDING, boardingPower, boardingAdvantage, boardingRate };

type Phase = 'approach' | 'jump' | 'brawl' | 'victory' | 'return' | 'defeat';

interface Jumper {
  c: Character;
  from: THREE.Vector3;
  to: THREE.Vector3;
  home: THREE.Vector3;
  homeRot: number;
  delay: number;
}

const ropeMat = new THREE.MeshStandardMaterial({ color: PAL.rope, roughness: 0.9 });

export interface BoardingView {
  playerCrew: number;
  enemyCrew: number;
  playerCrew0: number;
  enemyCrew0: number;
  needle: number;
  zoneC: number;
  zoneW: number;
  perfectW: number;
  result: string;
  resultT: number;
  phase: Phase;
  /** capture progress 0..1 (true value) and the smoothly animated one shown */
  progress: number;
  shown: number;
  /** current bar speed (units/s, negative = being pushed back) */
  rate: number;
  adv: number;
  playerPower: number;
  enemyPower: number;
}

/** Arcade boarding: pull alongside, swing over, timing-bar brawl, capture! */
export class Boarding {
  active = false;
  phase: Phase = 'approach';
  t = 0;
  enemy!: AIShip;
  private jumpers: Jumper[] = [];
  private foes: Character[] = [];
  private ropes: THREE.Mesh[] = [];
  private startPos = new THREE.Vector3();
  private startHeading = 0;
  private alongPos = new THREE.Vector3();
  private side = 1;
  private needleDir = 1;
  private needleSpeed = 0.9;
  private idleT = 0;
  private boost = 0;
  private lossT = 0;
  private playerMul = 1;
  private enemyMul = 1;
  view: BoardingView = { playerCrew: 0, enemyCrew: 0, playerCrew0: 0, enemyCrew0: 0, needle: 0, zoneC: 0.5, zoneW: 0.2, perfectW: 0.06, result: '', resultT: 0, phase: 'approach', progress: 0, shown: 0, rate: 0, adv: 0, playerPower: 0, enemyPower: 0 };

  constructor(private game: Game) {}

  start(enemy: AIShip) {
    const g = this.game;
    const p = g.player;
    this.active = true;
    this.enemy = enemy;
    enemy.boarded = true;
    this.phase = 'approach';
    this.t = 0;
    p.controlsEnabled = false;
    p.throttle = 0;
    p.steer = 0;
    this.startPos.copy(p.pos);
    this.startHeading = p.heading;
    // pick the side of the enemy the player is on
    const right = new THREE.Vector3(Math.cos(enemy.heading), 0, -Math.sin(enemy.heading));
    this.side = p.pos.clone().sub(enemy.pos).dot(right) > 0 ? 1 : -1;
    const off = enemy.model.beam / 2 + p.model.beam / 2 + 1.6;
    this.alongPos.copy(enemy.pos).addScaledVector(right, off * this.side);
    this.view.playerCrew0 = this.view.playerCrew = g.profile.crew;
    this.view.enemyCrew0 = this.view.enemyCrew = enemy.crewCount;
    // your ship's boarding strength and boarder officers vs. how hard their ship is to take
    this.playerMul = shipClass(g.profile.ship).boardingStrength * (1 + officerSkill(g.profile, 'boarder') * 0.12);
    this.enemyMul = enemy.type.boarding;
    const adv = boardingAdvantage(boardingPower(this.view.playerCrew, this.playerMul), boardingPower(this.view.enemyCrew, this.enemyMul));
    this.view.zoneW = clamp(0.23 + Math.max(0, adv) * 0.1, 0.18, 0.36) * (hasItem(g.profile, 'grapplingHooks') ? 1.25 : 1);
    this.view.perfectW = this.view.zoneW * 0.3;
    this.needleSpeed = Math.min(BOARDING.needleMax, 0.62 * enemy.type.difficulty * (hasItem(g.profile, 'cursedCutlasses') ? 0.85 : 1));
    this.view.progress = this.view.shown = BOARDING.start;
    this.view.rate = 0;
    this.boost = 0;
    this.lossT = 0;
    this.view.result = '';
    g.camRig.combatPulse();
    audio.play('whoosh');
    audio.playVoice('arr', p.pos, 0.9);
    g.ui.prompt(null);
  }

  private cineCam() {
    const g = this.game;
    const e = this.enemy;
    const right = new THREE.Vector3(Math.cos(e.heading), 0, -Math.sin(e.heading));
    const fwd = new THREE.Vector3(Math.sin(e.heading), 0, Math.cos(e.heading));
    const mid = e.pos.clone().addScaledVector(right, this.side * 3);
    const camPos = mid.clone().addScaledVector(right, this.side * (16 + e.model.length * 0.45)).addScaledVector(fwd, e.model.length * 0.35).setY(11 + e.model.length * 0.15);
    g.camRig.setCinematic(camPos, e.pos.clone().setY(e.model.deckYAt(0) + 1.5), 2.2);
  }

  private deckSpot(i: number, n: number) {
    const e = this.enemy;
    const z = lerp(-e.model.length * 0.28, e.model.length * 0.3, n <= 1 ? 0.5 : i / (n - 1));
    const hw = e.model.halfWidthAt(z) * 0.55;
    const x = (i % 2 ? -1 : 1) * hw * 0.3 + this.side * hw * 0.35;
    return new THREE.Vector3(x, e.model.deckYAt(z), z + rand(-0.6, 0.6));
  }

  private setupJump() {
    const g = this.game;
    const p = g.player;
    const e = this.enemy;
    const party: Character[] = [];
    if (p.captain) party.push(p.captain);
    party.push(...p.crew);
    this.jumpers = party.map((c, i) => {
      const home = c.root.position.clone();
      const from = c.root.getWorldPosition(new THREE.Vector3());
      const toLocal = this.deckSpot(i, party.length);
      toLocal.x += this.side * 1.2;
      const to = e.model.group.localToWorld(toLocal.clone());
      return { c, from, to, home, homeRot: c.root.rotation.y, delay: i * 0.12 };
    });
    for (const j of this.jumpers) {
      g.scene.attach(j.c.root);
      j.c.play('board');
      j.c.express('determined');
      if (j.c === p.captain) j.c.setProp('cutlass');
    }
    // enemy defenders: existing crew + extra sailors so there's a proper brawl
    this.foes = [...e.crew];
    if (e.captain) this.foes.push(e.captain);
    const extra = clamp(Math.ceil(e.crewCount / 4) - this.foes.length, 0, 4);
    for (let i = 0; i < extra; i++) {
      const c = new Character(e.type.team === 'navy' ? 'navy' : 'sailor');
      const spot = this.deckSpot(i + 1, extra + 2);
      spot.x -= this.side * 1.0;
      e.addCrew(c, spot, 0);
      this.foes.push(c);
    }
    for (const f of this.foes) {
      f.play('attack');
      f.express('angry');
      // face the boarders
      const r = f.root;
      r.rotation.y = this.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    // grappling ropes
    const pr = g.player.model.group;
    for (let i = 0; i < 3; i++) {
      const z = (i - 1) * e.model.length * 0.2;
      const a = pr.localToWorld(new THREE.Vector3(-this.side * p.model.halfWidthAt(z * 0.6), p.model.deckYAt(0) + 1, z * 0.6));
      const b = e.model.group.localToWorld(new THREE.Vector3(this.side * e.model.halfWidthAt(z), e.model.deckYAt(z) + 0.8, z));
      const m = new THREE.Mesh(beam(a, b, 0.06, 5), ropeMat);
      g.scene.add(m);
      this.ropes.push(m);
    }
    audio.play('whoosh', { volume: 0.8 });
    audio.play('clang', { volume: 0.4, delay: 0.15 });
  }

  update(dt: number) {
    if (!this.active) return;
    const g = this.game;
    const p = g.player;
    const e = this.enemy;
    this.t += dt;
    this.view.phase = this.phase;
    this.view.resultT = Math.max(0, this.view.resultT - dt);
    // keep the two hulls locked together
    if (this.phase !== 'approach' && this.phase !== 'return' && this.phase !== 'defeat') {
      p.pos.x = this.alongPos.x;
      p.pos.z = this.alongPos.z;
      p.heading = dampAngle(p.heading, e.heading, 4, dt);
      p.speed = 0;
    }

    switch (this.phase) {
      case 'approach': {
        const k = easeInOut(clamp(this.t / 1.6, 0, 1));
        p.pos.x = lerp(this.startPos.x, this.alongPos.x, k);
        p.pos.z = lerp(this.startPos.z, this.alongPos.z, k);
        p.heading = this.startHeading + (((e.heading - this.startHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
        p.speed = 0;
        this.cineCam();
        if (this.t >= 1.6) {
          this.phase = 'jump';
          this.t = 0;
          this.setupJump();
        }
        break;
      }
      case 'jump': {
        let allDone = true;
        for (const j of this.jumpers) {
          const tt = clamp((this.t - j.delay) / 0.9, 0, 1);
          if (tt < 1) allDone = false;
          const pos = j.from.clone().lerp(j.to, easeInOut(tt));
          pos.y += Math.sin(tt * Math.PI) * 3.2;
          j.c.root.position.copy(pos);
          j.c.root.rotation.y = e.heading + (this.side > 0 ? -Math.PI / 2 : Math.PI / 2);
          if (tt >= 1 && j.c.state === 'board') {
            e.model.group.attach(j.c.root);
            j.c.root.rotation.y = this.side > 0 ? -Math.PI / 2 : Math.PI / 2;
            j.c.play('attack');
            audio.play('bonk', { volume: 0.25, pitch: 0.6 });
          }
        }
        if (allDone && this.t > 1.2) {
          this.phase = 'brawl';
          this.t = 0;
          this.view.needle = 0;
          this.newZone();
          g.ui.showBoarding(true);
          audio.playVoice('arr', e.pos, 0.85);
        }
        break;
      }
      case 'brawl': {
        // needle bounces along the bar
        this.view.needle += this.needleDir * this.needleSpeed * dt;
        if (this.view.needle > 1) {
          this.view.needle = 2 - this.view.needle;
          this.needleDir = -1;
        }
        if (this.view.needle < 0) {
          this.view.needle = -this.view.needle;
          this.needleDir = 1;
        }
        this.idleT += dt;
        if (g.input.pressed('Space', 'KeyE', 'Enter') || g.ui.consumeBoardClick()) this.strike();
        else if (this.idleT > 5) this.strike(true);
        if (this.phase === 'brawl') this.tug(dt);
        // brawl ambience
        if (Math.random() < dt * 2.5) audio.play(Math.random() < 0.5 ? 'clang' : 'bonk', { pos: e.pos, volume: 0.25, pitch: rand(0.8, 1.3) });
        break;
      }
      case 'victory': {
        if (this.t > 3.4) {
          this.phase = 'return';
          this.t = 0;
          this.startReturn();
        }
        break;
      }
      case 'return':
      case 'defeat': {
        let allDone = true;
        for (const j of this.jumpers) {
          const tt = clamp((this.t - j.delay * 0.5) / 0.8, 0, 1);
          if (tt < 1) allDone = false;
          const target = p.model.group.localToWorld(j.home.clone());
          const pos = j.to.clone().lerp(target, easeInOut(tt));
          pos.y += Math.sin(tt * Math.PI) * 3;
          j.c.root.position.copy(pos);
        }
        if (allDone && this.t > 1.0) this.finish();
        break;
      }
    }
    g.ui.updateBoarding(this.view);
  }

  private newZone() {
    this.view.zoneC = rand(0.2 + this.view.zoneW / 2, 0.8 - this.view.zoneW / 2);
    this.idleT = 0;
  }

  /** The tug-of-war: the capture bar moves at a clamped speed set by the power advantage. */
  private tug(dt: number) {
    const v = this.view;
    const B = BOARDING;
    const pp = boardingPower(v.playerCrew, this.playerMul);
    const ep = boardingPower(v.enemyCrew, this.enemyMul);
    this.boost *= Math.exp(-B.boostDecay * dt);
    const rate = clamp(boardingRate(pp, ep) + this.boost, -B.maxRate, B.maxRate);
    v.progress = clamp(v.progress + (rate * dt) / B.bar, 0, 1);
    v.shown = damp(v.shown, v.progress, 6, dt);
    v.rate = rate;
    v.adv = boardingAdvantage(pp, ep);
    v.playerPower = pp;
    v.enemyPower = ep;
    // defenders fall as the bar fills
    const left = Math.ceil(v.enemyCrew0 * (1 - clamp((v.progress - B.start) / (1 - B.start), 0, 1)));
    if (left < v.enemyCrew) {
      v.enemyCrew = left;
      this.knockOut();
    }
    // being pushed back costs pirates
    if (rate < 0) {
      this.lossT += dt;
      if (this.lossT > B.lossEvery) {
        this.lossT = 0;
        this.losePirate('PUSHED BACK!');
      }
    } else this.lossT = 0;
    if (v.progress >= 1) {
      v.enemyCrew = 0;
      this.win(this.enemy);
    } else if (v.progress <= 0 || v.playerCrew <= 0) this.lose();
  }

  private losePirate(text: string) {
    const g = this.game;
    const v = this.view;
    v.playerCrew = Math.max(0, v.playerCrew - 1);
    g.profile.crew = Math.max(0, g.profile.crew - 1);
    const pirates = this.jumpers.map((j) => j.c);
    const crew = pirates.filter((c) => c !== g.player.captain);
    const victim = choose(crew.length ? crew : pirates);
    victim.trigger('hit', 0.6);
    g.ui.comicText(victim.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 3, 0)), text === 'PUSHED BACK!' ? 'OOF!' : 'OOF!', 'bad');
    audio.playVoice('oof', g.player.pos, 1.0);
    audio.play('bonk', { pitch: 0.7 });
  }

  /** Knock out defenders in proportion to the enemy crew left. */
  private knockOut() {
    const v = this.view;
    const koTarget = Math.round((1 - v.enemyCrew / Math.max(1, v.enemyCrew0)) * this.foes.length);
    let ko = this.foes.filter((f) => f.state === 'dizzy').length;
    for (const f of this.foes) {
      if (ko >= koTarget) break;
      if (f.state !== 'dizzy') {
        f.play('dizzy');
        f.express('hurt');
        ko++;
      }
    }
  }

  private strike(timeout = false) {
    const g = this.game;
    const v = this.view;
    const d = Math.abs(v.needle - v.zoneC);
    const pirates = this.jumpers.map((j) => j.c);
    const standing = this.foes.filter((f) => f.state !== 'dizzy');
    if (!timeout && d < v.perfectW / 2) {
      this.boost += BOARDING.perfectBoost;
      this.feedback('PERFECT!', 'good');
      this.knock(standing, pirates, 'POW!');
      g.camRig.addShake(0.35);
      audio.play('bonk', { pitch: 1.2 });
      audio.playVoice('yay', g.player.pos, 1.0);
    } else if (!timeout && d < v.zoneW / 2) {
      this.boost += BOARDING.hitBoost;
      this.feedback('HIT!', 'ok');
      this.knock(standing, pirates, choose(['BONK!', 'WHAM!', 'BOP!']));
      g.camRig.addShake(0.2);
      audio.play('bonk');
    } else {
      this.boost += BOARDING.missBoost;
      this.feedback(timeout ? 'TOO SLOW!' : 'MISS!', 'bad');
      this.losePirate('OOF!');
      const attacker = choose(standing.length ? standing : this.foes);
      attacker.trigger('fire', 0.4);
      if (v.playerCrew <= 0) this.lose();
    }
    this.needleSpeed = Math.min(BOARDING.needleMax, this.needleSpeed * 1.03);
    this.newZone();
  }

  private knock(standing: Character[], pirates: Character[], text: string) {
    const target = standing.length ? choose(standing) : null;
    const attacker = choose(pirates);
    attacker.trigger('fire', 0.35);
    if (target) {
      target.trigger('hit', 0.5);
      this.game.ui.comicText(target.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 3, 0)), text, 'good');
      this.game.particles.sparkle(target.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2.4, 0)));
    }
  }

  private feedback(text: string, _kind: string) {
    this.view.result = text;
    this.view.resultT = 0.9;
  }

  private win(e: AIShip) {
    const g = this.game;
    this.phase = 'victory';
    this.t = 0;
    g.ui.showBoarding(false);
    for (const f of this.foes) {
      f.play('dizzy');
      f.express('hurt');
    }
    for (const j of this.jumpers) {
      j.c.play(j.c === g.player.captain ? 'victory' : 'cheer');
      j.c.express('happy');
    }
    e.setFlag(g.player.flagKind);
    const deck = e.model.group.localToWorld(new THREE.Vector3(0, e.model.deckYAt(0) + 2, 0));
    g.particles.confettiBurst(deck, 90);
    g.particles.coins(deck, 30);
    audio.play('fanfare');
    audio.playVoice('yay', deck, 1.0);
    g.camRig.addShake(0.3);
    // orbit-ish hero shot
    const right = new THREE.Vector3(Math.cos(e.heading), 0, -Math.sin(e.heading));
    const fwd = new THREE.Vector3(Math.sin(e.heading), 0, Math.cos(e.heading));
    g.camRig.setCinematic(
      e.pos.clone().addScaledVector(right, this.side * (20 + e.model.length * 0.3)).addScaledVector(fwd, e.model.length * 0.5).add(new THREE.Vector3(0, 9 + e.model.length * 0.2, 0)),
      deck.clone().setY(deck.y - 0.5),
      1.6,
    );
    g.onCapture(e);
  }

  private lose() {
    const g = this.game;
    this.phase = 'defeat';
    this.t = 0;
    g.ui.showBoarding(false);
    g.ui.banner('BOARDING FAILED', 'They drove your crew back! Hire more pirates or sail a bigger ship.', [], 'bad');
    audio.play('error');
    for (const f of this.foes) {
      if (f.state !== 'dizzy') f.play('victory');
    }
    for (const j of this.jumpers) j.c.play('board');
    // capture the jump origins for the trip home
    for (const j of this.jumpers) {
      j.to = j.c.root.getWorldPosition(new THREE.Vector3());
      g.scene.attach(j.c.root);
    }
    const e = this.enemy;
    e.disabled = false;
    e.boarded = false;
    e.hp = Math.max(e.hp, e.maxHp * 0.45);
    e.setFlag(e.baseFlag);
    e.model.sailUniforms.uFurl.value = 0;
    e.setState('flee');
  }

  private startReturn() {
    const g = this.game;
    for (const j of this.jumpers) {
      j.to = j.c.root.getWorldPosition(new THREE.Vector3());
      g.scene.attach(j.c.root);
      j.c.play('board');
    }
    audio.play('whoosh');
  }

  private finish() {
    const g = this.game;
    const p = g.player;
    for (const j of this.jumpers) {
      p.model.group.attach(j.c.root);
      j.c.root.position.copy(j.home);
      j.c.root.rotation.set(0, j.homeRot, 0);
      j.c.play(j.c === p.captain ? 'steer' : 'idle');
      if (j.c === p.captain) j.c.setProp('none');
    }
    for (const r of this.ropes) {
      r.removeFromParent();
      r.geometry.dispose();
    }
    this.ropes = [];
    const won = this.phase === 'return';
    if (won) this.enemy.markCaptured();
    this.active = false;
    p.controlsEnabled = true;
    p.speed = 2;
    g.camRig.follow(p.heading);
    g.ui.showBoarding(false);
    if (won) g.ui.showChoice(true);
  }
}
