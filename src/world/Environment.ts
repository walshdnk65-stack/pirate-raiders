import * as THREE from 'three';
import { clamp, lerp, rand, smoothstep, weightedChoice, dampT } from '../core/math';
import { GeoBuilder, ellipsoid, T } from '../render/GeoBuilder';
import { globalUniforms, updateNightMaterials } from '../render/Materials';
import type { Ocean } from './Ocean';
import { dangerFactor } from './WorldData';

// ---------------------------------------------------------------------------
// Time-of-day keyframes (hour -> palette)
// ---------------------------------------------------------------------------
interface Key {
  h: number;
  top: number;
  hor: number;
  sun: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  deep: number;
  mid: number;
}
const KEYS: Key[] = [
  { h: 0, top: 0x0b1633, hor: 0x24365e, sun: 0x9fb4ff, sunI: 0.55, hemiSky: 0x3a4f8a, hemiGround: 0x1a2236, hemiI: 0.85, deep: 0x06243f, mid: 0x0d3a5e },
  { h: 4.8, top: 0x101c40, hor: 0x2c3b66, sun: 0x9fb4ff, sunI: 0.5, hemiSky: 0x3a4f8a, hemiGround: 0x1a2236, hemiI: 0.8, deep: 0x06243f, mid: 0x0d3a5e },
  { h: 6.0, top: 0x4a6fb5, hor: 0xffa27a, sun: 0xffb27a, sunI: 1.4, hemiSky: 0x8fa6d8, hemiGround: 0x5a4a50, hemiI: 1.0, deep: 0x0e4a7a, mid: 0x2a7ca0 },
  { h: 7.5, top: 0x4c9be8, hor: 0xffe1b8, sun: 0xfff0d6, sunI: 2.4, hemiSky: 0xb6dcff, hemiGround: 0x8a7a5a, hemiI: 1.15, deep: 0x0b5c96, mid: 0x1590b8 },
  { h: 12, top: 0x3a8ff0, hor: 0xc4ecff, sun: 0xfffaf0, sunI: 2.9, hemiSky: 0xc8e6ff, hemiGround: 0x8c7d5c, hemiI: 1.25, deep: 0x0a62a0, mid: 0x14a0c4 },
  { h: 16.5, top: 0x3f8ee6, hor: 0xd2ecff, sun: 0xfff2dc, sunI: 2.7, hemiSky: 0xc0e0ff, hemiGround: 0x8c7d5c, hemiI: 1.2, deep: 0x0a5e9a, mid: 0x1496bd },
  { h: 18.3, top: 0x5a6fb8, hor: 0xff9a5c, sun: 0xff9a50, sunI: 1.9, hemiSky: 0xd6a0a0, hemiGround: 0x5a4040, hemiI: 1.0, deep: 0x154a78, mid: 0x3a7298 },
  { h: 19.6, top: 0x1d2a5c, hor: 0x8a5a7a, sun: 0xb090ff, sunI: 0.7, hemiSky: 0x5a5a9a, hemiGround: 0x2a2236, hemiI: 0.85, deep: 0x0a2c50, mid: 0x163e66 },
  { h: 21, top: 0x0b1633, hor: 0x24365e, sun: 0x9fb4ff, sunI: 0.55, hemiSky: 0x3a4f8a, hemiGround: 0x1a2236, hemiI: 0.85, deep: 0x06243f, mid: 0x0d3a5e },
  { h: 24, top: 0x0b1633, hor: 0x24365e, sun: 0x9fb4ff, sunI: 0.55, hemiSky: 0x3a4f8a, hemiGround: 0x1a2236, hemiI: 0.85, deep: 0x06243f, mid: 0x0d3a5e },
];

