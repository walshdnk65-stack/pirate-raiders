import * as THREE from 'three';
import { WORLD_HALF } from './WorldData';

/** Gerstner wave set: [dirX, dirZ, steepness, wavelength] */
const WAVES: [number, number, number, number][] = [
  [1.0, 0.35, 0.11, 62],
  [-0.45, 1.0, 0.13, 35],
  [0.75, -0.6, 0.12, 19],
  [-0.9, -0.35, 0.1, 11.5],
  [0.25, 0.95, 0.07, 7.3],
];
const NORM = WAVES.map(([x, z, s, l]) => {
  const len = Math.hypot(x, z);
  const k = (Math.PI * 2) / l;
  return { dx: x / len, dz: z / len, s, k, c: Math.sqrt(9.8 / k) };
});

/**
 * Bakes a tileable RGBA detail texture once at startup so the water shader can do
 * texture lookups instead of expensive per-pixel procedural noise:
 *  R,G = ripple normal, B = lacy foam (Voronoi cell edges), A = soft noise.
 */
function bakeDetailTexture(N = 256) {
  const data = new Uint8Array(N * N * 4);
  const P = 8; // noise period (cells)
  const rnd = (x: number, y: number, s: number) => {
    x = ((x % P) + P) % P;
    y = ((y % P) + P) % P;
    const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const vnoise = (x: number, y: number, s: number, per: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const r = (a: number, b: number) => rnd(((a % per) + per) % per, ((b % per) + per) % per, s);
    const a = r(xi, yi);
    const b = r(xi + 1, yi);
    const c = r(xi, yi + 1);
    const d = r(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const height = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = (i / N) * P;
      const y = (j / N) * P;
      height[j * N + i] = vnoise(x, y, 1, P) * 0.6 + vnoise(x * 2, y * 2, 2, P * 2) * 0.3 + vnoise(x * 4, y * 4, 3, P * 4) * 0.1;
    }
  // tileable Voronoi (F2 - F1) for foam lace
  const C = 6;
  const pts: [number, number][] = [];
  for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) pts.push([(i + 0.15 + rnd(i, j, 9) * 0.7) / C, (j + 0.15 + rnd(i, j, 11) * 0.7) / C]);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const hx = height[j * N + ((i + 1) % N)] - height[j * N + ((i - 1 + N) % N)];
      const hy = height[((j + 1) % N) * N + i] - height[((j - 1 + N) % N) * N + i];
      const u = i / N;
      const v = j / N;
      let d1 = 9;
      let d2 = 9;
      const ci = Math.floor(u * C);
      const cj = Math.floor(v * C);
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const cx = ci + ox;
          const cy = cj + oy;
          const [px, py] = pts[((cy + C) % C) * C + ((cx + C) % C)];
          // shift the wrapped point next to this cell
          const dx = px + Math.floor(cx / C) - u;
          const dy = py + Math.floor(cy / C) - v;
          const d = Math.hypot(dx, dy) * C;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      const e = d2 - d1;
      const lace = 1 - Math.min(1, Math.max(0, (e - 0.04) / 0.1));
      data[k * 4] = Math.round(Math.max(0, Math.min(1, 0.5 - hx * 6)) * 255);
      data[k * 4 + 1] = Math.round(Math.max(0, Math.min(1, 0.5 - hy * 6)) * 255);
      data[k * 4 + 2] = Math.round(lace * 255);
      data[k * 4 + 3] = Math.round(height[k] * 255);
    }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Stylised ocean: Gerstner-wave displaced grid with a custom shader
 * (sky + planar reflections, sun glint, crest foam, shallow water & shore foam).
 */
export class Ocean {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  time = 0;
  waveScale = 1;

  constructor(shoreTex: THREE.Texture, reflTex: THREE.Texture | null) {
    const geo = Ocean.makeGrid(1500, 230);
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uWaves: { value: WAVES.map((w) => new THREE.Vector4(...w)) },
        uWaveScale: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
        uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
        uSkyTop: { value: new THREE.Color(0x3d8fe0) },
        uSkyHorizon: { value: new THREE.Color(0xbfe3f5) },
        uDeep: { value: new THREE.Color(0x0b5c96) },
        uMid: { value: new THREE.Color(0x1590b8) },
        uShallow: { value: new THREE.Color(0x3fd6c8) },
        uFoam: { value: new THREE.Color(0xf4fbff) },
        uAmbient: { value: new THREE.Color(0.55, 0.62, 0.7) },
        uShoreTex: { value: shoreTex },
        uWorldHalf: { value: WORLD_HALF },
        uReflTex: { value: null },
        uReflMatrix: { value: new THREE.Matrix4() },
        uReflStrength: { value: reflTex ? 1 : 0 },
        uNight: { value: 0 },
        uFlash: { value: 0 },
        uFarFade: { value: 900 },
      },
    ]);
    // render-target textures can't go through UniformsUtils.merge (it clones), so set after
    uniforms.uReflTex = { value: reflTex };
    uniforms.uShoreTex = { value: shoreTex };
    uniforms.uDetail = { value: bakeDetailTexture() };
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = -1;
  }

  /** Grid densest at the centre, coarser towards the edges. */
  static makeGrid(half: number, seg: number) {
    const geo = new THREE.BufferGeometry();
    const n = seg + 1;
    const pos = new Float32Array(n * n * 3);
    const a = 0.08;
    const map = (u: number) => half * (a * u + (1 - a) * u * u * u);
    for (let j = 0; j < n; j++) {
      const v = (j / seg) * 2 - 1;
      for (let i = 0; i < n; i++) {
        const u = (i / seg) * 2 - 1;
        const k = (j * n + i) * 3;
        pos[k] = map(u);
        pos[k + 1] = 0;
        pos[k + 2] = map(v);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++) {
        const a0 = j * n + i;
        const b0 = a0 + 1;
        const c0 = a0 + n;
        const d0 = c0 + 1;
        idx.push(a0, c0, b0, b0, c0, d0);
      }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return geo;
  }

  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uWaveScale.value = this.waveScale;
    const snap = 4;
    this.mesh.position.set(
      Math.round(camera.position.x / snap) * snap,
      0,
      Math.round(camera.position.z / snap) * snap,
    );
  }

  /** Gerstner displacement at an undisplaced grid point. */
  private disp(x: number, z: number, out: THREE.Vector3) {
    out.set(0, 0, 0);
    const t = this.time;
    const sc = this.waveScale;
    for (const w of NORM) {
      const s = w.s * sc;
      const f = w.k * (w.dx * x + w.dz * z - w.c * t);
      const a = s / w.k;
      const cf = Math.cos(f);
      out.x += w.dx * a * cf;
      out.y += a * Math.sin(f);
      out.z += w.dz * a * cf;
    }
    return out;
  }

  private _d = new THREE.Vector3();
  /** Water surface height at world xz (inverts the horizontal Gerstner shift). */
  heightAt(x: number, z: number) {
    let px = x;
    let pz = z;
    for (let i = 0; i < 3; i++) {
      this.disp(px, pz, this._d);
      px = x - this._d.x;
      pz = z - this._d.z;
    }
    return this.disp(px, pz, this._d).y;
  }

  /**
   * Cheap wave height (no inversion of the horizontal shift): a quarter of the cost of heightAt and
   * accurate to a few cm – fine for wakes, splashes and far-away ships.
   */
  heightApprox(x: number, z: number) {
    return this.disp(x, z, this._d).y;
  }

  /** Approximate surface normal at world xz. */
  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = 0.8;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }
}

const VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[5];
uniform float uWaveScale;
uniform mat4 uReflMatrix;
uniform float uFarFade;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying vec4 vReflCoord;
#include <fog_pars_vertex>

vec3 gerstner(vec4 w, vec2 p, float fade, inout vec3 tangent, inout vec3 binormal) {
  float steep = w.z * uWaveScale * fade;
  float k = 6.2831853 / w.w;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(w.xy);
  float f = k * (dot(d, p) - c * uTime);
  float a = steep / k;
  float s = sin(f);
  float co = cos(f);
  tangent += vec3(-d.x * d.x * steep * s, d.x * steep * co, -d.x * d.y * steep * s);
  binormal += vec3(-d.x * d.y * steep * s, d.y * steep * co, -d.y * d.y * steep * s);
  return vec3(d.x * a * co, a * s, d.y * a * co);
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float camDist = length(wp.xz - cameraPosition.xz);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    // small waves fade out in the distance to avoid aliasing
    float fade = i < 2 ? 1.0 : 1.0 - smoothstep(uFarFade * 0.25 * float(5 - i), uFarFade * 0.4 * float(6 - i), camDist);
    disp += gerstner(uWaves[i], wp.xz, fade, tangent, binormal);
  }
  wp.xyz += disp;
  vWorld = wp.xyz;
  vNormalW = normalize(cross(binormal, tangent));
  vCrest = disp.y;
  vReflCoord = uReflMatrix * wp;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uWaveScale;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uAmbient;
