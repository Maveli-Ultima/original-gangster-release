import * as THREE from 'three';

/** Metres, feet at y=0, forward +Z. No faction disc is part of a person. */
export const ACTOR_STYLES = ['fedora', 'worker', 'woman', 'police'] as const;
export type ActorStyle = (typeof ACTOR_STYLES)[number];
/** Advance aWalk.x by travelled metres * 2π / this value, never by wall time. */
export const ACTOR_STRIDE_METRES = 1.05;
export const ACTOR_HEIGHTS: Record<ActorStyle, number> = {
  fedora: 1.95, worker: 1.90, woman: 1.92, police: 1.94,
};

// Rigid sections meet at anatomical joints. Each leg is solved as two bones;
// shoes have their own ankle transform so the sole is flat during stance.
const PART = { body: 0, leftThigh: 1, leftShin: 2, leftShoe: 3,
  rightThigh: 4, rightShin: 5, rightShoe: 6,
  leftUpperArm: 7, leftForearm: 8, leftHand: 9,
  rightUpperArm: 10, rightForearm: 11, rightHand: 12 } as const;
type Part = typeof PART[keyof typeof PART];
const HIP = .92, KNEE = .51, ANKLE = .10;
const SHOULDER = 1.46, ELBOW = 1.19, WRIST = .965;

interface Ring { y: number; w: number; d: number; z?: number }

