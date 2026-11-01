import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Person, VehicleId, WorldState } from '../sim/types';

/** Generous selection envelopes, in the same metres as the street layout. Geometry bounds are measured in the review harness. */
export const VEHICLE_PROFILE: Record<VehicleId, { length: number; width: number; height: number; nose: number; lampY: number }> = {
  coupe: { length: 4.64, width: 1.86, height: 1.92, nose: 2.15, lampY: 0.91 },
  truck: { length: 5.54, width: 1.98, height: 2.43, nose: 2.61, lampY: 1.06 },
  speedster: { length: 4.54, width: 1.84, height: 1.42, nose: 2.10, lampY: 0.84 },
};

interface Part { geometry: THREE.BufferGeometry; color: number; paint?: boolean }
const BLACK = 0x1b1b1d, GLASS = 0x57717b, CHROME = 0xb3b0a6, LEATHER = 0x513729;

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, paint = false, radius = .025): Part {
  const geometry = new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w / 3, h / 3, d / 3));
  geometry.translate(x, y, z);
  return { geometry, color, paint };
}

function cylinder(radius: number, height: number, x: number, y: number, z: number, color: number, axis: 'x' | 'y' | 'z' = 'y'): Part {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
  if (axis === 'z') geometry.rotateX(Math.PI / 2);
  if (axis === 'x') geometry.rotateZ(Math.PI / 2);
  geometry.translate(x, y, z);
  return { geometry, color };
}

function runningGear(axles: [number, number], halfWidth: number, wheelRadius: number): Part[] {
  const parts: Part[] = [];
  for (const x of axles) for (const side of [-1, 1]) {
    const z = side * halfWidth;
    parts.push(cylinder(wheelRadius, .17, x, wheelRadius, z, BLACK, 'z'));
    parts.push(cylinder(wheelRadius * .55, .185, x, wheelRadius, z, 0x373b3c, 'z'));
    parts.push(cylinder(wheelRadius * .22, .20, x, wheelRadius, z, CHROME, 'z'));
    const arch = new THREE.TorusGeometry(wheelRadius + .075, .065, 5, 20, Math.PI);
    arch.translate(x, wheelRadius + .025, z);
    parts.push({ geometry: arch, color: BLACK });
  }
  for (const side of [-1, 1]) parts.push(box(axles[1] - axles[0] + .1, .065, .31, (axles[0] + axles[1]) / 2, .36, side * (halfWidth - .055), BLACK));
  return parts;
}

function nose(x: number, y: number, halfWidth: number, grilleHeight: number): Part[] {
  const parts = [box(.08, grilleHeight, halfWidth * 1.42, x, y, 0, CHROME)];
  parts.push(box(.088, grilleHeight * .86, halfWidth * 1.27, x + .006, y, 0, BLACK, false, .006));
  for (let i = -4; i <= 4; i++) parts.push(box(.014, grilleHeight * .82, .014, x + .057, y, i * halfWidth * .13, CHROME, false, .002));
  for (const side of [-1, 1]) {
    parts.push(cylinder(.13, .15, x - .01, y + .07, side * halfWidth * .84, CHROME, 'x'));
    parts.push(cylinder(.103, .018, x + .073, y + .07, side * halfWidth * .84, 0xe3d4a7, 'x'));
  }
  parts.push(box(.10, .09, halfWidth * 2.13, x + .14, .39, 0, CHROME));
  return parts;
}

function merge(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], tint: number[] = [];
  for (const part of parts) {
    const geo = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const pos = geo.getAttribute('position'), normal = geo.getAttribute('normal');
    const color = new THREE.Color(part.color);
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colors.push(color.r, color.g, color.b);
      tint.push(part.paint ? 1 : 0);
    }
    if (geo !== part.geometry) geo.dispose();
    part.geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Period coachwork: separate bonnet, cabin, glass, mudguards and running boards. Forward is +X. */
