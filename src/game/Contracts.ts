import type { Game } from './Game';
import { CARGO, ContractSave, ShipTypeId, SHIP_TYPES, TRADE_IDS } from './Data';
import { PORTS, ISLANDS, portById, islandByName } from '../world/WorldData';
import { audio } from '../core/Audio';
import { fmtMoney, mulberry32 } from '../core/math';

export const MAX_CONTRACTS = 3;
const RIVALS = ['Black Bess', 'Captain Scurvy', 'Mad Morgan', 'Red Rackham', 'The Barnacle Baron', 'Iron Annie'];

/**
 * Job contracts from tavern mission boards: deliveries, sealed-cargo runs, captures,
 * treasure hunts, rival pirates and exploration.
 */
export class Contracts {
  constructor(private game: Game) {}

  get list() {
    return this.game.profile.contracts;
  }

  /** Offers pinned on a port's board today (deterministic per port & day). */
  offers(portId: string): ContractSave[] {
    const g = this.game;
    const p = g.profile;
    const day = p.day;
    let h = day * 7907;
    for (const ch of portId) h = (h * 33 + ch.charCodeAt(0)) | 0;
    const rng = mulberry32(h);
    const pickR = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
    const here = portById(portId);
    const others = PORTS.filter((x) => x.id !== portId);
    const out: ContractSave[] = [];
    const kinds = ['deliver', 'transport', 'capture', pickR(['treasure', 'rival', 'reach']), pickR(['deliver', 'capture', 'reach'])];
    kinds.forEach((kind, i) => {
      const id = `${portId}-${day}-${i}`;
      const to = pickR(others);
      const dist = Math.hypot(to.berth.x - here.berth.x, to.berth.z - here.berth.z);
      switch (kind) {
        case 'deliver': {
          // something cheap here that sells well there
          const goods = TRADE_IDS.filter((c) => CARGO[c].cat !== 'contraband' && CARGO[c].cat !== 'luxury');
          const good = goods.sort((a, b) => g.economy.price(portId, a) / g.economy.price(to.id, a) - g.economy.price(portId, b) / g.economy.price(to.id, b))[Math.floor(rng() * 3)];
          const qty = 3 + Math.floor(rng() * 5);
          const money = Math.round((qty * g.economy.sellPrice(to.id, good) * 1.3 + 150 + dist * 0.25) / 10) * 10;
          out.push({ id, kind, title: `Deliver ${CARGO[good].name}`, desc: `Bring ${qty} crates of ${CARGO[good].name} ${CARGO[good].icon} to ${to.name}`, money, xp: 120 + qty * 15, target: qty, progress: 0, port: to.id, good, qty, from: portId });
          break;
        }
        case 'transport': {
          const qty = 3 + Math.floor(rng() * 4);
          const money = Math.round((300 + dist * 0.9 + qty * 40) / 10) * 10;
          out.push({ id, kind, title: 'Sealed Cargo Run', desc: `Carry ${qty} sealed crates 📦 to ${to.name}. Don't ask what's inside.`, money, xp: 150 + Math.round(dist * 0.1), target: qty, progress: 0, port: to.id, qty, from: portId });
          break;
        }
        case 'capture': {
          const types: ShipTypeId[] = p.level >= 3 ? ['mediumMerchant', 'largeCargo', 'luxury', 'armoured'] : p.level >= 2 ? ['mediumMerchant', 'largeCargo', 'luxury'] : ['smallMerchant', 'mediumMerchant'];
          if (rng() < 0.4) {
            const n = 2 + Math.floor(rng() * 2);
            out.push({ id, kind: 'capture', title: 'Privateer Work', desc: `Capture ${n} merchant ships`, money: 700 * n + p.level * 150, xp: 200 * n, target: n, progress: 0, from: portId });
          } else {
            const t = pickR(types);
            out.push({ id, kind: 'captureType', title: `Wanted: ${SHIP_TYPES[t].label}`, desc: `Capture a ${SHIP_TYPES[t].label}`, money: Math.round(SHIP_TYPES[t].xp * 4.5 + 400), xp: SHIP_TYPES[t].xp, target: 1, progress: 0, typeId: t, from: portId });
          }
          break;
        }
        case 'treasure': {
          const hidden = ISLANDS.filter((i) => i.kind === 'hidden' && !p.treasuresFound.includes(i.name));
          if (!hidden.length) break;
          const isl = pickR(hidden);
          out.push({ id, kind, title: 'Find the Lost Treasure', desc: `A map marks treasure on ${isl.name}. Go dig it up!`, money: 800, xp: 300, target: 1, progress: 0, island: isl.name, from: portId });
          break;
        }
        case 'rival': {
          const name = pickR(RIVALS);
          out.push({ id, kind, title: 'Defeat a Rival Pirate', desc: `${name} has been raiding these waters. Sink or capture their brig!`, money: 2200 + p.level * 300, xp: 600, target: 1, progress: 0, island: name, from: portId });
          break;
        }
        case 'reach': {
          const far = ISLANDS.filter((i) => i.kind !== 'hidden' && i.kind !== 'pirate' && i.kind !== 'port' && Math.hypot(i.x - here.berth.x, i.z - here.berth.z) > 350);
          const isl = pickR(far);
          const d = Math.hypot(isl.x - here.berth.x, isl.z - here.berth.z);
          out.push({ id, kind, title: 'Chart the Waters', desc: `Sail out and chart the waters around ${isl.name}`, money: Math.round((300 + d * 0.6) / 10) * 10, xp: 180, target: 1, progress: 0, island: isl.name, from: portId });
          break;
        }
      }
    });
    return out.filter((o) => !p.doneContracts.includes(o.id));
  }

