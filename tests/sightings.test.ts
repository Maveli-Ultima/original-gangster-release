import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { CELL } from '../src/sim/constants';
import { ORIGINAL_CELL_METRES } from '../src/sim/fireRoll';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { looksThisMinute, SIGHT_CELLS, tickSightings } from '../src/sim/systems/sightings';
import { buildingDoor } from '../src/sim/world';
import type { Person, WorldState } from '../src/sim/types';

// The original's tip line (0x481000) from its two passive sightings: one of
// the player's men in the street (0x6F66E0) and a protected business (0x5A3C90).
// Reach, view and cadence: tests/original-sightings-view.test.ts.
function setup() {
  const w: WorldState = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 }).world;
  const player = Object.values(w.gangs).find(g => g.isPlayer)!;
  const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
  const people = Object.values(w.people);
  const mine = people.find(p => p.gangId === player.id && p.role === 'hood')!;
  const theirs = people.find(p => p.gangId === rival.id && p.role === 'hood')!;
  player.knownPeople = player.knownPeople.filter(id => id !== theirs.id);
  // Everyone else indoors, so only these two are about.
  for (const p of people) if (p !== mine && p !== theirs && p.gangId != null) p.buildingId = p.buildingId ?? -1;
  for (const p of [mine, theirs]) {
    p.status = 'active'; p.buildingId = null; p.inVehicle = false; p.path = []; p.dest = null; p.halted = false;
  }
  while (!looksThisMinute(w, mine)) w.minute++;
  return { w, player, mine, theirs };
}
const at = (p: Person, x: number, y: number) => { p.pos = { x, y }; };
/** A point on the north-south street west of block column 1, `cells` cells down. */
const street = (cells: number) => ({ x: CELL + 2, y: CELL + 2 + cells * ORIGINAL_CELL_METRES });
/** He has not just walked into any cell: no business sees him arrive. */
const standing = (p: Person) => new Map([[p.id, `${Math.floor(p.pos.x / ORIGINAL_CELL_METRES)},${Math.floor(p.pos.y / ORIGINAL_CELL_METRES)}`]]);

describe('sightings: "I\'ve just seen %s moving round here!"', () => {
  it('one of the gang\'s men in sight names a rival hood, with where he is', () => {
    const { w, player, mine, theirs } = setup();
    mine.skills.intelligence = 5; theirs.skills.stealth = 0.5;
    const s = street(0); at(mine, s.x, s.y);
    const far = street(SIGHT_CELLS + 1); at(theirs, far.x, far.y);
    tickSightings(w, new Rng(1), standing(theirs));
    expect(player.knownPeople).not.toContain(theirs.id);
    const near = street(SIGHT_CELLS - 1); at(theirs, near.x, near.y);
    tickSightings(w, new Rng(1), standing(theirs));
    expect(player.knownPeople).toContain(theirs.id);
    const msg = w.messages[w.messages.length - 1];
    expect(msg.text).toContain(`I've just seen ${theirs.name} moving round here!`);
    expect(msg.personId).toBe(theirs.id);
    expect(msg.pos).toEqual(theirs.pos);
  });

  it('a dull spotter often misses a stealthy man; a sharp one never does', () => {
    const { w, player, mine, theirs } = setup();
    const a = street(0), b = street(1);
    at(mine, a.x, a.y); at(theirs, b.x, b.y);
    theirs.skills.stealth = 5;
    const tries = (intelligence: number) => {
      mine.skills.intelligence = intelligence;
      let seen = 0;
      for (let i = 0; i < 200; i++) {
        player.knownPeople = player.knownPeople.filter(id => id !== theirs.id);
        tickSightings(w, new Rng(i + 1), standing(theirs));
        if (player.knownPeople.includes(theirs.id)) seen++;
      }
      return seen;
    };
    // Stealth 63 against rand % 63 + 26 (half a star of Intelligence): seen
    // when the roll reaches 38, 25 times in 63.
    expect(tries(0.5)).toBeGreaterThan(50);
    expect(tries(0.5)).toBeLessThan(110);
    expect(tries(2)).toBe(200);
  });

  it('a business the gang protects sees a rival walk into its door\'s cell', () => {
    const { w, player, mine, theirs } = setup();
    mine.buildingId = -1;                              // nobody of ours about
    const shop = Object.values(w.buildings).find(b => b.protection?.gangId === player.id)!;
    expect(shop).toBeTruthy();
    for (const b of Object.values(w.buildings)) if (b !== shop && b.protection?.gangId === player.id) b.protection = null;
    const door = buildingDoor(w, shop);
    theirs.skills.stealth = 0.5;
    at(theirs, door.x + 4 * ORIGINAL_CELL_METRES, door.y);
    tickSightings(w, new Rng(3));
    expect(player.knownPeople).not.toContain(theirs.id);
    const away = `${Math.floor(theirs.pos.x / ORIGINAL_CELL_METRES)},${Math.floor(theirs.pos.y / ORIGINAL_CELL_METRES)}`;
    at(theirs, door.x, door.y);
    tickSightings(w, new Rng(3), new Map([[theirs.id, away]]));
    expect(player.knownPeople).toContain(theirs.id);
    expect(w.messages[w.messages.length - 1].text).toMatch(/^The .*: "I've just seen/);
  });

  it('a man already known is not reported again', () => {
    const { w, player, mine, theirs } = setup();
    const a = street(0), b = street(1);
    at(mine, a.x, a.y); at(theirs, b.x, b.y);
    mine.skills.intelligence = 5;
    tickSightings(w, new Rng(1), standing(theirs));
    const n = w.messages.length;
    tickSightings(w, new Rng(2), standing(theirs));
    expect(w.messages.length).toBe(n);
    expect(player.knownPeople.filter(id => id === theirs.id)).toHaveLength(1);
  });
});
