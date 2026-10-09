import * as THREE from 'three';

/**
 * Planar water reflection (mirror camera with an oblique near plane), rendering only
 * objects on layer 1 (ships, islands, port) into a low-res target sampled by the ocean.
 */
export class PlanarReflection {
  rt: THREE.WebGLRenderTarget;
  textureMatrix = new THREE.Matrix4();
  enabled = true;
  private _scale = 0.4;
  private lastW = 2;
  private lastH = 2;
  get scale() {
    return this._scale;
  }
  set scale(v: number) {
    this._scale = v;
    this.setSize(this.lastW, this.lastH);
  }
  private cam = new THREE.PerspectiveCamera();
  private plane = new THREE.Plane();
  private normal = new THREE.Vector3(0, 1, 0);
  private planePos = new THREE.Vector3(0, 0, 0);
  private camPos = new THREE.Vector3();
  private rot = new THREE.Matrix4();
  private lookAt = new THREE.Vector3();
  private target = new THREE.Vector3();
  private view = new THREE.Vector3();
  private clip = new THREE.Vector4();
  private q = new THREE.Vector4();

  constructor(w: number, h: number) {
    this.lastW = w;
    this.lastH = h;
    this.rt = new THREE.WebGLRenderTarget(Math.max(2, w * this._scale), Math.max(2, h * this._scale), { type: THREE.HalfFloatType });
    this.cam.layers.set(1);
  }

  setSize(w: number, h: number) {
    this.lastW = w;
    this.lastH = h;
    this.rt?.setSize(Math.max(2, Math.floor(w * this._scale)), Math.max(2, Math.floor(h * this._scale)));
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (!this.enabled) return;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.planePos, this.camPos);
    if (this.view.dot(this.normal) > 0) return;
    this.view.reflect(this.normal).negate().add(this.planePos);
    this.rot.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.target.subVectors(this.planePos, this.lookAt).reflect(this.normal).negate().add(this.planePos);
    const vc = this.cam;
    vc.position.copy(this.view);
    vc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    vc.lookAt(this.target);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // oblique clip plane so geometry below the water is not reflected
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.planePos.clone().setY(-0.3));
    this.plane.applyMatrix4(vc.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = vc.projectionMatrix;
    this.q.x = (Math.sign(this.clip.x) + pm.elements[8]) / pm.elements[0];
    this.q.y = (Math.sign(this.clip.y) + pm.elements[9]) / pm.elements[5];
    this.q.z = -1.0;
    this.q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    this.clip.multiplyScalar(2.0 / this.clip.dot(this.q));
    pm.elements[2] = this.clip.x;
    pm.elements[6] = this.clip.y;
    pm.elements[10] = this.clip.z + 1.0;
    pm.elements[14] = this.clip.w;

    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevClear = renderer.getClearAlpha();
    const prevColor = renderer.getClearColor(new THREE.Color());
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevClear);
    renderer.shadowMap.autoUpdate = prevAuto;
  }
}
