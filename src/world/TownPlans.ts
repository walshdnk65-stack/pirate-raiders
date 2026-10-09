import * as THREE from 'three';
import { TownBuilder, DECK_Y, buildPier, skullRock, lighthouse, watchtower, fort, InteriorCtx, K, PAL, T, cyl } from './Town';
import { Placer, crate, barrelAt, sack } from '../models/Props';
import { buildShip, DESIGNS, playerDesign } from '../models/ShipModel';
import { PIERS, PORTS, SKULL_COAST_Z, townToWorld, PortDef } from './WorldData';
import type { TownBuild, CircleCol, ScheduleEntry } from './TownTypes';
import type { StallType } from '../game/Economy';
import { Character } from '../models/Character';
import { M } from '../render/Materials';

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------
const HINTS = [
  "Ships have been disappearing near the eastern waters. Kraken's Teeth, they call it.",
  'Spices are dirt cheap out at Mermaid Lagoon. Royal folk pay double for them!',
  'Goldhaven nobles pay a fortune for plain old fish. Can you imagine?',
  'Saltmarsh fishermen sell fish for pennies.',
  'Port Royal makes the best cloth around – cheap, too.',
  "They say treasure's buried on islands at the very edge of the map.",
  'The navy circles the merchant ports. Lie low before you sail in, wanted folk!',
  'Jewellery is cheapest in Goldhaven. Funny, that.',
  'Skull Cove has more scrap metal and rope than it knows what to do with.',
  'Luxury ships carry gold. And they run fast!',
  'Somebody sells strange things behind the Salty Skull... if you can find him.',
  "In Port Royal, the shady stuff only comes out after dark.",
];
const CHAT = [
  "Lovely weather for plundering, isn't it?",
  'Have you seen my parrot? He owes me money.',
  "I've been on land three days. I already miss the waves.",
  'My cousin married a mermaid. Long story.',
  'The tavern pie is mostly gravy. Still worth it.',
  'Arr! ...sorry, habit.',
  "Don't step on the cat. He's the real mayor.",
];
const pick = <T>(arr: T[], i: number) => arr[i % arr.length];
const FEMALE = new Set(['townWoman', 'fishwife', 'richLady', 'islanderWoman']);
/** A chatty townsperson's name that suits how they look. */
const nameFor = (spec: string, i: number) =>
  FEMALE.has(spec) ? pick(['Gossip Gwen', 'Chatty Cath', 'Busy Bess', 'Nosy Nora', 'Tattle Tess'], i) : pick(['Nosy Ned', 'Mumbling Mick', 'Tattle Tom', 'Blabbing Bob', 'Yarnspinner Yuri'], i);
const hintLines = (i: number) => [pick(CHAT, i), pick(HINTS, i * 3 + 1)];

// ---------------------------------------------------------------------------
// Standard buildings
// ---------------------------------------------------------------------------
interface Style {
  wall: string;
  wallIn?: string;
  roof: string;
  trim?: string;
  stone?: boolean;
  thatch?: boolean;
  signBg?: string;
  signFg?: string;
}

/** Tavern interior: bar, tables, fireplace, mission board, recruits, music. */
function tavern(tb: TownBuilder, a: number, b: number, ly: number, name: string, style: Style, bartender: { spec: string; name: string }) {
  const id = `${tb.port.id}-tavern`;
  const r = tb.interior({ id, kind: 'tavern', name, icon: '🍺', a, b, ly, w: 16, d: 12, h: 4.6, ...style }, (c: InteriorCtx) => {
    K.rug(c.pl.child(T(0.5, 0, 0.8)), 6, 4, '#a5281f', '#f4c24c');
    // bar along the back wall
    K.barCounter(c.pl.child(T(-2, 0, -3.4)), c.glow, 8, c.rng);
    K.bottleShelf(c.pl.child(T(-2, 0, -5.6)), c.glow, 7, c.rng);
    c.box(-2, -3.4, 4.15, 0.62);
    for (const x of [-7, 1.8]) {
      barrelAt(c.pl, x, 0, -4.9, 0.9);
      barrelAt(c.pl, x, 0.98, -4.9, 0.9, true);
    }
    c.circle(-7, -4.9, 0.6);
    c.spot(`${id}-barkeep`, -2, -4.65, 0, 'idle');
    c.interact({ id: `${id}-bar`, kind: 'bartender', radius: 2.2, label: 'Bartender', icon: '🍺', keeper: `${id}-keeper`, lx: -2, lz: -1.9, lookX: -2, lookZ: -4.65 });
    // bar stools
    [-5.2, -3.4, -1.6, 0.2].forEach((x, i) => {
      K.stool(c.pl.child(T(x, 0, -2.45)));
      c.spot(`${id}-seat-bar${i}`, x, -2.45, Math.PI, 'sitDrink', { y: 0.36, prop: 'mug' });
    });
    // tables with chairs
    const tables: [number, number][] = [
      [-5.0, 1.4],
      [3.4, 2.7],
      [3.6, -2.0],
      [-1.2, 3.6],
    ];
    tables.forEach(([x, z], ti) => {
      K.roundTable(c.pl.child(T(x, 0, z)), c.glow.child(T(x, 0, z)), c.rng);
      c.circle(x, z, 1.0);
      const seats = ti === 3 ? [Math.PI / 2, -Math.PI / 2] : [Math.PI / 2, -Math.PI / 2, Math.PI];
      seats.forEach((ang, si) => {
        const sx = x + Math.sin(ang) * 1.45;
        const sz = z + Math.cos(ang) * 1.45;
        K.chair(c.pl.child(T(sx, 0, sz, 0, ang + Math.PI, 0)));
        c.spot(`${id}-seat-t${ti}-${si}`, sx, sz, ang + Math.PI, 'sitDrink', { y: 0.16, prop: 'mug' });
      });
    });
    // fireplace on the right wall
    const fire = K.fireplace(c.stone.child(T(7.5, 0, 0.3, 0, -Math.PI / 2, 0)), c.glow.child(T(7.5, 0, 0.3, 0, -Math.PI / 2, 0)));
    void fire;
    c.box(7.3, 0.3, 0.6, 1.5);
    tb.fires.push(c.W(6.9, 0.3, 0.8));
    // mission board by the door
    K.noticeBoard(c.pl.child(T(-4.6, -0.6, 5.62, 0, Math.PI, 0)), true);
    c.interact({ id: `${id}-board`, kind: 'board', radius: 2.0, label: 'Mission Board', icon: '📜', lx: -4.6, lz: 4.3, lookX: -4.6, lookZ: 5.6, lookY: 1.2 });
    tb.mark(c.W(-4.6, 4.3), '📜', 'Mission Board', { id: `${id}-board` });
    // wall lanterns + decor
    for (const [x, z, ry] of [
      [-7.8, -1, Math.PI / 2],
      [-7.8, 3.5, Math.PI / 2],
      [7.8, -3.5, -Math.PI / 2],
      [7.8, 3.8, -Math.PI / 2],
      [4, -5.85, 0],
    ] as [number, number, number][]) {
      const lp = c.pl.child(T(x, 0, z, 0, ry, 0));
      lp.add(new THREE.BoxGeometry(0.1, 0.1, 0.5), PAL.ironDark, T(0, 3.0, 0.25));
      c.glow.child(T(x, 0, z, 0, ry, 0)).add(cyl(0.16, 0.16, 0.38, 6), '#ffffff', T(0, 2.75, 0.5));
    }
    K.anchorGeo(c.pl.child(T(5.2, 1.0, -5.8, 0, 0, 0)));
    // recruits: two at tables, one by the wall
    c.spot(`${id}-recruit0`, -6.45, 1.4, Math.PI / 2, 'sitDrink', { y: 0.16, prop: 'mug' });
    c.interact({ id: `${id}-recruit0`, kind: 'recruit', recruitIdx: 0, radius: 1.8, label: 'Recruit', icon: '🧑‍✈️', lx: -4.6, lz: -0.3, lookX: -6.45, lookZ: 1.4, lookY: 1.3 });
    c.spot(`${id}-recruit1`, 4.85, 2.7, -Math.PI / 2, 'sitDrink', { y: 0.16, prop: 'mug' });
    c.interact({ id: `${id}-recruit1`, kind: 'recruit', recruitIdx: 1, radius: 1.8, label: 'Recruit', icon: '🧑‍✈️', lx: 5.2, lz: 4.6, lookX: 4.85, lookZ: 2.7, lookY: 1.3 });
    c.spot(`${id}-recruit2`, -7.1, -1.4, Math.PI / 2, 'hips');
    c.interact({ id: `${id}-recruit2`, kind: 'recruit', recruitIdx: 2, radius: 1.8, label: 'Recruit', icon: '🧑‍✈️', lx: -5.5, lz: -1.2, lookX: -7.1, lookZ: -1.4 });
    // music + dancing spots
    c.spot(`${id}-music`, 5.6, -0.2, -Math.PI / 2, 'cheer');
    c.spot(`${id}-dance0`, 0.6, 0.6, 0.4, 'dance');
    c.spot(`${id}-dance1`, -1.6, 0.4, -0.5, 'dance');
  });
  tb.mark(tb.localToWorld(r.pos, r.rot, 0, 7.5), '🍺', name, { id: `${id}-bar` });
  tb.resident({ id: `${id}-keeper`, spec: bartender.spec, name: bartender.name, role: 'keeper', schedule: [{ from: 0, to: 24, spot: `${id}-barkeep`, anim: 'idle' }], lines: ["What'll it be, Captain?", 'Rooms upstairs, rumours downstairs.'] });
  for (let i = 0; i < 3; i++) tb.resident({ id: `${id}-r${i}`, spec: 'recruit' + i, name: 'Recruit', role: 'recruit', schedule: [{ from: 0, to: 24, spot: `${id}-recruit${i}` }], lines: [] });
  return r;
}

