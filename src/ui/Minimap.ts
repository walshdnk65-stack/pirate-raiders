import type { Game } from '../game/Game';
import { WORLD_HALF, WORLD_SOFT_EDGE, landSDF, terrainHeight, PORTS, ZONES, ISLANDS, SDF_GRID } from '../world/WorldData';
import type { TownBuild } from '../world/TownTypes';

/** Anything the on-foot map can show: a port town, or an island you've rowed to. */
export type MapArea = Pick<TownBuild, 'center' | 'radius' | 'platforms' | 'map'> & { port: { id: string; name: string } };
import { groundHeight } from '../world/Islands';

const RES = 512;

/** Bakes the world into a parchment-style chart and draws ships/ports/missions on top. */
export class Minimap {
  private world: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  viewRadius = 420;
  private t = 0;

  constructor(
    private game: Game,
    private canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.world = document.createElement('canvas');
    this.world.width = this.world.height = RES;
    this.bake();
  }

  private bake() {
    const c = this.world.getContext('2d')!;
    const img = c.createImageData(RES, RES);
    const span = WORLD_HALF * 2;
    for (let j = 0; j < RES; j++) {
      const z = -WORLD_HALF + ((j + 0.5) / RES) * span;
      for (let i = 0; i < RES; i++) {
        const x = -WORLD_HALF + ((i + 0.5) / RES) * span;
        let d: number;
        if (SDF_GRID) {
          const g = SDF_GRID;
          const gi = Math.min(g.size - 1, Math.floor(((i + 0.5) / RES) * g.size));
          const gj = Math.min(g.size - 1, Math.floor(((j + 0.5) / RES) * g.size));
          d = g.data[gj * g.size + gi];
        } else d = landSDF(x, z);
        let r: number, g: number, b: number;
        if (d < 0) {
          const h = terrainHeight(x, z);
          if (h < 1.4) [r, g, b] = [245, 216, 150];
          else if (h > 14) [r, g, b] = [150, 140, 128];
          else [r, g, b] = [110, 196, 88];
        } else if (d < 3) [r, g, b] = [240, 250, 255];
        else {
          const k = Math.min(1, d / 40);
          r = 70 - k * 40;
          g = 200 - k * 80;
          b = 220 - k * 20;
        }
        const o = (j * RES + i) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    // danger zone hatch
    const dz = ZONES[0];
    c.save();
    c.globalAlpha = 0.18;
    c.fillStyle = '#7a0a2a';
    c.beginPath();
    c.arc(((dz.x + WORLD_HALF) / span) * RES, ((dz.z + WORLD_HALF) / span) * RES, (dz.r / span) * RES, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  /** Draw onto any canvas; centre/scale in world units. */
  drawTo(ctx: CanvasRenderingContext2D, W: number, cx: number, cz: number, radius: number, big: boolean) {
    const g = this.game;
    const span = WORLD_HALF * 2;
    const toPx = (W / 2) / radius;
    const X = (x: number) => W / 2 + (x - cx) * toPx;
    const Y = (z: number) => W / 2 + (z - cz) * toPx;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#1b5d97';
    ctx.fillRect(0, 0, W, W);
    const srcR = (radius / span) * RES;
    const sx = ((cx + WORLD_HALF) / span) * RES - srcR;
    const sy = ((cz + WORLD_HALF) / span) * RES - srcR;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.world, sx, sy, srcR * 2, srcR * 2, 0, 0, W, W);

    // range ring
    if (!big) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(g.player.pos.x), Y(g.player.pos.z), g.player.range * toPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // the big chart is drawn at 1024 px and scaled down to fit the screen: scale its text and icons up to match
    const fk = big ? W / 680 : 1;
    const icon = (x: number, z: number, txt: string, size: number) => {
      ctx.font = `${size * fk}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, X(x), Y(z));
    };
    /** Outlined label, nudged so it never runs off the edge of the chart. */
    const label = (text: string, x: number, y: number, size: number, fill: string, stroke = 'rgba(0,0,0,0.75)') => {
      ctx.font = `bold ${size * fk}px "Lilita One", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const half = ctx.measureText(text).width / 2 + 6;
      const cx2 = Math.min(W - half, Math.max(half, x));
      if (stroke) {
        ctx.lineWidth = 4 * fk;
        ctx.strokeStyle = stroke;
        ctx.strokeText(text, cx2, y);
      }
      ctx.fillStyle = fill;
      ctx.fillText(text, cx2, y);
    };

    // ports
    for (const p of PORTS) {
      icon(p.berth.x, p.berth.z, { pirate: '🏴‍☠️', merchant: '⚓', fishing: '🐟', rich: '👑', remote: '🌴' }[p.kind], big ? 26 : 26);
      if (big) label(p.name, X(p.berth.x), Y(p.berth.z) + 22 * fk, 17, '#fff', '#000');
    }
    if (big) {
      for (const isl of ISLANDS) {
        if (isl.kind === 'port' || isl.kind === 'pirate' || isl.kind === 'hidden') continue;
        label(isl.name, X(isl.x), Y(isl.z) + isl.r * toPx + 9 * fk, 12, 'rgba(40,30,10,0.9)', '');
      }
      const dz = ZONES[0];
      label("☠ Kraken's Teeth ☠", X(dz.x), Y(dz.z), 15, '#ffdddd', 'rgba(60,0,20,0.6)');
    }
    // the edge of the sailable sea
    if (big) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.strokeRect(X(-WORLD_SOFT_EDGE), Y(-WORLD_SOFT_EDGE), WORLD_SOFT_EDGE * 2 * toPx, WORLD_SOFT_EDGE * 2 * toPx);
      ctx.setLineDash([]);
      label('~ edge of the known seas ~', W / 2, Y(-WORLD_SOFT_EDGE) - 8 * fk, 11, 'rgba(255,255,255,0.8)', '');
      ctx.restore();
    }
    // treasure islands: a gold badge on each one – an X once you have its map (or are close), ✔ once dug up
    for (const t of g.islands.treasures) {
      const x = X(t.pos.x);
      const y = Y(t.pos.z);
      if (x < -20 || y < -20 || x > W + 20 || y > W + 20) continue;
      const known = g.profile.maps.includes(t.island.name) || t.pos.distanceTo(g.player.pos) < 260;
      const r = big ? 13 * fk : 11;
      ctx.save();
      if (known && !t.collected) {
        ctx.strokeStyle = 'rgba(255,60,60,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, r + 5 + Math.sin(this.t * 5) * 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = t.collected ? 'rgba(130,130,130,0.9)' : known ? '#fff3d0' : '#ffd23f';
      ctx.fill();
      ctx.lineWidth = big ? 3 : 2;
      ctx.strokeStyle = t.collected ? '#3a3a3a' : '#7a3a00';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      icon(t.pos.x, t.pos.z, t.collected ? '✔' : known ? '❌' : '💰', big ? 15 : 13);
      if (big) label(t.collected ? `${t.island.name} · dug up` : known ? `${t.island.name} · X marks the spot` : 'Treasure island?', x, y + r + 11 * fk, 13, t.collected ? '#ddd' : '#ffe08a');
      ctx.restore();
    }
    // land encounters: camps, forts and lairs you can row ashore to (difficulty in skulls)
    if (big && g.combat) {
      for (const s of g.combat.sites) {
        if (s.def.port) continue;
        const x = X(s.geo.center.x);
        const y = Y(s.geo.center.z);
        if (x < -20 || y < -20 || x > W + 20 || y > W + 20) continue;
        const done = s.status === 'cleared';
        ctx.globalAlpha = done ? 0.55 : 1;
        icon(s.geo.center.x, s.geo.center.z, done ? '✔' : s.def.icon, 15);
        label(`${s.def.name} ${'☠'.repeat(Math.min(5, s.def.tier))}`, x, y - 16 * fk, 10, done ? '#cfe8c8' : '#ffd0c8');
        ctx.globalAlpha = 1;
      }
    }
    // ships
    const want = g.missions.wantedType();
    for (const s of g.ships) {
      if (s.removeMe) continue;
      const x = X(s.pos.x);
      const y = Y(s.pos.z);
      if (x < -10 || y < -10 || x > W + 10 || y > W + 10) continue;
      let col = '#ffd23f';
      if (s.team === 'navy') col = s.state === 'patrol' ? '#7fa8ff' : '#ff3b3b';
      if (s.captured) col = '#5ee06a';
      if (s.disabled && !s.captured) col = this.t % 0.6 < 0.3 ? '#ffffff' : '#5ee06a';
      if (s.sinking) col = '#666';
      ctx.save();
      ctx.translate(x, y);
      if (want && s.type.id === want && !s.captured) {
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 13 + Math.sin(this.t * 6) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.rotate(-s.heading + Math.PI);
      const sz = ((s.type.team === 'navy' ? 7 : 6) + s.model.length * 0.12) * fk;
      ctx.fillStyle = col;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(sz * 0.65, sz * 0.8);
      ctx.lineTo(-sz * 0.65, sz * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // course line to port
    if (g.navTarget) {
      ctx.strokeStyle = 'rgba(255,210,63,0.85)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(X(g.player.pos.x), Y(g.player.pos.z));
      ctx.lineTo(X(g.navTarget.x), Y(g.navTarget.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // player
    ctx.save();
    ctx.translate(X(g.player.pos.x), Y(g.player.pos.z));
    ctx.rotate(-g.player.heading + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#d0312d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const ps = big ? 11 * fk : 11;
    ctx.moveTo(0, -ps);
    ctx.lineTo(ps * 0.75, ps);
    ctx.lineTo(0, ps * 0.5);
    ctx.lineTo(-ps * 0.75, ps);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // port direction arrow at the edge of the minimap
    if (!big) {
      const home = PORTS[0].berth;
      const dx = home.x - cx;
      const dz = home.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > radius * 0.92) {
        const a = Math.atan2(dz, dx);
        const r = W / 2 - 16;
        icon(cx + (Math.cos(a) * r) / toPx, cz + (Math.sin(a) * r) / toPx, '🏴‍☠️', 20);
      }
    }
  }

  draw() {
    this.t += 1 / 60;
    const g = this.game;
    const W = this.canvas.width;
    const town = g.onLand ? g.mapArea : null;
    if (town) this.drawTown(this.ctx, W, town, false);
    else this.drawTo(this.ctx, W, g.player.pos.x, g.player.pos.z, this.viewRadius, false);
  }

  // ---------------------------------------------------------------------------
  // Town maps (on foot)
  // ---------------------------------------------------------------------------
  private towns = new Map<string, { canvas: HTMLCanvasElement; x0: number; z0: number; span: number }>();

  private bakeTown(town: MapArea) {
    let b = this.towns.get(town.port.id);
    if (b) return b;
    const R = town.radius + 25;
    const x0 = town.center.x - R;
    const z0 = town.center.z - R;
    const span = R * 2;
    const N = 200;
    const lo = document.createElement('canvas');
    lo.width = lo.height = N;
    const lc = lo.getContext('2d')!;
    const img = lc.createImageData(N, N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = x0 + ((i + 0.5) / N) * span;
        const z = z0 + ((j + 0.5) / N) * span;
        const h = groundHeight(x, z);
        let c: number[];
        if (h < 0.05) c = h > -1.5 ? [120, 210, 220] : [52, 150, 200];
        else if (h < 1.25) c = [240, 214, 150];
        else if (h > 9) c = [128, 170, 96];
        else c = [134, 196, 104];
        const o = (j * N + i) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    lc.putImageData(img, 0, 0);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 640;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(lo, 0, 0, 640, 640);
    const k = 640 / span;
    const rect = (r: { x: number; z: number; hx: number; hz: number; rot: number }, fill: string, stroke?: string) => {
      ctx.save();
      ctx.translate((r.x - x0) * k, (r.z - z0) * k);
      ctx.rotate(-r.rot);
      ctx.fillStyle = fill;
      ctx.fillRect(-r.hx * k, -r.hz * k, r.hx * 2 * k, r.hz * 2 * k);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.strokeRect(-r.hx * k, -r.hz * k, r.hx * 2 * k, r.hz * 2 * k);
      }
      ctx.restore();
    };
    for (const p of town.platforms) if (p.y2 === undefined) rect(p, '#c8955c', 'rgba(90,50,20,0.6)');
    for (const f of town.map.footprints) rect(f, f.color, 'rgba(30,20,10,0.75)');
    b = { canvas, x0, z0, span };
    this.towns.set(town.port.id, b);
    return b;
  }

  /** Town map: small = follows the player and turns with the camera, big = whole town, north up. */
  drawTown(ctx: CanvasRenderingContext2D, W: number, town: MapArea, big: boolean) {
    const g = this.game;
    const b = this.bakeTown(town);
    const me = g.walker.pos;
    const cx = big ? town.center.x : me.x;
    const cz = big ? town.center.z : me.z;
    const radius = big ? town.radius * 0.88 : 46;
    const fk = big ? W / 560 : 1;
    const toPx = W / 2 / radius;
    // rotate so the camera's forward points up
    const a = big ? 0 : this.mapAngle();
    const ca = Math.cos(-a);
    const sa = Math.sin(-a);
    const S = (x: number, z: number) => {
      const dx = x - cx;
      const dz = z - cz;
      return [W / 2 + (dx * ca - dz * sa) * toPx, W / 2 + (dx * sa + dz * ca) * toPx];
    };
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#3496c8';
    ctx.fillRect(0, 0, W, W);
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-a);
    const pxPerWorld = 640 / b.span;
    const srcX = (cx - b.x0) * pxPerWorld;
    const srcZ = (cz - b.z0) * pxPerWorld;
    const sr = radius * 1.5 * pxPerWorld;
    const dr = radius * 1.5 * toPx;
    ctx.drawImage(b.canvas, srcX - sr, srcZ - sr, sr * 2, sr * 2, -dr, -dr, dr * 2, dr * 2);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // your ship
    const sp = g.player.pos;
    const [bx, bz] = S(sp.x, sp.z);
    ctx.font = `${26 * fk}px sans-serif`;
    ctx.fillText('⛵', bx, bz);
    // points of interest
    const found = g.profile.blackMarkets.includes(town.port.id);
    for (const m of town.map.marks) {
      if (m.secret && !found) continue;
      const [x, y] = S(m.x, m.z);
      if (x < -20 || y < -20 || x > W + 20 || y > W + 20) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = 'rgba(60,30,10,0.8)';
      ctx.lineWidth = 2 * fk;
      ctx.beginPath();
      ctx.arc(x, y, 16 * fk, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `${20 * fk}px sans-serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(m.icon, x, y + 1);
      if (big) {
        ctx.font = `${15 * fk}px "Lilita One", sans-serif`;
        ctx.lineWidth = 4 * fk;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(m.label, x, y + 27 * fk);
        ctx.fillStyle = '#fff';
        ctx.fillText(m.label, x, y + 27 * fk);
      }
    }
    // encounter sites, foes and crew
    const cb = g.combat;
    if (cb?.active) {
      for (const s of cb.landSites()) {
        const [x, y] = S(s.geo.center.x, s.geo.center.z);
        if (x < -20 || y < -20 || x > W + 20 || y > W + 20) continue;
        ctx.font = `${(big ? 20 : 18) * fk}px sans-serif`;
        ctx.globalAlpha = s.status === 'cleared' ? 0.45 : 1;
        ctx.fillText(s.status === 'cleared' ? (s.geo.chest && !s.chestOpen ? '🧰' : '✔') : s.def.icon, x, y);
        ctx.globalAlpha = 1;
        if (big) {
          ctx.font = `${13 * fk}px "Lilita One", sans-serif`;
          ctx.lineWidth = 4 * fk;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.strokeText(s.def.name, x, y + 20 * fk);
          ctx.fillStyle = s.status === 'cleared' ? '#cfe8c8' : '#ffb3a8';
          ctx.fillText(s.def.name, x, y + 20 * fk);
          ctx.fillStyle = '#000';
        }
      }
      const dot = (x0: number, z0: number, col: string, r: number) => {
        const [x, y] = S(x0, z0);
        ctx.beginPath();
        ctx.arc(x, y, r * fk, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000';
        ctx.stroke();
      };
      for (const e of cb.enemies) if (!e.f.dead && !e.hidden) dot(e.f.pos.x, e.f.pos.z, e.isBoss ? '#ff2a6a' : e.engaged ? '#ff3b3b' : '#ff9a5a', e.isBoss ? 7 : 4.5);
      for (const a of cb.allies) if (!a.f.dead) dot(a.f.pos.x, a.f.pos.z, a.escort ? '#ffd23f' : '#5ee06a', 4);
    }
    // tutorial objective
    const obj = g.landObjective;
    if (obj) {
      const [x, y] = S(obj.x, obj.z);
      const r = (big ? 22 : 20) + Math.sin(this.t * 8) * 3;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(clampN(x, 14, W - 14), clampN(y, 14, W - 14), r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the captain
    const [px, py] = S(me.x, me.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - g.walker.heading - a);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#d0312d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const ps = 12 * fk;
    ctx.moveTo(0, -ps);
    ctx.lineTo(ps * 0.75, ps);
    ctx.lineTo(0, ps * 0.5);
    ctx.lineTo(-ps * 0.75, ps);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (big) {
      ctx.font = `${26 * fk}px "Lilita One", sans-serif`;
      ctx.lineWidth = 6 * fk;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(`${town.port.name} — ${town.port.id.startsWith("isle:") ? "Island" : "Town"} Map`, W / 2, 34 * fk);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`${town.port.name} — ${town.port.id.startsWith("isle:") ? "Island" : "Town"} Map`, W / 2, 34 * fk);
    }
  }

  /** Rotation that puts the camera's view direction at the top of the town map. */
  mapAngle() {
    const yaw = this.game.camRig.walkYaw;
    // forward (camera → player) = (-sin yaw, -cos yaw); angle from screen-up, clockwise
    return Math.atan2(-Math.sin(yaw), Math.cos(yaw));
  }
}

const clampN = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
