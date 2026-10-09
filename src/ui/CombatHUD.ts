import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Combat } from '../game/combat/Combat';
import type { Enemy } from '../game/combat/Enemy';
import type { Fighter } from '../game/combat/Fighter';
import { RARITIES, EFFECTS } from '../game/combat/Weapons';
import { clamp } from '../core/math';
import { audio } from '../core/Audio';

interface Bar {
  el: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  mark: HTMLElement;
  used: boolean;
}

/**
 * On-foot combat HUD: the captain's health & stamina, the weapon in hand (combo pips, ammo,
 * reload), the locked/last-hit foe, health bars over engaged enemies, the lock-on reticle,
 * a pistol crosshair, the boss bar and the defeat screen.
 */
export class CombatHUD {
  root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private bars: Bar[] = [];
  private v = new THREE.Vector3();
  private cache: Record<string, string> = {};
  private boss: Enemy | null = null;
  private lastHit: { f: Fighter; t: number } | null = null;
  private staminaFlash = 0;
  defeatShown = false;
  private hpShown = 1;

  constructor(
    private game: Game,
    private combat: Combat,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'cbt';
    this.root.className = 'cbt off';
    this.root.innerHTML = `
      <div class="cbt-me">
        <div class="cbt-row"><span class="ci">❤️</span><div class="cbt-bar hp"><div class="ghost" id="cHpG"></div><div class="fill" id="cHp"></div><span id="cHpT">100 / 100</span></div></div>
        <div class="cbt-row"><span class="ci">⚡</span><div class="cbt-bar st" id="cStW"><div class="fill" id="cSt"></div></div></div>
      </div>
      <div class="cbt-weapon" id="cWpn">
        <div class="cw-ico" id="cWIco">🗡️</div>
        <div class="cw-info">
          <b id="cWName">Cutlass</b>
          <div class="cw-sub" id="cWSub"></div>
          <div class="cw-cd"><div id="cWCd"></div></div>
        </div>
        <div class="cw-keys"><kbd>1</kbd><kbd>2</kbd></div>
      </div>
      <div class="cbt-keys" id="cKeys"><b>LMB</b> attack · hold = heavy &nbsp; <b>RMB</b> block/aim &nbsp; <b>SPACE</b> roll &nbsp; <b>TAB/Q</b> lock-on &nbsp; <b>X</b> sheathe</div>
      <div class="cbt-target hidden" id="cTgt"><div class="ct-n"><span id="cTName">Pirate</span><small id="cTLvl">Lv 1</small></div><div class="cbt-bar en"><div class="ghost" id="cTHpG"></div><div class="fill" id="cTHp"></div></div></div>
      <div class="cbt-boss hidden" id="cBoss"><div class="cb-n"><span id="cBName">Boss</span><small id="cBTitle"></small></div><div class="cbt-bar boss"><div class="ghost" id="cBHpG"></div><div class="fill" id="cBHp"></div><i class="ph" style="left:65%"></i><i class="ph" style="left:33%"></i></div></div>
      <div class="cbt-bars" id="cBars"></div>
      <div class="cbt-lock hidden" id="cLock"></div>
      <div class="cbt-cross hidden" id="cCross"></div>
      <div class="cbt-defeat hidden" id="cDefeat">
        <div class="cd-box">
          <div class="cd-skull">💀</div>
          <h1>DEFEATED</h1>
          <p id="cDMsg">You were knocked out cold.</p>
          <div class="cd-btns"><button class="btn gold" id="cRetry">⚔️ RETRY</button><button class="btn" id="cPort">⚓ RETURN TO PORT</button></div>
          <small>Your ship, cargo, weapons and level are safe.</small>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.els[e.id] = e));
    this.els.cRetry.addEventListener('click', () => {
      audio.play('click');
      this.combat.retry();
    });
    this.els.cPort.addEventListener('click', () => {
      audio.play('click');
      this.game.combatReturnToPort();
    });
  }

  private set(id: string, text: string) {
    if (this.cache[id] === text) return;
    this.cache[id] = text;
    this.els[id].textContent = text;
  }
  private html(id: string, html: string) {
    if (this.cache[id] === html) return;
    this.cache[id] = html;
    this.els[id].innerHTML = html;
  }

  private viewW = 0;
  private viewH = 0;
  private project(p: THREE.Vector3) {
    const cam = this.game.camRig.camera;
    this.v.copy(p).project(cam);
    return { x: (this.v.x * 0.5 + 0.5) * this.viewW, y: (-this.v.y * 0.5 + 0.5) * this.viewH, behind: this.v.z > 1 };
  }

  setBoss(e: Enemy | null) {
    this.boss = e;
    this.els.cBoss.classList.toggle('hidden', !e);
    if (e) {
      this.set('cBName', e.type.name.toUpperCase());
      this.set('cBTitle', e.type.boss?.title ?? '');
    }
  }

  flashStamina() {
    this.staminaFlash = 0.5;
  }

  showDefeat(island: boolean) {
    this.defeatShown = true;
    this.els.cDefeat.classList.remove('hidden');
    this.els.cPort.textContent = '⚓ RETURN TO PORT';
    this.set('cDMsg', island ? 'You were knocked out cold. Your crew can row you back to port, or you can pick yourself up and try again.' : 'You were knocked out cold. A kindly innkeeper can patch you up, or you can try again.');
    audio.play('sink', { volume: 0.4 });
  }

  hideDefeat() {
    this.defeatShown = false;
    this.els.cDefeat.classList.add('hidden');
  }

  update(dt: number) {
    const c = this.combat;
    const g = this.game;
    const f = c.player;
    const show = c.active && g.onLand && g.state !== 'shop' && g.state !== 'dialogue';
    this.root.classList.toggle('off', !show);
    if (!show) {
      this.els.cLock.classList.add('hidden');
      this.els.cCross.classList.add('hidden');
      for (const b of this.bars) b.el.style.display = 'none';
      return;
    }
    // read the canvas size once a frame (reading layout per bar forces reflows)
    const cv = g.renderer.domElement;
    this.viewW = cv.clientWidth || innerWidth;
    this.viewH = cv.clientHeight || innerHeight;
    const calm = !f.drawn && f.hp >= f.maxHp && !c.engaged;
    this.root.classList.toggle('calm', calm);
    this.root.classList.toggle('fight', f.drawn);

    // ---- captain ----
    const hpK = clamp(f.hp / f.maxHp, 0, 1);
    this.hpShown += (hpK - this.hpShown) * Math.min(1, dt * 2.5);
    if (this.hpShown < hpK) this.hpShown = hpK;
    this.els.cHp.style.width = `${hpK * 100}%`;
    this.els.cHpG.style.width = `${this.hpShown * 100}%`;
    this.set('cHpT', `${Math.ceil(f.hp)} / ${f.maxHp}`);
    this.els.cHp.parentElement!.classList.toggle('low', hpK < 0.3);
    this.els.cSt.style.width = `${clamp(f.stamina / f.maxStamina, 0, 1) * 100}%`;
    this.staminaFlash -= dt;
    this.els.cStW.classList.toggle('flash', this.staminaFlash > 0);
    this.els.cStW.classList.toggle('tired', f.staminaWait > 0 && f.stamina < 25);

    // ---- weapon ----
    const w = f.weapon;
    if (w) {
      this.set('cWIco', w.base.icon);
      this.html('cWName', `<span style="color:${w.color}">${w.name}</span>`);
      let sub = `${RARITIES[w.item.rarity].name}${w.item.level ? ` +${w.item.level}` : ''}${w.effect ? ` · ${EFFECTS[w.effect].icon} ${EFFECTS[w.effect].name}` : ''}`;
      let cd = 0;
      if (w.kind === 'ranged') {
        const pips = '●'.repeat(Math.max(0, f.loaded)) + '○'.repeat(Math.max(0, w.mag - f.loaded));
        sub = `<span class="rounds">${pips}</span> · 🎯 ${g.profile.shot} shot`;
        const a = f.action;
        if (a?.kind === 'reload') cd = 1 - f.progress;
        else if (f.gunCD > 0) cd = f.gunCD / Math.max(0.01, w.cooldown);
        this.els.cWpn.classList.toggle('empty', f.loaded <= 0);
      } else {
        const a = f.action;
        if (a?.kind === 'charge') cd = -Math.min(1, a.t / 0.7);
        else if (a && (a.kind === 'attack' || a.kind === 'heavy')) cd = 1 - f.progress;
        this.els.cWpn.classList.remove('empty');
      }
      this.html('cWSub', sub);
      const bar = this.els.cWCd;
      bar.style.width = `${Math.abs(cd) * 100}%`;
      bar.className = cd < 0 ? 'charge' : '';
    }

    // ---- target panel: locked foe, else the one you last hit ----
    let tgt: Fighter | null = c.lock && !c.lock.f.dead ? c.lock.f : null;
    if (!tgt) {
      for (const e of c.enemies) if (!e.f.dead && e.f.sinceCombat < 0.05 && e.f.hp < e.f.maxHp) this.lastHit = { f: e.f, t: 4 };
      if (this.lastHit) {
        this.lastHit.t -= dt;
        if (this.lastHit.t <= 0 || this.lastHit.f.dead) this.lastHit = null;
        else tgt = this.lastHit.f;
      }
    }
    const tgtEnemy = tgt ? c.enemies.find((e) => e.f === tgt) : undefined;
    const showT = !!tgt && tgtEnemy !== this.boss;
    this.els.cTgt.classList.toggle('hidden', !showT);
    if (tgt && showT) {
      this.set('cTName', tgt.name);
      this.set('cTLvl', tgtEnemy ? `Tier ${tgtEnemy.tier}` : '');
      const k = clamp(tgt.hp / tgt.maxHp, 0, 1);
      this.els.cTHp.style.width = `${k * 100}%`;
      this.els.cTHpG.style.width = `${k * 100}%`;
    }
    // ---- boss ----
    if (this.boss) {
      const b = this.boss.f;
      const k = clamp(b.hp / b.maxHp, 0, 1);
      this.els.cBHp.style.width = `${k * 100}%`;
      this.els.cBHpG.style.width = `${k * 100}%`;
      this.els.cBoss.classList.toggle('enraged', this.boss.enraged);
    }

    // ---- bars over heads ----
    let n = 0;
    const cam = g.camRig.camera.position;
    const head = this.v;
    const list: { f: Fighter; ally: boolean; tele: boolean }[] = [];
    for (const e of c.enemies) {
      if (e.f.dead || e.hidden || e === this.boss) continue;
      if (!(e.engaged || e.f.hp < e.f.maxHp)) continue;
      if (e.f.pos.distanceTo(cam) > 36) continue;
      list.push({ f: e.f, ally: false, tele: c.telegraphing(e.f) });
    }
    for (const a of c.allies) if (!a.f.dead && (a.f.hp < a.f.maxHp || a.escort) && a.f.pos.distanceTo(cam) < 36) list.push({ f: a.f, ally: true, tele: false });
    for (const it of list) {
      let b = this.bars[n];
      if (!b) {
        const el = document.createElement('div');
        el.className = 'cbt-hb';
        el.innerHTML = '<i class="mk">!</i><div class="g"></div><div class="f"></div>';
        this.els.cBars.appendChild(el);
        b = { el, mark: el.children[0] as HTMLElement, ghost: el.children[1] as HTMLElement, fill: el.children[2] as HTMLElement, used: true };
        this.bars.push(b);
      }
      n++;
      head.copy(it.f.pos).setY(it.f.pos.y + it.f.height + 0.35);
      const s = this.project(head);
      if (s.behind) {
        b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = 'block';
      b.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
      const k = clamp(it.f.hp / it.f.maxHp, 0, 1);
      b.fill.style.width = `${k * 100}%`;
      b.ghost.style.width = `${k * 100}%`;
      b.el.classList.toggle('ally', it.ally);
      b.el.classList.toggle('tele', it.tele);
      b.el.classList.toggle('locked', !!c.lock && c.lock.f === it.f);
    }
    for (let i = n; i < this.bars.length; i++) this.bars[i].el.style.display = 'none';

    // ---- lock-on reticle ----
    const lk = c.lock && !c.lock.f.dead ? c.lock.f : null;
    if (lk) {
      const s = this.project(lk.chest());
      this.els.cLock.classList.toggle('hidden', s.behind);
      this.els.cLock.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    } else this.els.cLock.classList.add('hidden');
    this.els.cCross.classList.toggle('hidden', !f.aiming);
  }
}
