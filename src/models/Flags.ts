import * as THREE from 'three';
import { canvasTexture, globalUniforms } from '../render/Materials';

export type FlagKind = 'pirate' | 'pirateRed' | 'swords' | 'kraken' | 'merchantA' | 'merchantB' | 'merchantC' | 'luxury' | 'navy' | 'white';

function drawSkull(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string, bg: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  // crossbones
  ctx.fillStyle = color;
  for (const a of [0.7, -0.7]) {
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.roundRect(-46, -6, 92, 12, 6);
    ctx.fill();
    for (const ex of [-46, 46])
      for (const ey of [-7, 7]) {
        ctx.beginPath();
        ctx.arc(ex, ey, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    ctx.restore();
  }
  // skull
  ctx.beginPath();
  ctx.ellipse(0, -10, 30, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-17, 6, 34, 20, 6);
  ctx.fill();
  ctx.fillStyle = bg;
  for (const ex of [-12, 12]) {
    ctx.beginPath();
    ctx.ellipse(ex, -10, 9, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-5, 9);
  ctx.lineTo(5, 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-9, 15, 3, 10);
  ctx.fillRect(-1.5, 15, 3, 10);
  ctx.fillRect(6, 15, 3, 10);
  ctx.restore();
}

const texCache = new Map<string, THREE.Texture>();

export function flagTexture(kind: FlagKind) {
  let t = texCache.get(kind);
  if (t) return t;
  t = canvasTexture(256, 160, (ctx, w, h) => {
    switch (kind) {
      case 'pirate':
      case 'pirateRed':
        ctx.fillStyle = kind === 'pirate' ? '#15151a' : '#a5161b';
        ctx.fillRect(0, 0, w, h);
        drawSkull(ctx, w / 2, h / 2 + 4, 1.25, '#f6f1e6', kind === 'pirate' ? '#15151a' : '#a5161b');
        break;
      case 'swords': {
        ctx.fillStyle = '#1b1b24';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#f2f2f2';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        for (const s of [1, -1]) {
          ctx.beginPath();
          ctx.moveTo(w / 2 - 55 * s, 30);
          ctx.quadraticCurveTo(w / 2 + 10 * s, 70, w / 2 + 55 * s, 135);
          ctx.stroke();
        }
        ctx.fillStyle = '#f4c24c';
        ctx.beginPath();
        ctx.arc(w / 2, 80, 20, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'kraken': {
        ctx.fillStyle = '#3b1d5a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#f4c24c';
        ctx.lineCap = 'round';
        ctx.lineWidth = 10;
        for (let i = 0; i < 6; i++) {
          const x0 = w / 2 + (i - 2.5) * 14;
          ctx.beginPath();
          ctx.moveTo(x0, 80);
          ctx.bezierCurveTo(x0 + (i - 2.5) * 10, 110, x0 + (i % 2 ? 26 : -26), 125, x0 + (i - 2.5) * 16, 148);
          ctx.stroke();
        }
        ctx.fillStyle = '#f4c24c';
        ctx.beginPath();
        ctx.ellipse(w / 2, 58, 40, 36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3b1d5a';
        for (const ex of [-14, 14]) {
          ctx.beginPath();
          ctx.ellipse(w / 2 + ex, 56, 8, 10, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'merchantA':
      case 'merchantB':
      case 'merchantC': {
        const cols = { merchantA: ['#2b6cb0', '#f6f1e6'], merchantB: ['#2f855a', '#f6e05e'], merchantC: ['#c05621', '#f6f1e6'] }[kind];
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = cols[i % 2];
          ctx.fillRect(0, (i * h) / 5, w, h / 5 + 1);
        }
        ctx.fillStyle = cols[0];
        ctx.fillRect(0, 0, w * 0.4, h * 0.6);
        ctx.fillStyle = cols[1];
        ctx.beginPath();
        ctx.arc(w * 0.2, h * 0.3, 22, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'luxury':
        ctx.fillStyle = '#5b2a86';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f4c24c';
        ctx.fillRect(0, h * 0.42, w, h * 0.16);
        ctx.beginPath();
        ctx.moveTo(w / 2 - 30, h / 2 + 20);
        ctx.lineTo(w / 2 - 30, h / 2 - 22);
        ctx.lineTo(w / 2 - 15, h / 2 - 5);
        ctx.lineTo(w / 2, h / 2 - 28);
        ctx.lineTo(w / 2 + 15, h / 2 - 5);
        ctx.lineTo(w / 2 + 30, h / 2 - 22);
        ctx.lineTo(w / 2 + 30, h / 2 + 20);
        ctx.closePath();
        ctx.fill();
        break;
      case 'navy':
        ctx.fillStyle = '#1d3f8a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#f6f1e6';
        ctx.lineWidth = 20;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(w, h);
        ctx.moveTo(w, 0);
        ctx.lineTo(0, h);
        ctx.stroke();
        ctx.strokeStyle = '#d23a3a';
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.fillStyle = '#f4c24c';
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 22, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'white':
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ececec';
        for (let i = 0; i < 6; i++) ctx.fillRect(0, i * 28 + 10, w, 2);
        break;
    }
  });
  texCache.set(kind, t);
  return t;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** Waving cloth material (vertex shader flutter; amount grows along uv.x). */
export function flagMaterial(kind: FlagKind) {
  let m = matCache.get(kind);
  if (m) return m;
  // emissive copy of the texture keeps flags bright even when backlit (white flag stays white)
  const tex = flagTexture(kind);
  m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: kind === 'white' ? 0x8a8a8a : 0x4a4a4a, side: THREE.DoubleSide, roughness: 0.9 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uWind = globalUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fw = uv.x;
        float ph = position.x * 2.2 - uTime * (6.0 + uWind * 2.0) + position.y * 0.8;
        transformed.z += sin(ph) * 0.3 * fw * (0.6 + 0.4 * uWind) * (0.6 + position.x * 0.3);
        transformed.y += sin(ph * 0.7) * 0.08 * fw;`,
      );
  };
  m.customProgramCacheKey = () => 'flag';
  matCache.set(kind, m);
  return m;
}

/** Flag plane with the pole edge at x = 0. */
export function flagGeometry(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h, 12, 6);
  g.translate(w / 2, 0, 0);
  return g;
}

export function makeFlag(kind: FlagKind, w = 2.4, h = 1.5) {
  const mesh = new THREE.Mesh(flagGeometry(w, h), flagMaterial(kind));
  mesh.castShadow = true;
  return mesh;
}
