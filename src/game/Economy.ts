import { CARGO, CargoId, GoodCat, Profile, TRADE_IDS, officerSkill } from './Data';
import { PORTS } from '../world/WorldData';
import { clamp, mulberry32 } from '../core/math';

/**
 * Port price multipliers per good (1 = base price). Each port is cheap for a few goods and
 * pays well for others, so buying low in one port and sailing to another pays off:
 *   Skull Cove pepper → Port Royal · Saltmarsh fish → Goldhaven · Lagoon spices → Port Royal · Port Royal cloth → Lagoon
 *   Skull Cove metal & rum → Lagoon / Port Royal · Goldhaven jewels → Skull Cove / Saltmarsh
 */
const PORT_PRICES: Record<string, Partial<Record<CargoId, number>>> = {
  skull: { fish: 1.3, fruit: 1.2, meat: 1.1, grain: 1.0, pepper: 0.7, cinnamon: 0.65, exotic: 1.2, cloth: 1.2, silk: 1.1, clothing: 1.25, wood: 0.8, metal: 0.6, rope: 0.7, jewels: 1.3, goldware: 1.35, rare: 1.4, rum: 0.5, pearls: 1.0, krakenInk: 1.2 },
  royal: { fish: 1.2, fruit: 1.3, meat: 1.0, grain: 0.6, pepper: 1.45, cinnamon: 1.5, exotic: 1.6, cloth: 0.6, silk: 0.75, clothing: 0.65, wood: 1.3, metal: 1.2, rope: 1.1, jewels: 1.15, goldware: 1.1, rare: 1.2, rum: 1.6, pearls: 1.3, krakenInk: 1.4 },
  salt: { fish: 0.45, fruit: 1.1, meat: 0.7, grain: 0.9, pepper: 1.3, cinnamon: 1.35, exotic: 1.4, cloth: 1.3, silk: 1.3, clothing: 1.35, wood: 1.2, metal: 1.5, rope: 1.4, jewels: 1.4, goldware: 1.4, rare: 1.3, rum: 1.3, pearls: 1.1, krakenInk: 1.2 },
  gold: { fish: 1.6, fruit: 1.5, meat: 1.5, grain: 1.4, pepper: 1.2, cinnamon: 1.25, exotic: 1.7, cloth: 1.1, silk: 1.5, clothing: 1.2, wood: 1.4, metal: 1.3, rope: 1.3, jewels: 0.6, goldware: 0.65, rare: 0.7, rum: 1.5, pearls: 1.6, krakenInk: 1.7 },
  lagoon: { fish: 0.8, fruit: 0.45, meat: 1.3, grain: 1.6, pepper: 0.55, cinnamon: 0.6, exotic: 0.6, cloth: 1.6, silk: 1.5, clothing: 1.6, wood: 0.6, metal: 1.8, rope: 1.5, jewels: 1.2, goldware: 1.2, rare: 0.5, rum: 1.2, pearls: 0.7, krakenInk: 1.0 },
};

export type StallType = 'food' | 'spice' | 'textile' | 'material' | 'luxury' | 'general' | 'black';

export interface StallDef {
  name: string;
  icon: string;
  color: string;
  /** goods for sale (general: picked per day) */
  sells: CargoId[];
  /** categories the vendor will buy */
  buys: GoodCat[];
  /** how much of the market price the vendor pays when buying from you */
  buyRate: number;
  greet: string[];
  /** opening hours, or null = always open */
  hours: [number, number] | null;
}

export const STALLS: Record<StallType, StallDef> = {
  food: {
    name: 'Food Stall',
    icon: '🍖',
    color: '#e67e22',
    sells: ['fish', 'fruit', 'meat', 'grain'],
    buys: ['food'],
    buyRate: 1,
    greet: ['Fresh off the boat this morning!', 'Hungry crew? I\'ve got just the thing.', 'Finest grub on the island, Captain!'],
    hours: [6, 21],
  },
  spice: {
    name: 'Spice Stall',
    icon: '🌶️',
    color: '#e74c3c',
    sells: ['pepper', 'cinnamon', 'exotic'],
    buys: ['spice'],
    buyRate: 1,
    greet: ['Looking for some spices?', 'Fresh spices! Best prices on the island!', 'Smell that? That\'s profit, that is.'],
    hours: [7, 20],
  },
  textile: {
    name: 'Textile Stall',
    icon: '🧵',
    color: '#8e44ad',
    sells: ['cloth', 'silk', 'clothing'],
    buys: ['textile'],
    buyRate: 1,
    greet: ['Silk so soft you\'ll weep, darling.', 'Need new sails? Or a fancy hat?', 'Cloth by the bolt, coats by the dozen!'],
    hours: [7, 20],
  },
  material: {
    name: 'Materials Yard',
    icon: '🪵',
    color: '#a0522d',
    sells: ['wood', 'metal', 'rope'],
    buys: ['material'],
    buyRate: 1,
    greet: ['Planks, iron and rope – everything a ship eats.', 'Mind the splinters!', 'Building something? Or just buying cheap?'],
    hours: [6, 22],
  },
  luxury: {
    name: 'Luxury Goods',
    icon: '💎',
    color: '#16a085',
    sells: ['jewels', 'goldware', 'rare'],
    buys: ['luxury'],
    buyRate: 1,
    greet: ['Only the finest treasures, for the finest captains.', 'Please don\'t touch the goblets.', 'Ah, a customer of taste!'],
    hours: [8, 20],
  },
  general: {
    name: 'General Trader',
    icon: '⚖️',
    color: '#2e86c1',
    sells: [],
    buys: ['food', 'spice', 'textile', 'material', 'luxury'],
    buyRate: 0.88,
    greet: ['I buy anything, I sell everything!', 'A bit of this, a bit of that.', 'Trade\'s been slow – make me an offer!'],
    hours: null,
  },
  black: {
    name: 'Black Market',
    icon: '🕵️',
    color: '#2c2c3a',
    sells: ['rum', 'pearls', 'krakenInk'],
    buys: ['contraband', 'luxury'],
    buyRate: 0.95,
    greet: ['Psst... you didn\'t see me, right?', 'No questions asked. No answers given.', 'Keep your voice down, Captain.'],
    hours: null,
  },
};

