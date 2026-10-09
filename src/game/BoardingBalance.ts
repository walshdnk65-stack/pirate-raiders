/**
 * Boarding balance. The fight is a tug-of-war on a capture bar:
 *   power = sqrt(crew) × ship boarding strength × bonuses   (diminishing returns on crew)
 * The bar's speed comes from the power advantage and is clamped between a minimum (an even fight
 * still moves) and a hard maximum, so even a huge crew can never capture a ship instantly.
 */
export const BOARDING = {
  /** length of the capture bar in units (shown as %) */
  bar: 12,
  /** the boarders' foothold: where the bar starts */
  start: 0.2,
  /** units/s when both sides are evenly matched */
  minRate: 0.75,
  /** hard cap in units/s (≈ 4.8 s minimum from foothold to capture) */
  maxRate: 2.0,
  /** advantage (0..1) at which the base rate reaches maxRate (≈ 2.6× the enemy's power) */
  fullAdvantage: 0.45,
  /** units/s of push-back per unit of disadvantage when the defenders are stronger */
  pushBack: 1.5,
  /** momentum from the timing strikes (units/s, decays away) */
  hitBoost: 1.3,
  perfectBoost: 2.2,
  missBoost: -0.9,
  boostDecay: 1.8,
  /** while being pushed back you lose a pirate this often (s) */
  lossEvery: 2.6,
  /** timing needle speed limits */
  needleMax: 1.35,
};

/** Diminishing-returns crew power. */
export const boardingPower = (crew: number, mul: number) => Math.sqrt(Math.max(0, crew)) * mul;
/** −1 (hopeless) .. 0 (even) .. 1 (overwhelming) */
export const boardingAdvantage = (pp: number, ep: number) => (pp - ep) / Math.max(1e-6, pp + ep);
/** Base capture speed in units/s for a power match-up (before strike momentum). */
export function boardingRate(pp: number, ep: number) {
  const adv = boardingAdvantage(pp, ep);
  const B = BOARDING;
  if (adv >= 0) return B.minRate + (B.maxRate - B.minRate) * Math.min(1, adv / B.fullAdvantage);
  return Math.max(-B.maxRate, B.minRate + adv * B.pushBack);
}
