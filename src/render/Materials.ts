import * as THREE from 'three';

/** Uniforms shared across many materials (time for flags/sails, night factor for glows). */
export const globalUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uWind: { value: 1 },
};

/**
 * Adds a soft stylised rim light (the "mobile game" glow around silhouettes)
 * to a MeshStandardMaterial.
 */
export function addRim(mat: THREE.MeshStandardMaterial, strength = 0.35, color = new THREE.Color(1, 0.95, 0.85)) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uRimColor = { value: color };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uNight = globalUniforms.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRimColor; uniform float uRimStrength; uniform float uNight;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 vdir = normalize(-vViewPosition);
          float rimF = 1.0 - clamp(dot(vdir, normal), 0.0, 1.0);
          rimF = smoothstep(0.55, 1.0, rimF);
          outgoingLight += uRimColor * rimF * uRimStrength * mix(1.0, 0.35, uNight) * (0.4 + 0.6 * diffuseColor.rgb);
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'rim';
  return mat;
}



/** Vertex-coloured material used for merged procedural models. */
export const M = {
  vc: addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 }), 0.25),
  vcDouble: addRim(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide }),
    0.2,
  ),
  vcFlat: addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), 0.15),
  vcMetal: addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.55 }), 0.3),
  character: addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.0 }), 0.3),
  glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.35).multiplyScalar(2.2), toneMapped: true }),
  glowWindow: new THREE.MeshStandardMaterial({
    color: 0x3b2a18,
    emissive: new THREE.Color(1.0, 0.7, 0.3),
    emissiveIntensity: 0.2,
    roughness: 0.6,
  }),
};

/** Night-time glow: windows and lanterns brighten when the sun goes down. */
export function updateNightMaterials(night: number) {
  M.glowWindow.emissiveIntensity = 0.15 + night * 2.6;
  const g = 0.6 + night * 2.2;
  M.glow.color.setRGB(1.0 * g, 0.72 * g, 0.35 * g);
}

/** Canvas texture helper. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
