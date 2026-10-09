import * as THREE from 'three';

const N = 14;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * A ribbon that follows a blade through a swing: a ring of (hilt, tip) samples drawn as a
 * fading additive strip. Pooled by the combat system.
 */
export class Trail {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private samples: { a: THREE.Vector3; b: THREE.Vector3; age: number }[] = [];
  private color = new THREE.Color();
  /** still sampling (blade in its active swing) */
  live = false;
  owner: object | null = null;
  private src: THREE.Object3D | null = null;
  private tipLen = 1;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3);
    this.col = new Float32Array(N * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  get busy() {
    return this.live || this.samples.length > 0;
  }

  start(owner: object, prop: THREE.Object3D, bladeLen: number, color: string) {
    this.owner = owner;
    this.src = prop;
    this.tipLen = bladeLen;
    this.color.set(color);
    this.samples.length = 0;
    this.live = true;
    this.mesh.visible = true;
  }

  stop() {
    this.live = false;
  }

  /** Forget the owner immediately (fighter removed). */
  release() {
    this.live = false;
    this.samples.length = 0;
    this.owner = null;
    this.src = null;
    this.mesh.visible = false;
  }

  update(dt: number) {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age > 0.16) this.samples.shift();
    if (this.live && this.src) {
      this.src.updateWorldMatrix(true, false);
      _a.set(0, -this.tipLen * 0.28, 0).applyMatrix4(this.src.matrixWorld);
      _b.set(0, -this.tipLen, 0).applyMatrix4(this.src.matrixWorld);
      const s = this.samples.length >= N ? this.samples.shift()! : { a: new THREE.Vector3(), b: new THREE.Vector3(), age: 0 };
      s.a.copy(_a);
      s.b.copy(_b);
      s.age = 0;
      this.samples.push(s);
    }
    if (!this.samples.length) {
      this.mesh.visible = this.live;
      if (!this.live) this.owner = null;
      return;
    }
    this.mesh.visible = true;
    const n = this.samples.length;
    const c = this.color;
    for (let i = 0; i < N; i++) {
      const s = this.samples[Math.min(i, n - 1)];
      const o = i * 6;
      this.pos[o] = s.a.x;
      this.pos[o + 1] = s.a.y;
      this.pos[o + 2] = s.a.z;
      this.pos[o + 3] = s.b.x;
      this.pos[o + 4] = s.b.y;
      this.pos[o + 5] = s.b.z;
      // newest samples are brightest; the hilt edge is fainter than the tip
      const fresh = i < n ? Math.max(0, 1 - s.age / 0.16) * ((i + 1) / n) : 0;
      const q = i * 8;
      this.col[q] = c.r * 0.25 * fresh;
      this.col[q + 1] = c.g * 0.25 * fresh;
      this.col[q + 2] = c.b * 0.25 * fresh;
      this.col[q + 3] = fresh * 0.3;
      this.col[q + 4] = c.r * fresh;
      this.col[q + 5] = c.g * fresh;
      this.col[q + 6] = c.b * fresh;
      this.col[q + 7] = fresh;
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