function warehouse(tb: TownBuilder, a: number, b: number, ly: number, name: string, style: Style, clerk: { spec: string; name: string }) {
  const id = `${tb.port.id}-warehouse`;
  const r = tb.interior({ id, kind: 'warehouse', name, icon: '📦', a, b, ly, w: 13, d: 10, h: 5, doorW: 3.4, ...style }, (c) => {
    K.crateStack(c.pl.child(T(-4.6, 0, -3.6)), 0, 0, c.rng, 5);
    K.crateStack(c.pl.child(T(-1.2, 0, -3.8)), 0, 0, c.rng, 4);
    K.barrelStack(c.pl.child(T(3.6, 0, -3.9)), 0, 0, c.rng);
    c.box(-4.6, -3.6, 1.7, 0.8);
    c.box(-1.2, -3.8, 1.7, 0.8);
    c.box(3.6, -3.9, 1.5, 0.6);
    K.crateStack(c.pl.child(T(-5.2, 0, 1.0, 0, Math.PI / 2, 0)), 0, 0, c.rng, 4);
    c.box(-5.2, 1.0, 0.8, 1.7);
    for (let i = 0; i < 4; i++) sack(c.pl, -2.6 + i * 0.7, 0, -1.4, 1);
    // counter + ledger
    c.pl.add(new THREE.BoxGeometry(3.4, 1.05, 0.9), PAL.wood, T(3.2, 0.52, 1.6));
    c.pl.add(new THREE.BoxGeometry(3.6, 0.1, 1.1), PAL.woodLight, T(3.2, 1.08, 1.6));
    c.pl.add(new THREE.BoxGeometry(0.6, 0.08, 0.45), '#f6efe2', T(3.0, 1.17, 1.6, 0, 0.2, 0));
    c.pl.add(new THREE.BoxGeometry(0.6, 0.05, 0.45), '#7a2a1e', T(3.0, 1.13, 1.6, 0, 0.2, 0));
    c.box(3.2, 1.6, 1.75, 0.5);
    c.spot(`${id}-clerk`, 3.2, 0.45, 0, 'idle');
    c.interact({ id, kind: 'warehouse', radius: 2.0, label: 'Warehouse', icon: '📦', keeper: `${id}-keeper`, lx: 3.2, lz: 2.9, lookX: 3.2, lookZ: 0.45 });
    const lp = c.glow.child(T(5.9, 0, -2, 0, -Math.PI / 2, 0));
    lp.add(cyl(0.16, 0.16, 0.38, 6), '#ffffff', T(0, 3.0, 0.5));
  });
  tb.mark(tb.localToWorld(r.pos, r.rot, 0, 6.5), '📦', name, { id });
  tb.resident({ id: `${id}-keeper`, spec: clerk.spec, name: clerk.name, role: 'keeper', schedule: [{ from: 0, to: 24, spot: `${id}-clerk` }], lines: ['Store your cargo here – safe as houses.', 'Every crate counted, every coin noted.'] });
  return r;
}

function gunsmith(tb: TownBuilder, a: number, b: number, ly: number, name: string, style: Style, smith: { spec: string; name: string }) {
  const id = `${tb.port.id}-gunsmith`;
  const r = tb.interior({ id, kind: 'gunsmith', name, icon: '💣', a, b, ly, w: 11, d: 8.5, ...style }, (c) => {
    c.pl.add(new THREE.BoxGeometry(6, 1.05, 0.9), '#5a3a24', T(0, 0.52, -0.9));
    c.pl.add(new THREE.BoxGeometry(6.2, 0.1, 1.1), PAL.woodLight, T(0, 1.08, -0.9));
    cannonballPileAt(c.pl, -1.8, -0.9, 1.13);
    K.cannonGeo(c.pl.child(T(1.6, 1.13, -0.9, 0, Math.PI / 2, 0)), 0.55, PAL.brass, false);
    c.box(0, -0.9, 3.05, 0.5);
    c.spot(`${id}-smith`, 0, -2.1, 0, 'hips');
    c.interact({ id, kind: 'gunsmith', radius: 2.2, label: 'Gunsmith', icon: '💣', keeper: `${id}-keeper`, lx: 0, lz: 0.9, lookX: 0, lookZ: -2.1 });
    K.weaponRack(c.pl.child(T(0, 0, -3.95)));
    K.powderKeg(c.pl, -4.3, -3.3);
    K.powderKeg(c.pl, -3.4, -3.5);
    K.powderKeg(c.pl, 4.3, -3.3);
    c.circle(-3.9, -3.4, 1.0);
    c.circle(4.3, -3.3, 0.6);
    for (const sx of [-1, 1]) {
      K.cannonGeo(c.pl.child(T(sx * 3.7, 0, 2.0, 0, sx * 0.4, 0)), 1.0, sx < 0 ? PAL.iron : '#b07a3a');
      c.circle(sx * 3.7, 1.8, 0.9);
      K.cannonballPile(c.pl, sx * 3.9, 3.3);
    }
    const lp = c.glow.child(T(0, 0, 4.0, 0, Math.PI, 0));
    lp.add(cyl(0.16, 0.16, 0.38, 6), '#ffffff', T(2.5, 3.0, 0.2));
  });
  tb.mark(tb.localToWorld(r.pos, r.rot, 0, 5.5), '💣', name, { id });
  tb.resident({ id: `${id}-keeper`, spec: smith.spec, name: smith.name, role: 'keeper', schedule: [{ from: 0, to: 24, spot: `${id}-smith` }], lines: ['Boom! ...sorry. I get excited.', 'Bigger guns, longer range, nastier shot.'] });
  return r;
}

function cannonballPileAt(pl: Placer, x: number, z: number, y: number) {
  for (let i = 0; i < 3; i++) pl.add(new THREE.SphereGeometry(0.14, 8, 6), PAL.ironDark, T(x + (i - 1) * 0.29, y + 0.14, z));
  pl.add(new THREE.SphereGeometry(0.14, 8, 6), PAL.ironDark, T(x - 0.14, y + 0.38, z));
  pl.add(new THREE.SphereGeometry(0.14, 8, 6), PAL.ironDark, T(x + 0.14, y + 0.38, z));
}

