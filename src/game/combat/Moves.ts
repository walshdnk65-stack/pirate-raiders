import type { AnimState } from '../../models/Character';
import type { Action, Fighter, Swing } from './Fighter';
import type { SwingStyle } from './Weapons';

/**
 * The attack catalogue: timings (seconds at attack speed 1), active windows (fractions of the
 * animation) and damage / knockback multipliers for each combo step. Shared by the captain,
 * enemies and crew so everyone swings the same way.
 */
interface Step {
  anim: AnimState;
  dur: number;
  /** strike window within the animation (0..1) */
  act: [number, number];
  dmg: number;
  kb: number;
  stun: number;
  lunge: number;
  arcMul: number;
  reachAdd: number;
  finisher?: boolean;
}

const SLASH: Step[] = [
  { anim: 'slash1', dur: 0.5, act: [0.34, 0.56], dmg: 1, kb: 1, stun: 0.34, lunge: 2.6, arcMul: 1, reachAdd: 0 },
  { anim: 'slash2', dur: 0.5, act: [0.32, 0.55], dmg: 1.05, kb: 1, stun: 0.34, lunge: 2.6, arcMul: 1, reachAdd: 0 },
  { anim: 'slash3', dur: 0.74, act: [0.38, 0.56], dmg: 1.6, kb: 2.3, stun: 0.65, lunge: 4.4, arcMul: 0.8, reachAdd: 0.3, finisher: true },
];
const THRUST: Step[] = [
  { anim: 'thrust', dur: 0.46, act: [0.3, 0.48], dmg: 1, kb: 0.8, stun: 0.3, lunge: 3.6, arcMul: 1, reachAdd: 0 },
  { anim: 'thrust', dur: 0.44, act: [0.3, 0.48], dmg: 1.1, kb: 0.9, stun: 0.3, lunge: 3.6, arcMul: 1, reachAdd: 0.1 },
  { anim: 'slash3', dur: 0.7, act: [0.38, 0.56], dmg: 1.6, kb: 2.1, stun: 0.6, lunge: 4.4, arcMul: 1.8, reachAdd: 0, finisher: true },
];
const CHOP: Step[] = [
  { anim: 'slash1', dur: 0.56, act: [0.34, 0.56], dmg: 1, kb: 1, stun: 0.4, lunge: 2.2, arcMul: 1, reachAdd: 0 },
  { anim: 'slash2', dur: 0.56, act: [0.32, 0.55], dmg: 1.05, kb: 1.1, stun: 0.4, lunge: 2.2, arcMul: 1, reachAdd: 0 },
  { anim: 'slash3', dur: 0.8, act: [0.38, 0.56], dmg: 1.75, kb: 2.5, stun: 0.75, lunge: 4, arcMul: 0.8, reachAdd: 0.3, finisher: true },
];
const STEPS: Record<SwingStyle, Step[]> = { slash: SLASH, thrust: THRUST, chop: CHOP };

export const COMBO_MAX = 3;

export interface MeleeOpts {
  /** base damage per hit (before the step multiplier) */
  dmg: number;
  /** attack speed */
  speed: number;
  reach: number;
  arc: number;
  knockback: number;
  style: SwingStyle;
  sound: 'light' | 'medium' | 'heavy';
  /** enemies: real seconds of wind-up before the strike (longer telegraph) */
  windup?: number;
  /** the strike can't be interrupted */
  armor?: boolean;
  heavy?: boolean;
}

/**
 * Build a timed action whose strike happens `windup` seconds in, keeping the animation's own
 * shape: the wind-up part of the animation is stretched, the strike and recovery play at `speed`.
 */
function timed(step: Step, speed: number, windup?: number) {
  const a0 = step.act[0];
  const base = step.dur / speed;
  const W = windup ?? a0 * base;
  const P = (1 - a0) * base;
  const dur = W + P;
  const r = W / dur;
  const active: [number, number] = [r, r + ((step.act[1] - a0) / (1 - a0)) * (1 - r)];
  return { dur, active, knee: [r, a0] as [number, number] };
}

/** Light attack: combo step 1..3. */
export function meleeStep(f: Fighter, step: number, o: MeleeOpts): Action {
  const s = STEPS[o.style][Math.min(step, COMBO_MAX) - 1];
  const tm = timed(s, o.speed, o.windup);
  const swing: Swing = {
    dmg: o.dmg * s.dmg,
    reach: o.reach + s.reachAdd,
    arc: o.arc * s.arcMul,
    knockback: o.knockback * s.kb,
    stun: s.stun,
    finisher: !!s.finisher,
    heavy: o.heavy || (s.finisher && o.sound === 'heavy'),
    sound: o.sound,
  };
  return f.start({
    kind: 'attack',
    anim: s.anim,
    dur: tm.dur,
    active: tm.active,
    knee: tm.knee,
    swing,
    combo: step,
    lunge: s.lunge,
    armor: o.armor,
    // the next combo step can start once the strike is done
    cancelAt: s.finisher ? 0.88 : Math.min(0.95, tm.active[1] + 0.12),
  } as Action);
}

/** Charged heavy attack (released after holding the button). */
export function heavyStrike(f: Fighter, o: MeleeOpts, charge: number): Action {
  const k = Math.min(1, charge);
  const speed = o.speed * 0.95;
  const dur = 0.78 / speed;
  const swing: Swing = {
    dmg: o.dmg * (1.6 + 0.8 * k),
    reach: o.reach + 0.35,
    arc: Math.max(o.arc, 0.9) * 1.15,
    knockback: o.knockback * (2 + 0.8 * k),
    stun: 0.9,
    heavy: true,
    finisher: true,
    sound: 'heavy',
  };
  return f.start({ kind: 'heavy', anim: 'heavy', dur, active: [0.08, 0.32], swing, lunge: 4.8, armor: true, cancelAt: 0.82, blend: 0.05 });
}

export function rollAction(f: Fighter): Action {
  return f.start({ kind: 'roll', anim: 'roll', dur: 0.5, iframes: [0.04, 0.6], cancelAt: 0.78, blend: 0.05 });
}

export function staggerAction(f: Fighter, stun: number): Action {
  return f.start({ kind: 'hit', anim: 'stagger', dur: Math.max(0.2, stun), cancelAt: 1, blend: 0.05 });
}

export function knockdownAction(f: Fighter): Action {
  return f.start({ kind: 'knockdown', anim: 'knockdown', dur: 1.55, iframes: [0.22, 0.97], cancelAt: 0.93, blend: 0.05 });
}

export function deathAction(f: Fighter): Action {
  return f.start({ kind: 'death', anim: 'death', dur: 1.3, blend: 0.06 });
}
