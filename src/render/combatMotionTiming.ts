import type {WeaponId} from '../sim/types';

export const SHOOT_DURATION=1.4;
export const HIT_DURATION=43/30;
export const PUNCH_CONTACT=17/30;
export const PUNCH_DURATION=31/30;
export function hitDuration(weapon?:WeaponId):number {
  return weapon==='rifle'||weapon==='shotgun'||weapon==='tommy'?69/30:weapon?82/30:HIT_DURATION;
}
/** Authored recoil onset mapped to the shared visible contact at .24 seconds. */
export function shootingTime(time:number,weapon?:WeaponId):number {
  const recoil=weapon==='tommy'?0:weapon==='rifle'||weapon==='shotgun'?3/30:6/30;
  return Math.max(0,time+recoil-.24);
}