/** Small hidden room for the black market. */
function den(tb: TownBuilder, a: number, b: number, ly: number, name: string, style: Style, nightOnly: boolean) {
  const id = `${tb.port.id}-black`;
  const r = tb.interior({ id, kind: 'den', name, icon: '🕵️', a, b, ly, w: 6.5, d: 5.5, h: 3.8, doorW: 1.8, noSign: true, ...style }, (c) => {
    K.rug(c.pl.child(T(0, 0, 0.3)), 3.6, 2.6, '#3b1d5a', '#f4c24c');
    c.pl.add(new THREE.BoxGeometry(2.2, 0.9, 0.9), '#3a2418', T(0, 0.45, -0.9));
    c.pl.add(new THREE.BoxGeometry(2.4, 0.08, 1.1), '#5a3a24', T(0, 0.92, -0.9));
    c.pl.add(cyl(0.05, 0.05, 0.2, 6), '#f6efe2', T(-0.6, 1.06, -0.9));
    c.glow.add(new THREE.ConeGeometry(0.05, 0.12, 6), '#ffffff', T(-0.6, 1.22, -0.9));
    for (let i = 0; i < 5; i++) c.pl.add(new THREE.OctahedronGeometry(0.08, 0), ['#e84393', '#00cec9', '#fdcb6e', '#6c5ce7', '#55efc4'][i], T(0.2 + i * 0.15, 1.02, -0.8));
    c.box(0, -0.9, 1.2, 0.55);
    c.spot(`${id}-dealer`, 0, -1.95, 0, 'idle');
    c.interact({ id, kind: 'black', radius: 1.9, label: 'Shady Dealer', icon: '🕵️', keeper: `${id}-keeper`, secret: true, nightOnly, lx: 0, lz: 0.6, lookX: 0, lookZ: -1.95 });
    K.ropeCoil(c.pl, 2.4, 0, -1.8, 0.9);
    crate(c.pl, -2.4, 0, -1.8, 0.9, 0.3);
    crate(c.pl, -2.3, 0.9, -1.9, 0.7, 0.8);
    c.circle(-2.4, -1.8, 0.7);
    // treasure chest
    c.pl.add(roundBoxChest(), '#8b4f24', T(2.3, 0.35, 0.8, 0, -0.5, 0));
    c.pl.add(new THREE.BoxGeometry(0.95, 0.1, 0.62), PAL.gold, T(2.3, 0.7, 0.8, 0, -0.5, 0));
    c.circle(2.3, 0.8, 0.6);
    // curtains
    for (const sx of [-1, 1]) c.pl.add(new THREE.BoxGeometry(0.9, 2.8, 0.08, 1, 6, 1), '#6a1b3a', T(sx * 1.6, 1.5, -2.55));
  });
  tb.resident({
    id: `${id}-keeper`,
    spec: 'smuggler',
    name: 'Shady Dealer',
    role: 'smuggler',
    schedule: nightOnly
      ? [
          { from: 20, to: 5, spot: `${id}-dealer` },
          { from: 5, to: 20, spot: 'home' },
        ]
      : [{ from: 0, to: 24, spot: `${id}-dealer` }],
    lines: ['Psst. Over here.'],
  });
  tb.mark(tb.localToWorld(r.pos, r.rot, 0, 4), '🕵️', name, { id, secret: true });
  return r;
}

function roundBoxChest() {
  return new THREE.BoxGeometry(0.9, 0.6, 0.6);
}

/** Open-fronted shipwright's shed with a hull on the slipway (front faces the water). */
function shipyard(tb: TownBuilder, a: number, b: number, ly: number, name: string, roofCol: string, wright: { spec: string; name: string }) {
  const id = `${tb.port.id}-shipwright`;
  const W = 13;
  const D = 10;
  const f = tb.fit(a, b, W / 2 + 0.5, D / 2 + 0.5, ly);
  const p = tb.w(f.a, f.b);
  const rot = tb.yaw(ly);
  const pl = tb.placer(tb.wP, p.x, p.y, p.z, rot);
  const gl = tb.placer(tb.gP, p.x, p.y, p.z, rot);
  // posts
  const posts: [number, number][] = [
    [-W / 2, -D / 2],
    [W / 2, -D / 2],
    [-W / 2, D / 2],
    [W / 2, D / 2],
    [-W / 2, 0],
    [W / 2, 0],
    [0, -D / 2],
  ];
  for (const [x, z] of posts) {
    const h = 5.4 - ((z + D / 2) / D) * 1.0;
    pl.add(cyl(0.2, 0.24, h, 7), PAL.woodDark, T(x, h / 2, z));
    const wp = tb.localToWorld(p, rot, x, z);
    tb.circle(wp.x, wp.z, 0.35);
  }
  // sloped plank roof
  for (let x = -W / 2 - 0.6; x < W / 2 + 0.6; x += 0.7) pl.add(new THREE.BoxGeometry(0.68, 0.14, D + 1.4), Math.round(x / 0.7) % 2 ? roofCol : new THREE.Color(roofCol).multiplyScalar(0.85).getStyle(), T(x + 0.35, 4.95, 0, 0.1, 0, 0));
  pl.add(new THREE.BoxGeometry(W + 1.3, 0.3, 0.3), PAL.woodDark, T(0, 4.45, D / 2 + 0.1));
  // back wall + half side walls
  for (let x = -W / 2; x < W / 2; x += 0.5) pl.add(new THREE.BoxGeometry(0.48, 5.2, 0.14), Math.round(x * 2) % 3 ? '#9a6a40' : '#8a5a33', T(x + 0.25, 2.6, -D / 2));
  for (const sx of [-1, 1]) for (let z = -D / 2; z < -0.5; z += 0.5) pl.add(new THREE.BoxGeometry(0.14, 3.0, 0.48), Math.round(z * 2) % 3 ? '#9a6a40' : '#8a5a33', T((sx * W) / 2, 1.5, z + 0.25));
  tb.boxLocal(p, rot, 0, -D / 2, W / 2, 0.2);
  for (const sx of [-1, 1]) tb.boxLocal(p, rot, (sx * W) / 2, -D / 4 - 0.25, 0.2, D / 4);
  // slipway + hull frame (bow pointing out of the shed toward the water)
  for (let z = -3.5; z < D / 2 + 6; z += 0.6) pl.add(new THREE.BoxGeometry(3.4, 0.14, 0.5), Math.round(z / 0.6) % 2 ? PAL.plank : PAL.woodLight, T(2.6, 0.08, z));
  K.hullFrame(pl.child(T(2.6, 0, 0.8)), 8.5);
  tb.boxLocal(p, rot, 2.6, 0.8, 1.9, 4.4);
  // workbench + shipwright
  K.workbench(pl.child(T(-3.6, 0, -2.6)));
  tb.boxLocal(p, rot, -3.6, -2.6, 1.4, 0.6);
  const wpos = tb.localToWorld(p, rot, -3.6, -3.7);
  tb.spot(`${id}-wright`, wpos, rot, 'hammer', { prop: 'hammer' });
  const front = tb.localToWorld(p, rot, -3.6, -1.1);
  tb.interactables.push({ id, kind: 'shipwright', pos: front, radius: 2.2, label: 'Shipwright', icon: '🔨', look: wpos.clone().setY(wpos.y + 1.6), keeper: `${id}-keeper` });
  tb.mark(front, '🔨', name, { id });
  // lumber, sawhorse, anchor, rope, paint, lantern
  for (let i = 0; i < 4; i++) pl.add(new THREE.BoxGeometry(0.3, 0.2, 4.5), i % 2 ? PAL.woodLight : PAL.plank, T(-5.3 + (i % 2) * 0.32, 0.12 + Math.floor(i / 2) * 0.22, 2.2));
  tb.boxLocal(p, rot, -5.15, 2.2, 0.45, 2.3);
  K.sawHorse(pl.child(T(-2.2, 0, 2.6, 0, 0.4, 0)));
  tb.boxLocal(p, rot, -2.2, 2.6, 1.0, 0.45, 0.4);
  K.anchorGeo(pl.child(T(5.8, 0, -4.3)));
  K.ropeCoil(pl, 5.4, 0, -2.6);
  K.ropeCoil(pl, -5.6, 0, -4.2, 0.8);
  lanternLocal(pl, gl, -W / 2 + 0.4, 3.6, 0.3);
  lanternLocal(pl, gl, W / 2 - 0.4, 3.6, 0.3);
  tb.sign(name, '🔨', tb.localToWorld(p, rot, 0, D / 2 + 0.3, p.y + 5.1), rot, 4.2, '#244c6e');
  tb.footprint(p.x, p.z, W / 2, D / 2, rot, roofCol);
  tb.resident({ id: `${id}-keeper`, spec: wright.spec, name: wright.name, role: 'keeper', schedule: [{ from: 0, to: 24, spot: `${id}-wright` }], lines: ['Want to make that ship faster?', 'Hold still, I\'m measuring your hull.'] });
  return { pos: p, rot };
}

function lanternLocal(pl: Placer, gl: Placer, x: number, y: number, z: number) {
  pl.add(new THREE.BoxGeometry(0.1, 0.1, 0.5), PAL.ironDark, T(x, y + 0.6, z));
  gl.add(cyl(0.16, 0.16, 0.38, 6), '#ffffff', T(x, y + 0.35, z));
}

/** Docked decorative ship next to a pier (or at an offset). */
function dockedShip(tb: TownBuilder, design: Parameters<typeof buildShip>[0], x: number, z: number, heading: number, furl = 0.75) {
  const ship = buildShip(design);
  ship.sailUniforms.uFurl.value = furl;
  ship.group.position.set(x, 0, z);
  ship.group.rotation.y = heading;
  tb.group.add(ship.group);
  tb.flags.push(ship.flag);
}