/** Eight-sided tailored contour: broad planes, rounded corners, no box elbows. */
function loft(rings: Ring[]): THREE.BufferGeometry {
  const section = [[-.72, -1], [.72, -1], [1, -.62], [1, .62],
    [.72, 1], [-.72, 1], [-1, .62], [-1, -.62]];
  const p: number[] = [], indices: number[] = [];
  for (const r of rings) for (const [x, z] of section) p.push(x * r.w, r.y, z * r.d + (r.z ?? 0));
  for (let row = 0; row < rings.length - 1; row++) for (let k = 0; k < 8; k++) {
    const a = row * 8 + k, b = row * 8 + (k + 1) % 8, c = b + 8, d = a + 8;
    indices.push(a, d, b, b, d, c);
  }
  const last = (rings.length - 1) * 8;
  for (let k = 1; k < 7; k++) {
    indices.push(0, k, k + 1);
    indices.push(last, last + k + 1, last + k);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A complete period person. Per-vertex aTint affects only clothing; aSkin
 * replaces only exposed skin with the instance's linear-RGB aSkinColor.
 * The caller supplies instanced aWalk(vec2) and aSkinColor(vec3) attributes.
 */
export function actorGeometry(style: ActorStyle): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const parts: number[] = [], tints: number[] = [], skins: number[] = [];
  const color = new THREE.Color();
  const add = (geometry: THREE.BufferGeometry, hex: number, tint = 0, skin = 0,
    part: Part = PART.body, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    geometry.applyMatrix4(matrix);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = flat.getAttribute('position'), n = flat.getAttribute('normal');
    color.setHex(hex);
    for (let i = 0; i < p.count; i++) {
      const py = p.getY(i);
      positions.push(p.getX(i), Math.abs(py) < 1e-8 ? 0 : py, p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(color.r, color.g, color.b); parts.push(part); tints.push(tint); skins.push(skin);
    }
    flat.dispose();
    if (flat !== geometry) geometry.dispose();
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number,
    hex: number, tint = 0, part: Part = PART.body, rz = 0) =>
    add(new THREE.BoxGeometry(w, h, d), hex, tint, 0, part, x, y, z, 1, 1, 1, 0, 0, rz);
  const ball = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
    hex: number, skin = 0, part: Part = PART.body, segments = 10) =>
    add(new THREE.SphereGeometry(1, segments, 6), hex, 0, skin, part, x, y, z, sx, sy, sz);
  const tube = (rTop: number, rBottom: number, h: number, x: number, y: number, z: number,
    hex: number, tint = 0, part: Part = PART.body, sx = 1, sz = 1) =>
    add(new THREE.CylinderGeometry(rTop, rBottom, h, 10), hex, tint, 0, part, x, y, z, sx, 1, sz);

  const woman = style === 'woman', worker = style === 'worker', police = style === 'police';
  const cloth = 0xe6e3dc, shadedCloth = 0xb9b7b0, shoes = 0x292521;
  const shoulderWidth = woman ? .205 : .222;

  for (const side of [-1, 1]) {
    const left = side < 0;
    const thigh = left ? PART.leftThigh : PART.rightThigh;
    const shin = left ? PART.leftShin : PART.rightShin;
    const shoe = left ? PART.leftShoe : PART.rightShoe;
    const x = side * .095;
    // Separate trouser legs, with knees that articulate rather than slide.
    tube(.075, .060, HIP - KNEE + .055, x, (HIP + KNEE) / 2, 0, shadedCloth, 1, thigh, 1, 1.12);
    tube(.061, .045, KNEE - ANKLE, x, (KNEE + ANKLE) / 2, 0, shadedCloth, 1, shin, 1, 1.12);
    // Rounded, slightly pointed leather shoes; bottom is exactly y=0.
    add(loft([{ y: 0, w: .063, d: .127, z: .047 }, { y: .035, w: .066, d: .13, z: .047 },
      { y: .096, w: .052, d: .101, z: .035 }]), shoes, 0, 0, shoe, x);
    box(.09, .028, .075, x, .014, -.025, 0x1f1d1b, 0, shoe);

    const upper = left ? PART.leftUpperArm : PART.rightUpperArm;
    const fore = left ? PART.leftForearm : PART.rightForearm;
    const hand = left ? PART.leftHand : PART.rightHand;
    const ax = side * .258;
    tube(.064, .052, SHOULDER - ELBOW + .055, ax, (SHOULDER + ELBOW) / 2, 0,
      cloth, 1, upper, 1, .98);
    tube(.054, .043, ELBOW - WRIST + .022, ax, (ELBOW + WRIST) / 2, 0,
      cloth, 1, fore, 1, .98);
    tube(.044, .044, .025, ax, WRIST + .006, 0, worker ? shadedCloth : 0xded7c7, worker ? 1 : 0, fore);
    ball(ax, WRIST - .055, .01, .042, .066, .037, 0xffffff, 1, hand, 8);
  }

  // Pelvis and tailored upper body. Clothing follows the shoulder/chest outline.
  add(loft([{ y: .87, w: .177, d: .112 }, { y: 1.04, w: .162, d: .108 },
    { y: 1.31, w: .197, d: .120 }, { y: 1.47, w: shoulderWidth, d: .108 },
    { y: 1.52, w: .085, d: .071 }]), cloth, 1);
  if (woman) {
    // Split calf-length coat panels bend at their hip; the centre slit opens
    // during a step instead of trapping both moving legs in a rigid cone.
    for (const side of [-1, 1]) add(loft([
      { y: .405, w: .118, d: .135 }, { y: .68, w: .113, d: .129 }, { y: .925, w: .088, d: .107 },
    ]), cloth, 1, 0, side < 0 ? PART.leftThigh : PART.rightThigh, side * .107);
    box(.312, .035, .23, 0, 1.025, 0, shadedCloth, 1);
    box(.037, .04, .012, .015, 1.025, .12, 0x8a7651);
  } else if (!worker) {
    // Jacket skirt leaves thigh/knee and both trouser legs visible.
    add(loft([{ y: .82, w: .184, d: .12 }, { y: 1.055, w: .168, d: .112 }]), cloth, 1);
  } else {
    box(.327, .038, .221, 0, .982, 0, 0x514232);
    box(.034, .033, .018, 0, .982, .116, 0x9b8a67);
  }
  // Shirt wedge and two broad lapels, kept legible without enlarged anatomy.
  add(loft([{ y: 1.25, w: .018, d: .008 }, { y: 1.48, w: .071, d: .008 }]),
    worker ? 0xc9c0aa : 0xe4ddcc, 0, 0, PART.body, 0, 0, .120);
  for (const side of [-1, 1]) box(.058, .205, .02, side * .075, 1.39, .124,
    shadedCloth, 1, PART.body, side * -.34);
  if (!worker) {
    box(.025, .16, .015, 0, 1.357, .133, police ? 0x283142 : 0x58402f);
    ball(0, 1.448, .132, .020, .022, .011, police ? 0x283142 : 0x58402f, 0, PART.body, 6);
  }
  const buttons = woman ? [1.17, 1.29] : [1.11, 1.23];
  for (const y of buttons) ball(.018, y, .124, .011, .011, .007, police ? 0x8f8055 : 0x443c32, 0, PART.body, 6);
  if (worker) box(.083, .067, .018, -.098, 1.315, .126, shadedCloth, 1);
  if (police) {
    box(.334, .047, .231, 0, 1.02, 0, 0x302820);
    box(.038, .04, .014, 0, 1.02, .126, 0xab9862);
    ball(-.103, 1.358, .133, .027, .034, .01, 0xb5a270, 0, PART.body, 6);
    box(.06, .105, .07, .187, .965, .014, 0x3c2f24);
  }

  // Neck, anatomical head and ears. Skin stays independent of every coat tint.
  add(new THREE.CylinderGeometry(.052, .059, .105, 10), 0xffffff, 0, 1, PART.body, 0, 1.535, 0);
  ball(0, 1.672, .006, .108, .148, .105, 0xffffff, 1, PART.body, 12);
  for (const side of [-1, 1]) ball(side * .105, 1.669, .001, .022, .038, .020, 0xffffff, 1, PART.body, 6);
  ball(0, 1.675, .103, .020, .036, .027, 0xffffff, 1, PART.body, 6);
  // A thin hair shell at the nape never recolours with the coat.
  add(new THREE.SphereGeometry(1, 10, 6, Math.PI, Math.PI), woman ? 0x49382d : 0x342d27,
    0, 0, PART.body, 0, woman ? 1.675 : 1.724, -.014, .110, woman ? .143 : .092, .097);
  for (const side of [-1, 1]) {
    ball(side * .040, 1.696, .100, .009, .008, .005, 0x3b3129, 0, PART.body, 6);
    box(.034, .008, .006, side * .041, 1.714, .094, 0x483b30);
  }
  box(.036, .006, .006, 0, 1.617, .101, 0x815746);

  if (style === 'fedora') {
    // Pinched felt crown and oval brim: crown never exceeds 1.95m.
    tube(.150, .150, .017, 0, 1.808, .005, 0x5d5548, .32, PART.body, 1, .86);
    add(loft([{ y: 1.813, w: .110, d: .091 }, { y: 1.865, w: .102, d: .088 },
      { y: 1.932, w: .085, d: .073 }, { y: 1.95, w: .061, d: .071 }]), 0x61594c, .32);
    tube(.110, .112, .022, 0, 1.834, 0, 0x322d27, .15, PART.body, 1, .83);
    box(.025, .006, .088, 0, 1.945, 0, 0x494237);
  } else if (worker) {
    // A shallow flat cap and short forward peak, distinct from a fedora.
    ball(0, 1.84, .004, .122, .060, .118, 0x6a6253, 0, PART.body, 12);
    add(new THREE.CylinderGeometry(.100, .100, .012, 12), 0x514a3f, .3, 0, PART.body,
      0, 1.813, .074, 1, 1, .72);
    box(.010, .008, .195, 0, 1.889, .011, 0x807665);
  } else if (woman) {
    // Close-fitting bell crown and downturned narrow brim, not a man's hat.
    add(loft([{ y: 1.757, w: .126, d: .113 }, { y: 1.809, w: .115, d: .105 },
      { y: 1.885, w: .096, d: .087 }, { y: 1.92, w: .037, d: .044 }]), 0x675950, .30);
    tube(.117, .135, .029, 0, 1.769, 0, 0x615149, .3, PART.body, 1, .91);
    tube(.116, .117, .018, 0, 1.806, 0, 0x3e3733, .15, PART.body, 1, .91);
    ball(-.111, 1.813, .024, .023, .031, .012, 0x93836b, 0, PART.body, 6);
  } else {
    // Peaked uniform cap: leather visor, cloth crown and small brass badge.
    tube(.114, .106, .073, 0, 1.841, 0, shadedCloth, 1, PART.body, 1, .94);
    add(new THREE.SphereGeometry(1, 12, 6), shadedCloth, 1, 0, PART.body,
      0, 1.880, -.006, .129, .060, .111);
    add(new THREE.CylinderGeometry(.102, .102, .015, 12), 0x292c2e, 0, 0, PART.body,
      0, 1.812, .084, 1, 1, .68);
    box(.193, .017, .019, 0, 1.829, .092, 0x333335);
    ball(0, 1.865, .106, .020, .027, .009, 0xb6a36a, 0, PART.body, 6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tints, 1));
  geometry.setAttribute('aSkin', new THREE.Float32BufferAttribute(skins, 1));
  // Include walking shoes and seated knees/pedals; GPU deformation cannot update CPU bounds.
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-.40, 0, -.52), new THREE.Vector3(.40, 1.96, .72));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .98, .10), 1.25);
  geometry.userData = { style, heightMetres: ACTOR_HEIGHTS[style], triangleCount: positions.length / 9,
    strideMetres: ACTOR_STRIDE_METRES, forward: '+Z', feet: 'y=0', skinnedOnGpu: true,
    poses: ['idle', 'walk', 'seated'], seatedAmplitude: -1, seatedHipHeightMetres: HIP };
  return geometry;
}

