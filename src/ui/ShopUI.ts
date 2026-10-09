import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Interactable } from '../world/TownTypes';
import {
  AMMO,
  AMMO_IDS,
  AmmoId,
  CARGO,
  CargoId,
  COSMETICS,
  Cosmetic,
  ROLES,
  SPECIAL_ITEMS,
  UPGRADES,
  UpgradeId,
  TRADE_IDS,
  recruitsFor,
  officerSkill,
} from '../game/Data';
import { SHIP_CLASSES, SHIP_CLASS_IDS, ROMAN, shipStats, upgradeCost, upgradeValue, upgradeLabel, type ShipClassId } from '../game/ShipClasses';
import { classDesign, previewLook, type ClassLook } from '../models/ShipDesigns';
import type { Spinner } from '../models/ShipModel';
import { STALLS, StallType } from '../game/Economy';
import { MAX_CONTRACTS } from '../game/Contracts';
import { fmtMoney, clamp } from '../core/math';
import { audio } from '../core/Audio';
import { buildShip, disposeShipModel, type ShipModel } from '../models/ShipModel';
import { PlayerShip } from '../entities/PlayerShip';
import { portById } from '../world/WorldData';
import { Combat } from '../game/combat/Combat';
import { WEAPONS, WEAPON_IDS, RARITIES, EFFECTS, weaponStats, weaponName, weaponDps, upgradePrice, makeWeapon, MAX_WEAPON_LEVEL, type WeaponBaseId, type Rarity } from '../game/combat/Weapons';

export type ShopKind = 'stall' | 'black' | 'shipwright' | 'gunsmith' | 'bartender' | 'recruit' | 'board' | 'warehouse';

/** How expensive each port's shipwright is, and how far they can upgrade. */
export const YARD: Record<string, { mul: number; max: number; label: string }> = {
  skull: { mul: 1, max: 4, label: 'Fair pirate prices' },
  royal: { mul: 1.25, max: 4, label: 'Royal prices – quality work' },
  salt: { mul: 0.85, max: 2, label: 'Cheap, but only basic upgrades' },
  gold: { mul: 1.4, max: 4, label: 'Luxury prices' },
  lagoon: { mul: 1.1, max: 2, label: 'Island repairs' },
};

/** Gunsmith price multiplier per port. */
const GUN_MUL: Record<string, number> = { royal: 1.15, gold: 1.3 };

/** Shipyards charge a bit more or less for whole ships depending on the port. */
const shipYardMul = (port: string) => 1 + ((YARD[port]?.mul ?? 1) - 1) * 0.5;
const STOCK: Record<UpgradeId, number> = { hull: 0, sails: 0, steering: 0, cannons: 0, range: 0, crew: 0, cargo: 0 };

