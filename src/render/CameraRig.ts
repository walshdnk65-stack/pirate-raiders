import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, noise2, dampT } from '../core/math';
import type { Input } from '../core/Input';
import type { Ocean } from '../world/Ocean';
import { terrainHeight } from '../world/WorldData';
import { groundHeight } from '../world/Islands';

export type CamMode = 'follow' | 'cinematic' | 'orbit' | 'walk';

/** Third-person chase camera with orbit, zoom, combat framing, shake and collision. */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'orbit';
  yaw = Math.PI;
  yawOffset = 0;
  pitch = 0.42;
  pitchOffset = 0;
  dist = 33;
  targetDist = 33;
  minDist = 13;
  maxDist = 70;
  combat = 0;
  /** chase distance scale for bigger ships (1 = the starter boat) */
  shipK = 1;
  private combatT = 0;
  private trauma = 0;
  private shakeT = 0;
  private focus = new THREE.Vector3();
  colliders: THREE.Object3D[] = [];
  private ray = new THREE.Raycaster();
  private rayFrame = 0;
  private rayHit = 1e9;
  boost = 0;
  // cinematic
  cinePos = new THREE.Vector3();
  cineTarget = new THREE.Vector3();
  cineSpeed = 3;
  // orbit
  orbitCenter = new THREE.Vector3();
  orbitRadius = 60;
  orbitHeight = 22;
  orbitAngle = 0;
  orbitSpeed = 0.06;
  orbitLookY = 4;
  private curPos = new THREE.Vector3(0, 30, 80);
  private curLook = new THREE.Vector3();
  // on-foot camera
  walkYaw = 0;
  walkPitch = 0.34;
  walkDist = 7.5;
  walkTargetDist = 7.5;
  indoor = false;
  /** land combat: frame this point (locked-on enemy) behind the captain */
  lockOn: THREE.Vector3 | null = null;
  /** 0..1 over-the-shoulder pistol aim */
  aimK = 0;
  /** 0..1 fighting on foot (no auto-swing, slightly wider view) */
  fightK = 0;
  /** land combat: swing in behind this heading (the captain turned to strike) */
  followYaw: number | null = null;
  private blendT = 0;
  private walkHit = 1e9;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 1700);
    this.camera.position.copy(this.curPos);
    this.ray.far = 100;
  }

  addShake(amount: number) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Pull the chase camera back for bigger ships. */
  setShipSize(length: number) {
    this.shipK = clamp(length / 16, 1, 2.4);
  }

  /** Called when combat happens: camera eases in a little closer. */
  combatPulse() {
    this.combatT = 5;
  }

  setCinematic(pos: THREE.Vector3, target: THREE.Vector3, speed = 3, snap = false) {
    this.mode = 'cinematic';
    this.cinePos.copy(pos);
    this.cineTarget.copy(target);
    this.cineSpeed = speed;
    if (snap) {
      this.curPos.copy(pos);
      this.curLook.copy(target);
    }
  }

  setOrbit(center: THREE.Vector3, radius: number, height: number, speed = 0.06, lookY = 4) {
    this.mode = 'orbit';
    this.orbitCenter.copy(center);
    this.orbitRadius = radius;
    this.orbitHeight = height;
    this.orbitSpeed = speed;
    this.orbitLookY = lookY;
  }

  /** Third-person camera for walking around ports (yaw = direction from player to camera). */
  walk(snapYaw?: number, blend = 1.4) {
    this.mode = 'walk';
    if (snapYaw !== undefined) this.walkYaw = snapYaw;
    this.blendT = blend;
  }

  follow(snapHeading?: number) {
    if (this.mode !== 'follow') this.blendT = 1.0;
    this.mode = 'follow';
    if (snapHeading !== undefined) {
      this.yaw = snapHeading + Math.PI;
      this.yawOffset = 0;
    }
  }

  update(dt: number, target: { pos: THREE.Vector3; heading: number; speed: number }, input: Input | null, ocean: Ocean) {
    this.combatT -= dt;
    this.combat = damp(this.combat, this.combatT > 0 ? 1 : 0, this.combatT > 0 ? 2 : 0.7, dt);
    let desiredPos = new THREE.Vector3();
    let desiredLook = new THREE.Vector3();
    let k = 6;

    if (this.mode === 'follow') {
      if (input) {
        if (input.wheel) this.targetDist = clamp(this.targetDist * (1 + input.wheel * 0.1), this.minDist, this.maxDist);
        if (input.dragging && (input.mouseDX || input.mouseDY)) {
          this.yawOffset -= input.mouseDX * 0.006;
          this.pitchOffset = clamp(this.pitchOffset + input.mouseDY * 0.004, -0.22, 0.75);
        }
        const idle = performance.now() / 1000 - input.lastMouseMove;
        if (!input.dragging && idle > 2.2) {
          this.yawOffset = damp(this.yawOffset, 0, 1.6, dt);
          this.pitchOffset = damp(this.pitchOffset, 0, 1.2, dt);
        }
      }
      this.dist = damp(this.dist, this.targetDist * Math.pow(this.shipK, 0.8) * (1 - 0.2 * this.combat) * (1 + this.boost * 0.08), 4, dt);
      this.yaw = dampAngle(this.yaw, target.heading + Math.PI + this.yawOffset, 3.2, dt);
      const pitch = clamp(this.pitch + this.pitchOffset - this.combat * 0.04, 0.06, 1.2);
      const fwd = new THREE.Vector3(Math.sin(target.heading), 0, Math.cos(target.heading));
      this.focus.copy(target.pos).setY(Math.max(target.pos.y, 0) + 4 * this.shipK).addScaledVector(fwd, 2 + Math.min(Math.abs(target.speed), 30) * 0.1);
      const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
      let d = this.dist;
      // camera collision against islands / port buildings
      this.rayFrame++;
      if (this.colliders.length && this.rayFrame % 2 === 0) {
        this.ray.set(this.focus, dir);
        this.ray.far = d + 1;
        const hit = this.ray.intersectObjects(this.colliders, false)[0];
        this.rayHit = hit ? Math.max(this.minDist * 0.5, hit.distance - 1.5) : 1e9;
      }
      d = Math.min(d, this.rayHit);
      desiredPos = this.focus.clone().addScaledVector(dir, d);
      desiredLook = this.focus.clone();
      k = 14;
    } else if (this.mode === 'walk') {
      if (input) {
        if (input.wheel) this.walkTargetDist = clamp(this.walkTargetDist * (1 + input.wheel * 0.1), 3.2, 16);
        if ((input.dragging || input.pointerLocked) && (input.mouseDX || input.mouseDY)) {
          // captured mouse (combat free-look) moves in small steps, so it's a little less sensitive
          const sx = input.pointerLocked ? 0.0034 : 0.006;
          const sy = input.pointerLocked ? 0.0026 : 0.004;
          this.walkYaw -= input.mouseDX * sx;
          this.walkPitch = clamp(this.walkPitch + input.mouseDY * sy, 0.02, 1.25);
        }
        // gently swing in behind the captain while walking forward
        const idle = performance.now() / 1000 - input.lastMouseMove;
        if (!input.dragging && !input.pointerLocked && !this.lockOn && this.fightK < 0.5 && idle > 1.5 && target.speed > 1 && input.forward && !input.back) {
          this.walkYaw = dampAngle(this.walkYaw, target.heading + Math.PI, 0.8 * Math.min(1, target.speed / 5), dt);
        }
      }
      if (this.followYaw !== null && !this.lockOn) this.walkYaw = dampAngle(this.walkYaw, this.followYaw + Math.PI, 8, dt);
      if (this.lockOn) {
        // locked on: swing round behind the captain so both fighters are in view
        const want = Math.atan2(target.pos.x - this.lockOn.x, target.pos.z - this.lockOn.z);
        this.walkYaw = dampAngle(this.walkYaw, want, 4.5, dt);
        this.walkPitch = damp(this.walkPitch, 0.3, 2, dt);
      }
      const pitch = this.indoor ? Math.max(this.walkPitch, 0.68) : lerp(this.walkPitch, Math.min(this.walkPitch, 0.22), this.aimK);
      let wantDist = this.indoor ? Math.min(this.walkTargetDist, 9.5) : this.walkTargetDist;
      wantDist = lerp(wantDist * (1 + this.fightK * 0.08), 3.1, this.aimK);
      this.walkDist = damp(this.walkDist, wantDist, this.aimK > 0.05 ? 9 : 5, dt);
      this.focus.copy(target.pos).setY(target.pos.y + 1.55 + this.aimK * 0.15);
      if (this.lockOn) {
        const mid = Math.min(0.32, 6 / Math.max(1, Math.hypot(this.lockOn.x - target.pos.x, this.lockOn.z - target.pos.z)));
        this.focus.x += (this.lockOn.x - target.pos.x) * mid;
        this.focus.z += (this.lockOn.z - target.pos.z) * mid;
      }
      if (this.aimK > 0.01) {
        // over the right shoulder
        this.focus.x += Math.cos(this.walkYaw) * 0.85 * this.aimK;
        this.focus.z -= Math.sin(this.walkYaw) * 0.85 * this.aimK;
      }
      const dir = new THREE.Vector3(Math.sin(this.walkYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.walkYaw) * Math.cos(pitch));
      this.rayFrame++;
      if (this.colliders.length && this.rayFrame % 2 === 0) {
        this.ray.set(this.focus, dir);
        this.ray.far = this.walkDist + 0.6;
        const hit = this.ray.intersectObjects(this.colliders, false)[0];
        this.walkHit = hit ? Math.max(1.6, hit.distance - 0.5) : 1e9;
      }
      const d = Math.min(this.walkDist, this.walkHit);
      desiredPos = this.focus.clone().addScaledVector(dir, d);
      desiredLook = this.focus.clone();
      k = 12;
    } else if (this.mode === 'cinematic') {
      desiredPos.copy(this.cinePos);
      desiredLook.copy(this.cineTarget);
      k = this.cineSpeed;
    } else {
      this.orbitAngle += this.orbitSpeed * dt;
      desiredPos.set(
        this.orbitCenter.x + Math.sin(this.orbitAngle) * this.orbitRadius,
        this.orbitCenter.y + this.orbitHeight,
        this.orbitCenter.z + Math.cos(this.orbitAngle) * this.orbitRadius,
      );
      desiredLook.copy(this.orbitCenter).add(new THREE.Vector3(0, this.orbitLookY, 0));
      k = 2.5;
    }

    // smooth hand-over between camera modes (ship ⇄ on foot)
    if (this.blendT > 0) {
      this.blendT -= dt;
      k = Math.min(k, 2.2 + (1 - Math.max(0, this.blendT) / 1.4) * 6);
    }
    this.curPos.lerp(desiredPos, dampT(k, dt));
    this.curLook.lerp(desiredLook, dampT(k * 1.2, dt));
    // keep above water & terrain
    const minY = Math.max(ocean.heightAt(this.curPos.x, this.curPos.z) + 1.6, this.mode === 'walk' ? groundHeight(this.curPos.x, this.curPos.z) + 0.8 : terrainHeight(this.curPos.x, this.curPos.z) + 2.2);
    if (this.curPos.y < minY) this.curPos.y = minY;

    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.shakeT += dt * 30;
    const s = this.trauma * this.trauma;
    const off = new THREE.Vector3(noise2(this.shakeT, 0.5) * s * 1.2, noise2(this.shakeT, 9.1) * s * 0.9, noise2(this.shakeT, 3.3) * s * 1.2);
    this.camera.position.copy(this.curPos).add(off);
    this.camera.lookAt(this.curLook);
    this.camera.rotateZ(noise2(this.shakeT, 7.7) * s * 0.05);
    const fov = this.mode === 'walk' ? 52 + this.fightK * 3 - this.aimK * 10 : 55 + this.boost * 9 - this.combat * 2;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, fov, dampT(4, dt));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Camera yaw for audio panning. */
  get viewYaw() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return Math.atan2(d.x, d.z);
  }
}