type MarketCell = [drift: number, pressure: number];

/** Port-to-port prices that drift over time and react to what the player buys and sells. */
export class Economy {
  private hourAcc = 0;

  constructor(private profile: Profile) {
    if (!profile.market) profile.market = {};
    for (const p of PORTS) {
      profile.market[p.id] ??= {};
      const rng = mulberry32(p.id.length * 131 + 7);
      for (const id of TRADE_IDS) profile.market[p.id][id] ??= [0.9 + rng() * 0.2, 1];
    }
  }

  private cell(port: string, id: CargoId): MarketCell {
    return (this.profile.market![port]?.[id] as MarketCell | undefined) ?? [1, 1];
  }

  /** Mid-market price per crate in a port. */
  price(port: string, id: CargoId) {
    const [drift, pressure] = this.cell(port, id);
    return CARGO[id].value * (PORT_PRICES[port]?.[id] ?? 1) * drift * pressure;
  }

  private traderK() {
    return officerSkill(this.profile, 'trader') * 0.04;
  }

  /** What a vendor charges you. */
  buyPrice(port: string, id: CargoId) {
    return Math.max(1, Math.round(this.price(port, id) * 1.06 * (1 - this.traderK())));
  }

  /** What a vendor pays you. */
  sellPrice(port: string, id: CargoId, rate = 1) {
    return Math.max(1, Math.round(this.price(port, id) * 0.94 * rate * (1 + this.traderK())));
  }

  /** Average mid price across every port. */
  avgPrice(id: CargoId) {
    return Math.round(PORTS.reduce((s, p) => s + this.price(p.id, id), 0) / PORTS.length);
  }

  /** Port paying the most for a good right now. */
  bestSell(id: CargoId, except?: string) {
    let best = { port: PORTS[0], price: 0 };
    for (const p of PORTS) {
      if (p.id === except) continue;
      const v = this.sellPrice(p.id, id);
      if (v > best.price) best = { port: p, price: v };
    }
    return best;
  }

  /** How cheap a good is here compared with elsewhere (-1 cheap … +1 pricey). */
  trend(port: string, id: CargoId) {
    const k = this.price(port, id) / Math.max(1, this.avgPrice(id));
    return clamp((k - 1) * 2.5, -1, 1);
  }

  /** Buying raises the price a little per crate; selling lowers it. */
  traded(port: string, id: CargoId, qty: number) {
    const c = this.cell(port, id);
    c[1] = clamp(c[1] * Math.pow(qty > 0 ? 1.012 : 0.988, Math.abs(qty)), 0.6, 1.6);
    this.profile.market![port][id] = c;
  }

  /** Total paid for `qty` crates bought one after another (price creeps up). */
  quoteBuy(port: string, id: CargoId, qty: number) {
    const c = this.cell(port, id);
    const p0 = c[1];
    let total = 0;
    for (let i = 0; i < qty; i++) {
      total += this.buyPrice(port, id);
      c[1] = Math.min(1.6, c[1] * 1.012);
    }
    c[1] = p0;
    return total;
  }

  quoteSell(port: string, id: CargoId, qty: number, rate = 1) {
    const c = this.cell(port, id);
    const p0 = c[1];
    let total = 0;
    for (let i = 0; i < qty; i++) {
      total += this.sellPrice(port, id, rate);
      c[1] = Math.max(0.6, c[1] * 0.988);
    }
    c[1] = p0;
    return total;
  }

  /** The general trader's stock changes daily. */
  generalGoods(port: string, day: number) {
    const rng = mulberry32(day * 7919 + port.charCodeAt(0) * 31);
    const pool = TRADE_IDS.filter((id) => CARGO[id].cat !== 'contraband');
    // cheapest local goods are always in stock, plus a few random picks
    const cheap = [...pool].sort((a, b) => (PORT_PRICES[port]?.[a] ?? 1) - (PORT_PRICES[port]?.[b] ?? 1)).slice(0, 2);
    const extra = pool.filter((g) => !cheap.includes(g)).sort(() => rng() - 0.5).slice(0, 3);
    return [...cheap, ...extra];
  }

  /** Advance the market by in-game hours: prices wander, trade pressure fades. */
  update(hours: number) {
    this.hourAcc += hours;
    if (this.hourAcc < 0.5) return;
    const h = this.hourAcc;
    this.hourAcc = 0;
    const fade = Math.exp(-h / 7);
    for (const port of PORTS) {
      const m = this.profile.market![port.id];
      for (const id of TRADE_IDS) {
        const c = (m[id] as MarketCell) ?? [1, 1];
        const n = (Math.random() + Math.random() + Math.random() - 1.5) * 0.09 * Math.sqrt(h);
        c[0] = clamp(c[0] * Math.exp(n) + (1 - c[0]) * 0.04 * h, 0.72, 1.38);
        c[1] = 1 + (c[1] - 1) * fade;
        m[id] = c;
      }
    }
  }
}