/** Live 3D turntable of a ship inside the shipwright panel – drag to rotate. */
class ShipPreview {
  canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 2.2, 0.5, 400);
  private model: THREE.Group | null = null;
  private built: ShipModel | null = null;
  private water: THREE.Mesh;
  private spinners: Spinner[] = [];
  private key = '';
  private t = 0;
  private yaw = 0.7;
  private dragging = false;
  private lastX = 0;
  private idleT = 9;
  constructor() {
    this.canvas.className = 'ship-preview';
    this.canvas.title = 'Drag to rotate';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(520, 230, false);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.scene.add(new THREE.HemisphereLight(0xdff2ff, 0x6a5a40, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(20, 30, 15);
    this.scene.add(sun);
    this.water = new THREE.Mesh(new THREE.CircleGeometry(24, 40), new THREE.MeshStandardMaterial({ color: 0x2aa6c9, roughness: 0.3, transparent: true, opacity: 0.85 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.05;
    this.scene.add(this.water);
    this.cam.position.set(0, 9, 30);
    this.cam.lookAt(0, 5, 0);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
      this.idleT = 0;
    });
    const up = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }
  /** Show the ship you're sailing. */
  rebuild(game: Game) {
    this.show(PlayerShip.look(game.profile));
  }
  show(look: ClassLook) {
    const key = JSON.stringify(look);
    if (key === this.key) return;
    this.key = key;
    if (this.model) this.scene.remove(this.model);
    if (this.built) disposeShipModel(this.built);
    const m = buildShip(classDesign(look));
    this.built = m;
    this.model = m.group;
    this.spinners = m.spinners;
    m.sailUniforms.uBillow.value = 0.8;
    this.scene.add(this.model);
    // bigger ships: pull the camera back (but not all the way, so size still reads)
    const k = Math.pow(m.length / 16, 0.8);
    this.cam.position.set(0, 9 * k, 30 * k);
    this.cam.lookAt(0, 4.5 * k, 0);
    this.water.scale.setScalar(Math.max(1, m.length / 15));
  }
  render(dt: number) {
    this.t += dt;
    this.idleT += dt;
    if (!this.dragging && this.idleT > 2.5) this.yaw += dt * 0.45;
    if (this.model) {
      this.model.rotation.y = this.yaw;
      this.model.position.y = Math.sin(this.t * 1.3) * 0.15;
    }
    for (const sp of this.spinners) sp.obj.rotation[sp.axis] += (sp.bySpeed ? 1.4 : sp.rate) * dt;
    this.renderer.render(this.scene, this.cam);
  }
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/**
 * In-world shop screens: a panel beside the vendor with a speech bubble over their head,
 * for market stalls, black markets, the shipwright, gunsmith, tavern and warehouse.
 */
export class ShopUI {
  root: HTMLElement;
  bubble: HTMLElement;
  open = false;
  kind: ShopKind = 'stall';
  it: Interactable | null = null;
  private tab = '';
  private greeting = '';
  private vendor = '';
  private preview: ShipPreview | null = null;
  private v = new THREE.Vector3();
  private flashMsg = '';
  private flashT = 0;
  private shipSel: ShipClassId | null = null;
  private confirmSell: ShipClassId | null = null;

  constructor(private game: Game) {
    this.root = document.createElement('div');
    this.root.className = 'shop hidden';
    document.body.appendChild(this.root);
    this.bubble = document.createElement('div');
    this.bubble.className = 'speech hidden';
    document.body.appendChild(this.bubble);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('mouseover', (e) => {
      if ((e.target as HTMLElement).closest('button')) audio.play('hover', { volume: 0.35 });
    });
  }

  get port() {
    return this.game.currentPortId;
  }

  show(kind: ShopKind, it: Interactable, vendor: string, greeting: string) {
    this.open = true;
    this.kind = kind;
    this.it = it;
    this.vendor = vendor;
    this.greeting = greeting;
    this.tab = { stall: 'buy', black: 'goods', shipwright: 'upgrades', gunsmith: 'cannons', bartender: 'drinks', recruit: 'card', board: 'offers', warehouse: 'transfer' }[kind];
    this.root.classList.remove('hidden');
    this.root.dataset.kind = kind;
    this.bubble.classList.toggle('hidden', !greeting);
    this.bubble.innerHTML = `<b>${vendor}</b>${greeting}`;
    if (kind === 'shipwright') {
      this.preview ??= new ShipPreview();
      this.preview.rebuild(this.game);
      this.shipSel = null;
      this.confirmSell = null;
    }
    this.render();
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
    this.bubble.classList.add('hidden');
  }

  say(text: string) {
    this.greeting = text;
    this.bubble.innerHTML = `<b>${this.vendor}</b>${text}`;
    this.bubble.classList.remove('hidden');
    this.bubble.classList.remove('pop');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('pop');
  }

  private flash(msg: string) {
    this.flashMsg = msg;
    this.flashT = 2.5;
  }

  update(dt: number) {
    if (!this.open || !this.it) return;
    // keep the speech bubble over the vendor's head
    const cam = this.game.camRig.camera;
    this.v.copy(this.it.look).setY(this.it.look.y + 0.75).project(cam);
    const c = this.game.renderer.domElement;
    const x = (this.v.x * 0.5 + 0.5) * c.clientWidth;
    const y = (-this.v.y * 0.5 + 0.5) * c.clientHeight;
    this.bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    this.bubble.style.opacity = this.v.z > 1 ? '0' : '1';
    if (this.kind === 'shipwright' && this.preview) this.preview.render(dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.render();
    }
  }

  // ---------------------------------------------------------------------------
  private onClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const g = this.game;
    const act = btn.dataset.act!;
    const arg = btn.dataset.arg ?? '';
    const n = btn.dataset.n === 'max' ? 999 : Number(btn.dataset.n ?? 1);
    let err: string | null = null;
    switch (act) {
      case 'tab':
        this.tab = arg;
        audio.play('click');
        break;
      case 'close':
        audio.play('click');
        g.closeShop();
        return;
      case 'buy':
        err = g.buyGood(arg as CargoId, n, this.kind === 'black');
        if (!err) this.say(this.pickLine(['Pleasure doing business!', 'A fine choice, Captain.', 'Sold!', 'Mind how you carry it.']));
        break;
      case 'sell':
        err = g.sellGood(arg as CargoId, n, this.buyRate());
        if (!err) this.say(this.pickLine(['Lovely stuff. Here\'s your coin.', 'I\'ll take that off your hands!', 'Good doing business.']));
        break;
      case 'sellAll':
        for (const id of this.sellable()) g.sellGood(id, 999, this.buyRate());
        this.say('Everything? Splendid!');
        break;
      case 'shipSel':
        this.shipSel = arg as ShipClassId;
        this.confirmSell = null;
        audio.play('click');
        break;
      case 'buyShip':
        err = g.buyShip(arg as ShipClassId, shipYardMul(this.port));
        if (!err) this.say(`She's all yours, Captain! Your new ${SHIP_CLASSES[arg as ShipClassId].name} is waiting at the dock.`);
        break;
      case 'switchShip':
        err = g.switchShip(arg as ShipClassId);
        if (!err) this.say("I'll have the lads move your things across. She's at the dock!");
        break;
      case 'sellShip':
        if (this.confirmSell !== arg) {
          this.confirmSell = arg as ShipClassId;
          audio.play('click');
          break;
        }
        this.confirmSell = null;
        err = g.sellShip(arg as ShipClassId);
        if (!err) this.say("I'll find her a good home. Probably.");
        break;
      case 'upgrade':
        err = g.buyUpgrade(arg as UpgradeId, this.kind === 'gunsmith' ? (GUN_MUL[this.port] ?? 1) : (YARD[this.port]?.mul ?? 1));
        if (!err) {
          this.say(arg === 'cannons' || arg === 'range' ? 'BOOM! She\'ll pack a punch now.' : 'Hammer, nails, and – done! Take a look.');
          this.preview?.rebuild(g);
        }
        break;
      case 'repair':
        g.repairShip();
        this.say('Patched up good as new.');
        break;
      case 'cosmetic':
        err = g.buyOrEquipCosmetic(arg);
        this.preview?.rebuild(g);
        break;
      case 'buyWeapon': {
        const [base, rarity] = arg.split(':') as [WeaponBaseId, Rarity];
        err = g.combat.buyWeapon(base, rarity, GUN_MUL[this.port] ?? 1);
        if (!err) this.say(this.pickLine(['A fine blade for a fine captain.', 'Mind the sharp end.', 'She shoots straight – mostly.']));
        break;
      }
      case 'buyShot': {
        const [cnt, price] = arg.split(':').map(Number);
        err = g.combat.buyShot(cnt, price);
        if (!err) this.say('Fresh powder and lead. Keep it dry!');
        break;
      }
      case 'forge':
        err = g.combat.upgradeWeapon(arg, GUN_MUL[this.port] ?? 1);
        if (!err) this.say('*CLANG* *CLANG* – there. Sharper than my wit.');
        break;
      case 'equipArm': {
        const w = g.profile.weapons.find((x) => x.uid === arg);
        if (w) g.combat.equip(w);
        break;
      }
      case 'ammo':
        err = g.buyOrEquipAmmo(arg as AmmoId);
        if (!err) this.say(`${AMMO[arg as AmmoId].name}, loaded and ready.`);
        break;
      case 'item':
        err = g.buyItem(arg);
        if (!err) this.say(this.pickLine(['Nobody saw nothing.', 'Use it well. Or badly. Your choice.', 'No refunds.']));
        break;
      case 'hire':
        g.hireCrew();
        this.say('Fresh deckhands, ready to swab!');
        break;
      case 'rest':
        err = g.restUntilMorning();
        if (!err) {
          g.closeShop();
          return;
        }
        break;
      case 'rumour':
        err = g.buyRumour();
        if (!err) this.say(g.lastRumour);
        break;
      case 'recruit': {
        const r = this.recruits()[Number(arg)];
        err = g.hireOfficer(r);
        if (!err) {
          g.closeShop();
          return;
        }
        break;
      }
      case 'accept': {
        const c = g.contracts.offers(this.port).find((x) => x.id === arg);
        if (c) err = g.contracts.accept(c);
        break;
      }
      case 'abandon':
        g.contracts.abandon(arg);
        break;
      case 'store':
        err = g.storeGood(arg as CargoId, n);
        break;
      case 'take':
        err = g.takeGood(arg as CargoId, n);
        break;
      case 'storeAll':
        for (const id of TRADE_IDS) if ((g.profile.cargo[id] ?? 0) > 0) g.storeGood(id, 999);
        break;
      case 'takeAll':
        for (const id of TRADE_IDS) if ((this.wh()[id] ?? 0) > 0 && !g.takeGood(id, 999)) continue;
        break;
    }
    if (err) {
      audio.play('error');
      this.flash(err);
    }
    this.render();
  }

  private pickLine(a: string[]) {
    return a[Math.floor(Math.random() * a.length)];
  }

  private buyRate() {
    return this.kind === 'black' ? STALLS.black.buyRate : STALLS[this.it?.stall ?? 'general'].buyRate;
  }

  private stallType(): StallType {
    return this.kind === 'black' ? 'black' : (this.it?.stall ?? 'general');
  }

  /** Goods this vendor sells. */
  private forSale(): CargoId[] {
    const t = this.stallType();
    if (t === 'general') return this.game.economy.generalGoods(this.port, this.game.profile.day);
    return STALLS[t].sells;
  }

  /** Goods in your hold this vendor will buy. */
  private sellable(): CargoId[] {
    const cats = STALLS[this.stallType()].buys;
    return TRADE_IDS.filter((id) => (this.game.profile.cargo[id] ?? 0) > 0 && cats.includes(CARGO[id].cat));
  }

  private wh() {
    const p = this.game.profile;
    return (p.warehouses[this.port] ??= {});
  }

  private recruits() {
    const g = this.game;
    return recruitsFor(this.port, g.profile.day);
  }

  // ---------------------------------------------------------------------------
  render() {
    if (!this.open) return;
    const g = this.game;
    const p = g.profile;
    const it = this.it!;
    const tabs: [string, string][] = [];
    let body = '';
    let title = it.label;
    let icon = it.icon;
    switch (this.kind) {
      case 'stall':
        tabs.push(['buy', '🛒 BUY'], ['sell', '💰 SELL']);
        body = this.tab === 'sell' ? this.sellTab() : this.buyTab();
        break;
      case 'black':
        title = this.port === 'lagoon' ? "Hermit's Hidden Wares" : 'Black Market';
        tabs.push(['goods', '🦑 RARE GOODS'], ['special', '✨ SPECIAL ITEMS'], ['sell', '💰 SELL']);
        body = this.tab === 'sell' ? this.sellTab() : this.tab === 'special' ? this.specialTab() : this.buyTab();
        break;
      case 'shipwright': {
        const fresh = SHIP_CLASS_IDS.some((id) => SHIP_CLASSES[id].requiredLevel <= p.level && !p.fleet[id]);
        tabs.push(['ships', `⛵ SHIPS${fresh ? ' <span class="new-badge">NEW</span>' : ''}`], ['upgrades', '🔨 UPGRADES'], ['repair', '🔧 REPAIR'], ['paint', '🎨 PAINT & FLAGS']);
        body = this.tab === 'ships' ? this.shipsTab() : this.tab === 'repair' ? this.repairTab() : this.tab === 'paint' ? this.paintTab() : this.upgradeTab();
        break;
      }
      case 'gunsmith':
        tabs.push(['cannons', '💣 CANNONS'], ['ammo', '⚫ AMMO'], ['arms', '⚔️ HAND WEAPONS'], ['forge', '🔨 FORGE'], ['skins', '✨ SKINS']);
        body = this.tab === 'ammo' ? this.ammoTab() : this.tab === 'skins' ? this.skinTab() : this.tab === 'arms' ? this.armsTab() : this.tab === 'forge' ? this.forgeTab() : this.cannonTab();
        break;
      case 'bartender':
        title = portById(this.port).name === 'Skull Cove' ? 'The Salty Skull' : 'Tavern';
        title = this.game.tavernName;
        tabs.push(['drinks', '🍺 TAVERN'], ['crew', '👥 YOUR OFFICERS']);
        body = this.tab === 'crew' ? this.officerTab() : this.barTab();
        break;
      case 'recruit':
        title = 'Recruit';
        body = this.recruitCard();
        break;
      case 'board':
        title = 'Mission Board';
        tabs.push(['offers', '📜 CONTRACTS'], ['active', `📌 ACCEPTED (${p.contracts.length}/${MAX_CONTRACTS})`]);
        body = this.tab === 'active' ? this.activeTab() : this.offersTab();
        break;
      case 'warehouse':
        body = this.warehouseTab();
        break;
    }
    const used = g.cargoCount;
    const cap = g.cargoCapacity;
    const pct = clamp(used / cap, 0, 1) * 100;
    this.root.innerHTML = `
      <div class="shop-head">
        <div class="sh-ico">${icon}</div>
        <div class="sh-title"><h1>${title}</h1><small>${this.vendor} · ${portById(this.port).name}</small></div>
        <button class="sh-x" data-act="close" title="Leave (Esc)">✕</button>
      </div>
      ${tabs.length ? `<div class="shop-tabs">${tabs.map(([t, n]) => `<button data-act="tab" data-arg="${t}" class="${t === this.tab ? 'on' : ''}">${n}</button>`).join('')}<button data-act="close" class="leave">🚪 LEAVE</button></div>` : ''}
      <div class="shop-body">${this.flashT > 0 ? `<div class="shop-err">⚠️ ${this.flashMsg}</div>` : ''}${body}</div>
      <div class="shop-foot">
        <div class="sf-money">💰 ${fmtMoney(p.money)}</div>
        <div class="sf-cargo"><span>📦 CARGO ${used} / ${cap}</span><div class="cbar"><div style="width:${pct}%" class="${pct > 90 ? 'full' : ''}"></div></div><small>Cargo value ${fmtMoney(g.cargoValue)}</small></div>
      </div>`;
    if (this.kind === 'shipwright' && this.preview && (this.tab === 'upgrades' || this.tab === 'ships')) {
      const slot = this.root.querySelector('.preview-slot');
      if (slot) slot.appendChild(this.preview.canvas);
      if (this.tab === 'ships') this.preview.show(this.selLook(this.selectedShip()));
      else this.preview.rebuild(g);
    }
    void icon;
  }

  // ---------------------------------------------------------------- market
  private buyTab() {
    const g = this.game;
    const p = g.profile;
    const eco = g.economy;
    const space = g.cargoCapacity - g.cargoCount;
    const rows = this.forSale()
      .map((id) => {
        const c = CARGO[id];
        const price = eco.buyPrice(this.port, id);
        const avg = eco.avgPrice(id);
        const best = eco.bestSell(id, this.port);
        const profit = best.price - price;
        const trend = eco.trend(this.port, id);
        const tag = trend < -0.35 ? '<span class="tag cheap">CHEAP</span>' : trend > 0.35 ? '<span class="tag pricey">PRICEY</span>' : '';
        const maxN = Math.min(space, Math.floor(p.money / price));
        return `<div class="good">
          <div class="gi" style="--gc:${c.color}">${c.icon}</div>
          <div class="gn"><b>${c.name} ${tag}</b><small>${c.desc}</small><small class="own">In hold: ×${p.cargo[id] ?? 0}</small></div>
          <div class="gp">
            <div class="price">${fmtMoney(price)}<i>/crate</i></div>
            <div class="avg">Avg ${fmtMoney(avg)}</div>
            <div class="profit ${profit > 0 ? 'up' : 'down'}">${profit > 0 ? '+' : ''}${fmtMoney(profit)} <i>at ${best.port.name}</i></div>
          </div>
          <div class="gb">
            <button class="btn small gold" data-act="buy" data-arg="${id}" data-n="1" ${maxN < 1 ? 'disabled' : ''}>+1</button>
            <button class="btn small gold" data-act="buy" data-arg="${id}" data-n="5" ${maxN < 5 ? 'disabled' : ''}>+5</button>
            <button class="btn small" data-act="buy" data-arg="${id}" data-n="max" ${maxN < 1 ? 'disabled' : ''}>MAX</button>
          </div>
        </div>`;
      })
      .join('');
    const note = space <= 0 ? '<div class="shop-note">Your hold is full! Sell something, or store cargo in a warehouse.</div>' : `<div class="shop-note">Buy low here, sail to another port and sell high. <b>${space}</b> crates of space left.</div>`;
    return note + rows;
  }

  private sellTab() {
    const g = this.game;
    const p = g.profile;
    const eco = g.economy;
    const rate = this.buyRate();
    const ids = this.sellable();
    if (!ids.length) {
      const cats = STALLS[this.stallType()].buys.join(', ');
      return `<div class="empty">🕸️ Nothing this vendor wants.<br/><small>They buy: ${cats}</small></div>`;
    }
    const total = ids.reduce((s, id) => s + eco.quoteSell(this.port, id, p.cargo[id] ?? 0, rate), 0);
    return (
      `<div class="shop-note">${rate < 1 ? `This trader pays ${Math.round(rate * 100)}% of the market price.` : 'Prices drop a little with every crate you sell here.'}</div>` +
      ids
        .map((id) => {
          const c = CARGO[id];
          const qty = p.cargo[id] ?? 0;
          const price = eco.sellPrice(this.port, id, rate);
          const paid = p.costBasis[id];
          const prof = paid !== undefined ? price - paid : price;
          return `<div class="good">
            <div class="gi" style="--gc:${c.color}">${c.icon}</div>
            <div class="gn"><b>${c.name} ×${qty}</b><small>${paid !== undefined ? `You paid ${fmtMoney(paid)} each` : 'Plundered – pure profit!'}</small></div>
            <div class="gp"><div class="price">${fmtMoney(price)}<i>/crate</i></div><div class="profit ${prof >= 0 ? 'up' : 'down'}">${prof >= 0 ? '+' : ''}${fmtMoney(prof)} <i>per crate</i></div></div>
            <div class="gb">
              <button class="btn small green" data-act="sell" data-arg="${id}" data-n="1">−1</button>
              <button class="btn small green" data-act="sell" data-arg="${id}" data-n="5" ${qty < 5 ? 'disabled' : ''}>−5</button>
              <button class="btn small" data-act="sell" data-arg="${id}" data-n="max">ALL</button>
            </div>
          </div>`;
        })
        .join('') +
      `<div class="shop-row-end"><button class="btn gold" data-act="sellAll">💰 Sell all · ${fmtMoney(total)}</button></div>`
    );
  }

  private specialTab() {
    const p = this.game.profile;
    const where = this.port === 'lagoon' ? 'remote' : 'blackmarket';
    return SPECIAL_ITEMS.filter((i) => i.where.includes(where))
      .map((i) => {
        const owned = p.items.includes(i.id) && !i.repeatable;
        const soldOut = i.id === 'treasureMap' && !this.game.unmappedTreasure();
        return `<div class="good item">
          <div class="gi">${i.icon}</div>
          <div class="gn"><b>${i.name}</b><small>${i.desc}</small></div>
          <div class="gp"><div class="price">${owned ? '✔ Owned' : fmtMoney(i.cost)}</div></div>
          <div class="gb"><button class="btn small gold" data-act="item" data-arg="${i.id}" ${owned || soldOut || p.money < i.cost ? 'disabled' : ''}>${owned ? 'Owned' : soldOut ? 'Sold out' : 'Buy'}</button></div>
        </div>`;
      })
      .join('');
  }

  // ---------------------------------------------------------------- shipwright
  private upgradeTab() {
    const g = this.game;
    const yard = YARD[this.port] ?? YARD.skull;
    const cards = (['hull', 'sails', 'cannons', 'steering', 'cargo', 'crew'] as UpgradeId[]).map((id) => this.upgradeCard(id, yard.mul, yard.max)).join('');
    const c = g.shipClass;
    return `<div class="preview-wrap"><div class="preview-slot"></div><div class="pv-name">${c.icon} ${c.shipName}<small>Class ${ROMAN[c.tier]} · ${c.name}</small></div><div class="pv-stats">
        <span>❤️ ${g.player.maxHp} HP</span><span>⛵ ${Math.round(g.player.maxSpeed)} kn</span><span>📦 ${g.cargoCapacity}</span><span>👥 ${g.maxCrew}</span>
      </div></div>
      <div class="shop-note">${yard.label}${yard.mul !== 1 ? ` (×${yard.mul} cost)` : ''}. Upgrades change how your ship looks!</div>
      <div class="cards">${cards}</div>`;
  }

  private upgradeCard(id: UpgradeId, mul: number, maxLvl: number) {
    const g = this.game;
    const cls = g.profile.ship;
    const u = UPGRADES[id];
    const lab = upgradeLabel(cls, id);
    const lvl = g.profile.upgrades[id];
    const max = lvl >= u.costs.length;
    const capped = !max && lvl >= maxLvl;
    const cost = max ? 0 : upgradeCost(cls, id, lvl, mul)!;
    const pips = Array.from({ length: u.mul.length - 1 }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const next = lab.levels[lvl + 1];
    return `<div class="ucard">
      <div class="uc-h"><span>${lab.icon}</span><b>${lab.name}</b></div>
      <div class="pips">${pips}</div>
      <div class="uc-now">${lab.levels[lvl] ?? ''}</div>
      <div class="uc-stat">${u.stat}: ${u.fmt(upgradeValue(cls, id, lvl))}${max ? ' <em>(MAX)</em>' : ` → <span class="up">${u.fmt(upgradeValue(cls, id, lvl + 1))}</span>`}</div>
      ${next && !max ? `<div class="uc-next">Next: ${next}</div>` : ''}
      <div class="uc-vis">${lab.visual}</div>
      <button class="btn small ${max || capped ? '' : 'gold'}" data-act="upgrade" data-arg="${id}" ${max || capped || g.profile.money < cost ? 'disabled' : ''}>${max ? 'Maxed out' : capped ? 'Not sold here' : `Upgrade · ${fmtMoney(cost)}`}</button>
    </div>`;
  }

  /** Class picked in the SHIPS tab (default: the next ship worth looking at). */
  private selectedShip(): ShipClassId {
    const p = this.game.profile;
    if (this.shipSel) return this.shipSel;
    const tier = SHIP_CLASSES[p.ship].tier;
    const ids = SHIP_CLASS_IDS.filter((id) => SHIP_CLASSES[id].tier > tier);
    return ids.find((id) => !p.fleet[id] && SHIP_CLASSES[id].requiredLevel <= p.level) ?? ids.find((id) => !p.fleet[id]) ?? p.ship;
  }

  /** What a class looks like in the preview: your own ship if you own one, else stock. */
  private selLook(id: ShipClassId): ClassLook {
    const p = this.game.profile;
    const base = PlayerShip.look(p);
    if (id === p.ship) return base;
    const own = p.fleet[id];
    if (!own) return previewLook(id, base);
    const u = own.upgrades;
    return { ...base, cls: id, perSide: shipStats(id, u).perSide, hullLvl: u.hull, sailLvl: u.sails, cannonLvl: u.cannons, rangeLvl: u.range, steerLvl: u.steering, cargoLvl: u.cargo };
  }

  private shipsTab() {
    const g = this.game;
    const p = g.profile;
    const sel = this.selectedShip();
    const c = SHIP_CLASSES[sel];
    const own = p.fleet[sel];
    const active = p.ship === sel;
    const locked = p.level < c.requiredLevel;
    const price = g.shipPrice(sel, shipYardMul(this.port));
    const st = shipStats(sel, active ? p.upgrades : (own?.upgrades ?? STOCK));
    const cur = g.shipStats;
    const cmp = (v: number, now: number, txt: string) => `<b>${txt}</b>${!active && Math.abs(v - now) > 0.01 ? `<i class="${v > now ? 'up' : 'down'}">${v > now ? '▲' : '▼'}</i>` : ''}`;
    const power = (x: typeof st) => Math.round(x.damage * x.perSide);
    const statRow = (icon: string, name: string, html: string) => `<div class="sd-stat"><span>${icon}</span><small>${name}</small>${html}</div>`;
    let action: string;
    if (active) action = `<button class="btn" disabled>⛵ You're sailing her</button>`;
    else if (own)
      action = `<button class="btn green" data-act="switchShip" data-arg="${sel}">⛵ Sail this ship</button><button class="btn small ${this.confirmSell === sel ? 'red' : ''}" data-act="sellShip" data-arg="${sel}">${this.confirmSell === sel ? `Really sell for ${fmtMoney(g.shipResale(sel))}?` : `💰 Sell · ${fmtMoney(g.shipResale(sel))}`}</button>`;
    else if (locked) action = `<button class="btn locked" disabled>🔒 LOCKED – Reach Level ${c.requiredLevel} to unlock</button>`;
    else action = `<button class="btn gold" data-act="buyShip" data-arg="${sel}" ${p.money < price ? 'disabled' : ''}>${p.money < price ? `Need ${fmtMoney(price)}` : `Buy · ${fmtMoney(price)}`}</button>`;
    const list = SHIP_CLASS_IDS.map((id) => {
      const k = SHIP_CLASSES[id];
      const lk = p.level < k.requiredLevel;
      const tag = p.ship === id ? '<em class="sailing">SAILING</em>' : p.fleet[id] ? '<em class="owned">OWNED</em>' : lk ? `<em class="lock">🔒 Lv ${k.requiredLevel}</em>` : `<em>${fmtMoney(g.shipPrice(id, shipYardMul(this.port)))}</em>`;
      return `<div class="sl-card ${id === sel ? 'on' : ''} ${lk ? 'locked' : ''}" data-act="shipSel" data-arg="${id}"><span class="sl-ico">${k.icon}</span><small>Class ${ROMAN[k.tier]}</small><b>${k.name}</b>${tag}</div>`;
    }).join('');
    return `<div class="preview-wrap tall"><div class="preview-slot"></div>
        <div class="pv-name">${c.icon} ${c.shipName}<small>Class ${ROMAN[c.tier]} · ${c.name}</small></div>
        <div class="pv-hint">🖱️ drag to rotate</div>
        ${locked ? `<div class="pv-lock">🔒 LOCKED<small>Reach Level ${c.requiredLevel} to unlock</small></div>` : ''}
      </div>
      <div class="ship-detail">
        <div class="sd-head">
          <div><small>SHIP CLASS</small><b>Class ${ROMAN[c.tier]} · ${c.name}</b></div>
          <div><small>REQUIRED LEVEL</small><b class="${locked ? 'bad' : 'ok'}">Level ${c.requiredLevel} ${locked ? '🔒' : '✔'}</b></div>
          <div><small>PRICE</small><b>${own ? 'Owned' : c.purchasePrice ? fmtMoney(price) : 'Free'}</b></div>
          <div><small>ENGINE</small><b>${c.engineType}</b></div>
        </div>
        <p class="sd-desc">${c.desc}${!active ? ` <span class="sd-cmp">▲▼ compared with your ${g.shipClass.name}.</span>` : ''}</p>
        <div class="sd-stats">
          ${statRow('❤️', 'Health', cmp(st.maxHp, cur.maxHp, `${st.maxHp}`))}
          ${statRow('⚡', 'Speed', cmp(st.speed, cur.speed, `${Math.round(st.speed)} kn`))}
          ${statRow('📦', 'Cargo', cmp(st.cargo, cur.cargo, `${st.cargo}`))}
          ${statRow('👥', 'Crew', cmp(st.crew, cur.crew, `${st.crew}`))}
          ${statRow('💥', 'Cannon Power', cmp(power(st), power(cur), `${power(st)}`) + `<small class="sub">${st.guns} guns · ${Math.round(st.range)} m</small>`)}
          ${statRow('🛡', 'Boarding', cmp(st.boarding, cur.boarding, `×${st.boarding.toFixed(2)}`))}
        </div>
        <div class="sd-actions">${action}</div>
      </div>
      <div class="ship-list">${list}</div>`;
  }

  private repairTab() {
    const g = this.game;
    const missing = g.player.maxHp - g.player.hp;
    return `<div class="good">
      <div class="gi">🔧</div>
      <div class="gn"><b>Repair Hull</b><small>${missing > 0 ? `${Math.ceil(missing)} damage to patch up` : 'Shipshape and Bristol fashion!'}</small></div>
      <div class="gp"><div class="price">${missing > 0 ? fmtMoney(g.repairCost) : '—'}</div></div>
      <div class="gb"><button class="btn small gold" data-act="repair" ${missing <= 0 || g.profile.money < 4 ? 'disabled' : ''}>${missing > 0 ? 'Repair' : 'Full'}</button></div>
    </div>`;
  }

  private paintTab() {
    const p = this.game.profile;
    const group = (kind: Cosmetic['kind'], title: string) =>
      `<div class="sec-title">${title}</div><div class="swatches">${COSMETICS.filter((c) => c.kind === kind && (!c.special || p.owned.includes(c.id)))
        .map((c) => {
          const owned = p.owned.includes(c.id);
          const eq = p.sail === c.id || p.hull === c.id || p.flag === c.id || p.cannonSkin === c.id;
          return `<div class="swatch ${eq ? 'eq' : ''} ${owned ? '' : 'locked'}" data-act="cosmetic" data-arg="${c.id}"><div class="sw" style="background:${c.swatch}"></div>${c.name}<br/>${eq ? '✔ Equipped' : owned ? 'Equip' : fmtMoney(c.cost)}</div>`;
        })
        .join('')}</div>`;
    return group('sail', '⛵ Sails') + group('hull', '🚢 Hull Paint') + group('flag', '🏴‍☠️ Flag');
  }

  // ---------------------------------------------------------------- gunsmith
  private cannonTab() {
    const g = this.game;
    const p = g.profile;
    const mul = GUN_MUL[this.port] ?? 1;
    const turret = g.shipClass.layout === 'turret';
    const row = (id: UpgradeId) => {
      const u = UPGRADES[id];
      const lab = upgradeLabel(p.ship, id);
      const lvl = p.upgrades[id];
      const max = lvl >= u.costs.length;
      const cost = max ? 0 : upgradeCost(p.ship, id, lvl, mul)!;
      const nl = max ? lvl : lvl + 1;
      const st = shipStats(p.ship, { ...p.upgrades, [id]: nl });
      const desc = id === 'cannons' ? (turret ? 'Bigger turret guns hit harder and reload faster.' : 'Heavier guns hit harder and reload faster. One extra gun a side at level 3.') : 'Longer barrels throw your shot further.';
      return `<div class="good wide">
        <div class="gi">${lab.icon}</div>
        <div class="gn"><b>${max ? lab.levels[lvl] : lab.levels[lvl + 1]}</b><small>${desc}</small>
          <div class="stats3"><span>💥 Damage <b>${Math.round(st.damage)}</b></span><span>🎯 Range <b>${Math.round(st.range)} m</b></span><span>⏱️ Reload <b>${st.reload.toFixed(2)} s</b></span></div>
          <small class="own">Fitted: ${lab.levels[lvl]}</small></div>
        <div class="gp"><div class="price">${max ? 'MAX' : fmtMoney(cost)}</div></div>
        <div class="gb"><button class="btn small gold" data-act="upgrade" data-arg="${id}" ${max || p.money < cost ? 'disabled' : ''}>${max ? 'Maxed' : 'Buy'}</button></div>
      </div>`;
    };
    void g;
    const st = g.shipStats;
    return `<div class="shop-note">${g.shipClass.name}: ${st.guns} guns · ${upgradeLabel(p.ship, 'cannons').levels[p.upgrades.cannons]} with ${upgradeLabel(p.ship, 'range').levels[p.upgrades.range].toLowerCase()}.${officerSkill(p, 'gunner') ? ` Your gunner reloads ${officerSkill(p, 'gunner') * 7}% faster.` : ''}</div>` + row('cannons') + row('range');
  }

  private ammoTab() {
    const p = this.game.profile;
    const ss = this.game.shipStats;
    const base = ss.damage;
    const rng = ss.range;
    const rel = ss.reload;
    return (
      `<div class="shop-note">Switch ammo at sea with <kbd>Q</kbd>.</div>` +
      AMMO_IDS.map((id) => {
        const a = AMMO[id];
        const owned = p.ammo.includes(id);
        const eq = p.ammoSel === id;
        return `<div class="good wide ${eq ? 'equipped' : ''}">
          <div class="gi">${a.icon}</div>
          <div class="gn"><b>${a.name}</b><small>${a.desc}</small>
            <div class="stats3"><span>💥 Damage <b>${Math.round(base * a.dmg)}</b></span><span>🎯 Range <b>${Math.round(rng * a.range)} m</b></span><span>⏱️ Reload <b>${(rel * a.reload).toFixed(2)} s</b></span></div></div>
          <div class="gp"><div class="price">${owned ? (eq ? '✔ Loaded' : 'Owned') : fmtMoney(a.cost)}</div></div>
          <div class="gb"><button class="btn small ${owned ? '' : 'gold'}" data-act="ammo" data-arg="${id}" ${eq || (!owned && p.money < a.cost) ? 'disabled' : ''}>${eq ? 'Loaded' : owned ? 'Load' : 'Buy'}</button></div>
        </div>`;
      }).join('')
    );
  }

  /** Swords, axes and pistols for fighting on land, plus pistol shot. */
  private armsTab() {
    const g = this.game;
    const p = g.profile;
    const mul = GUN_MUL[this.port] ?? 1;
    const shotDeals: [number, number][] = [
      [10, Math.round(60 * mul)],
      [30, Math.round(160 * mul)],
    ];
    const shot = shotDeals
      .map(
        ([n, price]) => `<div class="good wide"><div class="gi">🎯</div><div class="gn"><b>Pistol Shot ×${n}</b><small>Lead balls and powder for any gun. You carry ${p.shot}.</small></div>
          <div class="gp"><div class="price">${fmtMoney(price)}</div></div>
          <div class="gb"><button class="btn small gold" data-act="buyShot" data-arg="${n}:${price}" ${p.money < price ? 'disabled' : ''}>Buy</button></div></div>`,
      )
      .join('');
    const rows = WEAPON_IDS.map((id) => {
      const b = WEAPONS[id];
      const locked = b.unlockLevel > p.level;
      const offers: Rarity[] = ['common', 'uncommon'];
      return offers
        .map((rar) => {
          const st = weaponStats(makeWeapon(id, rar));
          const price = Combat.priceOf(id, rar, mul);
          const owned = p.weapons.filter((w) => w.base === id && w.rarity === rar).length;
          const stats = b.kind === 'ranged' ? `<span>💥 Damage <b>${Math.round(st.damage)}${st.pellets > 1 ? ` ×${st.pellets}` : ''}</b></span><span>🎯 Range <b>${b.range} m</b></span><span>🔄 Reload <b>${st.reload.toFixed(1)} s</b></span>` : `<span>💥 Damage <b>${Math.round(st.damage)}</b></span><span>⚡ Speed <b>×${st.speed.toFixed(2)}</b></span><span>📏 Reach <b>${b.range.toFixed(1)} m</b></span>`;
          return `<div class="good wide ${locked ? 'locked' : ''}">
          <div class="gi">${b.icon}</div>
          <div class="gn"><b><span style="color:${RARITIES[rar].color}">${weaponName(makeWeapon(id, rar))}</span></b><small>${b.desc}</small>
            <div class="stats3">${stats}</div>${owned ? `<small class="own">You own ${owned}</small>` : ''}</div>
          <div class="gp"><div class="price">${locked ? `🔒 Lv ${b.unlockLevel}` : fmtMoney(price)}</div></div>
          <div class="gb"><button class="btn small gold" data-act="buyWeapon" data-arg="${id}:${rar}" ${locked || p.money < price ? 'disabled' : ''}>${locked ? 'Locked' : 'Buy'}</button></div>
        </div>`;
        })
        .join('');
    }).join('');
    return `<div class="shop-note">Weapons for fighting on land. Rare, Epic and Legendary arms only drop from pirates and chests!</div>${shot}<div class="sec-title">Blades &amp; guns</div>${rows}`;
  }

  /** Upgrade owned weapons with money and iron scrap. */
  private forgeTab() {
    const g = this.game;
    const p = g.profile;
    const mul = GUN_MUL[this.port] ?? 1;
    const order = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
    const list = [...p.weapons].sort((a, b) => Number(b.uid === p.melee || b.uid === p.ranged) - Number(a.uid === p.melee || a.uid === p.ranged) || order.indexOf(a.rarity) - order.indexOf(b.rarity));
    const rows = list
      .map((w) => {
        const st = weaponStats(w);
        const nx = upgradePrice(w);
        const next = nx ? weaponStats({ ...w, level: w.level + 1 }) : null;
        const money = nx ? Math.round(nx.money * mul) : 0;
        const can = !!nx && p.money >= money && p.scrap >= nx.scrap;
        const eq = w.uid === p.melee || w.uid === p.ranged;
        return `<div class="good wide ${eq ? 'equipped' : ''}">
          <div class="gi">${st.base.icon}</div>
          <div class="gn"><b><span style="color:${RARITIES[w.rarity].color}">${weaponName(w)}</span> ${w.level ? `+${w.level}` : ''}</b><small>${RARITIES[w.rarity].name} ${st.base.name}${w.effect ? ` · ${EFFECTS[w.effect].icon} ${EFFECTS[w.effect].desc}` : ''}</small>
            <div class="stats3"><span>💥 Damage <b>${Math.round(st.damage)}${next ? ` → ${Math.round(next.damage)}` : ''}</b></span><span>💪 DPS <b>${Math.round(weaponDps(st))}${next ? ` → ${Math.round(weaponDps(next))}` : ''}</b></span><span>⭐ Level <b>${w.level} / ${MAX_WEAPON_LEVEL}</b></span></div>
            ${eq ? '<small class="own">Equipped</small>' : `<button class="btn small" data-act="equipArm" data-arg="${w.uid}">Equip</button>`}</div>
          <div class="gp"><div class="price">${nx ? `${fmtMoney(money)}<br/><small>🔩 ${nx.scrap} scrap</small>` : 'MAX'}</div></div>
          <div class="gb"><button class="btn small gold" data-act="forge" data-arg="${w.uid}" ${can ? '' : 'disabled'}>${nx ? 'Upgrade' : 'Maxed'}</button></div>
        </div>`;
      })
      .join('');
    return `<div class="shop-note">🔩 You have <b>${p.scrap}</b> iron scrap. Each upgrade adds +9% damage (and faster reloads for guns).</div>${rows}`;
  }

  private skinTab() {
    const p = this.game.profile;
    return `<div class="shop-note">Cosmetic cannon finishes – purely for swagger.</div><div class="swatches">${COSMETICS.filter((c) => c.kind === 'cannon' && (!c.special || p.owned.includes(c.id)))
      .map((c) => {
        const owned = p.owned.includes(c.id);
        const eq = p.cannonSkin === c.id;
        return `<div class="swatch ${eq ? 'eq' : ''} ${owned ? '' : 'locked'}" data-act="cosmetic" data-arg="${c.id}"><div class="sw" style="background:${c.swatch}"></div>${c.name}<br/>${eq ? '✔ Equipped' : owned ? 'Equip' : fmtMoney(c.cost)}</div>`;
      })
      .join('')}</div>`;
  }

  // ---------------------------------------------------------------- tavern
  private barTab() {
    const g = this.game;
    const p = g.profile;
    const missing = g.maxCrew - p.crew;
    const night = g.env.night > 0.5;
    return `
      <div class="good"><div class="gi">🍺</div><div class="gn"><b>Hire Deckhands</b><small>${missing > 0 ? `${missing} bunks empty · $40 per scallywag` : 'Your crew is at full strength!'}</small></div>
        <div class="gp"><div class="price">${missing > 0 ? fmtMoney(Math.min(missing, Math.floor(p.money / 40)) * 40) : '—'}</div></div>
        <div class="gb"><button class="btn small gold" data-act="hire" ${missing <= 0 || p.money < 40 ? 'disabled' : ''}>Hire</button></div></div>
      <div class="good"><div class="gi">🛏️</div><div class="gn"><b>Rent a Room</b><small>${night ? 'Sleep until morning – the markets will be open again.' : 'Have a nap until evening, when the tavern gets lively.'}</small></div>
        <div class="gp"><div class="price">${fmtMoney(25)}</div></div>
        <div class="gb"><button class="btn small gold" data-act="rest" ${p.money < 25 ? 'disabled' : ''}>Rest</button></div></div>
      <div class="good"><div class="gi">🗣️</div><div class="gn"><b>Buy a Round</b><small>Loosen some tongues and hear the latest rumours.</small></div>
        <div class="gp"><div class="price">${fmtMoney(30)}</div></div>
        <div class="gb"><button class="btn small gold" data-act="rumour" ${p.money < 30 ? 'disabled' : ''}>Buy</button></div></div>
      <div class="shop-note">📜 Contracts are pinned on the mission board by the door. Recruits are sitting around the tavern – go and talk to them!</div>`;
  }

  private officerTab() {
    const p = this.game.profile;
    if (!p.officers.length) return '<div class="empty">🪑 No officers yet.<br/><small>Talk to the recruits around the tavern to hire gunners, navigators, engineers, boarders and traders.</small></div>';
    return p.officers
      .map((o) => {
        const r = ROLES[o.role];
        return `<div class="good"><div class="gi" style="--gc:${r.color}">${r.icon}</div><div class="gn"><b>${o.name}</b><small>${r.name} · ${stars(o.skill)} · ${r.bonus(o.skill)}</small><small class="own">“${o.ability}”</small></div></div>`;
      })
      .join('');
  }

  private recruitCard() {
    const g = this.game;
    const p = g.profile;
    const idx = this.it?.recruitIdx ?? 0;
    const r = this.recruits()[idx];
    if (!r || p.hiredRecruits.includes(r.id)) return '<div class="empty">This seat is empty now.</div>';
    const role = ROLES[r.role];
    const current = p.officers.find((o) => o.role === r.role);
    return `<div class="recruit">
      <div class="rc-role" style="--gc:${role.color}">${role.icon}<span>${role.name.toUpperCase()}</span></div>
      <div class="rc-name">${r.name}</div>
      <div class="rc-stars">${stars(r.skill)} <small>Skill ${r.skill}</small></div>
      <div class="rc-quote">“${r.line}”</div>
      <div class="rc-grid">
        <div><small>SPECIAL ABILITY</small><b>${r.ability}</b></div>
        <div><small>BONUS</small><b>${role.bonus(r.skill)}</b></div>
        <div><small>COST</small><b class="gold">${fmtMoney(r.cost)}</b></div>
      </div>
      ${current ? `<div class="shop-note">Replaces your current ${role.name.toLowerCase()}, ${current.name} (${stars(current.skill)}).</div>` : ''}
      <div class="rc-btns"><button class="btn gold" data-act="recruit" data-arg="${idx}" ${p.money < r.cost ? 'disabled' : ''}>🤝 HIRE · ${fmtMoney(r.cost)}</button><button class="btn" data-act="close">Maybe later</button></div>
    </div>`;
  }

  // ---------------------------------------------------------------- missions
  private contractRow(c: ReturnType<Game['contracts']['offers']>[number], active: boolean) {
    const g = this.game;
    const icon = { deliver: '📦', transport: '🔒', capture: '⚔️', captureType: '🎯', treasure: '🗺️', rival: '🏴‍☠️', reach: '🧭' }[c.kind] ?? '📜';
    const taken = g.contracts.accepted(c.id);
    const prog = c.kind === 'capture' ? ` (${c.progress}/${c.target})` : '';
    return `<div class="contract ${active ? 'active' : ''}">
      <div class="ct-ico">${icon}</div>
      <div class="ct-body"><b>${c.title}${prog}</b><small>${c.desc}</small></div>
      <div class="ct-rew"><b>${fmtMoney(c.money)}</b><small>+${c.xp} XP</small></div>
      ${active ? `<button class="btn small red" data-act="abandon" data-arg="${c.id}">✕</button>` : `<button class="btn small gold" data-act="accept" data-arg="${c.id}" ${taken || g.profile.contracts.length >= MAX_CONTRACTS ? 'disabled' : ''}>${taken ? '✔ Taken' : 'Accept'}</button>`}
    </div>`;
  }

  private offersTab() {
    const offers = this.game.contracts.offers(this.port);
    if (!offers.length) return '<div class="empty">📭 No new jobs today. Come back tomorrow!</div>';
    return `<div class="shop-note">New contracts are posted every day. You can take up to ${MAX_CONTRACTS} at once.</div>` + offers.map((c) => this.contractRow(c, false)).join('');
  }

  private activeTab() {
    const list = this.game.profile.contracts;
    if (!list.length) return '<div class="empty">No contracts accepted yet.</div>';
    return list.map((c) => this.contractRow(c, true)).join('');
  }

  // ---------------------------------------------------------------- warehouse
  private warehouseTab() {
    const g = this.game;
    const p = g.profile;
    const wh = this.wh();
    const space = g.cargoCapacity - g.cargoCount;
    const hold = TRADE_IDS.filter((id) => (p.cargo[id] ?? 0) > 0);
    const stored = TRADE_IDS.filter((id) => (wh[id] ?? 0) > 0);
    const col = (ids: CargoId[], src: Partial<Record<CargoId, number>>, act: 'store' | 'take') =>
      ids.length
        ? ids
            .map((id) => {
              const c = CARGO[id];
              const q = src[id] ?? 0;
              return `<div class="wrow"><span class="wi">${c.icon}</span><span class="wn">${c.name}<b>×${q}</b></span>
                <button class="btn small" data-act="${act}" data-arg="${id}" data-n="1" ${act === 'take' && space < 1 ? 'disabled' : ''}>1</button>
                <button class="btn small" data-act="${act}" data-arg="${id}" data-n="5" ${q < 5 || (act === 'take' && space < 5) ? 'disabled' : ''}>5</button>
                <button class="btn small ${act === 'store' ? 'gold' : 'green'}" data-act="${act}" data-arg="${id}" data-n="max">${act === 'store' ? 'Store' : 'Take'}</button></div>`;
            })
            .join('')
        : `<div class="empty small">${act === 'store' ? 'Your hold is empty.' : 'Nothing stored here yet.'}</div>`;
    const elsewhere = Object.entries(p.warehouses)
      .filter(([port, w]) => port !== this.port && Object.values(w).some((v) => (v ?? 0) > 0))
      .map(([port, w]) => `<span>${portById(port).name}: ${Object.entries(w).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${CARGO[k as CargoId].icon}×${v}`).join(' ')}</span>`)
      .join('');
    return `<div class="shop-note">Store cargo here and pick it up any time you visit. Each port has its own warehouse.</div>
      <div class="whcols">
        <div class="whcol"><h3>⛵ Ship Hold <small>${g.cargoCount}/${g.cargoCapacity}</small></h3>${col(hold, p.cargo, 'store')}<button class="btn small gold wide" data-act="storeAll" ${hold.length ? '' : 'disabled'}>⬇ Store everything</button></div>
        <div class="whcol"><h3>📦 ${portById(this.port).name} Warehouse</h3>${col(stored, wh, 'take')}<button class="btn small green wide" data-act="takeAll" ${stored.length && space > 0 ? '' : 'disabled'}>⬆ Load everything</button></div>
      </div>
      ${elsewhere ? `<div class="sec-title">Other warehouses</div><div class="elsewhere">${elsewhere}</div>` : ''}`;
  }
}
