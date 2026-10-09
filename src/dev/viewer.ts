import * as THREE from 'three';
import { Character, SPECS, AnimState } from '../models/Character';
import { globalUniforms } from '../render/Materials';

/** Dev model viewer: /?viewer=chars */
export function runViewer(kind: string) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.NeutralToneMapping;
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2f86e0);
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 500);
  scene.add(new THREE.HemisphereLight(0xc8e6ff, 0x8c7d5c, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(4, 8, 6);
  sun.castShadow = true;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshStandardMaterial({ color: 0x2a78c8 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const chars: Character[] = [];
  const params = new URLSearchParams(location.search);
  const anim = (params.get('anim') ?? 'idle') as AnimState;
  const only = params.get('spec');
  const ids = only ? [only] : Object.keys(SPECS);
  ids.forEach((id, i) => {
    const c = new Character(id);
    c.root.position.x = (i - (ids.length - 1) / 2) * 1.6;
    c.play(anim);
    c.express((params.get('expr') as any) ?? 'neutral');
    scene.add(c.root);
    chars.push(c);
  });
  const dist = Number(params.get('dist') ?? (only ? 6 : 16));
  const yaw = Number(params.get('yaw') ?? 0);
  const clock = new THREE.Timer();
  function frame(ts?: number) {
    clock.update(ts);
    if (renderer.domElement.width !== Math.floor(innerWidth * renderer.getPixelRatio())) {
      renderer.setSize(innerWidth, innerHeight);
      cam.aspect = innerWidth / Math.max(1, innerHeight);
      cam.updateProjectionMatrix();
    }
    const dt = clock.getDelta();
    globalUniforms.uTime.value += dt;
    for (const c of chars) c.update(dt);
    cam.position.set(Math.sin(yaw) * dist, 1.6 + dist * 0.12, Math.cos(yaw) * dist);
    cam.lookAt(0, 1.2, 0);
    renderer.render(scene, cam);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  void kind;
}

import { buildShip, DESIGNS, playerDesign, type ShipDesign } from '../models/ShipModel';
import { classDesign, previewLook, npcDesign } from '../models/ShipDesigns';
import { SHIP_CLASS_IDS, type ShipClassId } from '../game/ShipClasses';
import { Ocean } from '../world/Ocean';

/** Ship viewer: /?viewer=ships */
export function runShipViewer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.NeutralToneMapping;
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ccff5);
  scene.fog = new THREE.Fog(0xbfe3f5, 200, 900);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 3000);
  scene.add(new THREE.HemisphereLight(0xc8e6ff, 0x8c7d5c, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60 });
  scene.add(sun);
  const shore = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat);
  shore.needsUpdate = true;
  const ocean = new Ocean(shore, null);
  scene.add(ocean.mesh);
  const params = new URLSearchParams(location.search);
  const only = params.get('ship');
  // ?set=classes: the seven player ship classes side by side; ?set=npc: the steam/modern NPC ships
  const set = params.get('set');
  const base = { hullLvl: Number(params.get('lvl') ?? 0), sailLvl: Number(params.get('lvl') ?? 0), cannonLvl: Number(params.get('lvl') ?? 0), rangeLvl: 0, steerLvl: 0, cargoLvl: 1, sailColor: '#f3ead6', hullPaint: '#5b3a26', flag: 'pirate' as const };
  const keys = only ? [only] : set === 'classes' ? SHIP_CLASS_IDS.map((c) => `class:${c}`) : set === 'npc' ? ['steamFreighter', 'navyIronclad', 'navyInterceptor'] : ['player', ...Object.keys(DESIGNS)];
  const designOf = (k: string): ShipDesign => {
    if (k === 'player') return playerDesign(base);
    if (k.startsWith('class:')) return classDesign({ ...previewLook(k.slice(6) as ShipClassId, base), hullLvl: base.hullLvl, sailLvl: base.sailLvl, cannonLvl: base.cannonLvl });
    return npcDesign(k);
  };
  const gap = Number(params.get('gap') ?? (set === 'classes' ? 26 : 34));
  const ships = keys.map((k, i) => {
    const m = buildShip(designOf(k));
    m.group.position.set((i - (keys.length - 1) / 2) * gap, 0, 0);
    scene.add(m.group);
    const c = new Character('captain');
    c.root.position.copy(m.captainPos);
    c.play('steer');
    m.group.add(c.root);
    return { m, c };
  });
  const dist = Number(params.get('dist') ?? (only ? 40 : 160));
  const yaw = Number(params.get('yaw') ?? 0.7);
  const pitch = Number(params.get('pitch') ?? 0.35);
  const timer = new THREE.Timer();
  function frame(t: number) {
    timer.update(t);
    if (renderer.domElement.width !== Math.floor(innerWidth * renderer.getPixelRatio())) {
      renderer.setSize(innerWidth, innerHeight);
      cam.aspect = innerWidth / Math.max(1, innerHeight);
      cam.updateProjectionMatrix();
    }
    const dt = timer.getDelta();
    globalUniforms.uTime.value += dt;
    ocean.update(dt, cam);
    for (const s of ships) {
      s.c.update(dt);
      for (const sp of s.m.spinners) sp.obj.rotation[sp.axis] += (sp.bySpeed ? 1.2 : sp.rate) * dt;
      s.m.group.position.y = ocean.heightAt(s.m.group.position.x, s.m.group.position.z);
    }
    cam.position.set(Math.sin(yaw) * dist * Math.cos(pitch), dist * Math.sin(pitch), Math.cos(yaw) * dist * Math.cos(pitch));
    cam.lookAt(0, 4, 0);
    renderer.render(scene, cam);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
