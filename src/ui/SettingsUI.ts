import { audio } from '../core/Audio';
import { ACTIONS, settings, saveSettings, resetSettings, keyLabel, boundKey, type Difficulty, type BoardingStyle } from '../game/Settings';

export interface SettingsHandlers {
  getQuality: () => 'high' | 'medium' | 'low';
  onQuality: (q: 'high' | 'medium' | 'low') => void;
  /** key bindings (or anything that changes on-screen key hints) changed */
  onKeys: () => void;
}

/** Keys that stay fixed (menus, mouse-free fallbacks) and can't be bound to an action. */
const RESERVED = new Set(['Escape', 'Tab', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'MetaLeft', 'MetaRight', 'ContextMenu']);

/**
 * The settings screen: sound, graphics, camera, gameplay and key bindings. Opened from the
 * title screen and the pause menu; every change applies straight away and is saved.
 */
export class SettingsUI {
  el: HTMLElement;
  private listening: { code: string; btn: HTMLButtonElement } | null = null;
  private onClose: (() => void) | null = null;

  constructor(private h: SettingsHandlers) {
    const d = document.createElement('div');
    d.innerHTML = `<div class="screen dim hidden settings-screen"><div class="panel settings">
      <h2>⚙️ Settings</h2>
      <div class="set-tabs"><button class="on" data-tab="game">🎮 Game</button><button data-tab="keys">⌨️ Keys</button></div>
      <div class="set-body" data-body="game">
        <h3>🔊 Sound</h3>
        <label class="opt-row">Master volume <input type="range" min="0" max="1" step="0.05" data-k="master"></label>
        <label class="opt-row">🎵 Music <input type="range" min="0" max="1" step="0.05" data-k="music"></label>
        <label class="opt-row">💥 Effects <input type="range" min="0" max="1" step="0.05" data-k="sfx"></label>
        <h3>🖥️ Graphics</h3>
        <div class="opt-row">Quality <span class="seg" data-seg="quality"><button data-v="high">High</button><button data-v="medium">Medium</button><button data-v="low">Low</button></span></div>
        <h3>🎥 Camera</h3>
        <label class="opt-row">Mouse sensitivity <span class="rng"><input type="range" min="0.3" max="2.5" step="0.05" data-k="mouseSens"><output data-o="mouseSens"></output></span></label>
        <label class="opt-row">Invert vertical look <input type="checkbox" data-k="invertY"></label>
        <label class="opt-row">Screen shake <span class="rng"><input type="range" min="0" max="1.5" step="0.05" data-k="shake"><output data-o="shake"></output></span></label>
        <h3>⚔️ Gameplay</h3>
        <div class="opt-row">Difficulty <span class="seg" data-seg="difficulty"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></span></div>
        <div class="set-note" data-note="difficulty"></div>
        <div class="opt-row">Boarding ships <span class="seg" data-seg="boarding"><button data-v="fight">⚔️ Sword fight</button><button data-v="quick">⏱️ Quick</button></span></div>
        <div class="set-note" data-note="boarding"></div>
        <label class="opt-row">Damage numbers <input type="checkbox" data-k="damageNumbers"></label>
      </div>
      <div class="set-body hidden" data-body="keys">
        <div class="set-note">Click a key, then press the one you want. Keys swap if one is already used. <b>Esc</b>, <b>Tab</b> and the mouse stay as they are.</div>
        <div class="keylist"></div>
      </div>
      <div class="set-foot"><button class="btn small red" data-act="reset">Reset to defaults</button><button class="btn green" data-act="done">✔ Done</button></div>
    </div></div>`;
    this.el = d.firstElementChild as HTMLElement;
    document.body.appendChild(this.el);

    const $ = <T extends Element>(sel: string) => this.el.querySelector(sel) as T;
    // tabs
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.set-tabs button'))
      b.addEventListener('click', () => {
        audio.play('click');
        this.el.querySelectorAll('.set-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        this.el.querySelectorAll<HTMLElement>('.set-body').forEach((x) => x.classList.toggle('hidden', x.dataset.body !== b.dataset.tab));
        this.stopListening();
      });
    // sliders and checkboxes
    for (const inp of this.el.querySelectorAll<HTMLInputElement>('input[data-k]')) {
      const k = inp.dataset.k as keyof typeof settings;
      inp.addEventListener('input', () => {
        if (inp.type === 'checkbox') (settings as unknown as Record<string, unknown>)[k] = inp.checked;
        else (settings as unknown as Record<string, unknown>)[k] = Number(inp.value);
        if (k === 'master' || k === 'music' || k === 'sfx') this.applyAudio();
        if (k === 'shake' && inp.value !== '0') audio.play('tick');
        this.refreshOutputs();
        saveSettings();
      });
    }
    // segmented choices
    for (const seg of this.el.querySelectorAll<HTMLElement>('.seg')) {
      for (const b of seg.querySelectorAll<HTMLButtonElement>('button'))
        b.addEventListener('click', () => {
          audio.play('click');
          const v = b.dataset.v!;
          const what = seg.dataset.seg;
          if (what === 'quality') this.h.onQuality(v as 'high' | 'medium' | 'low');
          else if (what === 'difficulty') settings.difficulty = v as Difficulty;
          else if (what === 'boarding') settings.boarding = v as BoardingStyle;
          saveSettings();
          this.refresh();
        });
    }
    $<HTMLButtonElement>('[data-act="done"]').addEventListener('click', () => this.close());
    $<HTMLButtonElement>('[data-act="reset"]').addEventListener('click', () => {
      if (!confirm('Reset every setting (including key bindings) to its default?')) return;
      resetSettings();
      this.applyAudio();
      this.h.onKeys();
      this.refresh();
      audio.play('click');
    });
    // key capture runs before the game's own key handling so the pressed key doesn't leak into play
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.listening || this.el.classList.contains('hidden')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Escape') {
          this.stopListening();
          return;
        }
        if (RESERVED.has(e.code) || e.code === 'ShiftRight') {
          this.flash(this.listening.btn, `${keyLabel(e.code)} can't be used`);
          return;
        }
        this.bind(this.listening.code, e.code);
        this.stopListening();
      },
      true,
    );
    this.applyAudio();
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  show(onClose?: () => void) {
    this.onClose = onClose ?? null;
    this.el.classList.remove('hidden');
    this.refresh();
  }

  close() {
    this.stopListening();
    this.el.classList.add('hidden');
    audio.play('click');
    this.onClose?.();
    this.onClose = null;
  }

  /** Push the saved volumes into the audio engine. */
  applyAudio() {
    audio.volumes.master = settings.master;
    audio.volumes.music = settings.music;
    audio.volumes.sfx = settings.sfx;
    audio.applyVolumes();
  }

  private refreshOutputs() {
    for (const o of this.el.querySelectorAll<HTMLOutputElement>('output[data-o]')) {
      const v = (settings as unknown as Record<string, number>)[o.dataset.o!];
      o.textContent = o.dataset.o === 'shake' && v === 0 ? 'Off' : `${Math.round(v * 100)}%`;
    }
  }

  private refresh() {
    for (const inp of this.el.querySelectorAll<HTMLInputElement>('input[data-k]')) {
      const v = (settings as unknown as Record<string, unknown>)[inp.dataset.k!];
      if (inp.type === 'checkbox') inp.checked = !!v;
      else inp.value = String(v);
    }
    const segVal: Record<string, string> = { quality: this.h.getQuality(), difficulty: settings.difficulty, boarding: settings.boarding };
    for (const seg of this.el.querySelectorAll<HTMLElement>('.seg')) for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.v === segVal[seg.dataset.seg!]);
    const notes: Record<string, string> = {
      difficulty: { easy: 'Foes hit softer and go down faster, on land and at sea.', normal: 'The game as designed.', hard: 'Foes hit harder and take more beating.' }[settings.difficulty],
      boarding: settings.boarding === 'fight' ? 'Swing across and fight the defenders on their deck, with your crew beside you.' : 'The quick timing-bar brawl: tap at the right moment to push the defenders back.',
    };
    for (const n of this.el.querySelectorAll<HTMLElement>('[data-note]')) n.textContent = notes[n.dataset.note!] ?? '';
    this.refreshOutputs();
    this.renderKeys();
  }

  private renderKeys() {
    const list = this.el.querySelector('.keylist')!;
    list.innerHTML = '';
    let group = '';
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        const h = document.createElement('div');
        h.className = 'kgroup';
        h.textContent = { Move: 'Everywhere', Sea: 'At sea', Land: 'Fighting on foot', Menus: 'Menus' }[group] ?? group;
        list.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'krow';
      const changed = !!settings.keys[a.code];
      row.innerHTML = `<span>${a.label}</span><button class="kbtn${changed ? ' changed' : ''}">${keyLabel(boundKey(a.code))}</button>`;
      const btn = row.querySelector('button')!;
      btn.addEventListener('click', () => {
        audio.play('click');
        this.stopListening();
        this.listening = { code: a.code, btn };
        btn.classList.add('listen');
        btn.textContent = 'Press a key…';
      });
      list.appendChild(row);
    }
  }

  /** Bind an action to a key; whichever action had that key takes this one's old key. */
  private bind(code: string, phys: string) {
    const old = boundKey(code);
    if (old === phys) return;
    const other = ACTIONS.find((a) => a.code !== code && boundKey(a.code) === phys);
    const set = (c: string, k: string) => {
      if (k === c) delete settings.keys[c];
      else settings.keys[c] = k;
    };
    set(code, phys);
    if (other) set(other.code, old);
    saveSettings();
    this.h.onKeys();
    audio.play('coin', { volume: 0.4 });
    this.renderKeys();
  }

  private stopListening() {
    if (!this.listening) return;
    this.listening = null;
    this.renderKeys();
  }

  private flash(btn: HTMLButtonElement, text: string) {
    btn.textContent = text;
    audio.play('error', { volume: 0.4 });
  }
}
