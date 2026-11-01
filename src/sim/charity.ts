import { BUILDING_BY_ID } from './data/buildings';
import type { Building, WorldState } from './types';

export function donationTarget(b: Building): boolean {
  const role = BUILDING_BY_ID[b.typeId]?.special;
  return b.state !== 'destroyed' && b.cls === 'charity' && (role === 'church' || role === 'orphanage');
}

/** Manual p.39: poorer areas require less. Coefficients remain remake tuning. */
export function donationAmount(w: WorldState, b: Building): number {
  const squalor = Math.max(0, Math.min(100, w.blocks[b.blockId].squalor));
  return Math.round(400 + (100 - squalor) * 22);
}

/** Manual p.90 describes appeals in especially poor districts, without a cutoff. */
export const CHARITY_APPEAL_SQUALOR = 60;
