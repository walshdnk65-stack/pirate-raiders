import * as THREE from 'three';
import type { Ocean } from '../world/Ocean';
import { globalUniforms } from '../render/Materials';

const MAX = 56;

interface WakePoint {
  x: number;
  z: number;
  age: number;
  w: number;
  s: number;
}

const wakeMat = new THREE.ShaderMaterial({
  uniforms: { uTime: globalUniforms.uTime, uNight: globalUniforms.uNight },
  vertexShader: /* glsl */ `
    attribute float aAlpha;
    attribute float aSide;
    attribute float aAge;
    varying float vAlpha;
    varying float vSide;
    varying float vAge;
    varying vec2 vXZ;
    void main() {
      vAlpha = aAlpha;
      vSide = aSide;
      vAge = aAge;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vXZ = wp.xz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uNight;
    varying float vAlpha;
    varying float vSide;
    varying float vAge;
    varying vec2 vXZ;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main() {
      float edge = abs(vSide * 2.0 - 1.0);
      float nz = n(vXZ * 0.9 + uTime * 0.3) * 0.6 + n(vXZ * 2.3 - uTime * 0.2) * 0.4;
      float edgeFoam = smoothstep(0.55, 0.95, edge + nz * 0.25);
      float inner = smoothstep(0.45, 0.75, nz) * (1.0 - smoothstep(0.0, 0.6, vAge)) * 0.8;
      float a = max(edgeFoam, inner) * vAlpha * (1.0 - smoothstep(0.92, 1.0, edge));
      if (a < 0.01) discard;
      vec3 col = mix(vec3(0.97, 0.99, 1.0), vec3(0.5, 0.58, 0.7), uNight * 0.7);
      gl_FragColor = vec4(col, a * 0.9);
    }
  `,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/** Foam ribbon trailing behind a boat – widens and fades with age. */
export class WakeTrail {
  mesh: THREE.Mesh;
  private pts: WakePoint[] = [];
  private pos = new Float32Array(MAX * 2 * 3);
  private alpha = new Float32Array(MAX * 2);
  private side = new Float32Array(MAX * 2);
  private ageA = new Float32Array(MAX * 2);
  private geo = new THREE.BufferGeometry();
  private lastX = 0;
  private lastZ = 0;
  maxAge = 4.2;
  width = 2;
  spread = 1.6;

  constructor() {
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i < MAX; i++) {
      this.side[i * 2] = 0;
      this.side[i * 2 + 1] = 1;
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    this.geo.setAttribute('aAge', new THREE.BufferAttribute(this.ageA, 1).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(this.geo, wakeMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  reset() {
    this.pts.length = 0;
  }

  /** stern: current stern position; strength 0..1 (speed based). */
  update(dt: number, sternX: number, sternZ: number, strength: number, ocean: Ocean) {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].age > this.maxAge) this.pts.pop();
    const moved = Math.hypot(sternX - this.lastX, sternZ - this.lastZ);
    if (moved > 1.4 || this.pts.length === 0) {
      if (moved > 30) this.pts.length = 0;
      this.pts.unshift({ x: sternX, z: sternZ, age: 0, w: this.width, s: strength });
      if (this.pts.length > MAX) this.pts.length = MAX;
      this.lastX = sternX;
      this.lastZ = sternZ;
    } else if (this.pts.length) {
      // first point follows the stern
      const p0 = this.pts[0];
      p0.x = sternX;
      p0.z = sternZ;
      p0.s = Math.max(p0.s, strength);
    }
    const n = this.pts.length;
    for (let i = 0; i < MAX; i++) {
      const k = i * 2;
      if (i >= n) {
        const last = i > 0 ? (i - 1) * 2 * 3 : 0;
        // collapse remaining vertices onto the last point
        for (const v of [k, k + 1]) {
          this.pos[v * 3] = this.pos[last];
          this.pos[v * 3 + 1] = this.pos[last + 1];
          this.pos[v * 3 + 2] = this.pos[last + 2];
          this.alpha[v] = 0;
        }
        continue;
      }
      const p = this.pts[i];
      const a = this.pts[Math.max(0, i - 1)];
      const b = this.pts[Math.min(n - 1, i + 1)];
      let dx = a.x - b.x;
      let dz = a.z - b.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const w = p.w + p.age * this.spread;
      const y = ocean.heightApprox(p.x, p.z) + 0.12;
      const t = p.age / this.maxAge;
      const al = p.s * (1 - t) * (i === 0 ? 0 : 1) * Math.min(1, p.age * 4);
      this.pos[k * 3] = p.x - dz * w;
      this.pos[k * 3 + 1] = y;
      this.pos[k * 3 + 2] = p.z + dx * w;
      this.pos[(k + 1) * 3] = p.x + dz * w;
      this.pos[(k + 1) * 3 + 1] = y;
      this.pos[(k + 1) * 3 + 2] = p.z - dx * w;
      this.alpha[k] = this.alpha[k + 1] = al;
      this.ageA[k] = this.ageA[k + 1] = t;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAge as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
  }
}
