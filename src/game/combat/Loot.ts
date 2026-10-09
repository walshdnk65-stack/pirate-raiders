import * as THREE from 'three';
import { GeoBuilder, T, roundBox, cyl } from '../../render/GeoBuilder';
import { M } from '../../render/Materials';
import { PAL } from '../../models/Props';
import { propGeometry } from '../../models/Character';
import { rand } from '../../core/math';
import type { LandArea } from '../../world/LandArea';
import type { CargoId } from '../Data';
import { RARITIES, WEAPONS, type WeaponItem } from './Weapons';

export type LootKind = 'gold' | 'shot' | 'scrap' | 'weapon' | 'cargo' | 'rare' | 'heal';

export interface Pickup {
  kind: LootKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  obj: THREE.Object3D;
  amount: number;
  weapon?: WeaponItem;
  cargo?: CargoId;
  /** rare item id: 'map' (treasure map) or a cargo id for curios */
  rare?: string;
  t: number;
  landed: boolean;
  homing: boolean;
  spin: number;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function lootGeo(kind: LootKind): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (g) return g;
  const gb = new GeoBuilder();
  switch (kind) {
    case 'gold':
      for (let i = 0; i < 5; i++) gb.add(cyl(0.16, 0.16, 0.05, 12), PAL.gold, T((i % 2) * 0.08 - 0.04, 0.03 + i * 0.055, (i % 3) * 0.04 - 0.04, 0.06 * i, 0, 0.05));
      gb.add(cyl(0.16, 0.16, 0.05, 12), PAL.gold, T(0.28, 0.03, 0.1, 0.2, 0, 1.2));
      break;
    case 'shot':
      gb.add(roundBox(0.18, 0.2, 0.14, 2.4, 10, 8), '#8a5a33', T(0, 0.2, 0));
      gb.add(cyl(0.07, 0.12, 0.08, 8), '#6b3e1e', T(0, 0.42, 0));
      for (let i = 0; i < 3; i++) gb.add(new THREE.SphereGeometry(0.06, 8, 6), PAL.ironDark, T(0.22 + i * 0.09, 0.06, 0.12 - i * 0.07));
      break;
    case 'scrap':
      gb.add(new THREE.BoxGeometry(0.34, 0.08, 0.2), '#8a929c', T(0, 0.06, 0, 0, 0.4, 0.1));
      gb.add(new THREE.BoxGeometry(0.22, 0.08, 0.16), '#6a727c', T(0.12, 0.13, 0.08, 0.2, 1.2, 0));
      gb.add(new THREE.TorusGeometry(0.1, 0.03, 4, 8), '#5a626c', T(-0.15, 0.1, 0.1, 1.2, 0, 0));
      break;
    case 'cargo':
      gb.add(new THREE.BoxGeometry(0.55, 0.45, 0.45), PAL.woodLight, T(0, 0.23, 0));
      gb.add(new THREE.BoxGeometry(0.58, 0.08, 0.48), PAL.woodDark, T(0, 0.38, 0));
      gb.add(new THREE.BoxGeometry(0.58, 0.08, 0.48), PAL.woodDark, T(0, 0.08, 0));
      break;
    case 'rare':
      gb.add(new THREE.ConeGeometry(0.2, 0.42, 6), PAL.gold, T(0, 0.3, 0));
      gb.add(new THREE.SphereGeometry(0.14, 10, 8), PAL.gold, T(0, 0.58, 0));
      gb.add(new THREE.SphereGeometry(0.05, 6, 5), '#3fd0ff', T(0, 0.62, 0.12));
      break;
    case 'heal':
      gb.add(cyl(0.11, 0.13, 0.34, 10), '#2f8a3e', T(0, 0.17, 0));
      gb.add(cyl(0.04, 0.07, 0.16, 8), '#2f8a3e', T(0, 0.42, 0));
      gb.add(cyl(0.045, 0.045, 0.06, 6), '#c49a6c', T(0, 0.52, 0));
      gb.add(cyl(0.115, 0.115, 0.12, 10), '#f4f0e4', T(0, 0.18, 0));
      break;
    default:
      gb.add(new THREE.SphereGeometry(0.2, 8, 6), '#ffffff');
  }
  g = gb.build();
  geoCache.set(kind, g);
  return g;
}

const beamGeo = new THREE.CylinderGeometry(0.06, 0.22, 3.2, 8, 1, true).translate(0, 1.6, 0);
const ringGeo = new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2);