// ---------------------------------------------------------------------------
// NPC helpers
// ---------------------------------------------------------------------------
function waypoint(tb: TownBuilder, id: string, a: number, b: number, facing = 0) {
  tb.spot(`${tb.port.id}-${id}`, tb.w(a, b), tb.yaw(facing), 'idle', { public: true });
  return `${tb.port.id}-${id}`;
}

function guards(tb: TownBuilder, routes: string[][], names: string[]) {
  routes.forEach((route, i) =>
    tb.resident({
      spec: 'guard',
      name: names[i % names.length],
      role: 'guard',
      schedule: [{ from: 0, to: 24, spot: route[0] }],
      route,
      lines: ['Move along, citizen.', 'No pirates allowed. You ARE a merchant, yes?', 'Keep the peace, or I keep you.'],
      speed: 1.3,
    }),
  );
}

function fishers(tb: TownBuilder, spots: { a?: number; b?: number; pos?: THREE.Vector3; facing: number }[], specs = ['fisher']) {
  spots.forEach((s, i) => {
    const id = `${tb.port.id}-fish${i}`;
    const pos = s.pos ?? tb.w(s.a!, s.b!);
    tb.spot(id, pos, s.facing, 'fish', { prop: 'rod' });
    tb.resident({
      spec: specs[i % specs.length],
      name: pick(['Old Bert', 'Salty Sue', 'Gill', 'Mackerel Mo', 'Captain Cod'], i),
      role: 'fisher',
      schedule: [
        { from: 5, to: 12, spot: id, anim: 'fish', prop: 'rod' },
        { from: 12, to: 14, spot: 'wander' },
        { from: 14, to: 20, spot: id, anim: 'fish', prop: 'rod' },
        { from: 20, to: 23, spot: 'tavern' },
        { from: 23, to: 5, spot: 'home' },
      ],
      lines: ['Shh! You\'ll scare the fish.', 'Caught one THIS big yesterday.', pick(HINTS, i + 2)],
    });
  });
}

function townsfolk(tb: TownBuilder, specs: string[], names: string[], offset = 0) {
  specs.forEach((spec, i) => {
    const sched: ScheduleEntry[] =
      i % 3 === 0
        ? [
            { from: 7, to: 19, spot: 'wander' },
            { from: 19, to: 23, spot: 'tavern' },
            { from: 23, to: 7, spot: 'home' },
          ]
        : i % 3 === 1
          ? [
              { from: 9, to: 21, spot: 'wander' },
              { from: 21, to: 9, spot: 'home' },
            ]
          : [
              { from: 6, to: 12, spot: 'wander' },
              { from: 12, to: 18, spot: 'wander' },
              { from: 18, to: 1, spot: 'tavern' },
              { from: 1, to: 6, spot: 'home' },
            ];
    tb.resident({ spec, name: names[i % names.length], role: 'walker', schedule: sched, lines: hintLines(i + offset) });
  });
}

function chatters(tb: TownBuilder, pairs: { a: number; b: number; specs: [string, string] }[]) {
  pairs.forEach((p, i) => {
    const pa = tb.w(p.a - 0.85, p.b);
    const pb = tb.w(p.a + 0.85, p.b);
    const ida = `${tb.port.id}-chat${i}a`;
    const idb = `${tb.port.id}-chat${i}b`;
    const yaw = Math.atan2(pb.x - pa.x, pb.z - pa.z);
    tb.spot(ida, pa, yaw, 'talk');
    tb.spot(idb, pb, yaw + Math.PI, 'talk');
    p.specs.forEach((spec, k) =>
      tb.resident({
        spec,
        name: nameFor(spec, i * 2 + k),
        role: 'chatter',
        schedule: [
          { from: 9, to: 18, spot: k ? idb : ida, anim: 'talk' },
          { from: 18, to: 22, spot: k ? 'tavern' : 'wander' },
          { from: 22, to: 9, spot: 'home' },
        ],
        lines: hintLines(i * 2 + k + 3),
      }),
    );
  });
}

function workers(tb: TownBuilder, route: string[], specs: string[]) {
  specs.forEach((spec, i) =>
    tb.resident({
      spec,
      name: pick(['Heavy Hal', 'Lugs', 'Strongarm Sal', 'Dockside Dan'], i),
      role: 'worker',
      schedule: [
        { from: 6, to: 19, spot: route[i % route.length] },
        { from: 19, to: 23, spot: 'tavern' },
        { from: 23, to: 6, spot: 'home' },
      ],
      route,
      prop: 'crate',
      lines: ['These crates won\'t carry themselves!', 'Mind your toes, Captain.'],
      speed: 1.25,
    }),
  );
}

function nightlife(tb: TownBuilder, specs: string[]) {
  const id = `${tb.port.id}-tavern`;
  tb.resident({ spec: specs[0], name: 'Fiddlin\' Finn', role: 'musician', schedule: [{ from: 16, to: 2, spot: `${id}-music`, anim: 'cheer' }, { from: 2, to: 16, spot: 'home' }], lines: ['Request a shanty? I only know one.', '♪ Yo ho, yo ho... ♪'] });
  tb.resident({ spec: specs[1 % specs.length], name: 'Dancing Dot', role: 'dancer', schedule: [{ from: 20, to: 2, spot: `${id}-dance0`, anim: 'dance' }, { from: 2, to: 11, spot: 'home' }, { from: 11, to: 20, spot: 'wander' }], lines: ['Dance with me, Captain!'] });
  tb.resident({ spec: specs[2 % specs.length], name: 'Jig Jim', role: 'dancer', schedule: [{ from: 21, to: 1, spot: `${id}-dance1`, anim: 'dance' }, { from: 1, to: 21, spot: 'home' }], lines: ['Hup! Hup! Hup!'] });
  for (let i = 0; i < specs.length - 3; i++)
    tb.resident({ spec: specs[i + 3], name: pick(['Thirsty Thad', 'Grog Greta', 'Snoring Sid', 'Merry Mae'], i), role: 'patron', schedule: [{ from: 18, to: 2, spot: 'tavern' }, { from: 2, to: 18, spot: 'home' }], lines: hintLines(i + 5) });
}

function animals(tb: TownBuilder, kind: 'chicken' | 'cat' | 'parrot' | 'goat' | 'crab' | 'dog', at: [number, number][], r = 4) {
  for (const [a, b] of at) tb.animals.push({ kind, pos: tb.w(a, b), r, facing: tb.rng() * 6 });
}

/** Landing point on the main pier next to the berth. */
function landingFor(port: PortDef) {
  const pier = PIERS.find((p) => p.port === port.id && Math.abs(p.hw - 3) < 0.3) ?? PIERS.find((p) => p.port === port.id)!;
  // project the berth onto the pier axis, then step to the pier edge on the berth side
  const ax = Math.sin(pier.rot);
  const az = Math.cos(pier.rot);
  const rx = Math.cos(pier.rot);
  const rz = -Math.sin(pier.rot);
  const dx = port.berth.x - pier.x;
  const dz = port.berth.z - pier.z;
  const along = Math.max(-pier.hl + 2, Math.min(pier.hl - 2, dx * ax + dz * az));
  const side = Math.sign(dx * rx + dz * rz) || 1;
  return new THREE.Vector3(pier.x + ax * along + rx * side * (pier.hw - 0.8), DECK_Y, pier.z + az * along + rz * side * (pier.hw - 0.8));
}

