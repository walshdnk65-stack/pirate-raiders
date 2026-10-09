import * as THREE from 'three';
import { clamp, rand, choose } from './math';

type SfxName =
  | 'cannon'
  | 'cannonFar'
  | 'splash'
  | 'impact'
  | 'reload'
  | 'creak'
  | 'boost'
  | 'coin'
  | 'click'
  | 'hover'
  | 'fanfare'
  | 'mission'
  | 'levelup'
  | 'whoosh'
  | 'bonk'
  | 'clang'
  | 'arr'
  | 'hey'
  | 'oof'
  | 'yay'
  | 'thunder'
  | 'bell'
  | 'sink'
  | 'alarm'
  | 'error'
  | 'cash'
  | 'hammer'
  | 'tick'
  | 'step'
  | 'treasure'
  // land combat
  | 'swing'
  | 'hitFlesh'
  | 'blockHit'
  | 'parry'
  | 'pistol'
  | 'blast'
  | 'dryFire'
  | 'thud'
  | 'roar'
  | 'slam';

/**
 * Fully procedural Web Audio engine: ambience beds, synthesized SFX and a
 * little sea-shanty sequencer. No audio files required.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  amb!: GainNode;
  private noise!: AudioBuffer;
  private ocean?: { gain: GainNode; filter: BiquadFilterNode };
  private wind?: { gain: GainNode; filter: BiquadFilterNode };
  private port?: { gain: GainNode };
  private rain?: { gain: GainNode };
  listener = new THREE.Vector3();
  listenerYaw = 0;
  volumes = { master: 0.8, music: 0.55, sfx: 0.9 };
  private creakTimer = 2;
  private musicState: 'sea' | 'port' | 'combat' | 'tavern' = 'sea';
  private seqStep = 0;
  private nextNoteTime = 0;
  private musicIntensity = 0;
  started = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.amb = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.amb.connect(this.master);
    this.applyVolumes();
    // white noise buffer
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
    this.nextNoteTime = ctx.currentTime + 0.2;
    this.started = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.music.gain.value = this.volumes.music * 0.5;
    this.sfx.gain.value = this.volumes.sfx;
    this.amb.gain.value = this.volumes.sfx * 0.8;
  }

  private noiseSrc(loop = false) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    if (!loop) s.playbackRate.value = rand(0.9, 1.1);
    return s;
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // ocean bed: brown-ish filtered noise with slow swells
    {
      const src = this.noiseSrc(true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 520;
      const g = ctx.createGain();
      g.gain.value = 0.22;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.1;
      lfo.connect(lfoG).connect(g.gain);
      src.connect(f).connect(g).connect(this.amb);
      src.start();
      lfo.start();
      this.ocean = { gain: g, filter: f };
    }
    // wind
    {
      const src = this.noiseSrc(true);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 700;
      f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0.03;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.23;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 220;
      lfo.connect(lfoG).connect(f.frequency);
      src.connect(f).connect(g).connect(this.amb);
      src.start();
      lfo.start();
      this.wind = { gain: g, filter: f };
    }
    // rain hiss
    {
      const src = this.noiseSrc(true);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 3000;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.amb);
      src.start();
      this.rain = { gain: g };
    }
    // port murmur (bandpassed noise "crowd")
    {
      const src = this.noiseSrc(true);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 450;
      f.Q.value = 2.5;
      const g = ctx.createGain();
      g.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3.1;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 140;
      lfo.connect(lfoG).connect(f.frequency);
      src.connect(f).connect(g).connect(this.amb);
      src.start();
      lfo.start();
      this.port = { gain: g };
    }
  }

  /** Per-frame ambience/music update. */
  update(dt: number, s: { speed: number; wind: number; rain: number; portProximity: number; combat: boolean; inPort: boolean; turning: number; tavern?: boolean }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.ocean!.gain.gain.setTargetAtTime(0.16 + s.speed * 0.006 + s.wind * 0.05, t, 0.5);
    this.ocean!.filter.frequency.setTargetAtTime(420 + s.speed * 18 + s.wind * 120, t, 0.5);
    this.wind!.gain.gain.setTargetAtTime(0.012 + s.speed * 0.0016 + (s.wind - 1) * 0.05, t, 0.5);
    this.rain!.gain.gain.setTargetAtTime(s.rain * 0.06, t, 0.8);
    this.port!.gain.gain.setTargetAtTime(s.portProximity * 0.05, t, 0.8);
    // wood creaks
    this.creakTimer -= dt * (1 + Math.abs(s.turning) * 2 + s.wind * 0.5);
    if (this.creakTimer <= 0) {
      this.creakTimer = rand(2.5, 6);
      this.play('creak', { volume: 0.35 + Math.abs(s.turning) * 0.3 });
    }
    // music
    const want = s.tavern ? 'tavern' : s.inPort ? 'port' : s.combat ? 'combat' : 'sea';
    this.musicState = want;
    this.musicIntensity += ((s.combat ? 1 : 0) - this.musicIntensity) * Math.min(1, dt * 0.8);
    this.scheduleMusic();
  }

  /** Positional gain/pan relative to listener. */
  private spatial(pos?: THREE.Vector3) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = clamp(1 / (1 + d / 40), 0, 1);
    // pan relative to camera facing
    const ang = Math.atan2(dx, dz) - this.listenerYaw;
    const pan = clamp(-Math.sin(ang), -1, 1) * 0.8;
    return { gain, pan };
  }

  private out(gain: number, pan: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    return g;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, a = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, a, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + a + dur + 0.05);
    return o;
  }

  private burst(dest: AudioNode, t: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, a = 0.003) {
    const ctx = this.ctx!;
    const s = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, a, peak, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, rand(0, 1));
    s.stop(t + a + dur + 0.05);
  }

  /** Cartoon "voice": a glottal sawtooth through two formant filters. */
  private voice(dest: AudioNode, t: number, f0: number, f1: number, dur: number, formants: [number, number], peak: number, rasp = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur);
    const mix = ctx.createGain();
    mix.gain.value = 1;
    for (const [i, fr] of formants.entries()) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fr;
      bp.Q.value = 6;
      const gg = ctx.createGain();
      gg.gain.value = i === 0 ? 1 : 0.6;
      o.connect(bp).connect(gg).connect(mix);
    }
    const g = ctx.createGain();
    this.env(g, t, 0.03, peak, dur);
    if (rasp > 0) {
      const am = ctx.createOscillator();
      am.frequency.value = 28;
      const amg = ctx.createGain();
      amg.gain.value = rasp;
      am.connect(amg).connect(g.gain);
      am.start(t);
      am.stop(t + dur + 0.1);
    }
    mix.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  play(name: SfxName, opts: { pos?: THREE.Vector3; volume?: number; pitch?: number; delay?: number } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const sp = this.spatial(opts.pos);
    const v = (opts.volume ?? 1) * sp.gain;
    if (v < 0.01) return;
    const pitch = opts.pitch ?? 1;
    const o = this.out(v, sp.pan);
    switch (name) {
      case 'cannon':
      case 'cannonFar': {
        const far = name === 'cannonFar';
        this.burst(o, t, far ? 1.2 : 0.9, far ? 0.7 : 1.0, 'lowpass', far ? 700 : 2400, 120, 0.7);
        this.tone(o, 'sine', 95 * pitch, 32, t, 0.55, 1.1);
        this.tone(o, 'triangle', 60 * pitch, 28, t, 0.7, 0.7);
        if (!far) this.burst(o, t + 0.02, 0.15, 0.6, 'highpass', 2500, 2500, 0.5);
        break;
      }
      case 'splash':
        this.burst(o, t, 0.5, 0.55, 'bandpass', 1800, 500, 0.9, 0.01);
        this.burst(o, t + 0.08, 0.6, 0.3, 'lowpass', 900, 200, 0.7, 0.02);
        this.tone(o, 'sine', 300, 80, t, 0.15, 0.25);
        break;
      case 'impact':
        this.tone(o, 'sine', 140 * pitch, 50, t, 0.25, 1.0);
        this.burst(o, t, 0.35, 0.9, 'bandpass', 900, 250, 1.5);
        for (let i = 0; i < 5; i++) this.burst(o, t + rand(0.02, 0.2), 0.04, 0.35, 'bandpass', rand(1500, 4000), undefined, 4);
        break;
      case 'reload':
        this.burst(o, t, 0.04, 0.4, 'bandpass', 2600, 2600, 6);
        this.burst(o, t + 0.12, 0.05, 0.5, 'bandpass', 1500, 1500, 6);
        this.tone(o, 'square', 220, 160, t + 0.12, 0.06, 0.08);
        this.tone(o, 'sine', 90, 60, t + 0.3, 0.12, 0.5);
        break;
      case 'creak': {
        const base = rand(90, 150);
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.linearRampToValueAtTime(base * rand(0.7, 1.4), t + 0.6);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = rand(500, 900);
        bp.Q.value = 9;
        const g = ctx.createGain();
        this.env(g, t, 0.15, 0.12, 0.6);
        const am = ctx.createOscillator();
        am.frequency.value = rand(14, 30);
        const amg = ctx.createGain();
        amg.gain.value = 0.06;
        am.connect(amg).connect(g.gain);
        osc.connect(bp).connect(g).connect(o);
        osc.start(t);
        osc.stop(t + 0.9);
        am.start(t);
        am.stop(t + 0.9);
        break;
      }
      case 'boost':
        this.burst(o, t, 0.7, 0.5, 'bandpass', 400, 2400, 1.2, 0.05);
        this.tone(o, 'sine', 200, 500, t, 0.4, 0.15);
        break;
      case 'whoosh':
        this.burst(o, t, 0.45, 0.6, 'bandpass', 300, 1800, 1.5, 0.08);
        break;
      case 'coin':
        this.tone(o, 'square', 988 * pitch, 988 * pitch, t, 0.06, 0.12);
        this.tone(o, 'square', 1319 * pitch, 1319 * pitch, t + 0.06, 0.22, 0.12);
        break;
      case 'cash':
        for (let i = 0; i < 4; i++) {
          this.tone(o, 'square', 1046 * (1 + i * 0.12), 1046 * (1 + i * 0.12), t + i * 0.05, 0.08, 0.08);
        }
        this.tone(o, 'triangle', 2093, 2093, t + 0.22, 0.35, 0.15);
        break;
      case 'click':
        this.tone(o, 'sine', 900 * pitch, 600, t, 0.05, 0.25);
        break;
      case 'hover':
        this.tone(o, 'sine', 1400, 1400, t, 0.03, 0.06);
        break;
      case 'tick':
        this.tone(o, 'square', 1800, 1800, t, 0.02, 0.05);
        break;
      case 'error':
        this.tone(o, 'square', 220, 180, t, 0.12, 0.12);
        this.tone(o, 'square', 165, 140, t + 0.12, 0.18, 0.12);
        break;
      case 'fanfare': {
        const notes = [62, 66, 69, 74, 69, 74, 78];
        const times = [0, 0.12, 0.24, 0.36, 0.6, 0.72, 0.84];
        notes.forEach((n, i) => this.brass(o, t + times[i], n, i === notes.length - 1 ? 0.9 : 0.2, 0.22));
        this.brass(o, t + 0.84, 66, 0.9, 0.12);
        this.brass(o, t + 0.84, 69, 0.9, 0.12);
        this.burst(o, t + 0.84, 0.5, 0.15, 'highpass', 6000);
        break;
      }
      case 'mission':
        [72, 76, 79, 84].forEach((n, i) => this.pluck(o, t + i * 0.09, n, 0.5, 0.25));
        break;
      case 'levelup':
        [67, 71, 74, 79, 83, 86].forEach((n, i) => this.pluck(o, t + i * 0.07, n, 0.4, 0.2));
        this.brass(o, t + 0.45, 79, 0.6, 0.18);
        break;
      case 'treasure':
        [76, 79, 83, 88, 91].forEach((n, i) => this.pluck(o, t + i * 0.08, n, 0.6, 0.22));
        break;
      case 'bonk':
        this.tone(o, 'sine', 520 * pitch, 140, t, 0.18, 0.7);
        this.tone(o, 'square', 1200 * pitch, 400, t, 0.05, 0.15);
        this.burst(o, t, 0.06, 0.4, 'bandpass', 2000, 2000, 2);
        break;
      case 'clang':
        for (const f of [523, 1307, 2140, 3010]) this.tone(o, 'sine', f * pitch, f * pitch * 0.98, t, 0.5, 0.12);
        this.burst(o, t, 0.05, 0.4, 'highpass', 3000);
        break;
      case 'arr':
        this.voice(o, t, 140 * pitch, 105 * pitch, 0.55, [650, 1150], 0.55, 0.35);
        break;
      case 'hey':
        this.voice(o, t, 200 * pitch, 260 * pitch, 0.22, [520, 1900], 0.5);
        break;
      case 'oof':
        this.voice(o, t, 190 * pitch, 110 * pitch, 0.25, [350, 800], 0.55);
        break;
      case 'yay':
        this.voice(o, t, 220 * pitch, 330 * pitch, 0.35, [700, 1700], 0.45);
        this.voice(o, t + 0.05, 260 * pitch, 380 * pitch, 0.3, [700, 1900], 0.3);
        break;
      case 'thunder':
        this.burst(o, t, 2.8, 0.9, 'lowpass', 500, 60, 0.5, 0.05);
        for (let i = 0; i < 6; i++) this.burst(o, t + rand(0, 0.8), 0.25, 0.4, 'lowpass', 1200, 200, 0.6);
        break;
      case 'bell':
        for (const [f, a] of [
          [587, 0.3],
          [1174, 0.15],
          [1480, 0.1],
          [2350, 0.06],
        ] as [number, number][])
          this.tone(o, 'sine', f, f * 0.995, t, 2.2, a, 0.002);
        break;
      case 'sink':
        for (let i = 0; i < 14; i++) this.tone(o, 'sine', rand(200, 600), rand(500, 1200), t + i * rand(0.05, 0.15), 0.08, 0.12);
        this.burst(o, t, 2.5, 0.4, 'lowpass', 400, 100, 0.7, 0.3);
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this.tone(o, 'square', 660, 660, t + i * 0.3, 0.14, 0.08);
          this.tone(o, 'square', 880, 880, t + i * 0.3 + 0.15, 0.14, 0.08);
        }
        break;
      case 'step':
        this.burst(o, t, 0.06, 0.35, 'lowpass', 900, 300, 1);
        this.tone(o, 'sine', 140, 70, t, 0.05, 0.12);
        break;
      case 'swing':
        // pitch < 1 = heavier weapon
        this.burst(o, t, 0.16 / pitch, 0.5, 'bandpass', 900 * pitch, 2600 * pitch, 1.8, 0.02);
        this.burst(o, t + 0.03, 0.1 / pitch, 0.22, 'highpass', 3500 * pitch);
        break;
      case 'hitFlesh':
        // cartoon thwack: low thump + papery slap
        this.tone(o, 'sine', 170 * pitch, 60, t, 0.12, 0.9);
        this.burst(o, t, 0.08, 0.7, 'bandpass', 1300 * pitch, 500, 1.2);
        this.burst(o, t + 0.01, 0.05, 0.35, 'highpass', 4000);
        break;
      case 'blockHit':
        for (const f of [740, 1660, 2490]) this.tone(o, 'sine', f * pitch, f * pitch * 0.97, t, 0.28, 0.13);
        this.burst(o, t, 0.06, 0.55, 'bandpass', 3000 * pitch, 2000, 2);
        this.tone(o, 'triangle', 220 * pitch, 160, t, 0.08, 0.3);
        break;
      case 'parry':
        for (const f of [1046, 1568, 2093, 3136]) this.tone(o, 'sine', f, f * 1.01, t, 0.7, 0.12);
        this.burst(o, t, 0.08, 0.6, 'highpass', 5000);
        break;
      case 'pistol':
        this.burst(o, t, 0.05, 1.0, 'highpass', 2200);
        this.burst(o, t, 0.45, 0.85, 'lowpass', 2600, 300, 0.8);
        this.tone(o, 'sine', 160 * pitch, 45, t, 0.3, 0.9);
        break;
      case 'blast':
        this.burst(o, t, 0.07, 1.0, 'highpass', 1500);
        this.burst(o, t, 0.7, 1.0, 'lowpass', 1800, 150, 0.7);
        this.tone(o, 'sine', 110, 35, t, 0.45, 1.1);
        break;
      case 'dryFire':
        this.burst(o, t, 0.025, 0.5, 'bandpass', 3200, 3200, 8);
        this.tone(o, 'square', 1400, 1200, t, 0.02, 0.06);
        break;
      case 'thud':
        this.tone(o, 'sine', 120 * pitch, 40, t, 0.25, 0.9);
        this.burst(o, t, 0.3, 0.5, 'lowpass', 600, 120, 0.7);
        break;
      case 'roar':
        this.voice(o, t, 95 * pitch, 70 * pitch, 1.1, [420, 900], 0.75, 0.6);
        this.burst(o, t, 1.0, 0.25, 'lowpass', 700, 300, 0.7, 0.1);
        break;
      case 'slam':
        this.tone(o, 'sine', 70, 28, t, 0.7, 1.2);
        this.burst(o, t, 0.9, 1.0, 'lowpass', 900, 80, 0.6);
        for (let i = 0; i < 6; i++) this.burst(o, t + rand(0.03, 0.35), 0.06, 0.3, 'bandpass', rand(800, 2500), undefined, 3);
        break;
      case 'hammer':
        for (let i = 0; i < 3; i++) {
          this.tone(o, 'sine', 300, 120, t + i * 0.18, 0.08, 0.5);
          this.burst(o, t + i * 0.18, 0.05, 0.4, 'bandpass', 2400, 2400, 3);
        }
        break;
    }
  }

  playVoice(kind: 'arr' | 'hey' | 'oof' | 'yay', pos?: THREE.Vector3, pitch = 1) {
    this.play(kind, { pos, pitch: pitch * rand(0.92, 1.08), volume: 0.8 });
  }

  // ---------------- instruments ----------------
  private mtof(n: number) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }
  private brass(dest: AudioNode, t: number, note: number, dur: number, peak: number) {
    const ctx = this.ctx!;
    const f = this.mtof(note);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 2, t);
    lp.frequency.linearRampToValueAtTime(f * 6, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(f * 2.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.setValueAtTime(peak * 0.8, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.15);
    }
    lp.connect(g).connect(dest);
  }
  private pluck(dest: AudioNode, t: number, note: number, dur: number, peak: number, type: OscillatorType = 'triangle') {
    this.tone(dest, type, this.mtof(note), this.mtof(note), t, dur, peak, 0.003);
  }
  private accordion(dest: AudioNode, t: number, note: number, dur: number, peak: number) {
    const ctx = this.ctx!;
    const f = this.mtof(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.04);
    g.gain.setValueAtTime(peak * 0.85, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 2200;
    bp.Q.value = 1.5;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibG = ctx.createGain();
    vibG.gain.value = 4;
    vib.connect(vibG);
    for (const [det, type] of [
      [-8, 'sawtooth'],
      [7, 'square'],
    ] as [number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      vibG.connect(o.detune);
      o.connect(bp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    vib.start(t);
    vib.stop(t + dur + 0.1);
    const lvl = ctx.createGain();
    lvl.gain.value = 0.35;
    bp.connect(lvl).connect(g).connect(dest);
  }
  private drum(dest: AudioNode, t: number, peak: number) {
    this.tone(dest, 'sine', 120, 45, t, 0.25, peak);
    this.burst(dest, t, 0.05, peak * 0.3, 'lowpass', 600);
  }
  private tamb(dest: AudioNode, t: number, peak: number) {
    this.burst(dest, t, 0.08, peak, 'highpass', 6500, 6500, 0.8, 0.002);
  }

  // ---------------- music sequencer ----------------
  // original 6/8 shanty in D minor: [note, lengthInEighths] per bar
  private readonly MELODY: [number, number][][] = [
    [[69, 2], [74, 1], [74, 2], [76, 1]],
    [[77, 2], [76, 1], [74, 2], [72, 1]],
    [[69, 2], [74, 1], [74, 1], [76, 1], [77, 1]],
    [[76, 2], [74, 1], [72, 3]],
    [[69, 2], [74, 1], [74, 2], [76, 1]],
    [[77, 2], [79, 1], [81, 2], [79, 1]],
    [[77, 2], [74, 1], [76, 2], [73, 1]],
    [[74, 6]],
    [[81, 2], [81, 1], [79, 2], [77, 1]],
    [[76, 2], [79, 1], [76, 2], [72, 1]],
    [[74, 2], [77, 1], [81, 2], [77, 1]],
    [[76, 3], [73, 3]],
    [[81, 2], [81, 1], [79, 2], [77, 1]],
    [[76, 2], [77, 1], [79, 2], [76, 1]],
    [[77, 2], [74, 1], [73, 2], [76, 1]],
    [[74, 3], [0, 3]],
  ];
  // chord roots (MIDI) and minor flag per bar
  private readonly CHORDS: [number, boolean][] = [
    [50, true],
    [48, false],
    [50, true],
    [45, true],
    [50, true],
    [48, false],
    [46, false],
    [50, true],
    [53, false],
    [48, false],
    [50, true],
    [45, false],
    [53, false],
    [48, false],
    [46, false],
    [50, true],
  ];

  private scheduleMusic() {
    const ctx = this.ctx!;
    const bpmEighth = this.musicState === 'combat' ? 0.15 : this.musicState === 'tavern' ? 0.145 : this.musicState === 'port' ? 0.2 : 0.175;
    while (this.nextNoteTime < ctx.currentTime + 0.25) {
      const step = this.seqStep;
      const bar = Math.floor(step / 6) % 16;
      const pos = step % 6;
      const t = this.nextNoteTime;
      const dest = this.music;
      const [root, minor] = this.CHORDS[bar];
      // melody (find note starting at this position)
      let acc = 0;
      for (const [n, len] of this.MELODY[bar]) {
        if (acc === pos && n > 0) {
          if (this.musicState === 'tavern') {
            this.accordion(dest, t, n, len * bpmEighth * 0.9, 0.2);
            this.pluck(dest, t, n + 12, len * bpmEighth * 0.6, 0.06, 'square');
          } else if (this.musicState === 'port') this.pluck(dest, t, n, len * bpmEighth * 1.2, 0.16, 'triangle');
          else this.accordion(dest, t, n, len * bpmEighth * 0.95, 0.16);
        }
        acc += len;
      }
      // bass: root on 1, fifth on 4
      if (pos === 0) this.pluck(dest, t, root - 12, bpmEighth * 2.5, 0.32, 'triangle');
      if (pos === 3) this.pluck(dest, t, root - 5, bpmEighth * 2.5, 0.26, 'triangle');
      // chord strum
      if (pos === 0 || pos === 3 || (pos === 5 && this.musicState !== 'port')) {
        const third = minor ? 3 : 4;
        const vol = pos === 0 ? 0.07 : 0.05;
        [0, third, 7].forEach((iv, k) => this.pluck(dest, t + k * 0.012, root + 12 + iv, bpmEighth * 1.4, vol, 'sawtooth'));
      }
      // percussion
      if (this.musicState !== 'port') {
        if (pos === 0 || pos === 3) this.drum(dest, t, 0.45);
        if (this.musicIntensity > 0.3 && (pos === 2 || pos === 5)) this.drum(dest, t, 0.25 * this.musicIntensity);
        this.tamb(dest, t, pos % 3 === 0 ? 0.08 : 0.04);
      } else if (pos === 0) this.tamb(dest, t, 0.04);
      this.nextNoteTime += bpmEighth;
      this.seqStep++;
    }
  }

  thunder(delay: number, intensity: number) {
    this.play('thunder', { delay, volume: intensity });
  }

  setListener(pos: THREE.Vector3, yaw: number) {
    this.listener.copy(pos);
    this.listenerYaw = yaw;
  }

  randomCrewShout(pos?: THREE.Vector3) {
    this.playVoice(choose(['arr', 'hey', 'yay'] as const), pos, rand(0.85, 1.25));
  }
}

export const audio = new AudioEngine();
