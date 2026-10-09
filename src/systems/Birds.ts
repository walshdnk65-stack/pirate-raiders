import * as THREE from 'three';
import { GeoBuilder, T, ellipsoid } from '../render/GeoBuilder';
import { M } from '../render/Materials';
import { rand } from '../core/math';
import { ISLANDS } from '../world/WorldData';

interface Bird {
  g: THREE.Group;
  wl: THREE.Object3D;
  wr: THREE.Object3D;
  /** the wing pieces (their world matrices feed the instanced meshes) */
  wlm: THREE.Object3D;
  wrm: THREE.Object3D;
  center: THREE.Vector3;
  r: number;
  a: number;
  sp: number;
  h: number;
  phase: number;
}

/** Cartoon seagulls circling the nearest island (drawn instanced: 3 draw calls for the whole flock). */
export class Birds {
  private birds: Bird[] = [];
  private retargetT = 0;
  private bodies: THREE.InstancedMesh;
  private wings: THREE.InstancedMesh;
  private _p = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const bodyB = new GeoBuilder();
    bodyB.add(ellipsoid(0.35, 0.32, 0.8, 10, 8), '#f7f7f2');
    bodyB.add(new THREE.SphereGeometry(0.28, 10, 8), '#f7f7f2', T(0, 0.18, 0.7));
    bodyB.add(new THREE.ConeGeometry(0.09, 0.4, 6), '#ffb21f', T(0, 0.14, 1.1, Math.PI / 2, 0, 0));
    bodyB.add(new THREE.SphereGeometry(0.05, 6, 4), '#111', T(0.16, 0.26, 0.86));
    bodyB.add(new THREE.SphereGeometry(0.05, 6, 4), '#111', T(-0.16, 0.26, 0.86));
    bodyB.add(new THREE.ConeGeometry(0.22, 0.5, 4), '#e8e8e2', T(0, 0, -0.85, -Math.PI / 2, 0, 0));
    const bodyGeo = bodyB.build();
    const wingB = new GeoBuilder();
    wingB.add(new THREE.BoxGeometry(1.4, 0.06, 0.55), (c) => (c.x > 1.0 ? '#2a2a30' : '#e9e9e4'), T(0.7, 0, 0));
    const wingGeo = wingB.build();
    const N = 14;
    this.bodies = new THREE.InstancedMesh(bodyGeo, M.vc, N);
    this.wings = new THREE.InstancedMesh(wingGeo, M.vc, N * 2);
    for (const im of [this.bodies, this.wings]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      scene.add(im);
    }
    for (let i = 0; i < N; i++) {
      // transform-only hierarchy (not in the scene); the instanced meshes copy its matrices
      const g = new THREE.Group();
      const wl = new THREE.Group();
      const wlm = new THREE.Object3D();
      wl.add(wlm);
      wl.position.set(0.25, 0.15, 0);
      const wr = new THREE.Group();
      const wrm = new THREE.Object3D();
      wrm.rotation.y = Math.PI;
      wr.add(wrm);
      wr.position.set(-0.25, 0.15, 0);
      g.add(wl, wr);
      g.scale.setScalar(1.3);
      this.birds.push({ g, wl, wr, wlm, wrm, center: new THREE.Vector3(), r: rand(18, 45), a: rand(0, 6.28), sp: rand(0.25, 0.5) * (Math.random() < 0.5 ? 1 : -1), h: rand(16, 32), phase: rand(0, 10) });
    }
  }

  update(dt: number, focus: THREE.Vector3) {
    this.retargetT -= dt;
    if (this.retargetT <= 0) {
      this.retargetT = 4;
      // circle the closest island to the player (or the player if at sea)
      let best = ISLANDS[0];
      let bd = 1e9;
      for (const isl of ISLANDS) {
        const d = Math.hypot(isl.x - focus.x, isl.z - focus.z);
        if (d < bd) {
          bd = d;
          best = isl;
        }
      }
      const c = bd < 260 ? new THREE.Vector3(best.x, 0, best.z) : focus.clone();
      this.birds.forEach((b, i) => {
        b.center.copy(c).add(new THREE.Vector3(((i % 3) - 1) * 12, 0, (Math.floor(i / 3) % 3 - 1) * 12));
        if (bd < 260) b.r = best.r * rand(0.5, 1.2);
      });
    }
    for (const b of this.birds) {
      b.phase += dt;
      b.a += b.sp * dt;
      const x = b.center.x + Math.cos(b.a) * b.r;
      const z = b.center.z + Math.sin(b.a) * b.r;
      const y = b.h + Math.sin(b.phase * 0.7) * 2;
      // ease toward the orbit so retargeting is smooth
      b.g.position.lerp(this._p.set(x, y, z), Math.min(1, dt * 1.5));
      const tangent = Math.atan2(-Math.sin(b.a) * Math.sign(b.sp), Math.cos(b.a) * Math.sign(b.sp));
      b.g.rotation.set(0, tangent, -Math.sign(b.sp) * 0.35);
      const flap = Math.sin(b.phase * 9) * 0.55 * (Math.sin(b.phase * 0.5) > -0.3 ? 1 : 0.15);
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    }
    this.birds.forEach((b, i) => {
      b.g.updateMatrixWorld(true);
      this.bodies.setMatrixAt(i, b.g.matrixWorld);
      this.wings.setMatrixAt(i * 2, b.wlm.matrixWorld);
      this.wings.setMatrixAt(i * 2 + 1, b.wrm.matrixWorld);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;
  }
}