// ---------------------------------------------------------------------------
// Port plans
// ---------------------------------------------------------------------------
function buildSkullCove(tb: TownBuilder) {
  const port = tb.port;
  const cz = SKULL_COAST_Z;
  for (const p of PIERS.filter((p) => p.port === 'skull')) buildPier(tb.wP, tb.gP, p);
  // T-head at the end of the main pier
  tb.wP.add(new THREE.BoxGeometry(14, 0.18, 4), PAL.plank, T(0, 1.72, cz + 33));
  tb.platforms.push({ x: 0, z: cz + 33, hx: 7, hz: 2, rot: 0, y: DECK_Y });
  const pirate: Style = { wall: '#7a5a3a', wallIn: '#9a6a40', roof: '#2c2c34', trim: '#3a2410', signBg: '#3a1a1a' };

  // harbour front
  tb.plaza(0, -6, 30, 10, 0, '#b0896a', '#a07a5a', 1.4);
  tb.sign('SKULL COVE', '☠️', tb.w(0, -9.5).setY(5.4), 0, 6.5, '#5a1a1a');
  tb.wP.add(cyl(0.18, 0.2, 5.6, 6), PAL.woodDark, T(-3.3, 2.8, cz - 9.6));
  tb.wP.add(cyl(0.18, 0.2, 5.6, 6), PAL.woodDark, T(3.3, 2.8, cz - 9.6));
  tb.circle(-3.3, cz - 9.6, 0.3);
  tb.circle(3.3, cz - 9.6, 0.3);

  // pirate bazaar
  tb.plaza(0, -19, 26, 13, 0, '#c9a67a', '#b8956a', 1.6);
  tb.stall('spice', -10, -13, 0.25, 'wood', { spec: 'islanderWoman', name: 'Saffron Sal' }, '#d63031');
  tb.stall('food', 10, -13, -0.25, 'wood', { spec: 'fishwife', name: 'Mama Gumbo' });
  tb.stall('material', -6, -22, 0.1, 'wood', { spec: 'pirateB', name: 'Rusty Ron' });
  tb.stall('general', 6, -22, -0.1, 'wood', { spec: 'merchant', name: 'Honest Hank' }, '#2e86c1');
  K.bunting(tb.lP, tb.w(-12, -10).setY(4.2), tb.w(12, -10).setY(4.2), 1);
  tb.lamp(-14, -15);
  tb.lamp(14, -15);
  tb.pile(-15, -8, 4);
  tb.pile(16, -7, 4);
  tb.barrels(1, -27.5, 0);

  tavern(tb, -18, -33, 0.25, 'The Salty Skull', pirate, { spec: 'innkeeper', name: 'Big Bertha' });
  shipyard(tb, 25, -12, -0.4, 'Skull Shipwright', '#a0482a', { spec: 'shipwright', name: 'Hammerin\' Hal' });
  gunsmith(tb, 17, -33, -0.2, 'Powder & Shot', { ...pirate, roof: '#7a1a1a' }, { spec: 'gunsmith', name: 'Boomer McGee' });
  warehouse(tb, -36, -19, 0.55, 'Smuggler\'s Store', { ...pirate, roof: '#4a3a2a' }, { spec: 'pirateC', name: 'Counting Clem' });
  // black market: hidden behind the tavern, down a little alley
  den(tb, -30, -47, 0.9, 'Back Alley Den', { wall: '#4a3a30', wallIn: '#3a2a22', roof: '#2a2026', trim: '#1a1210' }, false);
  tb.crates(-25.5, -44.5, 4, 0.4);

  // houses up the hill
  const pal = [
    ['#f2dfb0', '#c0392b'],
    ['#e6edf2', '#2e86c1'],
    ['#f5c6a5', '#16a085'],
    ['#fde2a7', '#d35400'],
    ['#e8d5f2', '#8e44ad'],
    ['#d6eaf8', '#c0392b'],
  ];
  const houses: [number, number, number][] = [
    [-2, -42, 0],
    [12, -46, -0.15],
    [30, -32, -0.6],
    [-44, -35, 0.6],
    [36, -45, -0.5],
    [-14, -53, 0.1],
  ];
  houses.forEach(([a, b, ly], i) => tb.houseAt(a, b, ly, { w: 6.5, d: 6, h: 4.2, wall: pal[i][0], roof: pal[i][1], floors: i % 2 ? 2 : 1, seed: 40 + i }));
  K.well(tb.placer(tb.wP, ...tb.w(4, -32).toArray(), 0), tb.placer(tb.sP, ...tb.w(4, -32).toArray(), 0));
  tb.circle(tb.w(4, -32).x, tb.w(4, -32).z, 1.1);
  watchtower(tb, -48, -12);
  fort(tb, 47, -9, -0.3);
  skullRock(tb.sP.child(T(-66, -1.5, cz + 22, 0, 0.5, 0)));
  // fishing corner on the left jetty
  K.netGeo(tb.placer(tb.wP, ...tb.w(-22, -6).toArray(), tb.yaw(0.3)), 3.2);
  tb.boxLocal(tb.w(-22, -6), tb.yaw(0.3), 0, 0, 1.8, 0.3);
  K.dryingRack(tb.placer(tb.wP, ...tb.w(-28, -9).toArray(), tb.yaw(0.5)), 3);
  tb.boxLocal(tb.w(-28, -9), tb.yaw(0.5), 0, 0, 1.7, 0.5);

  // palms + lanterns
  for (const [a, b] of [
    [-30, -24],
    [30, -18],
    [-8, -30],
    [-50, -26],
    [52, -26],
    [0, -52],
    [24, -26],
  ])
    tb.palm(a, b, 0.9 + tb.rng() * 0.3);
  for (const [a, b] of [
    [-8, -9],
    [8, -9],
    [-26, -27],
    [8, -36],
  ])
    tb.lamp(a, b);

  // decorative pirate ships
  const deco = buildShip(playerDesign({ hullLvl: 2, sailLvl: 2, cannonLvl: 2, rangeLvl: 0, steerLvl: 0, cargoLvl: 1, sailColor: '#2a2a30', hullPaint: '#4a2f1f', flag: 'pirateRed' }));
  deco.sailUniforms.uFurl.value = 0.7;
  const p1 = PIERS[1];
  deco.group.position.set(p1.x - Math.cos(p1.rot) * 7, 0, p1.z + Math.sin(p1.rot) * 7 + 2);
  deco.group.rotation.y = p1.rot;
  tb.group.add(deco.group);
  tb.flags.push(deco.flag);
  tb.flag('pirate', new THREE.Vector3(6, 1.7, cz + 34), 8, 3.4);
  for (const [a, b] of [
    [-5, -4],
    [5, -4],
  ])
    tb.circle(tb.w(a, b).x, tb.w(a, b).z, 0.2);

  // residents
  const wp = [waypoint(tb, 'wp-market', 0, -17), waypoint(tb, 'wp-front', -6, -5), waypoint(tb, 'wp-well', 7, -30), waypoint(tb, 'wp-hill', -6, -46), waypoint(tb, 'wp-yard', 18, -20), waypoint(tb, 'wp-tavern', -14, -24), waypoint(tb, 'wp-pier', 1.5, 12)];
  void wp;
  const pierRoot = waypoint(tb, 'wp-crates', -1.5, -2);
  const pierEnd = `${port.id}-wp-pier`;
  workers(tb, [pierEnd, pierRoot, `${port.id}-warehouse-door-out`], ['pirateA', 'pirateB']);
  fishers(tb, [
    { pos: new THREE.Vector3(-4.5, DECK_Y, cz + 34), facing: Math.PI * 0.08 },
    { pos: new THREE.Vector3(PIERS[2].x + 1.2, DECK_Y, PIERS[2].z + 9), facing: -0.3 },
  ]);
  townsfolk(tb, ['townWoman', 'pirateC', 'oldSalt', 'pirateA', 'islander'], ['Polly Plankton', 'Scurvy Steve', 'Grandpa Barnacle', 'Patch', 'Coco']);
  chatters(tb, [
    { a: -2, b: -30, specs: ['pirateB', 'townWoman'] },
    { a: 20, b: -24, specs: ['pirateC', 'oldSalt'] },
  ]);
  nightlife(tb, ['pirateC', 'townWoman', 'pirateA', 'pirateB', 'oldSalt', 'islander']);
  tb.resident({ spec: 'pirateA', name: 'Swabbie', role: 'sweeper', schedule: [{ from: 6, to: 11, spot: `${port.id}-wp-front`, anim: 'sweep', prop: 'mop' }, { from: 11, to: 22, spot: 'wander' }, { from: 22, to: 6, spot: 'home' }], lines: ['This deck... er, street... won\'t mop itself.'] });
  animals(tb, 'chicken', [
    [-8, -38],
    [-6, -40],
    [14, -40],
  ]);
  animals(tb, 'cat', [
    [3, -27],
    [-14, -8],
  ]);
  animals(tb, 'parrot', [[-11, -27]]);
  animals(tb, 'crab', [
    [-40, -4],
    [36, -2],
  ]);
  return tb.build(landingFor(port), tb.w(0, -22), 72);
}

