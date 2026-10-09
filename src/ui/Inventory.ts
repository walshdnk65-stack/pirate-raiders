import type { Game } from '../game/Game';
import { AMMO, AMMO_IDS, CARGO, CARGO_IDS, ROLES, SPECIAL_ITEMS, UPGRADES, UPGRADE_IDS, MAX_UPGRADE, cosmeticById, xpForLevel } from '../game/Data';
import { SHIP_CLASSES, SHIP_CLASS_IDS, ROMAN, nextClass, upgradeLabel, upgradeValue } from '../game/ShipClasses';
import { fmtMoney, clamp } from '../core/math';
import { audio } from '../core/Audio';
import { portById } from '../world/WorldData';
import { weaponStats, weaponName, weaponDps, upgradePrice, RARITIES, EFFECTS, WEAPONS, MAX_WEAPON_LEVEL, type WeaponItem } from '../game/combat/Weapons';
import { SITES } from '../game/combat/Encounters';

type Tab = 'ship' | 'arms' | 'cargo' | 'gear' | 'crew' | 'quests';

/** Captain's inventory: money, cargo, equipment, crew, quest items and treasure. */
export class Inventory {
  root: HTMLElement;
  open = false;
  private tab: Tab = 'ship';
  /** the panel stays in the page while open, so refreshing it doesn't replay its pop-in animation */
  private panel: HTMLElement;
  private lastHtml = '';

