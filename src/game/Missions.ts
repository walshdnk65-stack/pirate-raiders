import type { Game } from './Game';
import type { ShipTypeId } from './Data';
import { audio } from '../core/Audio';
import { fmtMoney } from '../core/math';

export type MissionKind = 'capture' | 'captureType' | 'earn' | 'sell' | 'cargoReturn' | 'survive' | 'treasure' | 'sinkNavy';

export interface MissionDef {
  id: string;
  title: string;
  desc: string;
  kind: MissionKind;
  target: number;
  typeId?: ShipTypeId;
  money: number;
  xp: number;
}

const STORY: MissionDef[] = [
  { id: 'first', title: 'First Plunder', desc: 'Capture 1 merchant ship', kind: 'capture', target: 1, money: 500, xp: 150 },
  { id: 'fence', title: 'Fence the Goods', desc: 'Sell cargo at any market stall', kind: 'sell', target: 1, money: 300, xp: 100 },
  { id: 'earn5k', title: 'Getting Rich', desc: 'Earn $5,000', kind: 'earn', target: 5000, money: 800, xp: 250 },
  { id: 'cap3', title: 'Terror of the Seas', desc: 'Capture 3 ships', kind: 'capture', target: 3, money: 1200, xp: 350 },
  { id: 'large', title: 'Big Game', desc: 'Capture a Large Cargo Ship', kind: 'captureType', typeId: 'largeCargo', target: 1, money: 1500, xp: 400 },
  { id: 'hold', title: 'Full Hold', desc: 'Return to port with $1,000 of cargo', kind: 'cargoReturn', target: 1000, money: 1000, xp: 300 },
  { id: 'survive', title: 'Hot Pursuit', desc: 'Survive a naval patrol (★★ for 45s)', kind: 'survive', target: 45, money: 1500, xp: 450 },
  { id: 'luxury', title: 'Champagne Pirate', desc: 'Capture a Luxury Ship', kind: 'captureType', typeId: 'luxury', target: 1, money: 2500, xp: 600 },
  { id: 'treasure', title: 'X Marks the Spot', desc: 'Find a hidden treasure island', kind: 'treasure', target: 1, money: 1500, xp: 500 },
  { id: 'navy2', title: 'Navy Nemesis', desc: 'Sink 2 navy ships', kind: 'sinkNavy', target: 2, money: 2500, xp: 700 },
  { id: 'iron', title: 'Iron Breaker', desc: 'Capture an Armoured Cargo Ship', kind: 'captureType', typeId: 'armoured', target: 1, money: 4000, xp: 900 },
  { id: 'legend', title: 'Pirate Legend', desc: 'Capture 15 ships', kind: 'capture', target: 15, money: 10000, xp: 2500 },
];

function generated(i: number): MissionDef {
  const k = i % 4;
  const tier = Math.floor(i / 4) + 1;
  if (k === 0) return { id: `gen${i}`, title: 'Plunder Spree', desc: `Capture ${2 + tier} ships`, kind: 'capture', target: 2 + tier, money: 1500 * tier, xp: 500 * tier };
  if (k === 1) return { id: `gen${i}`, title: 'Treasure Hoard', desc: `Earn ${fmtMoney(8000 * tier)}`, kind: 'earn', target: 8000 * tier, money: 1200 * tier, xp: 400 * tier };
  if (k === 2) return { id: `gen${i}`, title: 'Navy Bane', desc: `Sink ${1 + tier} navy ships`, kind: 'sinkNavy', target: 1 + tier, money: 1800 * tier, xp: 600 * tier };
  return { id: `gen${i}`, title: 'Rich Pickings', desc: `Return with ${fmtMoney(1500 * tier)} of cargo`, kind: 'cargoReturn', target: 1500 * tier, money: 1400 * tier, xp: 450 * tier };
}

export interface ActiveMission {
  def: MissionDef;
  progress: number;
  done: boolean;
}

export class Missions {
  active: ActiveMission[] = [];
  private nextIndex = 0;

  constructor(private game: Game) {
    const p = game.profile;
    this.nextIndex = p.missionIndex;
    if (p.missions.length) {
      for (const m of p.missions) {
        const def = this.defById(m.id);
        if (def) this.active.push({ def, progress: m.progress, done: false });
      }
    }
    this.fill();
  }

  private defById(id: string) {
    const s = STORY.find((d) => d.id === id);
    if (s) return s;
    if (id.startsWith('gen')) return generated(Number(id.slice(3)));
    return null;
  }

  private fill() {
    while (this.active.length < 3) {
      const i = this.nextIndex++;
      const def = i < STORY.length ? STORY[i] : generated(i - STORY.length);
      this.active.push({ def, progress: 0, done: false });
    }
    this.persist();
  }

  persist() {
    this.game.profile.missionIndex = this.nextIndex;
    this.game.profile.missions = this.active.map((m) => ({ id: m.def.id, progress: m.progress }));
  }

  event(kind: MissionKind | 'captureAny', data: { typeId?: ShipTypeId; amount?: number; seconds?: number; value?: number } = {}) {
    let changed = false;
    for (const m of this.active) {
      if (m.done) continue;
      const d = m.def;
      switch (d.kind) {
        case 'capture':
          if (kind === 'capture') {
            m.progress++;
            changed = true;
          }
          break;
        case 'captureType':
          if (kind === 'capture' && data.typeId === d.typeId) {
            m.progress++;
            changed = true;
          }
          break;
        case 'earn':
          if (kind === 'earn' && data.amount) {
            m.progress += data.amount;
            changed = true;
          }
          break;
        case 'sell':
          if (kind === 'sell') {
            m.progress++;
            changed = true;
          }
          break;
        case 'cargoReturn':
          if (kind === 'cargoReturn' && (data.value ?? 0) >= d.target) {
            m.progress = d.target;
            changed = true;
          }
          break;
        case 'survive':
          if (kind === 'survive' && data.seconds !== undefined) {
            m.progress = Math.max(m.progress, Math.floor(data.seconds));
            changed = true;
          }
          break;
        case 'treasure':
          if (kind === 'treasure') {
            m.progress++;
            changed = true;
          }
          break;
        case 'sinkNavy':
          if (kind === 'sinkNavy') {
            m.progress++;
            changed = true;
          }
          break;
      }
      if (m.progress >= d.target && !m.done) this.complete(m);
    }
    if (changed) this.persist();
  }

  private complete(m: ActiveMission) {
    m.done = true;
    m.progress = m.def.target;
    const g = this.game;
    audio.play('mission');
    g.ui.toast('✅ MISSION COMPLETE', `${m.def.title}  ·  +${fmtMoney(m.def.money)}  +${m.def.xp} XP`, 'mission');
    g.addMoney(m.def.money, false);
    g.addXp(m.def.xp);
    g.after(2.5, () => {
      this.active = this.active.filter((x) => x !== m);
      this.fill();
    });
  }

  /** The first incomplete mission that wants a specific ship type (for minimap hints). */
  wantedType(): ShipTypeId | null {
    const m = this.active.find((x) => !x.done && x.def.kind === 'captureType');
    return m?.def.typeId ?? null;
  }

  wantsPort() {
    return this.active.some((x) => !x.done && (x.def.kind === 'sell' || x.def.kind === 'cargoReturn'));
  }
}