function buildPortRoyal(tb: TownBuilder) {
  const port = tb.port;
  for (const p of PIERS.filter((p) => p.port === port.id)) buildPier(tb.wP, tb.gP, p, 1.7);
  const royal: Style = { wall: '#ece4d6', wallIn: '#b98a5a', roof: '#2c5aa0', trim: '#5a3a24', stone: true, signBg: '#1d3f8a' };
  tb.plaza(0, -7, 34, 12, 0, '#cfc6b8', '#bdb4a6', 1.3);
  // grand market square with a fountain
  tb.plaza(0, -24, 34, 24, 0, '#d9d0c0', '#c4baa8', 1.5);
  const fc = tb.w(0, -24);
  K.fountain(tb.placer(tb.sP, fc.x, fc.y, fc.z, 0), tb.placer(tb.gP, fc.x, fc.y, fc.z, 0));
  tb.circle(fc.x, fc.z, 2.8);
  tb.fires.length = tb.fires.length;
  const ring: [StallType, number, number, string, string][] = [
    ['food', -11, -15, 'fishwife', 'Marge the Market'],
    ['spice', 11, -15, 'islanderWoman', 'Madame Paprika'],
    ['textile', -13, -25, 'richLady', 'Lady Lacey'],
    ['material', 13, -25, 'pirateB', 'Ingot Ingrid'],
    ['luxury', -8, -33.5, 'richMan', 'Sir Sparkle'],
    ['general', 8, -33.5, 'merchant', 'Trader Tobias'],
  ];
  for (const [type, a, b, spec, name] of ring) tb.stall(type, a, b, tb.faceTo(a, b, 0, -24), 'wood', { spec, name });
  for (const [a, b] of [
    [-17, -20],
    [17, -20],
    [-17, -30],
    [17, -30],
    [0, -13],
  ])
    tb.lamp(a, b, true);
  K.bunting(tb.lP, tb.w(-15, -13).setY(4.6), tb.w(15, -13).setY(4.6), 2);
  K.bunting(tb.lP, tb.w(-15, -35).setY(4.6), tb.w(15, -35).setY(4.6), 4);

  tavern(tb, -21, -46, 0.15, 'The Crown & Anchor', { ...royal, roof: '#a5281f' }, { spec: 'innkeeper', name: 'Barnaby Brew' });
  gunsmith(tb, 21, -46, -0.15, 'Royal Armoury', { ...royal, roof: '#2c3e50' }, { spec: 'gunsmith', name: 'Sergeant Kaboom' });
  shipyard(tb, 27, -8, -0.5, 'Royal Shipyard', '#2c5aa0', { spec: 'shipwright', name: 'Master Keel' });
  warehouse(tb, -27, -12, 0.45, 'Royal Trading Co.', { ...royal, roof: '#6d4c41' }, { spec: 'clerk', name: 'Mr. Ledger' });
  // the black market only opens at night, in an alley behind the tavern
  den(tb, -36, -56, 0.7, 'Moonlight Den', { wall: '#5a5048', wallIn: '#3a2a22', roof: '#2a2026', trim: '#1a1210', stone: true }, true);
  tb.crates(-31, -52, 4, 0.5);

  const walls = ['#f4f1ea', '#e9dfcf', '#dfe7ee', '#f6e3c8'];
  const roofs = ['#c0392b', '#2980b9', '#e67e22', '#2c5aa0'];
  const houses: [number, number, number][] = [
    [0, -56, 0],
    [12, -58, -0.1],
    [-12, -60, 0.1],
    [34, -36, -0.7],
    [-38, -38, 0.8],
    [26, -60, -0.3],
  ];
  houses.forEach(([a, b, ly], i) => tb.houseAt(a, b, ly, { w: 7, d: 6, h: 5 + (i % 2), wall: walls[i % 4], roof: roofs[i % 4], stone: true, floors: 2, seed: 70 + i }));
  for (const [a, b] of [
    [-20, -8],
    [20, -8],
    [-30, -30],
    [30, -48],
    [0, -44],
  ])
    tb.palm(a, b);
  for (const [a, b] of [
    [-6, -44],
    [6, -44],
  ])
    tb.lamp(a, b, true);
  // planters
  for (const [a, b, ly] of [
    [-6, -3, 0],
    [6, -3, 0],
  ] as [number, number, number][]) {
    const p = tb.w(a, b);
    K.planter(tb.placer(tb.wP, p.x, p.y, p.z, tb.yaw(ly)), tb.placer(tb.lP, p.x, p.y, p.z, tb.yaw(ly)), 2.4, a * 3);
    tb.boxLocal(p, tb.yaw(ly), 0, 0, 1.2, 0.45);
  }
  lighthouse(tb);
  for (const k of [-1, 1]) tb.flag(k < 0 ? 'navy' : 'merchantA', tb.w(k * 7, 2), 8);
  // docked merchant ship
  const pier = PIERS.find((p) => p.port === port.id && p.hw === 3)!;
  const design = DESIGNS.largeCargo;
  dockedShip(tb, design, pier.x - Math.cos(pier.rot) * (design.beam / 2 + 4.2), pier.z + Math.sin(pier.rot) * (design.beam / 2 + 4.2), pier.rot + Math.PI);
  // rowboats on the beach
  for (const [a, b, ly] of [
    [-40, -2, 1.2],
    [40, -4, -1.0],
  ] as [number, number, number][]) {
    const p = tb.w(a, b);
    K.rowboat(tb.placer(tb.wP, p.x, Math.max(p.y, 0.4) - 0.3, p.z, tb.yaw(ly)), '#2e86c1');
    tb.boxLocal(p, tb.yaw(ly), 0, 0, 0.9, 1.9);
  }

  // residents
  const wps = [waypoint(tb, 'wp-a', -16, -6), waypoint(tb, 'wp-b', 16, -6), waypoint(tb, 'wp-c', -18, -38), waypoint(tb, 'wp-d', 18, -38), waypoint(tb, 'wp-e', 0, -48), waypoint(tb, 'wp-pier', 0, 10)];
  guards(tb, [[wps[0], wps[2], wps[4], wps[3], wps[1]], [wps[5], wps[1], wps[0]]], ['Sergeant Stern', 'Corporal Polite']);
  workers(tb, [wps[5], `${port.id}-warehouse-door-out`], ['sailor', 'pirateA']);
  townsfolk(tb, ['townWoman', 'merchant', 'richLady', 'sailor', 'clerk', 'richMan'], ['Prudence', 'Mr. Pennywise', 'Lady Fanshawe', 'Able Seaman Abe', 'Clarence', 'Lord Bigwig']);
  chatters(tb, [
    { a: -4, b: -16, specs: ['townWoman', 'sailor'] },
    { a: 5, b: -40, specs: ['merchant', 'richLady'] },
  ]);
  fishers(tb, [{ a: -30, b: 14, facing: tb.yaw(0) }]);
  nightlife(tb, ['pirateC', 'townWoman', 'sailor', 'merchant', 'pirateB', 'clerk']);
  animals(tb, 'cat', [
    [-10, -40],
    [24, -14],
  ]);
  animals(tb, 'dog', [[4, -10]], 8);
  return tb.build(landingFor(port), tb.w(0, -26), 70);
}

