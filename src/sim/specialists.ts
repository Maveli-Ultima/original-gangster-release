import type { Gang, Person, WorldState } from './types';
import { dismount } from './transport';

export type SpecialistRole = 'accountant' | 'lawyer';

/** A slot alone does not establish that its holder can still do the job. */
export function availableSpecialist(w: WorldState, gang: Gang, role: SpecialistRole): Person | undefined {
  const id = role === 'accountant' ? gang.accountantId : gang.lawyerId;
  const p = id == null ? undefined : w.people[id];
  return p?.role === role && p.gangId === gang.id && p.status === 'active' ? p : undefined;
}

/** Unassign the gang's vehicle when the specialist leaves their post. */
export function reclaimStaffVehicle(w: WorldState, gang: Gang, role: SpecialistRole): void {
  const id = role === 'accountant' ? gang.accountantId : gang.lawyerId;
  const p = id == null ? undefined : w.people[id];
  if (p) {dismount(w,p);if(w.vehicleFleet)delete w.vehicleFleet[`staff:${p.id}`];}
  const vehicle = gang.staffVehicles?.[role];
  if (!vehicle) return;
  gang.vehicles[vehicle] = (gang.vehicles[vehicle] ?? 0) + 1;
  gang.staffVehicles![role] = null;
}