const _ca = new THREE.Color();
const _cb = new THREE.Color();
function lerpHex(a: number, b: number, t: number, out: THREE.Color) {
  _ca.setHex(a);
  _cb.setHex(b);
  return out.copy(_ca).lerp(_cb, t);
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
interface WeatherParams {
  waves: number;
  fogNear: number;
  fogFar: number;
  cloud: number; // cloud cover / darkness
  rain: number;
  lightning: number;
  wind: number;
  dim: number;
}
const WEATHER: Record<WeatherKind, WeatherParams> = {
  clear: { waves: 1.0, fogNear: 380, fogFar: 1300, cloud: 0.0, rain: 0, lightning: 0, wind: 1.0, dim: 0 },
  cloudy: { waves: 1.15, fogNear: 320, fogFar: 1100, cloud: 0.45, rain: 0, lightning: 0, wind: 1.25, dim: 0.15 },
  rain: { waves: 1.35, fogNear: 200, fogFar: 800, cloud: 0.8, rain: 0.65, lightning: 0, wind: 1.5, dim: 0.35 },
  storm: { waves: 1.85, fogNear: 120, fogFar: 620, cloud: 1.0, rain: 1.0, lightning: 1, wind: 2.0, dim: 0.5 },
  fog: { waves: 0.85, fogNear: 30, fogFar: 330, cloud: 0.35, rain: 0, lightning: 0, wind: 0.7, dim: 0.12 },
};

export class Environment {
  hour = 9.5;
  /** Real seconds for a full 24h cycle. */
  dayLength = 720;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  clouds: THREE.Group;
  cloudMat: THREE.MeshStandardMaterial;
  rain: THREE.LineSegments;
  rainMat: THREE.ShaderMaterial;
  fog: THREE.Fog;
  sunDir = new THREE.Vector3();
  night = 0;
  weather: WeatherKind = 'clear';
  private nextWeather = 60 + rand(60, 120);
  cur: WeatherParams = { ...WEATHER.clear };
  lightningFlash = 0;
  private lightningTimer = 4;
  onThunder?: (delay: number, intensity: number) => void;
  onWeatherChange?: (w: WeatherKind) => void;
  danger = 0;
  private cloudData: { obj: THREE.Object3D; speed: number }[] = [];

  constructor(private scene: THREE.Scene) {
    this.fog = new THREE.Fog(0xbfe3f5, 380, 1300);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xc8e6ff, 0x8c7d5c, 1.2);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 55;
    const cam = this.sun.shadow.camera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 10;
    cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // ---- sky dome ----
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3() },
        uNight: { value: 0 },
        uFlash: { value: 0 },
        uCloud: { value: 0 },
        uTime: globalUniforms.uTime,
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // ---- cartoon clouds ----
    this.cloudMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
      fog: true,
    });
    this.clouds = new THREE.Group();
    const cloudGeos: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 5; v++) {
      const gb = new GeoBuilder();
      const puffs = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < puffs; i++) {
        const r = rand(14, 26);
        const x = (i - puffs / 2) * rand(14, 20);
        gb.add(ellipsoid(r, r * 0.75, r * 0.85, 10, 7), (c) => (c.y < -3 ? 0xd9e4f0 : 0xffffff), T(x, rand(-2, 8), rand(-10, 10)));
      }
      cloudGeos.push(gb.build());
    }
    for (let i = 0; i < 34; i++) {
      const m = new THREE.Mesh(cloudGeos[i % cloudGeos.length], this.cloudMat);
      const a = Math.random() * Math.PI * 2;
      const d = rand(150, 1300);
      m.position.set(Math.cos(a) * d, rand(170, 280), Math.sin(a) * d);
      m.rotation.y = Math.random() * Math.PI;
      m.scale.setScalar(rand(0.8, 1.6));
      this.clouds.add(m);
      this.cloudData.push({ obj: m, speed: rand(3, 7) });
    }
    scene.add(this.clouds);

    // ---- rain ----
    const N = 2400;
    const rp = new Float32Array(N * 2 * 3);
    const rs = new Float32Array(N * 2);
    const re = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = rand(-60, 60);
      const y = rand(0, 60);
      const z = rand(-60, 60);
      rp.set([x, y, z, x, y, z], i * 6);
      const seed = Math.random();
      rs[i * 2] = seed;
      rs[i * 2 + 1] = seed;
      re[i * 2] = 0;
      re[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(rs, 1));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: globalUniforms.uTime, uCenter: { value: new THREE.Vector3() }, uAmount: { value: 0 } },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  get isNight() {
    return this.night > 0.5;
  }

  setWeather(w: WeatherKind) {
    this.weather = w;
    this.onWeatherChange?.(w);
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera, ocean: Ocean) {
    this.hour = (this.hour + (dt / this.dayLength) * 24) % 24;

    // weather scheduling
    this.nextWeather -= dt;
    if (this.nextWeather <= 0) {
      const next = weightedChoice<WeatherKind>([
        { item: 'clear', w: 5 },
        { item: 'cloudy', w: 3 },
        { item: 'rain', w: 2 },
        { item: 'storm', w: 1 },
        { item: 'fog', w: 1.2 },
      ]);
      this.setWeather(next);
      this.nextWeather = next === 'clear' ? rand(120, 220) : rand(70, 140);
    }
    // local storms in dangerous waters
    this.danger = dangerFactor(focus.x, focus.z);
    const target = { ...WEATHER[this.weather] };
    if (this.danger > 0) {
      const st = WEATHER.storm;
      const k = this.danger;
      (Object.keys(target) as (keyof WeatherParams)[]).forEach((key) => {
        target[key] = lerp(target[key], Math.max(target[key], st[key]), k);
      });
      target.fogNear = lerp(WEATHER[this.weather].fogNear, st.fogNear, k);
      target.fogFar = lerp(WEATHER[this.weather].fogFar, st.fogFar, k);
    }
    const wk = dampT(0.12, dt);
    (Object.keys(this.cur) as (keyof WeatherParams)[]).forEach((key) => {
      this.cur[key] = lerp(this.cur[key], target[key], wk);
    });
    const W = this.cur;

    // ---- palette from time of day ----
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= this.hour) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = smoothstep(0, 1, (this.hour - a.h) / (b.h - a.h));
    const top = lerpHex(a.top, b.top, t, new THREE.Color());
    const hor = lerpHex(a.hor, b.hor, t, new THREE.Color());
    const sunC = lerpHex(a.sun, b.sun, t, new THREE.Color());
    const sunI = lerp(a.sunI, b.sunI, t);
    const hemiSky = lerpHex(a.hemiSky, b.hemiSky, t, new THREE.Color());
    const hemiGround = lerpHex(a.hemiGround, b.hemiGround, t, new THREE.Color());
    const hemiI = lerp(a.hemiI, b.hemiI, t);
    const deep = lerpHex(a.deep, b.deep, t, new THREE.Color());
    const mid = lerpHex(a.mid, b.mid, t, new THREE.Color());

    // storm greys
    const grey = new THREE.Color(0x6a7684);
    const greyTop = new THREE.Color(0x4a5562);
    const dim = W.dim;
    top.lerp(greyTop.multiplyScalar(0.4 + 0.6 * (1 - this.night)), W.cloud * 0.75);
    hor.lerp(grey.multiplyScalar(0.35 + 0.65 * (1 - this.night)), W.cloud * 0.7);

    // sun position: rises at 6, sets at 18 (east = +x)
    const dayPhase = ((this.hour - 6) / 12) * Math.PI;
    const elev = Math.sin(dayPhase);
    this.night = clamp(1 - smoothstep(-0.15, 0.12, elev), 0, 1);
    const sunVec = new THREE.Vector3(Math.cos(dayPhase), Math.max(elev, -0.3), -0.35).normalize();
    const moonVec = new THREE.Vector3(-Math.cos(dayPhase), Math.max(-elev, 0.15) + 0.2, 0.3).normalize();
    // the directional light follows sun by day, moon by night
    const lightDir = this.night > 0.5 ? moonVec : sunVec.clone().setY(Math.max(sunVec.y, 0.12)).normalize();
    this.sunDir.copy(lightDir);

    this.sun.color.copy(sunC);
    this.sun.intensity = sunI * (1 - dim * 0.75);
    this.sun.position.copy(focus).addScaledVector(lightDir, 200);
    this.sun.target.position.copy(focus);
    this.hemi.color.copy(hemiSky);
    this.hemi.groundColor.copy(hemiGround);
    this.hemi.intensity = hemiI * (1 - dim * 0.3);

    // lightning
    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 4);
    if (W.lightning > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = rand(3, 9);
        this.lightningFlash = 1;
        this.onThunder?.(rand(0.3, 1.5), rand(0.5, 1));
      }
    }
    const flash = this.lightningFlash * (Math.random() > 0.3 ? 1 : 0.4);
    this.hemi.intensity += flash * 2.5;

    // fog
    this.fog.color.copy(hor);
    this.fog.near = W.fogNear * (1 - this.night * 0.2);
    this.fog.far = W.fogFar * (1 - this.night * 0.15);

    // sky
    const su = this.skyMat.uniforms;
    su.uTop.value.copy(top);
    su.uHorizon.value.copy(hor);
    su.uSunDir.value.copy(sunVec);
    su.uSunColor.value.copy(sunC);
    su.uMoonDir.value.copy(moonVec);
    su.uNight.value = this.night;
    su.uFlash.value = flash;
    su.uCloud.value = W.cloud;
    this.sky.position.copy(camera.position);

    // clouds drift and wrap around the focus
    const cloudCol = new THREE.Color(0xffffff).lerp(new THREE.Color(0x5c6670), W.cloud * 0.85);
    cloudCol.multiplyScalar(lerp(1, 0.28, this.night));
    this.cloudMat.color.copy(cloudCol);
    this.cloudMat.emissive.copy(sunC).lerp(hor, 0.5).multiplyScalar(0.25 * (1 - this.night * 0.7) * (1 - W.cloud * 0.6));
    this.cloudMat.emissiveIntensity = 1;
    for (const c of this.cloudData) {
      c.obj.position.x += c.speed * W.wind * dt;
      const dx = c.obj.position.x - focus.x;
      const dz = c.obj.position.z - focus.z;
      if (dx > 1300) c.obj.position.x -= 2600;
      if (dx < -1300) c.obj.position.x += 2600;
      if (dz > 1300) c.obj.position.z -= 2600;
      if (dz < -1300) c.obj.position.z += 2600;
    }
    this.clouds.visible = true;

    // rain
    this.rainMat.uniforms.uAmount.value = W.rain;
    this.rainMat.uniforms.uCenter.value.copy(camera.position);
    this.rain.visible = W.rain > 0.02;

    // ocean
    const ou = ocean.material.uniforms;
    ocean.waveScale = W.waves;
    ou.uSunDir.value.copy(lightDir);
    ou.uSunColor.value.copy(sunC).multiplyScalar(this.night > 0.5 ? 0.5 : 1 - dim * 0.7);
    ou.uSkyTop.value.copy(top);
    ou.uSkyHorizon.value.copy(hor);
    const stormDeep = new THREE.Color(0x1e3a4e);
    ou.uDeep.value.copy(deep).lerp(stormDeep.multiplyScalar(1 - this.night * 0.6), W.cloud * 0.6);
    ou.uMid.value.copy(mid).lerp(new THREE.Color(0x3a6070).multiplyScalar(1 - this.night * 0.6), W.cloud * 0.6);
    ou.uShallow.value.setHex(0x3fd6c8).multiplyScalar(lerp(1, 0.3, this.night) * (1 - dim * 0.4));
    ou.uFoam.value.setHex(0xf4fbff);
    ou.uAmbient.value.copy(hemiSky).multiplyScalar(hemiI * 0.5 * (1 - dim * 0.3)).addScalar(0.05);
    ou.uNight.value = this.night;
    ou.uFlash.value = flash;

    globalUniforms.uNight.value = this.night;
    globalUniforms.uWind.value = W.wind;
    updateNightMaterials(this.night);
  }

  /** "Day 1, 09:30" style clock text. */
  clockText() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uFlash;