function buildSaltmarsh(tb: TownBuilder) {
  const port = tb.port;
  for (const p of PIERS.filter((p) => p.port === port.id)) buildPier(tb.wP, tb.gP, p, 1.7, p.hw > 2.5);
  const fishy: Style = { wall: '#dfeeea', wallIn: '#9a7a5a', roof: '#16a085', trim: '#3a5a6a', signBg: '#1f5f6a' };
  tb.plaza(0, -8, 22, 10, 0, '#c9b48a', '#b9a47a', 1.6);
  tb.stall('food', -7, -14, 0.25, 'wood', { spec: 'fishwife', name: 'Fishwife Fran', lines: ['Fresh fish! Cheapest on the seven seas!', 'Smells fishy? That means it\'s fresh!'] }, '#1f8fbf');
  tb.stall('material', 7, -14, -0.25, 'wood', { spec: 'fisher', name: 'Netmaker Ned' });
  tb.stall('general', 0, -22, 0, 'wood', { spec: 'clerk', name: 'Penny Pincher' }, '#16a085');
  tavern(tb, 15, -33, -0.3, 'The Leaky Bucket', fishy, { spec: 'innkeeper', name: 'Wet Willy' });
  shipyard(tb, -21, -12, 0.45, 'Net & Hull', '#3a5a6a', { spec: 'shipwright', name: 'Bosun Barry' });
  warehouse(tb, 22, -12, -0.4, 'Fish Shed', { ...fishy, roof: '#5a7a8a' }, { spec: 'fisher', name: 'Old Haddock' });
  const houses: [number, number, number][] = [
    [-12, -32, 0.2],
    [-4, -40, 0],
    [-22, -38, 0.5],
    [6, -46, -0.1],
    [-14, -48, 0.3],
  ];
  const cols = [
    ['#dfeeea', '#16a085'],
    ['#f6efe2', '#2e86c1'],
    ['#eaf2f4', '#d35400'],
    ['#fdf3e1', '#1abc9c'],
    ['#e6eef7', '#c0392b'],
  ];
  houses.forEach(([a, b, ly], i) => tb.houseAt(a, b, ly, { w: 6, d: 5.5, h: 3.8, wall: cols[i][0], roof: cols[i][1], seed: 90 + i }));
  // nets, racks, boats, baskets everywhere – it's a fishing village
  for (const [a, b, ly] of [
    [-12, -4, 0.1],
    [12, -4, -0.1],
    [30, -20, -0.8],
  ] as [number, number, number][]) {
    K.netGeo(tb.placer(tb.wP, ...tb.w(a, b).toArray(), tb.yaw(ly)), 3.4);
    tb.boxLocal(tb.w(a, b), tb.yaw(ly), 0, 0, 1.9, 0.3);
  }
  for (const [a, b, ly] of [
    [-5, -28, 0],
    [8, -26, 0.2],
    [-30, -24, 0.6],
  ] as [number, number, number][]) {
    K.dryingRack(tb.placer(tb.wP, ...tb.w(a, b).toArray(), tb.yaw(ly)), 3.2);
    tb.boxLocal(tb.w(a, b), tb.yaw(ly), 0, 0, 1.8, 0.5);
  }
  for (const [a, b, ly, col] of [
    [-34, -4, 1.3, '#e74c3c'],
    [-38, -8, 1.0, '#f1c40f'],
    [36, -5, -1.2, '#2e86c1'],
  ] as [number, number, number, string][]) {
    const p = tb.w(a, b);
    K.rowboat(tb.placer(tb.wP, p.x, Math.max(p.y, 0.4) - 0.3, p.z, tb.yaw(ly)), col);
    tb.boxLocal(p, tb.yaw(ly), 0, 0, 0.9, 1.9);
  }
  for (const [a, b] of [
    [-3, -6],
    [4, -16],
    [-16, -20],
  ]) {
    const p = tb.w(a, b);
    K.fishBasket(tb.placer(tb.wP, p.x, p.y, p.z, 0), 0, 0);
    K.fishBasket(tb.placer(tb.wP, p.x, p.y, p.z, 0), 0.8, 0.3);
    tb.circle(p.x + 0.4, p.z, 0.8);
  }
  const wl = tb.w(-6, -34);
  K.well(tb.placer(tb.wP, wl.x, wl.y, wl.z, 0), tb.placer(tb.sP, wl.x, wl.y, wl.z, 0));
  tb.circle(wl.x, wl.z, 1.1);
  for (const [a, b] of [
    [-26, -30],
    [26, -40],
    [0, -52],
    [-34, -16],
  ])
    tb.palm(a, b);
  for (const [a, b] of [
    [-6, -9],
    [6, -9],
    [3, -32],
  ])
    tb.lamp(a, b);
  lighthouse(tb);
  tb.flag('merchantC', tb.w(-7, 1), 7);
  const pier = PIERS.find((p) => p.port === port.id && p.hw === 3)!;
  dockedShip(tb, DESIGNS.smallMerchant, pier.x - Math.cos(pier.rot) * (DESIGNS.smallMerchant.beam / 2 + 4.2), pier.z + Math.sin(pier.rot) * (DESIGNS.smallMerchant.beam / 2 + 4.2), pier.rot + Math.PI);

  const jetties = PIERS.filter((p) => p.port === port.id && p.hw < 2.5);
  fishers(
    tb,
    [
      ...jetties.map((j) => ({ pos: new THREE.Vector3(j.x + Math.sin(j.rot) * (j.hl - 1.5), DECK_Y, j.z + Math.cos(j.rot) * (j.hl - 1.5)), facing: j.rot })),
      { pos: landingFor(port).clone().add(new THREE.Vector3(Math.sin(pier.rot) * 12, 0, Math.cos(pier.rot) * 12)), facing: pier.rot + 0.4 },
    ],
    ['fisher', 'fishwife', 'fisher'],
  );
  waypoint(tb, 'wp-a', -10, -10);
  waypoint(tb, 'wp-b', 12, -22);
  waypoint(tb, 'wp-c', -12, -42);
  townsfolk(tb, ['fishwife', 'fisher', 'townWoman', 'sailor'], ['Auntie Eel', 'Barnacle Bill', 'Coral', 'Skipper']);
  chatters(tb, [{ a: 0, b: -30, specs: ['fisher', 'fishwife'] }]);
  nightlife(tb, ['sailor', 'fishwife', 'fisher', 'pirateC']);
  animals(tb, 'chicken', [
    [-10, -36],
    [-2, -44],
    [-18, -42],
  ]);
  animals(tb, 'cat', [
    [-2, -6],
    [6, -18],
    [20, -8],
  ]);
  animals(tb, 'crab', [
    [-30, -2],
    [28, -2],
  ]);
  return tb.build(landingFor(port), tb.w(0, -22), 60);
}

function buildGoldhaven(tb: TownBuilder) {
  const port = tb.port;
  for (const p of PIERS.filter((p) => p.port === port.id)) buildPier(tb.wP, tb.gP, p, 1.7);
  const rich: Style = { wall: '#fbf7ef', wallIn: '#d9c3a0', roof: '#1a8a8a', trim: '#c9a227', stone: true, signBg: '#5b2a86', signFg: '#ffe48a' };
  // marble boulevard from the pier up to a grand plaza with a golden statue
  tb.plaza(0, -14, 9, 24, 0, '#f2ede4', '#e2dccf', 1.2);
  tb.plaza(0, -34, 28, 18, 0, '#f6f1e8', '#e8dfcf', 1.4, true);
  const sp = tb.w(0, -34);
  K.statuePlinth(tb.placer(tb.sP, sp.x, sp.y, sp.z, 0));
  tb.box(sp.x, sp.z, 1.15, 1.15, tb.yaw(0));
  statue(tb, sp.clone().setY(sp.y + 2.12), tb.yaw(0));
  tb.mark(sp, '🗿', 'Admiral Goldbeard');
  // fancy stalls along the boulevard
  tb.stall('luxury', -8, -12, Math.PI / 2, 'fancy', { spec: 'richMan', name: 'Baron von Bling' }, '#8e44ad');
  tb.stall('textile', 8, -12, -Math.PI / 2, 'fancy', { spec: 'richLady', name: 'Madame Silk' }, '#e84393');
  tb.stall('spice', -8, -21, Math.PI / 2, 'fancy', { spec: 'merchant', name: 'Count Cardamom' }, '#d35400');
  tb.stall('food', 8, -21, -Math.PI / 2, 'fancy', { spec: 'fishwife', name: 'Chef Truffle' }, '#16a085');
  for (let i = 0; i < 4; i++) {
    tb.palm(-5, -6 - i * 6.5, 0.9);
    tb.palm(5, -6 - i * 6.5, 0.9);
  }
  for (const [a, b] of [
    [-13, -28],
    [13, -28],
    [-13, -40],
    [13, -40],
  ])
    tb.lamp(a, b, true);
  for (const [a, b, ly] of [
    [-9, -30, 0],
    [9, -30, 0],
    [-9, -39, 0],
    [9, -39, 0],
  ] as [number, number, number][]) {
    const p = tb.w(a, b);
    K.planter(tb.placer(tb.wP, p.x, p.y, p.z, tb.yaw(ly)), tb.placer(tb.lP, p.x, p.y, p.z, tb.yaw(ly)), 2.4, b * 7);
    tb.boxLocal(p, tb.yaw(ly), 0, 0, 1.2, 0.45);
  }
  tavern(tb, -20, -49, 0.15, 'The Golden Goblet', { ...rich, roof: '#c9a227' }, { spec: 'innkeeper', name: 'Maître Pierre' });
  gunsmith(tb, 20, -49, -0.15, 'Gilded Guns', rich, { spec: 'gunsmith', name: 'Lord Bombast' });
  shipyard(tb, -30, -29, -Math.PI / 2 + 0.25, 'Goldhaven Yacht Works', '#1a8a8a', { spec: 'shipwright', name: 'Sir Rivets' });
  warehouse(tb, -19, -11, 0.3, 'Golden Vault Storage', { ...rich, roof: '#5b2a86' }, { spec: 'clerk', name: 'Mr. Strongbox' });
  const houses: [number, number, number][] = [
    [-38, -41, 0.7],
    [0, -58, 0],
    [-13, -62, 0.2],
    [13, -62, -0.2],
  ];
  houses.forEach(([a, b, ly], i) => tb.houseAt(a, b, ly, { w: 7.5, d: 6.5, h: 5.5, wall: '#fbf7ef', roof: ['#1a8a8a', '#c9a227', '#5b2a86', '#2e86c1', '#1a8a8a'][i], trim: PAL.gold, stone: true, floors: 2, seed: 120 + i }));
  lighthouse(tb);
  for (const k of [-1, 1]) tb.flag(k < 0 ? 'luxury' : 'navy', tb.w(k * 7, 2), 9);
  const pier = PIERS.find((p) => p.port === port.id && p.hw === 3)!;
  dockedShip(tb, DESIGNS.luxury, pier.x - Math.cos(pier.rot) * (DESIGNS.luxury.beam / 2 + 4.2), pier.z + Math.sin(pier.rot) * (DESIGNS.luxury.beam / 2 + 4.2), pier.rot + Math.PI);

  const wps = [waypoint(tb, 'wp-a', 0, -8), waypoint(tb, 'wp-b', -12, -34), waypoint(tb, 'wp-c', 12, -34), waypoint(tb, 'wp-d', 0, -44), waypoint(tb, 'wp-pier', 0, 10)];
  guards(tb, [[wps[0], wps[1], wps[3], wps[2]], [wps[4], wps[0]]], ['Captain Polish', 'Private Shiny']);
  townsfolk(tb, ['richLady', 'richMan', 'richLady', 'merchant', 'townWoman'], ['Duchess Diamante', 'Sir Moneybags', 'Lady Lavender', 'Mr. Gold', 'Rosie']);
  chatters(tb, [
    { a: -4, b: -27, specs: ['richMan', 'richLady'] },
    { a: 4, b: -44, specs: ['richLady', 'merchant'] },
  ]);
  nightlife(tb, ['richMan', 'richLady', 'merchant', 'sailor', 'richLady']);
  animals(tb, 'cat', [[-4, -40]]);
  animals(tb, 'dog', [[3, -16]], 10);
  animals(tb, 'parrot', [[6, -36]]);
  return tb.build(landingFor(port), tb.w(0, -30), 72);
}