// Identical deformation is injected into lit and shadow programs. The gait
// relies only on aWalk, so pause/resume/save frame interpolation is caller-owned.
const ACTOR_GLSL = /* glsl */`
attribute float aPart;
attribute float aTint;
attribute float aSkin;
attribute vec2 aWalk;
#ifdef USE_INSTANCING
attribute vec3 aSkinColor;
#endif
mat3 actorRx(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}
void actorDeform(vec3 bindP, vec3 bindN, out vec3 posedP, out vec3 posedN) {
  float amplitude = clamp(aWalk.y, 0.0, 1.0);
  float phase = aWalk.x;
  float bodyY = amplitude * (-0.085 + 0.015 * cos(phase * 2.0));
  posedP = bindP + vec3(0.0, bodyY, 0.0);
  posedN = bindN;
  // Idle is the authored bind pose. Bypass the fully extended IK GPU path;
  // negative amplitudes still select the driving pose below.
  if (aWalk.y == 0.0) return;
  // Negative amplitude selects a stable driving pose. Root/seat translation
  // is caller-owned; the phase does not move a seated person's joints.
  if (aWalk.y < 0.0) {
    if (aPart > 0.5 && aPart < 6.5) {
      bool right = aPart > 3.5;
      float section = aPart - (right ? 4.0 : 1.0);
      float x = right ? 0.095 : -0.095;
      vec3 hip = vec3(x, ${HIP.toFixed(3)}, 0.0);
      vec3 knee = hip + vec3(0.0, 0.0, 0.41);
      vec3 ankle = knee + vec3(0.0, -0.41, 0.0);
      mat3 rotation = actorRx(section < 0.5 ? -1.57079632679 : section < 1.5 ? 0.0 : -0.12);
      if (section < 0.5) posedP = hip + rotation * (bindP - vec3(x, ${HIP.toFixed(3)}, 0.0));
      else if (section < 1.5) posedP = knee + rotation * (bindP - vec3(x, ${KNEE.toFixed(3)}, 0.0));
      else posedP = ankle + rotation * (bindP - vec3(x, ${ANKLE.toFixed(3)}, 0.0));
      posedN = rotation * bindN;
    } else if (aPart > 6.5) {
      bool right = aPart > 9.5;
      float section = aPart - (right ? 10.0 : 7.0);
      float x = right ? 0.258 : -0.258;
      vec3 shoulder = vec3(x, ${SHOULDER.toFixed(3)}, 0.0);
      vec3 elbow = shoulder + actorRx(-0.65) * vec3(0.0, -${(SHOULDER - ELBOW).toFixed(3)}, 0.0);
      mat3 rotation = actorRx(section < 0.5 ? -0.65 : -1.10);
      posedP = section < 0.5
        ? shoulder + rotation * (bindP - vec3(x, ${SHOULDER.toFixed(3)}, 0.0))
        : elbow + rotation * (bindP - vec3(x, ${ELBOW.toFixed(3)}, 0.0));
      posedN = rotation * bindN;
    }
    return;
  }
  if (aPart > 0.5 && aPart < 6.5) {
    bool right = aPart > 3.5;
    float section = aPart - (right ? 4.0 : 1.0);
    float t = fract(phase / 6.28318530718 + (right ? 0.5 : 0.0));
    float stepZ, lift = 0.0, footAngle = 0.0;
    if (t < 0.62) {
      // Linear reverse travel exactly cancels forward root travel in stance.
      stepZ = ${ACTOR_STRIDE_METRES.toFixed(3)} * (0.31 - t);
    } else {
      float u = (t - 0.62) / 0.38;
      stepZ = mix(-0.3255, 0.3255, u * u * (3.0 - 2.0 * u));
      lift = 0.105 * sin(u * 3.14159265359);
      footAngle = -0.20 * sin(u * 3.14159265359);
    }
    float x = right ? 0.095 : -0.095;
    vec3 hip = vec3(x, ${HIP.toFixed(3)} + bodyY, 0.0);
    vec3 ankle = vec3(x, ${ANKLE.toFixed(3)} + amplitude * lift, amplitude * stepZ);
    vec2 delta = ankle.yz - hip.yz;
    float lengthToFoot = clamp(length(delta), 0.001, 0.82);
    float bend = acos(clamp(lengthToFoot / 0.82, -1.0, 1.0));
    float upperAngle = atan(-delta.y, -delta.x) - bend;
    float lowerAngle = upperAngle + 2.0 * bend;
    vec3 knee = hip + actorRx(upperAngle) * vec3(0.0, -0.41, 0.0);
    mat3 rotation;
    if (section < 0.5) {
      rotation = actorRx(upperAngle);
      posedP = hip + rotation * (bindP - vec3(x, ${HIP.toFixed(3)}, 0.0));
    } else if (section < 1.5) {
      rotation = actorRx(lowerAngle);
      posedP = knee + rotation * (bindP - vec3(x, ${KNEE.toFixed(3)}, 0.0));
    } else {
      rotation = actorRx(footAngle * amplitude);
      posedP = ankle + rotation * (bindP - vec3(x, ${ANKLE.toFixed(3)}, 0.0));
    }
    posedN = rotation * bindN;
  } else if (aPart > 6.5) {
    bool right = aPart > 9.5;
    float section = aPart - (right ? 10.0 : 7.0);
    float armPhase = phase + (right ? 3.14159265359 : 0.0);
    float upperAngle = amplitude * 0.30 * cos(armPhase);
    float lowerAngle = upperAngle - amplitude * (0.10 + 0.07 * sin(armPhase));
    float x = right ? 0.258 : -0.258;
    vec3 shoulder = vec3(x, ${SHOULDER.toFixed(3)} + bodyY, 0.0);
    vec3 elbow = shoulder + actorRx(upperAngle) * vec3(0.0, -${(SHOULDER - ELBOW).toFixed(3)}, 0.0);
    mat3 rotation = actorRx(section < 0.5 ? upperAngle : lowerAngle);
    posedP = section < 0.5
      ? shoulder + rotation * (bindP - vec3(x, ${SHOULDER.toFixed(3)}, 0.0))
      : elbow + rotation * (bindP - vec3(x, ${ELBOW.toFixed(3)}, 0.0));
    posedN = rotation * bindN;
  }
}
`;

function patchActorMaterial(material: THREE.Material, lit: boolean): void {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ACTOR_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 actorDiscardNormal;
        actorDeform(position, vec3(0.0, 1.0, 0.0), transformed, actorDiscardNormal);`);
    if (lit) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vec3 actorDiscardPosition;
          actorDeform(position, objectNormal, actorDiscardPosition, objectNormal);`)
        .replace('#include <color_vertex>', `#include <color_vertex>
          vColor.xyz = color.rgb;
          #ifdef USE_INSTANCING_COLOR
            vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, aTint);
          #endif
          #ifdef USE_INSTANCING
            vColor.xyz = mix(vColor.xyz, color.rgb * aSkinColor, aSkin);
          #else
            vColor.xyz = mix(vColor.xyz, color.rgb * vec3(0.57, 0.33, 0.20), aSkin);
          #endif`);
    }
  };
  material.customProgramCacheKey = () => `og-actor-joints-v3-${lit ? 'lit' : 'depth'}`;
}

export function createActorMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true,
    roughness: .88, metalness: 0 });
  patchActorMaterial(material, true);
  return material;
}

/** Attach to every actor mesh's customDepthMaterial for matching sun shadows. */
export function createActorDepthMaterial(): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchActorMaterial(material, false);
  return material;
}
