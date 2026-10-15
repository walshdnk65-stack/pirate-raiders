import { audio } from '../core/Audio';
import { rekey } from '../game/Settings';
import { SettingsUI, type SettingsHandlers } from './SettingsUI';

const CONTROLS = `
  <div class="keys-cols">
  <div class="keys">
    <div class="kh">⛵ AT SEA</div><div></div>
    <div><kbd>W</kbd><kbd>S</kbd></div><div>Sail / slow down</div>
    <div><kbd>A</kbd><kbd>D</kbd></div><div>Turn left / right</div>
    <div><kbd>SPACE</kbd></div><div>Fire cannons</div>
    <div><kbd>Q</kbd></div><div>Switch ammo</div>
    <div><kbd>SHIFT</kbd></div><div>Speed boost</div>
    <div><kbd>E</kbd></div><div>Board ships · Dock at a port · Dig treasure</div>
    <div><kbd>R</kbd></div><div>Raid a port (near its harbour)</div>
  </div>
  <div class="keys">
    <div class="kh">🚶 ON LAND</div><div></div>
    <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div><div>Walk</div>
    <div><kbd>SHIFT</kbd></div><div>Run</div>
    <div><kbd>SPACE</kbd></div><div>Jump</div>
    <div><kbd>E</kbd></div><div>Talk · Shop · Board your ship</div>
    <div><kbd>I</kbd></div><div>Inventory (also <kbd>TAB</kbd>)</div>
    <div><kbd>M</kbd></div><div>Map · <kbd>Esc</kbd> Pause</div>
  </div>
  <div class="keys">
    <div class="kh">⚔️ FIGHTING</div><div></div>
    <div><kbd>LMB</kbd></div><div>Attack (hold: heavy)</div>
    <div><kbd>RMB</kbd></div><div>Block · aim a gun</div>
    <div><kbd>SPACE</kbd></div><div>Dodge-roll</div>
    <div><kbd>Q</kbd></div><div>Lock on (also <kbd>TAB</kbd>)</div>
    <div><kbd>1</kbd><kbd>2</kbd></div><div>Blade / gun · <kbd>R</kbd> reload</div>
    <div><kbd>X</kbd></div><div>Draw / put away</div>
  </div>
  </div>`;

export interface ScreenHandlers extends SettingsHandlers {
  onPlay: (fresh: boolean) => void;
  onResume: () => void;
  onRespawn: () => void;
  onCloseMap: () => void;
}

export class Screens {
  title: HTMLElement;
  pause: HTMLElement;
  over: HTMLElement;
  loading: HTMLElement;
  bigmap: HTMLElement;
  bigmapCanvas: HTMLCanvasElement;
  settings: SettingsUI;

  constructor(private h: ScreenHandlers, hasSave: boolean) {
    this.loading = this.el(`<div class="screen dim"><div class="title-logo"><div class="skull">🏴‍☠️</div><div class="l1">PIRATE<br/><span>RAIDERS</span></div></div><div class="loading" id="loadText">Charting the seas…</div></div>`);

    this.title = this.el(`<div class="screen hidden">
      <div class="title-logo"><div class="skull">🏴‍☠️</div><div class="l1">PIRATE<br/><span>RAIDERS</span></div><div class="tag">Plunder the seas · Capture ships · Become a legend</div></div>
      <div class="menu-col">
        <button class="btn gold" id="playBtn">${hasSave ? '⛵ CONTINUE' : '⛵ SET SAIL!'}</button>
        ${hasSave ? '<button class="btn small red" id="newBtn">New Game</button>' : ''}
        <button class="btn small" id="setBtn">⚙️ Settings</button>
        <button class="btn small" id="helpBtn">Controls</button>
      </div>
      <div class="credits">Made with Three.js · All models, music & sounds generated procedurally</div>
    </div>`);

    this.pause = this.el(`<div class="screen dim hidden"><div class="panel pause-panel">
      <h2>⏸ Paused</h2>
      <div class="menu-col">
        <button class="btn green" id="resumeBtn">▶ Resume</button>
        <button class="btn" id="pSetBtn">⚙️ Settings</button>
        <button class="btn" id="pHelpBtn">🧭 Controls</button>
      </div>
    </div></div>`);

    this.over = this.el(`<div class="screen dim hidden"><div class="panel" style="text-align:center">
      <h2>☠️ Sunk! ☠️</h2>
      <p style="font-weight:900;font-size:18px">Your ship went down to Davy Jones' locker.<br/>The crew dragged you back to port…</p>
      <p style="font-weight:900;color:#ff9a9a" id="overLoss"></p>
      <button class="btn gold" id="respawnBtn">⚓ Back to port</button>
    </div></div>`);

    this.bigmap = this.el(`<div class="bigmap hidden"><canvas width="1024" height="1024"></canvas><button class="btn small close" id="mapClose">✕ Close [M]</button></div>`);
    this.bigmapCanvas = this.bigmap.querySelector('canvas')!;

    const q = (id: string) => document.getElementById(id)!;
    q('playBtn').addEventListener('click', () => {
      audio.init();
      audio.play('click');
      this.h.onPlay(false);
    });
    q('newBtn')?.addEventListener('click', () => {
      if (!confirm('Start a new game? Your saved progress will be lost.')) return;
      audio.init();
      audio.play('click');
      this.h.onPlay(true);
    });
    this.settings = new SettingsUI(h);
    const showControls = () => {
      audio.init();
      audio.play('click');
      const p = this.el(`<div class="screen dim"><div class="panel"><h2>🧭 Controls</h2>${rekey(CONTROLS)}<div style="text-align:center;margin-top:16px"><button class="btn green">Got it!</button></div></div></div>`);
      p.querySelector('button')!.addEventListener('click', () => p.remove());
    };
    const showSettings = () => {
      audio.init();
      audio.play('click');
      this.settings.show();
    };
    q('helpBtn').addEventListener('click', showControls);
    q('pHelpBtn').addEventListener('click', showControls);
    q('setBtn').addEventListener('click', showSettings);
    q('pSetBtn').addEventListener('click', showSettings);
    q('resumeBtn').addEventListener('click', () => {
      audio.play('click');
      this.h.onResume();
    });
    q('respawnBtn').addEventListener('click', () => {
      audio.play('click');
      this.h.onRespawn();
    });
    // go through the game so it knows the map is closed (otherwise you can't walk until you press M)
    q('mapClose').addEventListener('click', () => this.h.onCloseMap());
  }

  private el(html: string) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    const e = d.firstElementChild as HTMLElement;
    document.body.appendChild(e);
    return e;
  }

  setLoading(text: string) {
    const t = document.getElementById('loadText');
    if (t) t.textContent = text;
  }

  showTitle() {
    this.loading.remove();
    this.title.classList.remove('hidden');
  }
}