/** A golden statue of a pirate admiral (a frozen character with a gold material). */
function statue(tb: TownBuilder, pos: THREE.Vector3, rot: number) {
  const c = new Character('captain');
  c.play('point', true);
  c.update(0.5);
  c.update(0.5);
  c.mesh.material = new THREE.MeshStandardMaterial({ color: 0xf4c24c, metalness: 0.75, roughness: 0.3 });
  c.root.scale.setScalar(1.6);
  c.root.position.copy(pos);
  c.root.rotation.y = rot;
  tb.group.add(c.root);
}

function buildLagoon(tb: TownBuilder) {
  const port = tb.port;
  for (const p of PIERS.filter((p) => p.port === port.id)) buildPier(tb.wP, tb.gP, p, 1.7, false);
  const tiki: Style = { wall: '#c9a45a', wallIn: '#a07a3a', roof: '#d8b25a', trim: '#6b3e1e', thatch: true, signBg: '#16a085' };
  tb.plaza(0, -12, 18, 12, 0, '#efd9a0', '#e2cb8c', 2.0, true);
  tb.stall('spice', -7, -12, 0.35, 'bamboo', { spec: 'islanderWoman', name: 'Auntie Nutmeg', lines: ['Spices from the deep jungle. Cheapest anywhere!', 'Smell that? Pure sunshine.'] }, '#e17055');
  tb.stall('food', 7, -12, -0.35, 'bamboo', { spec: 'islander', name: 'Mango Mo' }, '#fdcb6e');
  tb.stall('general', 0, -20, 0, 'bamboo', { spec: 'islander', name: 'Hidden Trader Hula', lines: ['Rare things wash up here. I sell them.', 'You came all this way? Then let\'s trade!'] }, '#00b894');
  tavern(tb, 11, -28, -0.4, 'The Tiki Shack', tiki, { spec: 'islander', name: 'Kahu' });
  // hidden trader out past the rocks
  den(tb, -17, -24, 0.9, "Hermit's Hut", { ...tiki, wall: '#8a6a3a', roof: '#a8823a' }, false);
  for (const [a, b, r] of [
    [-12, -21, 1.6],
    [-11, -26, 1.3],
  ] as [number, number, number][]) {
    const p = tb.w(a, b);
    tb.sP.add(rockGeoLocal(r), PAL.rock, T(p.x, p.y + r * 0.4, p.z), true);
    tb.circle(p.x, p.z, r);
  }
  for (const [a, b, ly] of [
    [-10, -32, 0.4],
    [-2, -34, 0],
    [8, -40, -0.3],
    [-14, -36, 0.7],
  ] as [number, number, number][])
    tb.hutAt(a, b, ly, Math.floor(a * 7 + b));
  const totemP = tb.w(-2, -26);
  K.totem(tb.placer(tb.wP, totemP.x, totemP.y, totemP.z, tb.yaw(0)));
  tb.circle(totemP.x, totemP.z, 0.6);
  const camp = tb.w(4, -4);
  K.campfire(tb.placer(tb.sP, camp.x, camp.y, camp.z, 0), tb.placer(tb.gP, camp.x, camp.y, camp.z, 0));
  tb.circle(camp.x, camp.z, 0.9);
  tb.fires.push(camp.clone().setY(camp.y + 0.6));
  for (const [a, b] of [
    [-6, -5],
    [6, -18],
    [-6, -18],
    [14, -16],
    [-14, -14],
    [2, -28],
  ])
    tb.torch(a, b);
  for (const [a, b] of [
    [-16, -8],
    [16, -8],
    [-20, -30],
    [18, -36],
    [0, -44],
    [-8, -42],
    [12, -2],
    [-12, -2],
  ])
    tb.palm(a, b, 0.8 + tb.rng() * 0.4);
  // hammock between two palms + canoes on the beach
  K.hammock(tb.lP, tb.w(16, -8).setY(tb.w(16, -8).y + 1.6), tb.w(20, -12).setY(tb.w(20, -12).y + 1.6));
  for (const [a, b, ly, col] of [
    [-20, -2, 1.4, '#e17055'],
    [20, -3, -1.2, '#00b894'],
  ] as [number, number, number, string][]) {
    const p = tb.w(a, b);
    K.rowboat(tb.placer(tb.wP, p.x, Math.max(p.y, 0.4) - 0.3, p.z, tb.yaw(ly)), col, false);
    tb.boxLocal(p, tb.yaw(ly), 0, 0, 0.9, 1.9);
  }
  tb.flag('swords', tb.w(-5, 1), 6, 2.4);

  waypoint(tb, 'wp-a', 0, -8);
  waypoint(tb, 'wp-b', -8, -28);
  waypoint(tb, 'wp-c', 8, -20);
  townsfolk(tb, ['islander', 'islanderWoman', 'islander'], ['Koa', 'Leilani', 'Old Tiki'], 4);
  chatters(tb, [{ a: 0, b: -16, specs: ['islanderWoman', 'islander'] }]);
  tb.resident({ spec: 'islanderWoman', name: 'Firedancer Malu', role: 'dancer', schedule: [{ from: 19, to: 3, spot: `${port.id}-fire0`, anim: 'dance' }, { from: 3, to: 19, spot: 'home' }], lines: ['The fire keeps the spirits happy!'] });
  tb.spot(`${port.id}-fire0`, tb.w(4, -6.5), tb.yaw(Math.PI), 'dance');
  nightlife(tb, ['islander', 'islanderWoman', 'pirateC', 'islander']);
  fishers(tb, [{ pos: (() => { const j = PIERS.find((p) => p.port === port.id && p.hw < 2.5)!; return new THREE.Vector3(j.x + Math.sin(j.rot) * (j.hl - 1.5), DECK_Y, j.z + Math.cos(j.rot) * (j.hl - 1.5)); })(), facing: tb.yaw(0) }], ['islander']);
  animals(tb, 'goat', [
    [-6, -40],
    [10, -46],
  ], 5);
  animals(tb, 'chicken', [[-12, -32]]);
  animals(tb, 'parrot', [
    [3, -24],
    [-15, -18],
  ]);
  animals(tb, 'crab', [
    [-14, 0],
    [16, 0],
    [0, 2],
  ], 3);
  return tb.build(landingFor(port), tb.w(0, -18), 52);
}

function rockGeoLocal(r: number) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  g.scale(1, 0.75, 1);
  return g;
}

// ---------------------------------------------------------------------------
export function buildTowns(obstacles: CircleCol[]): TownBuild[] {
  const plans: Record<string, (tb: TownBuilder) => TownBuild> = { skull: buildSkullCove, royal: buildPortRoyal, salt: buildSaltmarsh, gold: buildGoldhaven, lagoon: buildLagoon };
  return PORTS.map((p) => plans[p.id](new TownBuilder(p, obstacles)));
}

export { townToWorld, sack, M };