uniform float uCloud;
uniform float uTime;
varying vec3 vDir;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.55, y), 0.65));
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.2, y));

  // sun disc + glow
  float sd = dot(d, uSunDir);
  float sunVis = (1.0 - uNight) * (1.0 - uCloud * 0.85);
  col += uSunColor * smoothstep(0.9975, 0.9985, sd) * 3.0 * sunVis;
  col += uSunColor * pow(max(sd, 0.0), 80.0) * 0.5 * sunVis;
  col += uSunColor * pow(max(sd, 0.0), 6.0) * 0.18 * (1.0 - uNight) * (1.0 - smoothstep(0.0, 0.5, y));

  // moon
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.9988, 0.9993, md);
  col = mix(col, vec3(0.95, 0.96, 1.0) * 1.6, moon * uNight * (1.0 - uCloud * 0.7));
  col += vec3(0.5, 0.6, 0.9) * pow(max(md, 0.0), 120.0) * 0.4 * uNight;

  // stars
  vec3 sp = d * 220.0;
  vec3 cell = floor(sp);
  float h = hash13(cell);
  float star = step(0.9965, h) * (1.0 - smoothstep(0.05, 0.32, length(fract(sp) - 0.5)));
  float tw = 0.6 + 0.4 * sin(uTime * 3.0 + h * 100.0);
  col += vec3(1.0) * star * tw * uNight * smoothstep(0.05, 0.3, y) * (1.0 - uCloud);

  col += vec3(0.7, 0.75, 0.95) * uFlash * 0.8;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RAIN_VERT = /* glsl */ `
attribute float aSeed;
attribute float aEnd;
uniform float uTime;
uniform vec3 uCenter;
uniform float uAmount;
varying float vA;
void main() {
  vec3 p = position;
  float fall = mod(uTime * (38.0 + aSeed * 12.0) + aSeed * 60.0, 60.0);
  p.y = mod(p.y - fall, 60.0) - 20.0;
  // wrap around the camera
  p.x = mod(p.x - uCenter.x + 60.0, 120.0) - 60.0 + uCenter.x;
  p.z = mod(p.z - uCenter.z + 60.0, 120.0) - 60.0 + uCenter.z;
  p.y += uCenter.y - 10.0;
  p += vec3(-0.3, -1.7, 0.0) * aEnd;
  vA = step(aSeed, uAmount) * 0.45;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const RAIN_FRAG = /* glsl */ `
varying float vA;
void main() {
  if (vA <= 0.0) discard;
  gl_FragColor = vec4(0.75, 0.82, 0.92, vA);
}
`;
