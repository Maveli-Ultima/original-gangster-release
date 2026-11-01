import { createPerson } from './citygen';
import type { Rng } from './rng';
import type { ID, Person, WorldState } from './types';
import { allBuildings, buildingDoor } from './world';

export function availableOfficial(w: WorldState, id: ID, role: 'judge' | 'da'): Person | undefined {
  const p = w.people[id];
  return p?.role === role && p.status === 'active' ? p : undefined;
}

/** Fill vacant civic posts at weekly settlement. A murdered/retired official
 * must not leave the courts assigning undefined IDs or the city with no ballot.
 * New officials have their own identity, opinions and bribe history.
 */
export function ensureCourtOfficials(w: WorldState, rng: Rng): void {
  for (const role of ['judge', 'da'] as const) {
    const key = role === 'judge' ? 'judgeIds' : 'daIds';
    const roster = [...new Set(w[key])].filter(id => availableOfficial(w, id, role));
    if (roster.length < 4) {
      const court = allBuildings(w).find(b => b.typeId === 'courthouse');
      const pos = court ? buildingDoor(w, court) : { x: 8, y: 8 };
      while (roster.length < 4) roster.push(createPerson(w, rng, role, pos, { quality: 1.1 }).id);
    }
    w[key] = roster;
  }
}