  accepted(id: string) {
    return this.list.some((c) => c.id === id);
  }

  /** Take a job from the board. Returns an error message or null. */
  accept(c: ContractSave): string | null {
    const g = this.game;
    const p = g.profile;
    if (this.list.length >= MAX_CONTRACTS) return `You can only juggle ${MAX_CONTRACTS} contracts at once.`;
    if (this.accepted(c.id)) return 'Already accepted.';
    if (c.kind === 'transport') {
      const space = g.cargoCapacity - g.cargoCount;
      if (space < c.qty!) return `Not enough room in your hold (${c.qty} crates needed).`;
      p.cargo.sealed = (p.cargo.sealed ?? 0) + c.qty!;
    }
    if (c.kind === 'treasure' && c.island && !p.maps.includes(c.island)) p.maps.push(c.island);
    this.list.push({ ...c });
    if (c.kind === 'rival') g.spawnRival(c.id, c.island!);
    audio.play('mission', { volume: 0.6 });
    g.ui.toast('📜 Contract accepted', c.title, 'mission');
    return null;
  }

  private complete(c: ContractSave) {
    const g = this.game;
    const p = g.profile;
    p.contracts = p.contracts.filter((x) => x !== c);
    p.doneContracts.push(c.id);
    if (p.doneContracts.length > 200) p.doneContracts.splice(0, 50);
    g.addMoney(c.money);
    g.addXp(c.xp);
    audio.play('mission');
    audio.play('cash', { delay: 0.3 });
    g.ui.toast('✅ CONTRACT COMPLETE', `${c.title} · +${fmtMoney(c.money)} · +${c.xp} XP`, 'mission');
  }

  /** Arrived at a port: hand over deliveries and sealed cargo. */
  arrive(portId: string) {
    const p = this.game.profile;
    for (const c of [...this.list]) {
      if (c.port !== portId) continue;
      if (c.kind === 'deliver') {
        const have = p.cargo[c.good!] ?? 0;
        if (have >= c.qty!) {
          p.cargo[c.good!] = have - c.qty!;
          this.complete(c);
        } else if (have > 0) this.game.ui.toast(`📦 ${c.title}`, `Need ${c.qty} crates – you only have ${have}.`, 'info');
      } else if (c.kind === 'transport') {
        const have = p.cargo.sealed ?? 0;
        p.cargo.sealed = Math.max(0, have - c.qty!);
        if (have >= c.qty!) this.complete(c);
      }
    }
  }

  capture(typeId: ShipTypeId, rivalId?: string) {
    for (const c of [...this.list]) {
      if (c.kind === 'capture' || (c.kind === 'captureType' && c.typeId === typeId)) {
        c.progress++;
        if (c.progress >= c.target) this.complete(c);
      }
      if (c.kind === 'rival' && rivalId === c.id) this.complete(c);
    }
  }

  rivalDefeated(id: string) {
    const c = this.list.find((x) => x.id === id);
    if (c) this.complete(c);
  }

  treasure(island: string) {
    for (const c of [...this.list]) if (c.kind === 'treasure' && c.island === island) this.complete(c);
  }

  /** Exploration contracts tick off when you sail close to the island. */
  checkReach(x: number, z: number) {
    for (const c of [...this.list]) {
      if (c.kind !== 'reach') continue;
      const isl = islandByName(c.island!);
      if (Math.hypot(isl.x - x, isl.z - z) < isl.r + 70) this.complete(c);
    }
  }

  /** World position a contract points at (for markers), or null. */
  targetOf(c: ContractSave) {
    if (c.port) return portById(c.port).berth;
    if (c.kind === 'treasure' || c.kind === 'reach') {
      const isl = islandByName(c.island!);
      return isl ? { x: isl.x, y: 0, z: isl.z } : null;
    }
    if (c.kind === 'rival') {
      const s = this.game.ships.find((x) => x.contractId === c.id && !x.sinking);
      return s ? s.pos : null;
    }
    return null;
  }

  /** Abandon a contract (sealed crates are returned). */
  abandon(id: string) {
    const p = this.game.profile;
    const c = this.list.find((x) => x.id === id);
    if (!c) return;
    if (c.kind === 'transport') p.cargo.sealed = Math.max(0, (p.cargo.sealed ?? 0) - c.qty!);
    p.contracts = p.contracts.filter((x) => x !== c);
    this.game.ui.toast('🗑️ Contract abandoned', c.title, 'danger');
  }
}