/**
 * Things foes drop: coins, shot, scrap, cargo, weapons and rare finds. They pop out, land, bob
 * about and fly to the captain when he walks near.
 */
export class Loot {
  items: Pickup[] = [];
  group = new THREE.Group();
  private beamMats = new Map<string, THREE.MeshBasicMaterial>();

  private beamMat(color: string) {
    let m = this.beamMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      this.beamMats.set(color, m);
    }
    return m;
  }

  spawn(kind: LootKind, at: THREE.Vector3, amount = 1, extra: Partial<Pick<Pickup, 'weapon' | 'cargo' | 'rare'>> = {}) {
    let obj: THREE.Object3D;
    if (kind === 'weapon' && extra.weapon) {
      const w = extra.weapon;
      const g = new THREE.Group();
      const geo = propGeometry(WEAPONS[w.base].prop);
      if (geo) {
        const m = new THREE.Mesh(geo, M.vc);
        m.rotation.set(Math.PI / 2, 0, 0.3);
        m.position.y = 0.12;
        m.castShadow = true;
        g.add(m);
      }
      const col = RARITIES[w.rarity].color;
      const beam = new THREE.Mesh(beamGeo, this.beamMat(col));
      beam.userData.beam = true;
      g.add(beam);
      const ring = new THREE.Mesh(ringGeo, this.beamMat(col));
      ring.position.y = 0.04;
      g.add(ring);
      obj = g;
    } else {
      const m = new THREE.Mesh(lootGeo(kind), M.vc);
      m.castShadow = true;
      if (kind === 'rare') {
        const g = new THREE.Group();
        g.add(m);
        const beam = new THREE.Mesh(beamGeo, this.beamMat('#ffd23f'));
        g.add(beam);
        obj = g;
      } else obj = m;
    }
    obj.position.copy(at);
    this.group.add(obj);
    const a = rand(0, Math.PI * 2);
    const sp = rand(1.2, 3.2);
    const p: Pickup = { kind, pos: obj.position, vel: new THREE.Vector3(Math.cos(a) * sp, rand(4.5, 6.5), Math.sin(a) * sp), obj, amount, t: 0, landed: false, homing: false, spin: rand(-3, 3), ...extra };
    this.items.push(p);
    return p;
  }

  /** Move pickups; returns those the captain just collected. */
  update(dt: number, me: THREE.Vector3, area: LandArea | null): Pickup[] {
    const got: Pickup[] = [];
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.t += dt;
      const dx = me.x - p.pos.x;
      const dz = me.z - p.pos.z;
      const dy = me.y + 0.9 - p.pos.y;
      const d = Math.hypot(dx, dz);
      const magnet = p.kind === 'weapon' || p.kind === 'rare' || p.kind === 'cargo' ? 1.7 : 4.2;
      if (p.landed && p.t > 0.5 && d < magnet && Math.abs(dy) < 2.5) p.homing = true;
      if (p.homing) {
        const sp = 9 + p.t * 2;
        const L = Math.hypot(dx, dy, dz) || 1;
        p.pos.x += (dx / L) * sp * dt;
        p.pos.y += (dy / L) * sp * dt;
        p.pos.z += (dz / L) * sp * dt;
        if (L < 0.6) {
          got.push(p);
          this.remove(i);
          continue;
        }
      } else if (!p.landed) {
        p.vel.y -= 18 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const ground = area?.surface(p.pos.x, p.pos.z, p.pos.y + 0.5, 1.5) ?? 0;
        if (p.pos.y <= ground) {
          p.pos.y = ground;
          if (p.vel.y < -3) p.vel.y *= -0.3;
          else {
            p.landed = true;
            p.vel.set(0, 0, 0);
            p.obj.userData.baseY = ground;
          }
          p.vel.x *= 0.5;
          p.vel.z *= 0.5;
        }
      } else {
        p.obj.position.y = (p.obj.userData.baseY as number) + 0.12 + Math.sin(p.t * 3) * 0.08;
      }
      p.obj.rotation.y += (p.kind === 'weapon' ? 1.2 : 2.4 + p.spin) * dt;
      // coins and shot fade away eventually; weapons wait for you
      if (p.t > 120 && p.kind !== 'weapon' && p.kind !== 'rare') this.remove(i);
    }
    return got;
  }

  private remove(i: number) {
    const p = this.items[i];
    p.obj.removeFromParent();
    this.items.splice(i, 1);
  }

  clear() {
    for (let i = this.items.length - 1; i >= 0; i--) this.remove(i);
  }
}
