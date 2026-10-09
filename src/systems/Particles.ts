import * as THREE from 'three';
import { rand, choose } from '../core/math';
import { addRim } from '../render/Materials';

type Curve = 'puff' | 'shrink' | 'grow' | 'const' | 'rise';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  curve: Curve;
  grav: number;
  drag: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  r: number;
  g: number;
  b: number;
  stretch: number;
  floor: number;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();

class Pool {
  mesh: THREE.InstancedMesh;
  parts: Particle[] = [];
  /** dead particles, reused by spawn() instead of allocating new objects */
  private free: Particle[] = [];
  private wasEmpty = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    public max: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }
  spawn(p: Partial<Particle> & { x: number; y: number; z: number }) {
    // full: recycle the oldest particle (cheaper than shifting the whole array)
    let part: Particle;
    if (this.parts.length >= this.max) {
      part = this.parts[0];
      this.parts[0] = this.parts[this.parts.length - 1];
      this.parts.length--;
    } else part = this.free.pop() ?? ({} as Particle);
    Object.assign(part, {
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      max: 1,
      size: 1,
      curve: 'puff',
      grav: 0,
      drag: 0,
      rx: Math.random() * 6,
      ry: Math.random() * 6,
      rz: Math.random() * 6,
      sx: 0,
      sy: 0,
      sz: 0,
      r: 1,
      g: 1,
      b: 1,
      stretch: 0,
      floor: -999,
    });
    Object.assign(part, p);
    this.parts.push(part);
    return part;
  }
  update(dt: number) {
    let n = 0;
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.free.push(p);
        continue;
      }
      const dk = Math.exp(-p.drag * dt);
      p.vx *= dk;
      p.vy = p.vy * dk - p.grav * dt;
      p.vz *= dk;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        p.vy = 0;
        p.vx *= 0.8;
        p.vz *= 0.8;
        p.sx *= 0.5;
        p.sy *= 0.5;
        p.sz *= 0.5;
      }
      p.rx += p.sx * dt;
      p.ry += p.sy * dt;
      p.rz += p.sz * dt;
      const t = p.life / p.max;
      let k = 1;
      switch (p.curve) {
        case 'puff':
          k = t < 0.18 ? 0.35 + 0.65 * Math.sin((t / 0.18) * Math.PI * 0.5) * 1.08 : 1 - Math.pow((t - 0.18) / 0.82, 1.6);
          break;
        case 'shrink':
          k = 1 - t * t;
          break;
        case 'grow':
          k = 0.2 + t * 0.8;
          break;
        case 'rise':
          // smoke column: keeps swelling as it climbs, then pops out
          k = t < 0.7 ? 0.35 + 0.65 * Math.sqrt(t / 0.7) : 1 - Math.pow((t - 0.7) / 0.3, 2);
          break;
      }
      const sz = Math.max(0.0001, p.size * k);
      this.p.set(p.x, p.y, p.z);
      this.e.set(p.rx, p.ry, p.rz);
      this.q.setFromEuler(this.e);
      if (p.stretch > 0) {
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        this.s.set(sz, sz, sz * (1 + sp * p.stretch));
        // orient along velocity
        if (sp > 0.01) this.q.setFromUnitVectors(Z_AXIS, _dir.set(p.vx / sp, p.vy / sp, p.vz / sp));
      } else if (p.curve === 'grow') {
        this.s.set(sz, sz * Math.max(0.05, 1 - t), sz);
      } else this.s.set(sz, sz, sz);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.c.setRGB(p.r, p.g, p.b);
      this.mesh.setColorAt(n, this.c);
      parts[n] = p;
      n++;
    }
    parts.length = n;
    this.mesh.count = n;
    if (n === 0 && this.wasEmpty) return;
    this.wasEmpty = n === 0;
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, Math.max(1, n) * 16);
    im.needsUpdate = true;
    const ic = this.mesh.instanceColor!;
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, Math.max(1, n) * 3);
    ic.needsUpdate = true;
  }
}

/** Instanced cartoon particle effects – puffy smoke, splashes, debris, fire, coins and confetti. */
export class Particles {
  group = new THREE.Group();
  puff: Pool;
  glow: Pool;
  debris: Pool;
  drop: Pool;
  coin: Pool;
  confetti: Pool;
  ring: Pool;

