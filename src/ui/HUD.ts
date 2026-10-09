import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { BoardingView } from '../game/Boarding';
import type { CannonSide } from '../models/ShipModel';
import { fmtMoney, clamp } from '../core/math';
import { xpForLevel, AMMO } from '../game/Data';
import { Minimap } from './Minimap';
import { audio } from '../core/Audio';

interface Floater {
  el: HTMLElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
  vy: number;
  jitter: number;
}

export interface WorldMarker {
  key: string;
  pos: THREE.Vector3;
  kind: 'alert' | 'board' | 'target' | 'targetCapt' | 'port' | 'help' | 'poi' | 'goal';
  text?: string;
  edge?: boolean;
}

/** DOM heads-up display: bars, money, minimap, target panel, prompts, floaters. */
export class HUD {
  root: HTMLElement;
  minimap: Minimap;
  private els: Record<string, HTMLElement> = {};
  private floaters: Floater[] = [];
  private markerEls = new Map<string, HTMLElement>();
  private cache: Record<string, string> = {};
  private lastMoney = -1;
  private v = new THREE.Vector3();
  private boardClick = false;
  private promptText: string | null = null;
  private mmT = 0;

  constructor(private game: Game) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.className = 'off';
    this.root.innerHTML = `
      <div class="hud-tl hud-el">
        <div class="portrait-wrap"><div class="portrait" id="portrait"></div><div class="lvl-badge">LV <span id="lvl">1</span></div></div>
        <div class="stats">
          <div class="bar-row"><span class="ico" id="hullIco">❤️</span><div class="bar"><div class="ghost" id="hullGhost"></div><div class="fill" id="hullFill"></div><span id="hullText">100 / 100</span></div></div>
          <div class="bar-row"><span class="ico">👥</span><div class="pill" id="crewText">6 / 6</div></div>
          <div class="xpbar"><div id="xpFill"></div></div>
        </div>
      </div>
      <div class="hud-tc hud-el">
        <div class="wanted" id="wanted">${'<span class="sk">💀</span>'.repeat(5)}</div>
        <div class="clock" id="clock">09:00 ☀️</div>
        <div class="zone-name" id="zone"></div>
      </div>
      <div class="hud-tr hud-el">
        <div class="res money" id="moneyBox"><span class="ri">💰</span><span id="money">$1,000</span></div>
        <div class="res" id="cargoBox"><span class="ri">📦</span><span><span id="cargo">0 / 24</span><small id="cargoVal">$0</small></span></div>
      </div>
      <div class="minimap-wrap hud-el"><canvas id="minimap" width="380" height="380"></canvas><div class="mm-n" id="mmN">N</div></div>
      <div class="mm-hint hud-el" id="mmHint">[M] World map</div>
      <div class="missions hud-el" id="missions"></div>
      <div class="target off" id="target">
        <div class="tn"><span id="tName">Ship</span><span class="status-tag" id="tStatus">SAILING</span></div>
        <div class="tt"><span id="tType">Type</span><span id="tDist">0m</span></div>
        <div class="bar"><div class="fill" id="tHp"></div><span id="tHpText">100</span></div>
        <div class="tinfo"><span>📦 <span id="tCargo">$0</span></span><span>👥 <span id="tCrew">0</span></span><span>💰 <span id="tCoffers">$0</span></span></div>
      </div>
      <div class="hud-bottom hud-el">
        <div class="boostbox"><div class="boostbar" id="boostBar"><div id="boostFill"></div></div><div class="bl">⚡ BOOST <small>[SHIFT]</small></div></div>
        <div class="guns">
          <div class="gun" id="gunL"><div class="cd"></div>💣<span class="lbl">LEFT</span></div>
          <div class="gun" id="gunF"><div class="cd"></div>🎯<span class="lbl">BOW</span></div>
          <div class="gun" id="gunR"><div class="cd"></div>💣<span class="lbl">RIGHT</span></div>
        </div>
        <div class="ammo"><span id="ammo">⚫ Round Shot</span> <kbd>Q</kbd></div>
        <div class="speedo">
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="rgba(22,18,40,.78)" stroke="#fff" stroke-width="5"/>
            <path d="M 24 88 A 46 46 0 1 1 96 88" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="9" stroke-linecap="round"/>
            <path id="spdArc" d="M 24 88 A 46 46 0 1 1 96 88" fill="none" stroke="url(#spdGrad)" stroke-width="9" stroke-linecap="round" stroke-dasharray="0 300"/>
            <defs><linearGradient id="spdGrad"><stop offset="0" stop-color="#7ef7ff"/><stop offset="1" stop-color="#ffcf3f"/></linearGradient></defs>
          </svg>
          <div class="val"><div><span id="spd">0</span><small>KNOTS</small></div></div>
        </div>
      </div>
      <div class="controls-hint hud-el" id="hint"></div>
      <div class="place" id="place"></div>
      <div class="speech talk hidden" id="talk"></div>
      <div class="prompt hidden" id="prompt"></div>
      <div class="toasts" id="toasts"></div>
      <div class="banner" id="banner"></div>
      <div id="markers"></div>
      <div id="floaters"></div>
      <div class="boarding hidden" id="boarding">
        <div class="bres" id="bRes"></div>
        <h2>⚔️ BOARDING! ⚔️</h2>
        <div class="vs">
          <div class="side"><div class="nm">🏴‍☠️ YOUR CREW <span class="cnt">👥 <b id="bP">0</b></span></div><small>BOARDING POWER</small><div class="bar pl"><div class="fill" id="bPf"></div></div></div>
          <div class="vsx">VS</div>
          <div class="side r"><div class="nm"><span class="cnt">👥 <b id="bE">0</b></span> ENEMY CREW ⚓</div><small>BOARDING POWER</small><div class="bar en"><div class="fill" id="bEf"></div></div></div>
        </div>
        <div class="bprog" id="bProgW"><div class="bp-fill" id="bProg"></div><div class="bp-flow" id="bFlow"></div><div class="bp-txt"><span>CAPTURE</span><b id="bPct">0%</b></div></div>
        <div class="bmsg" id="bMsg"></div>
        <div class="tbar" id="tbar"><div class="zone" id="bZone"></div><div class="perfect" id="bPerf"></div><div class="needle" id="bNeedle"></div></div>
        <div class="bhint">Press <b>SPACE</b> when the needle is in the <span style="color:#7ef08a">green</span> zone — <span style="color:#ffd23f">gold</span> = PERFECT!</div>
      </div>
      <div class="choice hidden" id="choice">
        <button class="btn green" id="chContinue">⛵ Continue Sailing</button>
        <button class="btn gold" id="chPort">⚓ Set Course for Port</button>
      </div>
      <div class="damage-flash" id="dmgFlash"></div>
    `;
    document.body.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.els[e.id] = e));
    this.minimap = new Minimap(game, this.els.minimap as HTMLCanvasElement);
    this.setHintMode('sea');
    this.els.boarding.addEventListener('mousedown', () => (this.boardClick = true));
    this.els.chContinue.addEventListener('click', () => {
      audio.play('click');
      this.showChoice(false);
      game.navTarget = null;
    });
    this.els.chPort.addEventListener('click', () => {
      audio.play('click');
      this.showChoice(false);
      game.setCourseHome();
    });
  }

  show(on: boolean) {
    this.root.classList.toggle('off', !on);
  }

  get portraitRect() {
    return this.els.portrait.getBoundingClientRect();
  }

  private set(id: string, text: string) {
    if (this.cache[id] === text) return;
    this.cache[id] = text;
    this.els[id].textContent = text;
  }

  // ---------------------------------------------------------------------
  update(dt: number) {
    const g = this.game;
    const p = g.player;
    const prof = g.profile;
    // hull
    const hpK = clamp(p.hp / p.maxHp, 0, 1);
    this.els.hullFill.style.width = `${hpK * 100}%`;
    this.els.hullGhost.style.width = `${hpK * 100}%`;
    this.set('hullText', `${Math.ceil(p.hp)} / ${p.maxHp}`);
    // on foot the captain has his own health bar: this one is the ship's hull
    this.set('hullIco', g.onLand ? '⛵' : '❤️');
    this.set('crewText', `${prof.crew} / ${g.maxCrew}`);
    this.els.crewText.classList.toggle('warn', prof.crew < g.maxCrew * 0.5);
    this.set('lvl', String(prof.level));
    const need = xpForLevel(prof.level);
    this.els.xpFill.style.width = `${clamp(prof.xp / need, 0, 1) * 100}%`;
    // money / cargo
    if (prof.money !== this.lastMoney) {
      if (this.lastMoney >= 0 && prof.money > this.lastMoney) {
        this.els.moneyBox.classList.remove('bump');
        void this.els.moneyBox.offsetWidth;
        this.els.moneyBox.classList.add('bump');
      }
      this.lastMoney = prof.money;
    }
    this.set('money', fmtMoney(g.displayMoney));
    this.set('cargo', `${g.cargoCount} / ${g.cargoCapacity}`);
    this.set('cargoVal', fmtMoney(g.cargoValue));
    // wanted
    const lvl = g.wanted.level;
    const sk = this.els.wanted.children;
    for (let i = 0; i < 5; i++) sk[i].classList.toggle('on', i < lvl);
    this.els.wanted.classList.toggle('active', lvl > 0);
    const icon = g.env.night > 0.5 ? '🌙' : ({ clear: '☀️', cloudy: '⛅', rain: '🌧️', storm: '⛈️', fog: '🌫️' } as Record<string, string>)[g.env.weather];
    this.set('clock', `${g.env.clockText()} ${g.env.danger > 0.3 ? '⛈️' : icon}`);
    this.set('zone', g.zoneLabel);
    // speed
    const spd = Math.abs(p.speed);
    this.set('spd', String(Math.round(spd)));
    const arcLen = 232;
    (this.els.spdArc as unknown as SVGPathElement).setAttribute('stroke-dasharray', `${(clamp(spd / (p.maxSpeed * 1.6), 0, 1) * arcLen).toFixed(1)} 300`);
    // boost
    this.els.boostFill.style.width = `${p.boost}%`;
    this.els.boostBar.classList.toggle('active', p.boosting);
    // guns
    const aimSide = g.aimSide;
    for (const s of ['L', 'F', 'R'] as CannonSide[]) {
      const el = this.els['gun' + s];
      const k = p.reloadT[s] / p.reloadTime;
      (el.firstElementChild as HTMLElement).style.setProperty('--p', `${clamp(k, 0, 1) * 100}%`);
      el.classList.toggle('ready', k <= 0);
      el.classList.toggle('aim', aimSide === s);
    }
    // ammo
    const am = AMMO[prof.ammoSel] ?? AMMO.round;
    this.set('ammo', `${am.icon} ${am.name}`);
    // missions
    this.renderMissions();
    this.els.mmN.style.transform = `rotate(${-(g.onLand ? this.minimap.mapAngle() : 0)}rad)`;
    // target
    this.renderTarget();
    // floaters + markers
    this.updateFloaters(dt);
    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 0.05;
      this.minimap.draw();
    }
  }

  private renderMissions() {
    const g = this.game;
    const cs = g.profile.contracts;
    const key = cs.map((c) => `${c.id}:${c.progress}`).join('|') + '#' + g.missions.active.map((m) => `${m.def.id}:${Math.floor(m.progress)}:${m.done}`).join('|');
    if (this.cache.missions === key) return;
    this.cache.missions = key;
    const contracts = cs
      .map((c) => {
        const icon = { deliver: '📦', transport: '🔒', capture: '⚔️', captureType: '🎯', treasure: '🗺️', rival: '🏴‍☠️', reach: '🧭' }[c.kind] ?? '📜';
        const prog = c.target > 1 && (c.kind === 'capture') ? ` · ${c.progress}/${c.target}` : '';
        return `<div class="mission contract"><div class="mt">${icon} ${c.title}</div><div class="md">${c.desc}${prog} · ${fmtMoney(c.money)}</div></div>`;
      })
      .join('');
    this.els.missions.innerHTML =
      (contracts ? '<h4>📌 CONTRACTS</h4>' + contracts : '') +
      '<h4>📜 GOALS</h4>' +
      g.missions.active
        .slice(0, cs.length >= 2 ? 1 : cs.length === 1 ? 2 : 3)
        .map((m) => {
          const pct = clamp(m.progress / m.def.target, 0, 1) * 100;
          const prog = m.def.kind === 'earn' || m.def.kind === 'cargoReturn' ? `${fmtMoney(Math.min(m.progress, m.def.target))} / ${fmtMoney(m.def.target)}` : m.def.kind === 'survive' ? `${Math.min(m.progress, m.def.target)}s / ${m.def.target}s` : `${Math.min(m.progress, m.def.target)} / ${m.def.target}`;
          return `<div class="mission ${m.done ? 'done' : ''}"><div class="mt">${m.done ? '✅ ' : ''}${m.def.title}</div><div class="md">${m.def.desc} · ${prog}</div><div class="mp"><div style="width:${pct}%"></div></div></div>`;
        })
        .join('');
  }

  private renderTarget() {
    const g = this.game;
    const t = g.player.target;
    const el = this.els.target;
    if (!t || !t.alive || g.boarding.active || g.inPort) {
      el.classList.add('off');
      return;
    }
    el.classList.remove('off');
    this.set('tName', t.name);
    this.set('tType', t.typeLabel);
    this.set('tDist', `${Math.round(t.pos.distanceTo(g.player.pos))} m`);
    const k = clamp(t.hp / t.maxHp, 0, 1);
    this.els.tHp.style.width = `${k * 100}%`;
    this.set('tHpText', `${Math.ceil(t.hp)} / ${t.maxHp}`);
    this.set('tCargo', fmtMoney(t.cargoValue));
    this.set('tCrew', String(t.crewCount));
    this.set('tCoffers', fmtMoney(t.coffers));
    let status = 'SAILING';
    let cls = '';
    if (t.team === 'navy') {
      status = t.state === 'patrol' ? 'PATROLLING' : t.state === 'leave' ? 'RETREATING' : 'HOSTILE';
      cls = t.state === 'patrol' ? 'navy' : 'fight';
    } else if (t.captured) {
      status = 'CAPTURED';
      cls = 'disabled';
    } else if (t.disabled) {
      status = 'SURRENDERED — BOARD!';
      cls = 'disabled';
    } else if (t.state === 'flee') {
      status = 'FLEEING';
      cls = 'flee';
    } else if (t.state === 'fight') {
      status = 'FIGHTING BACK';
      cls = 'fight';
    }
    this.set('tStatus', status);
    this.els.tStatus.className = 'status-tag ' + cls;
  }

  // ---------------------------------------------------------------------
  private viewW = 0;
  private viewH = 0;
  private viewAt = -1;
  private project(pos: THREE.Vector3) {
    const cam = this.game.camRig.camera;
    this.v.copy(pos).project(cam);
    const behind = this.v.z > 1;
    // read the canvas size once per frame (reading layout per marker can force a reflow)
    if (this.viewAt !== this.game.time) {
      const c = this.game.renderer.domElement;
      this.viewW = c.clientWidth || innerWidth;
      this.viewH = c.clientHeight || innerHeight;
      this.viewAt = this.game.time;
    }
    return { x: (this.v.x * 0.5 + 0.5) * this.viewW, y: (-this.v.y * 0.5 + 0.5) * this.viewH, behind };
  }

  private spawnFloater(pos: THREE.Vector3, html: string, cls: string, life = 1.1, vy = 60) {
    const el = document.createElement('div');
    el.className = 'floater ' + cls;
    el.innerHTML = html;
    this.els.floaters.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0, life, vy, jitter: (Math.random() - 0.5) * 40 });
    if (this.floaters.length > 40) {
      const f = this.floaters.shift()!;
      f.el.remove();
    }
  }

  damageNumber(pos: THREE.Vector3, amount: number, kind: 'player' | 'enemy') {
    this.spawnFloater(pos.clone().add(new THREE.Vector3(0, 2, 0)), `-${amount}`, `dmg ${kind} ${amount >= 25 ? 'big' : ''}`, 1.0, 80);
  }

  comicText(pos: THREE.Vector3, text: string, kind: 'good' | 'bad') {
    this.spawnFloater(pos, text, `comic ${kind === 'bad' ? 'bad' : ''}`, 0.9, 30);
  }

  /** Land-combat numbers and callouts (damage, BLOCKED, PARRY!, pickups). */
  combatText(pos: THREE.Vector3, text: string, cls: string) {
    this.spawnFloater(pos, text, `cf ${cls}`, cls === 'crit' || cls === 'parry' || cls === 'big' ? 1.0 : 0.8, cls === 'pickup' || cls === 'heal' ? 40 : 55);
  }

  coinText(pos: THREE.Vector3, text: string) {
    this.spawnFloater(pos, text, 'coinpop', 1.6, 50);
  }

  private updateFloaters(dt: number) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t > f.life) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const s = this.project(f.pos);
      const k = f.t / f.life;
      const pop = k < 0.15 ? 0.4 + (k / 0.15) * 0.9 : k < 0.3 ? 1.3 - ((k - 0.15) / 0.15) * 0.3 : 1;
      const op = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      f.el.style.opacity = s.behind ? '0' : String(op);
      f.el.style.transform = `translate(${s.x + f.jitter * k}px, ${s.y - f.vy * k * 1.5}px) translate(-50%, -50%) scale(${pop})`;
    }
  }

  /** Update world-space markers from a list built by the game each frame. */
  markers(list: WorldMarker[]) {
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.key);
      let el = this.markerEls.get(m.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'marker';
        el.innerHTML = `<div class="mk"></div>`;
        this.els.markers.appendChild(el);
        this.markerEls.set(m.key, el);
      }
      const inner = el.firstElementChild as HTMLElement;
      const cls =
        m.kind === 'alert'
          ? 'mk mk-alert'
          : m.kind === 'board'
            ? 'mk mk-board'
            : m.kind === 'target'
              ? 'mk mk-target'
              : m.kind === 'targetCapt'
                ? 'mk mk-target capt'
                : m.kind === 'help'
                  ? 'mk mk-help'
                  : m.kind === 'poi'
                    ? 'mk mk-poi'
                    : m.kind === 'goal'
                      ? 'mk mk-goal'
                      : 'mk mk-port';
      if (inner.className !== cls) inner.className = cls;
      const txt = m.kind === 'alert' ? '!' : m.kind === 'board' ? '⚔️ BOARD [E]' : m.kind === 'help' ? '📯' : m.text ?? '';
      if (inner.textContent !== txt) inner.textContent = txt;
      let s = this.project(m.pos);
      if (m.edge) {
        // clamp to screen edge when off-screen
        const margin = 50;
        let x = s.x;
        let y = s.y;
        if (s.behind) {
          x = innerWidth - x;
          y = innerHeight - margin;
        }
        const off = x < margin || x > innerWidth - margin || y < margin || y > innerHeight - margin || s.behind;
        x = clamp(x, margin, innerWidth - margin);
        y = clamp(y, margin + 60, innerHeight - margin - 120);
        s = { x, y, behind: false };
        if (off && (m.kind === 'port' || m.kind === 'goal')) inner.textContent = `${m.kind === 'goal' ? '⭐' : '⚓'} ${m.text ?? ''} ➜`;
      }
      el.style.display = s.behind ? 'none' : 'block';
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
    for (const [k, el] of this.markerEls) {
      if (!seen.has(k)) {
        el.remove();
        this.markerEls.delete(k);
      }
    }
  }

  prompt(text: string | null, style: '' | 'blue' | 'red' = '') {
    const key = text ? text + style : null;
    if (key === this.promptText) return;
    this.promptText = key;
    const el = this.els.prompt;
    if (!text) {
      el.classList.add('hidden');
      return;
    }
    el.className = 'prompt ' + style;
    el.innerHTML = text;
  }

  toast(title: string, sub: string, kind: 'danger' | 'good' | 'mission' | 'info' = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<div class="t1">${title}</div>${sub ? `<div class="t2">${sub}</div>` : ''}`;
    this.els.toasts.appendChild(el);
    setTimeout(() => el.remove(), 3900);
    while (this.els.toasts.children.length > 3) this.els.toasts.firstElementChild!.remove();
  }

  banner(title: string, sub: string, rewards: { text: string; gold?: boolean }[], kind: '' | 'bad' = '', duration = 3.6) {
    const el = this.els.banner;
    el.className = 'banner ' + kind;
    el.innerHTML = `<div class="bt">${title}</div><div class="bs">${sub}</div><div class="rewards">${rewards
      .map((r, i) => `<div class="reward ${r.gold ? 'gold' : ''}" style="animation-delay:${0.25 + i * 0.12}s">${r.text}</div>`)
      .join('')}</div>`;
    clearTimeout((el as unknown as { _t: number })._t);
    (el as unknown as { _t: number })._t = window.setTimeout(() => (el.innerHTML = ''), duration * 1000);
  }

  flashDamage() {
    const el = this.els.dmgFlash;
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 80);
    this.els.portrait.classList.remove('hurt');
    void this.els.portrait.offsetWidth;
    this.els.portrait.classList.add('hurt');
  }

  onFire(side: CannonSide) {
    const el = this.els['gun' + (side === 'B' ? 'F' : side)];
    el.classList.remove('fired');
    void el.offsetWidth;
    el.classList.add('fired');
  }

  showBoarding(on: boolean) {
    this.cache.bDir = '';
    this.els.boarding.classList.toggle('hidden', !on);
    this.root.classList.toggle('is-boarding', on);
    this.els.hint.classList.toggle('hidden', on);
  }

  consumeBoardClick() {
    const c = this.boardClick;
    this.boardClick = false;
    return c;
  }

  updateBoarding(v: BoardingView) {
    if (v.phase !== 'brawl') return;
    this.set('bP', String(v.playerCrew));
    this.set('bE', String(v.enemyCrew));
    // power bars: the stronger side fills its bar
    const top = Math.max(v.playerPower, v.enemyPower, 1e-6);
    this.els.bPf.style.width = `${(v.playerPower / top) * 100}%`;
    this.els.bEf.style.width = `${(v.enemyPower / top) * 100}%`;
    this.els.bProg.style.width = `${clamp(v.shown, 0, 1) * 100}%`;
    this.set('bPct', `${Math.round(clamp(v.shown, 0, 1) * 100)}%`);
    const dir = v.rate < -0.05 ? 'back' : v.rate > 0.05 ? 'fwd' : 'hold';
    const mood = v.rate < 0 || v.adv < -0.05 ? 'bad' : v.adv > 0.12 ? 'good' : 'even';
    if (this.cache.bDir !== dir + mood) {
      this.cache.bDir = dir + mood;
      this.els.bProgW.dataset.dir = dir;
      this.els.bMsg.dataset.mood = mood;
      this.els.bMsg.textContent = mood === 'bad' ? '⚠️ They are pushing back!' : mood === 'good' ? '💪 Your crew has the advantage!' : '⚖️ Evenly matched – time your strikes!';
    }
    this.els.bFlow.style.animationDuration = `${clamp(1.6 / Math.max(0.2, Math.abs(v.rate)), 0.5, 4)}s`;
    this.els.bZone.style.left = `${(v.zoneC - v.zoneW / 2) * 100}%`;
    this.els.bZone.style.width = `${v.zoneW * 100}%`;
    this.els.bPerf.style.left = `${(v.zoneC - v.perfectW / 2) * 100}%`;
    this.els.bPerf.style.width = `${v.perfectW * 100}%`;
    this.els.bNeedle.style.left = `${v.needle * 100}%`;
    this.set('bRes', v.result);
    this.els.bRes.style.opacity = v.resultT > 0 ? '1' : '0';
  }

  showChoice(on: boolean) {
    this.els.choice.classList.toggle('hidden', !on);
    if (on) setTimeout(() => this.showChoice(false), 9000);
  }

  setHintVisible(on: boolean) {
    this.els.hint.classList.toggle('hidden', !on);
  }

  /** Controls reminder for sailing vs walking. */
  setHintMode(mode: 'sea' | 'land') {
    if (this.cache.hintMode === mode) return;
    this.cache.hintMode = mode;
    this.els.hint.innerHTML =
      mode === 'sea'
        ? `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> sail &nbsp; <kbd>SPACE</kbd> fire &nbsp; <kbd>Q</kbd> ammo<br/><kbd>SHIFT</kbd> boost &nbsp; <kbd>E</kbd> dock &nbsp; <kbd>TAB</kbd> items &nbsp; <kbd>M</kbd> map &nbsp; <kbd>Esc</kbd> pause`
        : `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp; <kbd>SHIFT</kbd> run &nbsp; <kbd>SPACE</kbd> jump &nbsp; <kbd>E</kbd> interact &nbsp; <kbd>X</kbd> draw weapon<br/><kbd>Drag</kbd> look &nbsp; <kbd>Wheel</kbd> zoom &nbsp; <kbd>TAB</kbd> inventory &nbsp; <kbd>M</kbd> map &nbsp; <kbd>Esc</kbd> pause`;
    this.els.mmHint.textContent = mode === 'sea' ? '[M] World map' : '[M] Map';
  }

  /** Big location title when arriving somewhere ("SKULL COVE · Pirate haven"). */
  place(title: string, sub: string) {
    const el = this.els.place;
    el.innerHTML = `<b>${title}</b><span>${sub}</span>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout((el as unknown as { _t: number })._t);
    (el as unknown as { _t: number })._t = window.setTimeout(() => el.classList.remove('show'), 3700);
  }

  /** NPC speech bubble anchored over a head in the world. */
  showTalk(name: string, text: string, more: boolean) {
    const el = this.els.talk;
    el.innerHTML = `<b>${name}</b>${text}<i>${more ? '▶ E' : '✕ E'}</i>`;
    el.classList.remove('hidden');
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
  moveTalk(pos: THREE.Vector3) {
    const s = this.project(pos);
    this.els.talk.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    this.els.talk.style.opacity = s.behind ? '0' : '1';
  }
  hideTalk() {
    this.els.talk.classList.add('hidden');
  }
}
