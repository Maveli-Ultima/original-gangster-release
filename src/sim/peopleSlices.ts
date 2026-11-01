import type { Person, WorldState } from './types';

/**
 * The city's people in slices by id (sim.ts runs the walking a slice at a
 * time), each in id order. People are only ever added (citygen createPerson,
 * which takes the next id), so the lists are rebuilt when `nextId` moves and
 * otherwise reused: a slice walks its own sixth of the city instead of
 * testing all 8,000 people for membership.
 */
const cache = new WeakMap<WorldState['people'], { nextId: number; count: number; lists: Person[][] }>();

export function peopleSlice(w: WorldState, index: number, count: number): Person[] {
  let c = cache.get(w.people);
  if (!c || c.nextId !== w.nextId || c.count !== count) {
    const lists: Person[][] = Array.from({ length: count }, () => []);
    for (const key in w.people) { const p = w.people[key]; lists[p.id % count].push(p); }
    c = { nextId: w.nextId, count, lists };
    cache.set(w.people, c);
  }
  return c.lists[index];
}
