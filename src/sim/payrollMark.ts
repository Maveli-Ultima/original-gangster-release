import type { ID, Person } from './types';

/**
 * The official's payroll bit for a gang (person +0x90, read by 0x51B2C0). The
 * lawyer's hire 0x75D3B0 sets it; it is cleared only when he is dismissed or
 * let go off the lawyer's list (0x51B390). One who quits in the weekly pass
 * 0x75DA90 is unlinked from the list but keeps the bit (`quitPayrollOf`), so
 * every reader still takes him for that gang's man: the crime investigation
 * 0x7425E0 drops the gang's crimes, the street reaction 0x7496F0 tolerates
 * its men, the crackdown 0x4F6750 counts him, and the hire refuses him.
 */
export function onGangPayroll(p: Person, gangId: ID): boolean {
  return p.employedBy === gangId || !!p.quitPayrollOf?.includes(gangId);
}

/** He quit this gang's payroll and still carries its bit: it cannot hire him again. */
export function quitGangPayroll(p: Person, gangId: ID): boolean {
  return !!p.quitPayrollOf?.includes(gangId);
}