  constructor() {
    const puffMat = addRim(new THREE.MeshStandardMaterial({ roughness: 1 }), 0.25);
    this.puff = new Pool(new THREE.IcosahedronGeometry(1, 1), puffMat, 1200);
    this.glow = new Pool(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ toneMapped: true }), 600);
    this.debris = new Pool(new THREE.BoxGeometry(1, 0.35, 0.22), new THREE.MeshStandardMaterial({ roughness: 0.9 }), 400);
    this.drop = new Pool(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.3, emissive: 0x335566, flatShading: true }), 1400);
    this.coin = new Pool(new THREE.CylinderGeometry(1, 1, 0.18, 14), new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.8, emissive: 0x3a2400 }), 300);
    this.confetti = new Pool(new THREE.PlaneGeometry(1, 0.55), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 600);
    const ringGeo = new THREE.TorusGeometry(1, 0.1, 5, 28);
    ringGeo.rotateX(Math.PI / 2);
    this.ring = new Pool(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 200);
    for (const p of this.pools) this.group.add(p.mesh);
  }

  get pools() {
    return [this.puff, this.glow, this.debris, this.drop, this.coin, this.confetti, this.ring];
  }

  update(dt: number) {
    for (const p of this.pools) p.update(dt);
  }

  // ---------------- emitters ----------------

  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 5; i++) {
      const sp = rand(4, 12) * scale;
      this.glow.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: dir.x * sp + rand(-1, 1),
        vy: dir.y * sp + rand(-0.5, 1.5),
        vz: dir.z * sp + rand(-1, 1),
        size: rand(0.5, 0.9) * scale,
        max: rand(0.1, 0.2),
        curve: 'shrink',
        drag: 6,
        r: 5,
        g: rand(2.6, 3.6),
        b: 0.8,
      });
    }
    for (let i = 0; i < 12; i++) {
      const sp = rand(3, 14) * scale;
      const g = rand(0.72, 0.86);
      this.puff.spawn({
        x: pos.x + dir.x * 0.5,
        y: pos.y,
        z: pos.z + dir.z * 0.5,
        vx: dir.x * sp + rand(-1.2, 1.2),
        vy: dir.y * sp + rand(0, 2.5),
        vz: dir.z * sp + rand(-1.2, 1.2),
        size: rand(0.55, 1.2) * scale,
        max: rand(0.9, 1.8),
        drag: 3.2,
        grav: -0.6,
        r: g,
        g: g,
        b: g * 1.02,
      });
    }
  }

  splash(pos: THREE.Vector3, scale = 1) {
    const n = Math.round(16 * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.5, 3.2) * scale;
      const w = rand(0.85, 1);
      this.drop.spawn({
        x: pos.x + Math.cos(a) * 0.4,
        y: pos.y + 0.2,
        z: pos.z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * r,
        vy: rand(7, 15) * Math.sqrt(scale),
        vz: Math.sin(a) * r,
        size: rand(0.18, 0.42) * Math.sqrt(scale),
        max: rand(0.7, 1.2),
        grav: 22,
        curve: 'shrink',
        stretch: 0.06,
        r: w * 0.85,
        g: w * 0.95,
        b: w,
      });
    }
    // central column
    for (let i = 0; i < 5; i++) {
      this.puff.spawn({
        x: pos.x + rand(-0.3, 0.3),
        y: pos.y + i * 0.5 * scale,
        z: pos.z + rand(-0.3, 0.3),
        vy: rand(5, 9) * scale,
        size: rand(0.5, 0.9) * scale,
        max: rand(0.5, 0.8),
        grav: 14,
        drag: 1,
        r: 0.92,
        g: 0.97,
        b: 1,
      });
    }
    this.ring.spawn({ x: pos.x, y: pos.y + 0.1, z: pos.z, size: 3.4 * scale, max: 0.9, curve: 'grow', rx: 0, ry: 0, rz: 0, r: 1, g: 1, b: 1 });
    this.ring.spawn({ x: pos.x, y: pos.y + 0.1, z: pos.z, size: 2.0 * scale, max: 0.7, curve: 'grow', rx: 0, ry: 0, rz: 0, r: 0.85, g: 0.95, b: 1 });
  }

  explosion(pos: THREE.Vector3, scale = 1, woodColor = '#9a6a40') {
    for (let i = 0; i < 10; i++) {
      this.glow.spawn({
        x: pos.x + rand(-0.5, 0.5),
        y: pos.y + rand(-0.3, 0.6),
        z: pos.z + rand(-0.5, 0.5),
        vx: rand(-4, 4) * scale,
        vy: rand(1, 6) * scale,
        vz: rand(-4, 4) * scale,
        size: rand(0.6, 1.3) * scale,
        max: rand(0.18, 0.4),
        drag: 4,
        r: 4.5,
        g: rand(1.6, 2.6),
        b: 0.35,
      });
    }
    for (let i = 0; i < 12; i++) {
      const g = rand(0.25, 0.5);
      this.puff.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: rand(-5, 5) * scale,
        vy: rand(2, 8) * scale,
        vz: rand(-5, 5) * scale,
        size: rand(0.7, 1.4) * scale,
        max: rand(1.0, 1.8),
        drag: 2.5,
        grav: -1.2,
        r: g,
        g: g,
        b: g,
      });
    }
    this.debris_(pos, Math.round(12 * scale), woodColor, scale);
    // sparks
    for (let i = 0; i < 10; i++) {
      this.glow.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: rand(-12, 12),
        vy: rand(4, 14),
        vz: rand(-12, 12),
        size: rand(0.08, 0.16),
        max: rand(0.4, 0.8),
        grav: 25,
        stretch: 0.15,
        curve: 'shrink',
        r: 3,
        g: 2.2,
        b: 0.6,
      });
    }
  }

  debris_(pos: THREE.Vector3, n: number, color: string, scale = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = rand(0.7, 1.15);
      this.debris.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: rand(-7, 7) * scale,
        vy: rand(5, 13) * scale,
        vz: rand(-7, 7) * scale,
        size: rand(0.35, 0.8) * scale,
        max: rand(1.4, 2.4),
        grav: 22,
        curve: 'const',
        sx: rand(-10, 10),
        sy: rand(-10, 10),
        sz: rand(-10, 10),
        floor: pos.y - 2.5,
        r: c.r * k,
        g: c.g * k,
        b: c.b * k,
      });
    }
  }

  smoke(pos: THREE.Vector3, dark = 0.3, size = 1) {
    const g = rand(dark, dark + 0.15) * 0.6 + 0.3;
    this.puff.spawn({
      x: pos.x + rand(-0.4, 0.4),
      y: pos.y,
      z: pos.z + rand(-0.4, 0.4),
      vx: rand(-0.5, 0.5),
      vy: rand(2.5, 4.5),
      vz: rand(-0.5, 0.5),
      size: rand(0.5, 0.9) * size,
      max: rand(1.6, 2.6),
      grav: -0.4,
      drag: 0.3,
      r: g,
      g: g,
      b: g * 1.04,
    });
  }

  /** One puff of a continuous smoke column (call repeatedly from a fixed vent). */
  plume(pos: THREE.Vector3, dark: number, size = 1, driftX = 1.6, carry?: THREE.Vector3) {
    const g = rand(dark, dark + 0.08);
    this.puff.spawn({
      x: pos.x + rand(-0.15, 0.15),
      y: pos.y,
      z: pos.z + rand(-0.15, 0.15),
      vx: driftX + rand(-0.3, 0.3) + (carry?.x ?? 0),
      vy: rand(3.2, 4.2),
      vz: rand(-0.3, 0.3) + (carry?.z ?? 0),
      size: rand(0.75, 1.0) * size,
      max: rand(1.3, 1.7),
      curve: 'rise',
      drag: 0.4,
      r: g,
      g: g,
      b: g * 1.05,
    });
  }

  fire(pos: THREE.Vector3, size = 1) {
    this.glow.spawn({
      x: pos.x + rand(-0.5, 0.5) * size,
      y: pos.y,
      z: pos.z + rand(-0.5, 0.5) * size,
      vx: rand(-0.4, 0.4),
      vy: rand(2, 4),
      vz: rand(-0.4, 0.4),
      size: rand(0.4, 0.8) * size,
      max: rand(0.4, 0.7),
      curve: 'shrink',
      r: 3,
      g: rand(0.9, 1.7),
      b: 0.2,
    });
  }

  trail(pos: THREE.Vector3) {
    this.puff.spawn({ x: pos.x, y: pos.y, z: pos.z, size: rand(0.25, 0.38), max: rand(0.3, 0.45), drag: 2, grav: -0.5, vy: 0.4, r: 0.85, g: 0.85, b: 0.88 });
  }

  spray(pos: THREE.Vector3, vel: THREE.Vector3, amount = 1) {
    this.drop.spawn({
      x: pos.x + rand(-0.4, 0.4),
      y: pos.y,
      z: pos.z + rand(-0.4, 0.4),
      vx: vel.x + rand(-1.5, 1.5),
      vy: rand(3, 6) * amount,
      vz: vel.z + rand(-1.5, 1.5),
      size: rand(0.12, 0.26) * amount,
      max: rand(0.5, 0.8),
      grav: 18,
      curve: 'shrink',
      r: 0.92,
      g: 0.98,
      b: 1,
    });
  }

  coins(pos: THREE.Vector3, n = 20) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(2, 7);
      this.coin.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: Math.cos(a) * sp,
        vy: rand(10, 18),
        vz: Math.sin(a) * sp,
        size: rand(0.3, 0.42),
        max: rand(1.4, 2.1),
        grav: 24,
        curve: 'const',
        sx: rand(5, 14),
        sy: rand(-4, 4),
        sz: rand(-3, 3),
        r: 1,
        g: 0.78,
        b: 0.25,
      });
    }
  }

  confettiBurst(pos: THREE.Vector3, n = 60) {
    const cols = ['#ff4d6d', '#ffd23f', '#3ec1d3', '#7bd389', '#a78bfa', '#ff8c42'].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const c = choose(cols);
      const a = Math.random() * Math.PI * 2;
      const sp = rand(3, 10);
      this.confetti.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: Math.cos(a) * sp,
        vy: rand(10, 20),
        vz: Math.sin(a) * sp,
        size: rand(0.25, 0.4),
        max: rand(2.2, 3.4),
        grav: 9,
        drag: 1.6,
        curve: 'const',
        sx: rand(-12, 12),
        sy: rand(-12, 12),
        sz: rand(-12, 12),
        r: c.r * 1.4,
        g: c.g * 1.4,
        b: c.b * 1.4,
      });
    }
  }

  sparkle(pos: THREE.Vector3) {
    this.glow.spawn({
      x: pos.x + rand(-1, 1),
      y: pos.y + rand(0, 1.5),
      z: pos.z + rand(-1, 1),
      vy: rand(0.5, 1.5),
      size: rand(0.08, 0.18),
      max: rand(0.5, 0.9),
      curve: 'puff',
      r: 3,
      g: 2.6,
      b: 1,
    });
  }

  dust(pos: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 10; i++) {
      this.puff.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: rand(-4, 4) * scale,
        vy: rand(1, 5) * scale,
        vz: rand(-4, 4) * scale,
        size: rand(0.6, 1.1) * scale,
        max: rand(0.8, 1.4),
        drag: 3,
        r: 0.95,
        g: 0.85,
        b: 0.62,
      });
    }
  }

  bubbles(pos: THREE.Vector3, spread = 3) {
    this.drop.spawn({
      x: pos.x + rand(-spread, spread),
      y: pos.y,
      z: pos.z + rand(-spread, spread),
      vy: rand(1, 3),
      size: rand(0.2, 0.45),
      max: rand(0.4, 0.8),
      curve: 'puff',
      r: 0.9,
      g: 0.97,
      b: 1,
    });
  }

  speedLine(pos: THREE.Vector3, vel: THREE.Vector3) {
    this.puff.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, size: rand(0.05, 0.1), max: 0.35, stretch: 0.25, curve: 'shrink', r: 1, g: 1, b: 1 });
  }
}