  constructor(private game: Game) {
    this.root = document.createElement('div');
    this.root.className = 'inventory hidden';
    this.panel = document.createElement('div');
    this.panel.className = 'inv-panel';
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.act === 'close') this.toggle(false);
      if (b.dataset.act === 'equip' || b.dataset.act === 'salvage') {
        const g = this.game;
        const w = g.profile.weapons.find((x) => x.uid === b.dataset.arg);
        if (w && b.dataset.act === 'equip') g.combat.equip(w);
        else if (w) {
          const err = g.combat.salvage(w.uid);
          if (err) {
            audio.play('error');
            g.ui.toast('⚠️ Can’t salvage', err, 'danger');
          }
        }
        this.render();
      }
      if (b.dataset.act === 'tab') {
        this.tab = b.dataset.arg as Tab;
        audio.play('click');
        const body = this.panel.querySelector('.inv-body');
        if (body) body.scrollTop = 0;
        this.render();
      }
    });
  }

  toggle(on = !this.open) {
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    audio.play(on ? 'whoosh' : 'click', { volume: 0.4 });
    if (on) {
      this.lastHtml = '';
      this.render();
    }
  }

  render() {
    if (!this.open) return;
    const g = this.game;
    const p = g.profile;
    const tabs: [Tab, string][] = [
      ['ship', '⛵ Ship'],
      ['arms', '⚔️ Arms'],
      ['cargo', '📦 Cargo'],
      ['gear', '⚙️ Equipment'],
      ['crew', '👥 Crew'],
      ['quests', '🗺️ Quests & Treasure'],
    ];
    let body = '';
    if (this.tab === 'ship') body = this.shipTab();
    else if (this.tab === 'arms') body = this.armsTab();
    else if (this.tab === 'cargo') {
      const ids = CARGO_IDS.filter((id) => (p.cargo[id] ?? 0) > 0);
      body =
        `<div class="inv-cap"><span>📦 ${g.cargoCount} / ${g.cargoCapacity} crates</span><div class="cbar"><div style="width:${clamp(g.cargoCount / g.cargoCapacity, 0, 1) * 100}%"></div></div><span>Worth ~${fmtMoney(g.cargoValue)}</span></div>` +
        (ids.length
          ? `<div class="inv-grid">${ids
              .map((id) => {
                const c = CARGO[id];
                const q = p.cargo[id] ?? 0;
                const quest = c.cat === 'quest';
                const best = quest ? null : g.economy.bestSell(id);
                return `<div class="inv-item" style="--gc:${c.color}"><div class="ii">${c.icon}</div><b>${c.name}</b><span class="q">×${q}</span><small>${quest ? 'Contract cargo' : `Best: ${fmtMoney(best!.price)} at ${best!.port.name}`}</small></div>`;
              })
              .join('')}</div>`
          : '<div class="empty">🕸️ Your hold is empty. Buy goods at market stalls or plunder merchant ships!</div>');
      const wh = Object.entries(p.warehouses).filter(([, w]) => Object.values(w).some((v) => (v ?? 0) > 0));
      if (wh.length)
        body += `<div class="sec-title">Warehouses</div>${wh.map(([port, w]) => `<div class="inv-line"><b>${portById(port).name}</b> ${Object.entries(w).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${CARGO[k as keyof typeof CARGO].icon}×${v}`).join(' ')}</div>`).join('')}`;
    } else if (this.tab === 'gear') {
      const ups = UPGRADE_IDS.map((id) => {
        const u = UPGRADES[id];
        const lab = upgradeLabel(p.ship, id);
        const l = p.upgrades[id];
        return `<div class="inv-line"><span>${lab.icon} <b>${lab.name}</b></span><span>${lab.levels[l] ?? ''} · ${u.fmt(upgradeValue(p.ship, id, l))}</span></div>`;
      }).join('');
      const ammo = AMMO_IDS.filter((a) => p.ammo.includes(a))
        .map((a) => `<span class="chip ${p.ammoSel === a ? 'on' : ''}">${AMMO[a].icon} ${AMMO[a].name}</span>`)
        .join('');
      const items = SPECIAL_ITEMS.filter((i) => p.items.includes(i.id) && !i.repeatable)
        .map((i) => `<div class="inv-line"><span>${i.icon} <b>${i.name}</b></span><small>${i.desc}</small></div>`)
        .join('');
      body = `<div class="sec-title">${g.shipClass.icon} ${g.shipClass.shipName} – refits</div>${ups}
        <div class="sec-title">Ammunition <small>(Q at sea)</small></div><div class="chips">${ammo}</div>
        <div class="sec-title">Look</div><div class="chips"><span class="chip">⛵ ${cosmeticById(p.sail).name}</span><span class="chip">🚢 ${cosmeticById(p.hull).name}</span><span class="chip">🏴‍☠️ ${cosmeticById(p.flag).name}</span><span class="chip">💣 ${cosmeticById(p.cannonSkin).name}</span></div>
        <div class="sec-title">Special Items</div>${items || '<div class="empty small">None yet – rumour has it shady dealers sell strange things…</div>'}`;
    } else if (this.tab === 'crew') {
      body = `<div class="inv-line"><span>👥 <b>Deckhands</b></span><span>${p.crew} / ${g.maxCrew}</span></div>
        <div class="sec-title">Officers</div>${
          p.officers.length
            ? p.officers.map((o) => `<div class="inv-line"><span>${ROLES[o.role].icon} <b>${o.name}</b> <small>${ROLES[o.role].name}</small></span><span>${'★'.repeat(o.skill)}${'☆'.repeat(3 - o.skill)} · ${ROLES[o.role].bonus(o.skill)}</span></div>`).join('')
            : '<div class="empty small">No officers. Recruit them in taverns.</div>'
        }`;
    } else {
      const maps = p.maps.filter((m) => !p.treasuresFound.includes(m));
      body = `<div class="sec-title">Contracts</div>${
        p.contracts.length ? p.contracts.map((c) => `<div class="inv-line"><span>📌 <b>${c.title}</b></span><small>${c.desc} · ${fmtMoney(c.money)}</small></div>`).join('') : '<div class="empty small">No contracts. Visit a tavern mission board.</div>'
      }
        <div class="sec-title">Quest Items</div>${(p.cargo.sealed ?? 0) > 0 ? `<div class="inv-line"><span>📦 <b>Sealed Crates</b></span><span>×${p.cargo.sealed}</span></div>` : ''}${maps.map((m) => `<div class="inv-line"><span>🗺️ <b>Treasure Map</b></span><span>X marks the spot on ${m}</span></div>`).join('') || ((p.cargo.sealed ?? 0) > 0 ? '' : '<div class="empty small">Nothing yet.</div>')}
        <div class="sec-title">Treasure Found</div>${p.treasuresFound.length ? p.treasuresFound.map((t) => `<div class="inv-line"><span>💎 <b>${t}</b></span><span>Dug up!</span></div>`).join('') : '<div class="empty small">No treasure found yet. Hidden islands lie at the edges of the map.</div>'}`;
    }
    const st = p.stats;
    const html = `
      <div class="inv-head"><h1>🏴‍☠️ Captain's Inventory</h1><button class="sh-x" data-act="close">✕</button></div>
      <div class="inv-top">
        <div><small>MONEY</small><b class="gold">${fmtMoney(p.money)}</b></div>
        <div><small>LEVEL</small><b>${p.level}</b><div class="xp"><div style="width:${clamp(p.xp / xpForLevel(p.level), 0, 1) * 100}%"></div></div></div>
        <div><small>CAPTURES</small><b>${st.captures}</b></div>
        <div><small>TRADE PROFIT</small><b>${fmtMoney(st.tradeProfit)}</b></div>
        <div><small>DAY</small><b>${p.day}</b></div>
      </div>
      <div class="shop-tabs">${tabs.map(([t, n]) => `<button data-act="tab" data-arg="${t}" class="${t === this.tab ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="inv-body">${body}</div>
      <div class="inv-foot"><kbd>TAB</kbd>/<kbd>I</kbd> close</div>`;
    // the game refreshes this while it's open: only touch the page when something changed,
    // and keep the scroll position
    if (html === this.lastHtml) return;
    const scroll = this.panel.querySelector('.inv-body')?.scrollTop ?? 0;
    this.lastHtml = html;
    this.panel.classList.toggle('wide', this.tab === 'ship');
    this.panel.innerHTML = html;
    const bodyEl = this.panel.querySelector('.inv-body');
    if (bodyEl) bodyEl.scrollTop = scroll;
  }
  /** Hand weapons: what you carry, everything in the armoury, and your land-fighting record. */
  private armsTab() {
    const g = this.game;
    const p = g.profile;
    const f = g.combat.player;
    const card = (w: WeaponItem | undefined, slot: string) => {
      if (!w) return `<div class="arm-card empty"><small>${slot}</small><b>— none —</b><span>Buy one from a gunsmith</span></div>`;
      const st = weaponStats(w);
      const r = RARITIES[w.rarity];
      const fx = w.effect ? `<div class="arm-fx">${EFFECTS[w.effect].icon} <b>${EFFECTS[w.effect].name}</b> – ${EFFECTS[w.effect].desc}</div>` : '';
      const stats =
        st.kind === 'ranged'
          ? `<span>💥 ${Math.round(st.damage * f.dmgMul)}${st.pellets > 1 ? ` ×${st.pellets}` : ''}</span><span>🎯 ${st.range} m</span><span>🔄 ${st.reload.toFixed(1)} s</span><span>🔫 ${st.mag} round${st.mag > 1 ? 's' : ''}</span>`
          : `<span>💥 ${Math.round(st.damage * f.dmgMul)}</span><span>⚡ ×${st.speed.toFixed(2)}</span><span>📏 ${st.range.toFixed(1)} m</span><span>💪 ${Math.round(weaponDps(st) * f.dmgMul)} dps</span>`;
      return `<div class="arm-card" style="--rc:${r.color}"><small>${slot}</small><div class="arm-h"><span class="arm-i">${st.base.icon}</span><div><b style="color:${r.color}">${weaponName(w)}</b><em>${r.name} ${st.base.name}${w.level ? ` · +${w.level}` : ''}</em></div></div><div class="arm-st">${stats}</div>${fx}</div>`;
    };
    const melee = p.weapons.find((w) => w.uid === p.melee);
    const gun = p.weapons.find((w) => w.uid === p.ranged);
    const order = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
    const rows = [...p.weapons]
      .sort((a, b) => (WEAPONS[a.base].kind === WEAPONS[b.base].kind ? order.indexOf(a.rarity) - order.indexOf(b.rarity) : WEAPONS[a.base].kind === 'melee' ? -1 : 1))
      .map((w) => {
        const st = weaponStats(w);
        const r = RARITIES[w.rarity];
        const eq = w.uid === p.melee || w.uid === p.ranged;
        const up = upgradePrice(w);
        return `<div class="arm-row ${eq ? 'eq' : ''}" style="--rc:${r.color}"><span class="arm-i">${st.base.icon}</span><div class="arm-n"><b style="color:${r.color}">${weaponName(w)}</b><small>${r.name}${w.level ? ` +${w.level}` : ''}${w.level >= MAX_WEAPON_LEVEL ? ' (max)' : ''} · ${st.kind === 'ranged' ? `${Math.round(st.damage * f.dmgMul)} dmg · ${st.mag} rd` : `${Math.round(st.damage * f.dmgMul)} dmg · ${Math.round(weaponDps(st) * f.dmgMul)} dps`}${w.effect ? ` · ${EFFECTS[w.effect].icon} ${EFFECTS[w.effect].name}` : ''}${up ? '' : ''}</small></div>${eq ? '<em class="arm-eq">EQUIPPED</em>' : `<button class="btn small gold" data-act="equip" data-arg="${w.uid}">Equip</button><button class="btn small" data-act="salvage" data-arg="${w.uid}" title="Break down for iron scrap">🔩</button>`}</div>`;
      })
      .join('');
    const L = p.land;
    const cleared = SITES.filter((x) => L.cleared[x.id] !== undefined).length;
    return `<div class="arm-top">${card(melee, '⚔️ BLADE')}${card(gun, '🔫 GUN')}</div>
      <div class="arm-res"><span>🎯 <b>${p.shot}</b> pistol shot</span><span>🔩 <b>${p.scrap}</b> iron scrap</span><span>❤️ <b>${f.maxHp}</b> health</span><span>⚡ <b>${Math.round(f.maxStamina)}</b> stamina</span></div>
      <div class="sec-title">Armoury <small>(upgrade weapons with scrap at a gunsmith)</small></div><div class="arm-list">${rows}</div>
      <div class="sec-title">On land</div><div class="arm-res"><span>☠️ <b>${L.kills}</b> pirates beaten</span><span>⛺ <b>${cleared}</b> camps cleared</span><span>💀 <b>${L.bosses.length}</b> bosses</span><span>🧭 <b>${L.escorts}</b> escorts</span></div>
      <div class="inv-hint">On foot: <b>X</b> draw · <b>LMB</b> attack (hold for heavy) · <b>RMB</b> block / aim · <b>SPACE</b> roll · <b>TAB</b>/<b>Q</b> lock-on · <b>1</b>/<b>2</b> blade / gun · <b>R</b> reload</div>`;
  }

  /** Ship progression: what you sail now, what's next, and the whole ladder. */
  private shipTab() {
    const g = this.game;
    const p = g.profile;
    const c = g.shipClass;
    const st = g.shipStats;
    const refit = UPGRADE_IDS.reduce((a, id) => a + p.upgrades[id], 0);
    const refitMax = UPGRADE_IDS.length * MAX_UPGRADE;
    const nx = nextClass(c.id);
    const stat = (icon: string, name: string, v: string) => `<div class="ps-stat"><span>${icon}</span><small>${name}</small><b>${v}</b></div>`;
    let next = '<div class="ps-next done">🏆 You sail the finest ship on the seas!</div>';
    if (nx) {
      const locked = p.level < nx.requiredLevel;
      const owned = !!p.fleet[nx.id];
      const k = clamp(p.level / nx.requiredLevel, 0, 1);
      next = `<div class="ps-next ${locked ? 'locked' : 'open'}">
        <div class="ps-ico">${nx.icon}</div>
        <div class="ps-info"><small>NEXT SHIP</small><b>${nx.name}</b><span>${nx.shipName} · Class ${ROMAN[nx.tier]}</span>
          <div class="ps-req"><span>Required level <b>${nx.requiredLevel}</b></span><span>Price <b>${fmtMoney(nx.purchasePrice)}</b></span></div>
          ${locked ? `<div class="ps-lock">🔒 LOCKED <small>Reach Level ${nx.requiredLevel} to unlock</small></div><div class="xp big"><div style="width:${k * 100}%"></div></div><small class="ps-lvl">Level ${p.level} / ${nx.requiredLevel}</small>` : owned ? '<div class="ps-ok">✔ In your fleet – switch at any shipyard</div>' : `<div class="ps-ok">✔ UNLOCKED – buy it at any shipyard${p.money < nx.purchasePrice ? ` (you need ${fmtMoney(nx.purchasePrice - p.money)} more)` : '!'}</div>`}
        </div></div>`;
    }
    const ladder = SHIP_CLASS_IDS.map((id) => {
      const k = SHIP_CLASSES[id];
      const lk = p.level < k.requiredLevel;
      const status = p.ship === id ? '<em class="sailing">SAILING</em>' : p.fleet[id] ? '<em class="owned">OWNED</em>' : lk ? `<em class="lock">🔒 Reach Level ${k.requiredLevel} to unlock</em>` : '<em class="open">UNLOCKED</em>';
      return `<div class="ps-row ${lk ? 'locked' : ''} ${p.ship === id ? 'on' : ''}"><span class="ps-i">${k.icon}</span><small>${ROMAN[k.tier]}</small><b>${k.name}</b><span class="ps-l">Lv ${k.requiredLevel}</span><span class="ps-p">${k.purchasePrice ? fmtMoney(k.purchasePrice) : 'Starter'}</span>${status}</div>`;
    }).join('');
    return `<div class="ps-grid">
      <div class="ps-cur">
        <small>CURRENT SHIP</small>
        <h2>${c.icon} ${c.shipName}</h2>
        <div class="ps-cls">Class ${ROMAN[c.tier]} · ${c.name} · ${c.engineType}</div>
        <div class="ps-refit"><span>Ship level <b>${refit} / ${refitMax}</b> refits</span><div class="xp"><div style="width:${(refit / refitMax) * 100}%"></div></div></div>
        <div class="ps-stats">
          ${stat('❤️', 'Health', `${Math.round(g.player.hp)} / ${g.player.maxHp}`)}
          ${stat('⚡', 'Speed', `${Math.round(g.player.maxSpeed)} kn`)}
          ${stat('📦', 'Cargo', `${g.cargoCount} / ${g.cargoCapacity}`)}
          ${stat('👥', 'Crew', `${p.crew} / ${g.maxCrew}`)}
          ${stat('💣', 'Cannons', `${st.guns} guns · ${Math.round(g.player.damage)} dmg`)}
          ${stat('🛡', 'Boarding', `×${c.boardingStrength.toFixed(2)}`)}
        </div>
      </div>
      ${next}
    </div>
    <div class="sec-title">Ship classes</div><div class="ps-ladder">${ladder}</div>`;
  }
}
