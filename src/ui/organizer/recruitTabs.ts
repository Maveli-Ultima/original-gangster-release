/** The Recruitment sheet's tabs, and the wording of its accountant and lawyer hire button. */
import type { PersonRole } from '../../sim/types';

export type RecruitTabId = 'hood' | 'accountant' | 'lawyer';
export type StaffRole = Extract<PersonRole, 'accountant' | 'lawyer'>;

export const RECRUIT_TABS: readonly { id: RecruitTabId; label: string; empty: string }[] = [
  { id: 'hood', label: 'Hoods', empty: 'No hoods are offering their services. Send a hood to Recruit at a gym, pool hall, the docks or the labour exchange.' },
  { id: 'accountant', label: 'Accountants', empty: 'No accountants are offering their services. Send a hood to Recruit at an accountancy firm or the main bank.' },
  { id: 'lawyer', label: 'Lawyers', empty: 'No lawyers are offering their services. Send a hood to Recruit at a law office or the courthouse.' },
];

export const isStaffRole = (role: string): role is StaffRole => role === 'accountant' || role === 'lawyer';

/** Anyone who is not a specialist counts as a hood, so no recruit can drop off every tab. */
export function recruitsOnTab<T extends { role: string }>(recruits: readonly T[], tab: RecruitTabId): T[] {
  return recruits.filter((p) => (isStaffRole(p.role) ? p.role === tab : tab === 'hood'));
}

export function staffHireLabel(role: StaffRole, currentName: string | undefined): string {
  return currentName ? `Replace ${currentName} as ${role}` : `Hire as ${role}`;
}