uniform sampler2D uShoreTex;
uniform sampler2D uDetail;
uniform float uWorldHalf;
uniform sampler2D uReflTex;
uniform float uReflStrength;
uniform float uNight;
uniform float uFlash;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying vec4 vReflCoord;
#include <fog_pars_fragment>

float shoreDist(vec2 xz) {
  vec2 uv = (xz + uWorldHalf) / (uWorldHalf * 2.0);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 48.0;
  return texture2D(uShoreTex, uv).r * 64.0 - 16.0;
}

void main() {
  vec3 n = normalize(vNormalW);
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 p = vWorld.xz;

  // two scrolling layers of the baked detail texture
  vec4 d1 = texture2D(uDetail, p * 0.022 + vec2(uTime * 0.011, uTime * 0.007));
  vec4 d2 = texture2D(uDetail, p * 0.041 - vec2(uTime * 0.009, -uTime * 0.012));
  float detailFade = 1.0 - smoothstep(80.0, 320.0, dist);
  vec2 rip = (d1.rg + d2.rg - 1.0) * 2.0;
  n = normalize(n + vec3(rip.x, 0.0, rip.y) * 0.35 * detailFade * (0.6 + 0.4 * uWaveScale));
  float nz = (d1.a + d2.a) - 1.0;

  float sd = shoreDist(p);
  float shallow = 1.0 - smoothstep(0.0, 30.0, sd);

  float crest = clamp(vCrest * 0.32 * (1.0 / max(uWaveScale, 0.5)) + 0.5, 0.0, 1.0);
  vec3 base = mix(uDeep, uMid, smoothstep(0.25, 1.0, crest));
  base = mix(base, uShallow, shallow * shallow * 0.9);

  float NdL = dot(n, uSunDir);
  float diff = smoothstep(-0.2, 0.8, NdL);
  vec3 col = base * (uAmbient + uSunColor * diff * 0.55);

  float sss = pow(max(dot(-V, uSunDir) * 0.5 + 0.5, 0.0), 4.0) * smoothstep(0.45, 1.0, crest);
  col += uShallow * sss * uSunColor * 0.45;

  float NdV = max(dot(n, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.6));
  vec3 reflCol = sky;
  if (uReflStrength > 0.0) {
    vec2 ruv = vReflCoord.xy / vReflCoord.w + n.xz * 0.045;
    vec4 refl = texture2D(uReflTex, ruv);
    reflCol = mix(sky, refl.rgb, clamp(refl.a, 0.0, 1.0) * uReflStrength);
    col = mix(col, refl.rgb, refl.a * uReflStrength * 0.18);
  }
  col = mix(col, reflCol, clamp(fres * 0.85 + 0.12, 0.0, 1.0) * 0.85);

  float sp = max(dot(R, uSunDir), 0.0);
  float glint = smoothstep(0.9988, 0.9997, sp) * 1.4 + pow(sp, 500.0) * 0.9;
  col += uSunColor * glint * (1.0 - uNight * 0.6) * smoothstep(-0.05, 0.1, uSunDir.y);

  // ---------- foam ----------
  float crestMask = smoothstep(0.86, 1.02, crest + nz * 0.15);
  float lace = texture2D(uDetail, p * 0.035 + vec2(uTime * 0.016, uTime * 0.01)).b;
  float crestFoam = crestMask * lace * 0.75 + smoothstep(1.0, 1.12, crest + nz * 0.1) * 0.5 * smoothstep(1.2, 1.6, uWaveScale);
  crestFoam *= mix(0.35, 1.0, detailFade);
  float edge = 1.0 - smoothstep(0.4, 2.4 + nz * 1.5, sd);
  float bandPhase = sd * 0.55 + uTime * 1.6;
  float bands = smoothstep(0.82, 0.9, sin(bandPhase) * 0.5 + 0.5 + (d1.b - 0.5) * 0.5 + nz * 0.2);
  bands *= 1.0 - smoothstep(2.0, 11.0, sd);
  float shoreFoam = max(edge, bands * 0.9);
  float foam = clamp(max(crestFoam, shoreFoam), 0.0, 1.0);
  col = mix(col, uFoam * (uAmbient * 1.1 + uSunColor * 0.6), foam);

  col += vec3(0.6, 0.7, 0.9) * uFlash * 0.35;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
