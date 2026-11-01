import * as THREE from 'three';
import type { Mass, Profile } from './profile';
import { STOREY_H } from './util';

/** Authored proportions informed by the installed original's church tile group. */
export const BELFRY = { baseWidth: 2.8, openingBottom: 1.16, openingTop: 2.38, height: 9.23 } as const;
export const CIVIC_DOME = { width: 2.16, height: 1.855 } as const;
export const CIVIC_STONE = 0xa49c89;
export const ORNAMENT_PALETTE = { stone: 0x938b79, trim: 0xaaa18d, slate: 0x514f47,
  shadow: 0x242925, metal: 0x877447, copper: 0x54756f } as const;

/** Local to newly authored ornaments: shared geometry palettes stay unchanged. */
export function ornamentRgb(hex: number): [number, number, number] {
  return new THREE.Color(hex).toArray() as [number, number, number];
}

export function churchBelfryLayout(tower: Mass): {
  x: number; z: number; baseY: number; scaleXZ: number; scaleY: number; top: number;
} {
  const scaleXZ = tower.w * .96 / BELFRY.baseWidth;
  const scaleY = 1.34;
  // The belfry starts on the masonry tower behind the entrance gable.
  const baseY = tower.y + tower.h - .08;
  return { x: tower.dx, z: tower.dz, baseY, scaleXZ, scaleY,
    top: baseY + BELFRY.height * scaleY };
}

export function civicDomeLayout(mass: Mass): {
  x: number; z: number; baseY: number; scaleXZ: number; scaleY: number; top: number;
} {
  const diameter = Math.min(mass.w, mass.d) * .58;
  const height = diameter * .70, baseY = mass.y + mass.h - .025;
  return { x: mass.dx, z: mass.dz, baseY, scaleXZ: diameter / CIVIC_DOME.width,
    scaleY: height / CIVIC_DOME.height, top: baseY + height };
}

export function porticoColumnScale(profile: Profile, municipal: boolean): number {
  // Existing column geometry is1.01m tall, not1m. Banks retain prior behavior.
  return municipal ? Math.min(profile.height * .45, profile.baseHeight + 1) / 1.01
    : Math.min(profile.height * .62, STOREY_H * 2.2);
}
