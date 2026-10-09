import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Ship } from '../entities/Ship';
import { terrainHeight } from '../world/WorldData';
import { audio } from '../core/Audio';
import { addRim } from '../render/Materials';
import { AMMO, AmmoId } from '../game/Data';

interface Ball {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Ship;
  dmg: number;
  life: number;
  trailT: number;
  active: boolean;
  ammo: AmmoId;
}

const G = 28;

/** Cannonballs: ballistic flight, smoke trails, hits on ships/water/land. */
export class Projectiles {
  group = new THREE.Group();
  private balls: Ball[] = [];
  private geo = new THREE.SphereGeometry(0.34, 12, 9);
  private mat = addRim(new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.35, metalness: 0.6 }), 0.5);
  private local = new THREE.Vector3();
  private inv = new THREE.Matrix4();

  constructor(private game: Game) {}

  private mats = new Map<AmmoId, THREE.Material>();

  fire(pos: THREE.Vector3, vel: THREE.Vector3, owner: Ship, dmg: number, ammo: AmmoId = 'round') {
    let b = this.balls.find((x) => !x.active);
    if (!b) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.castShadow = true;
      this.group.add(mesh);
      b = { mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), owner, dmg, life: 0, trailT: 0, active: true, ammo };
      this.balls.push(b);
    }
    b.pos.copy(pos);
    b.vel.copy(vel);
    b.owner = owner;
    b.dmg = dmg;
    b.ammo = ammo;
    let mat = this.mats.get(ammo);
    if (!mat) {
      mat = ammo === 'round' ? this.mat : addRim(new THREE.MeshStandardMaterial({ color: AMMO[ammo].color, roughness: 0.4, metalness: 0.5, emissive: ammo === 'fire' ? 0xff5a10 : 0x000000, emissiveIntensity: ammo === 'fire' ? 2 : 0 }), 0.5);
      this.mats.set(ammo, mat);
    }
    b.mesh.material = mat;
    b.mesh.scale.setScalar(ammo === 'heavy' ? 1.35 : ammo === 'grape' ? 0.7 : 1);
    b.life = 0;
    b.trailT = 0;
    b.active = true;
    b.mesh.visible = true;
    b.mesh.position.copy(pos);
  }

  update(dt: number) {
    const ships = this.game.allShips();
    const ocean = this.game.ocean;
    const fx = this.game.particles;
    for (const b of this.balls) {
      if (!b.active) continue;
      b.life += dt;
      // sub-step for fast balls
      const steps = 2;
      const h = dt / steps;
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        b.vel.y -= G * h;
        b.pos.addScaledVector(b.vel, h);
        // ship hits
        for (const ship of ships) {
          if (ship === b.owner || !ship.alive || ship.sinking) continue;
          if (ship.team !== 'player' && b.owner.team !== 'player') continue; // AI don't hurt each other
          if (ship.team === 'player' && this.game.playerProtected) continue; // safe while boarding or in port
          const R = ship.model.length * 0.55 + 1;
          if (b.pos.distanceToSquared(ship.pos) > R * R + 400) continue;
          ship.body.updateWorldMatrix(true, false);
          this.inv.copy(ship.body.matrixWorld).invert();
          this.local.copy(b.pos).applyMatrix4(this.inv);
          const L2 = ship.model.length * 0.5;
          if (Math.abs(this.local.z) > L2 + 0.3) continue;
          const hw = ship.model.halfWidthAt(this.local.z) + 0.4;
          if (Math.abs(this.local.x) > hw) continue;
          if (this.local.y < -0.8 || this.local.y > ship.model.mastTop * 0.8) continue;
          // hit!
          ship.applyDamage(b.dmg, b.pos.clone(), b.owner);
          this.game.onProjectileHit(b.owner, ship, b.ammo);
          done = true;
          break;
        }
        if (done) break;
        const wy = ocean.heightApprox(b.pos.x, b.pos.z);
        if (b.pos.y < wy) {
          fx.splash(new THREE.Vector3(b.pos.x, wy, b.pos.z), 1);
          audio.play('splash', { pos: b.pos, volume: 0.7 });
          done = true;
          break;
        }
        if (b.pos.y < 40) {
          const th = terrainHeight(b.pos.x, b.pos.z);
          if (b.pos.y < th) {
            fx.dust(b.pos.clone(), 1);
            fx.debris_(b.pos.clone(), 5, '#8a7d6e');
            audio.play('impact', { pos: b.pos, volume: 0.5, pitch: 0.7 });
            done = true;
            break;
          }
        }
      }
      if (done || b.life > 6) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      b.mesh.position.copy(b.pos);
      b.trailT -= dt;
      if (b.trailT <= 0) {
        b.trailT = 0.05;
        fx.trail(b.pos);
        if (b.ammo === 'fire') fx.fire(b.pos, 0.35);
      }
    }
  }

  clear() {
    for (const b of this.balls) {
      b.active = false;
      b.mesh.visible = false;
    }
  }
}
