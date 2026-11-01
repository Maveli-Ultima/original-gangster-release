import type { Building } from './types';

/** Manual p.39 permits legal commercial, industrial and tenement premises.
 * A special service does not make an industrial business municipal; in
 * particular a union must be ownable to front Teamsters (p.58). */
export function purchasablePremisesType(b: Building): boolean {
  return ['empty', 'commercial', 'industrial', 'tenement'].includes(b.cls);
}
