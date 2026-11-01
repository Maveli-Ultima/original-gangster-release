import type { Building, Person, WorldState } from './types';

/**
 * Shared, read-only lists of the city's people and buildings, in id order
 * (the order Object.values gives). The simulation and renderer scan them many
 * times a tick; copying 8,000 people into a fresh array each time was a
 * steady stream of garbage. People and buildings take their ids from
 * `nextId` and are only added during play, so a list is rebuilt when
 * `nextId` moves; city generation, which also removes buildings, clears the
 * lists when it finishes (forgetEntityLists).
 *
 * Callers must not change the array (sort, push, splice): filter or copy first.
 */
const people = new WeakMap<WorldState['people'], { nextId: number; list: Person[] }>();
const buildings = new WeakMap<WorldState['buildings'], { nextId: number; list: Building[] }>();

export function peopleList(w: WorldState): readonly Person[] {
  const c = people.get(w.people);
  if (c && c.nextId === w.nextId) return c.list;
  const list = Object.values(w.people);
  people.set(w.people, { nextId: w.nextId, list });
  return list;
}

export function buildingList(w: WorldState): readonly Building[] {
  const c = buildings.get(w.buildings);
  if (c && c.nextId === w.nextId) return c.list;
  const list = Object.values(w.buildings);
  buildings.set(w.buildings, { nextId: w.nextId, list });
  return list;
}

/** City generation removes buildings without moving nextId: start the lists afresh. */
export function forgetEntityLists(w: WorldState): void {
  people.delete(w.people);
  buildings.delete(w.buildings);
}