export function vehicleGeometry(kind: VehicleId): THREE.BufferGeometry {
  const truck = kind === 'truck', open = kind === 'speedster';
  const parts: Part[] = [];
  const axles: [number, number] = truck ? [-1.80, 1.81] : [-1.42, 1.47];
  const wheelRadius = truck ? .43 : .35;
  const halfWidth = truck ? .895 : .835;
  parts.push(...runningGear(axles, halfWidth, wheelRadius));
  parts.push(box(truck ? 5.10 : 4.20, .14, 1.32, truck ? -.06 : -.02, .41, 0, BLACK));
  if (truck) {
    parts.push(box(1.17, .59, 1.43, 1.91, .88, 0, 0xf4f1e9, true, .06));
    parts.push(box(1.09, .91, 1.59, .72, 1.03, 0, 0xfaf8f1, true, .04));
    parts.push(box(1.10, .13, 1.68, .70, 1.99, 0, BLACK));
    parts.push(box(.045, .47, 1.35, 1.275, 1.64, 0, GLASS));
    for (const side of [-1, 1]) {
      parts.push(box(.68, .48, .025, .75, 1.64, side * .806, GLASS));
      parts.push(box(.105, .61, .05, .36, 1.64, side * .817, 0xf2efdf, true));
      parts.push(box(.15, .025, .044, .46, 1.21, side * .819, CHROME, false, .008));
    }
    parts.push(box(3.35, .19, 1.84, -1.04, .87, 0, 0x66513c));
    parts.push(box(3.23, 1.24, 1.77, -1.06, 1.61, 0, 0x968d6f, false, .08));
    parts.push(box(3.29, .22, 1.83, -1.06, 2.29, 0, 0xa49a7a, false, .10));
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) parts.push(box(.035, 1.27, .027, -2.40 + i * .67, 1.61, side * .897, 0x736d58, false, .004));
      parts.push(box(3.24, .065, .042, -1.06, 1.18, side * .905, 0x655541));
    }
    parts.push(...nose(2.49, .99, .86, .66));
  } else {
    parts.push(box(3.88, open ? .15 : .52, 1.48, -.02, open ? .605 : .79, 0, 0xf4f1e9, true, .06));
    parts.push(box(1.52, .43, 1.27, 1.28, 1.04, 0, 0xf9f7ef, true, .065));
    // Vertical bonnet louvers are geometry, so their scale stays coherent when zooming.
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) parts.push(box(.018, .22, .014, .90 + i * .15, 1.02, side * .646, 0x514e48, false, .002));
    if (open) {
      parts.push(box(1.70, .08, 1.31, -.86, .72, 0, LEATHER));
      parts.push(box(.55, .13, 1.12, -.81, .82, 0, 0x6b4a34));
      parts.push(box(.13, .43, 1.12, -1.08, 1.02, 0, LEATHER));
      for (const side of [-1, 1]) parts.push(box(1.89, .36, .09, -.80, .855, side * .70, 0xf5efe5, true));
      parts.push(box(.047, .34, 1.30, .065, 1.25, 0, GLASS, false, .01));
      parts.push(box(.045, .03, 1.38, .064, 1.417, 0, CHROME, false, .005));
      const steering = new THREE.TorusGeometry(.15, .018, 5, 16);
      steering.rotateY(Math.PI / 2);
      steering.rotateZ(-.38);
      steering.translate(-.23, 1.105, 0);
      parts.push({ geometry: steering, color: BLACK });
      for (const side of [-1, 1]) parts.push(box(.045, .39, .025, .064, 1.23, side * .67, CHROME, false, .005));
      parts.push(box(.57, .34, 1.32, -1.68, 1.01, 0, 0xf5efe5, true, .08));
    } else {
      parts.push(box(1.98, .74, 1.41, -.68, 1.395, 0, 0xe9e5d9, true, .045));
      parts.push(box(2.12, .16, 1.51, -.68, 1.83, 0, BLACK, false, .045));
      parts.push(box(.032, .48, 1.19, .327, 1.49, 0, GLASS, false, .009));
      parts.push(box(.032, .41, 1.11, -1.687, 1.49, 0, GLASS, false, .009));
      for (const side of [-1, 1]) {
        parts.push(box(.80, .47, .024, -.20, 1.49, side * .716, GLASS));
        parts.push(box(.72, .47, .024, -1.10, 1.49, side * .716, GLASS));
        parts.push(box(.06, .54, .036, -.655, 1.49, side * .731, 0xe6e3db, true));
        parts.push(box(.16, .028, .042, -.43, 1.142, side * .756, CHROME, false, .006));
        parts.push(box(.026, .37, .02, -.68, .89, side * .753, 0x696661, false, .004));
      }
    }
    parts.push(...nose(2.02, .84, .81, .63));
    parts.push(box(.10, .08, 1.69, -2.11, .40, 0, CHROME));
    parts.push(cylinder(.31, .15, -2.07, .92, 0, BLACK, 'x'));
    parts.push(cylinder(.14, .16, -2.075, .92, 0, CHROME, 'x'));
  }
  return merge(parts);
}

export function createVehicleMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: .48, metalness: .17, vertexColors: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        #if defined(USE_COLOR) && defined(USE_INSTANCING_COLOR)
          vColor.xyz = color.xyz * mix(vec3(1.0), instanceColor, aTint);
        #endif`);
  };
  material.customProgramCacheKey = () => 'og-period-vehicle-v1';
  return material;
}

export function vehicleLightGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const side of [-1, 1]) {
    const geometry = new THREE.SphereGeometry(.105, 8, 5);
    geometry.translate(0, 0, side * .68);
    parts.push({ geometry, color: 0xffffff });
  }
  return merge(parts);
}

/** Prefer the saved vehicle; legacy/review figures keep a deterministic fallback. */
export function vehicleForPerson(world: WorldState, person: Person): VehicleId {
  if(person.vehicleKey && world.vehicleFleet?.[person.vehicleKey])return world.vehicleFleet[person.vehicleKey].kind;
  if(person.role==='accountant'||person.role==='lawyer'){
    const kind=world.gangs?.[person.gangId!]?.staffVehicles?.[person.role];if(kind)return kind;
  }
  const team = person.teamId != null ? world.teams[person.teamId] : undefined;
  if (!team) return 'coupe';
  const choices: VehicleId[] = [];
  for (const kind of ['coupe', 'truck', 'speedster'] as const) {
    // Legacy or isolated visual-review figures without a saved seat.
    if ((team.vehicles[kind] ?? 0) > 0) choices.push(kind);
  }
  if (!choices.length) return 'coupe';
  const crew = [team.lieutenantId, ...team.memberIds].filter((id, index, ids) => ids.indexOf(id) === index);
  const slot = Math.max(0, crew.indexOf(person.id));
  return choices[slot % choices.length];
}
