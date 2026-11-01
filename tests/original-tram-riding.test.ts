import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { streetPersonVisible } from '../src/render/characterPresentation';
import { createWorld } from '../src/sim/citygen';
import { cityStreetInset } from '../src/sim/cityLayout';
import { CELL, PAVEMENT_OFFSET } from '../src/sim/constants';
import { peopleList } from '../src/sim/entityLists';
import { witnessesNear } from '../src/sim/events';
import { stepPerson } from '../src/sim/movement';
import { validateSaveWorld } from '../src/sim/saveSchema';
import {
  TRAM_BOARD_WAIT, TRAM_CAPACITY, TRAM_RIDING, TRAM_CATCH_EVERY, TRAM_CATCH_FAR, TRAM_CATCH_LEG, TRAM_CATCH_NEAR, tickTramRiding, tramRideable,
} from '../src/sim/tramRiding';
import { TRAM_SPEED, cityTramLines, tramRoute, tramsAt } from '../src/sim/trams';
import type { Person, Vec2, WorldState } from '../src/sim/types';

// Riding the original's street trams (docs/audit/2026-10-29/trams/review.md):
// a walker on a straight leg of at least 0x781 sub-units along an avenue
// catches a tram 0x78..300 sub-units behind him heading his way (0x5DCDF0);
// it stands until he is aboard, with room for 40 (0x6220E0); he keeps its
// place and is set down when it reaches his cell, or at once if it already
// has (0x622410, 0x621020, goal 10 of 0x5D2740).

const base = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
const clone = (w: WorldState): WorldState => JSON.parse(JSON.stringify(w));
const FINE = CELL / 5;

interface Scene { w: WorldState; p: Person; k: number; centre: number; dir: 1 | -1; start: Vec2; dest: Vec2 }

/**
 * A citizen on a footway of the first east-west avenue, `behind` metres ahead
 * of a tram heading `dir`, walking `leg` metres straight on that way, on the
 * minute his check falls due.
 */
interface Setup { behind?: number; leg?: number; dir?: 1 | -1; walk?: 1 | -1; outer?: boolean; offset?: number }
function scene({ behind = 20, leg = 300, dir = 1, walk = dir, outer = false, offset = 0 }: Setup = {}): Scene {
  const w = clone(base);
  const line = cityTramLines(w)[0], centre = line.points[0].y, length = tramRoute(line).length;
  expect(line.points[1].y).toBe(centre);
  const p = peopleList(w).find(q => q.role === 'citizen' && tramRideable(w, q))!;
  w.minute = 600 + (TRAM_CATCH_EVERY - (600 + p.id) % TRAM_CATCH_EVERY) % TRAM_CATCH_EVERY;
  const trams = tramsAt(w, w.minute);
  const k = trams.findIndex(t => t.line === 0 && Math.sign(t.dx) === dir && t.along > 400 && t.along < length - 400);
  const pavement = PAVEMENT_OFFSET + cityStreetInset(w);
  const y = (outer ? centre - CELL / 2 - pavement : centre - CELL / 2 + pavement) + offset;
  const x = trams[k].x + dir * behind;
  p.pos = { x, y };
  p.dest = { x: x + walk * leg, y };
  p.path = [{ ...p.dest }];
  return { w, p, k, centre, dir, start: { ...p.pos }, dest: { ...p.dest } };
}

/** A minute as the sim runs it: the walkers step, then the trams. */
function minute(w: WorldState, p: Person): void {
  w.minute++;
  if (p.dest && p.tram?.phase !== 'riding') stepPerson(p, 1);
  tickTramRiding(w);
}

/** Catch and walk to the tram until aboard. */
function board(s: Scene): number {
  tickTramRiding(s.w);
  expect(s.p.tram?.phase).toBe('boarding');
  let minutes = 0;
  while (s.p.tram?.phase === 'boarding' && minutes < TRAM_BOARD_WAIT) { minute(s.w, s.p); minutes++; }
  return minutes;
}

describe('catching a tram', () => {
  const caught = (s: Scene) => { tickTramRiding(s.w); return s.p.tram; };

  it('catches one 0x78..300 sub-units behind him on a straight leg of 0x781 along an avenue', () => {
    for (const dir of [1, -1] as const) for (const outer of [false, true]) {
      const s = scene({ dir, outer });
      const ride = caught(s);
      expect(ride, `dir ${dir} outer ${outer}`).toMatchObject({ tram: s.k, phase: 'boarding', kerb: s.start.y, dest: s.dest });
      // He gets off where his leg ends (0x622410), along the line from its west end.
      expect(ride!.drop).toBeCloseTo(s.dest.x, 6);
      // Across to the track beside him (over the flanking street first from its far side), then back to the tram.
      const t = tramsAt(s.w, s.w.minute)[s.k], last = s.p.path[s.p.path.length - 1];
      expect(last.x).toBeCloseTo(t.x, 9);
      expect(Math.abs(last.y - t.y)).toBeCloseTo(1.6, 9);
      expect(Math.sign(last.y - t.y)).toBe(-1); // on his (north) side of it
      expect(s.p.dest).toEqual({ x: last.x, y: last.y });
      expect(s.p.path[0].cross != null).toBe(outer);
    }
    expect(TRAM_CATCH_LEG).toBeCloseTo(0x781 * FINE / 96, 9);
    expect([TRAM_CATCH_NEAR, TRAM_CATCH_FAR]).toEqual([0x78 * FINE / 96, 300 * FINE / 96]);
  }, 120000);

  it('only within the window behind him', () => {
    expect(caught(scene({ behind: TRAM_CATCH_NEAR + .5 }))).toBeDefined();
    expect(caught(scene({ behind: TRAM_CATCH_FAR - .5 }))).toBeDefined();
    expect(caught(scene({ behind: TRAM_CATCH_NEAR - .5 }))).toBeUndefined();
    expect(caught(scene({ behind: TRAM_CATCH_FAR + .5 }))).toBeUndefined();
    expect(caught(scene({ behind: -20 }))).toBeUndefined(); // already past him
  }, 120000);

  it('only on a leg of at least 0x781 sub-units, along the avenue, the tram heading his way', () => {
    expect(caught(scene({ leg: TRAM_CATCH_LEG + 1 }))).toBeDefined();
    expect(caught(scene({ leg: TRAM_CATCH_LEG - 1 }))).toBeUndefined();
    // The next street out is not the avenue.
    expect(caught(scene({ offset: -CELL }))).toBeUndefined();
    // Walking west with an eastbound tram behind him: no westbound one is there.
    const s = scene({ walk: -1, behind: -20 });
    const westbound = tramsAt(s.w, s.w.minute).filter(t => t.line === 0 && t.dx < 0)
      .map(t => t.x - s.start.x).filter(d => d > TRAM_CATCH_NEAR && d < TRAM_CATCH_FAR);
    expect(westbound).toEqual([]);
    expect(caught(s)).toBeUndefined();
  }, 120000);

  it('only on foot, a citizen about his own business, on his minute', () => {
    const car = scene(); car.p.inVehicle = true;
    expect(caught(car)).toBeUndefined();
    const officer = scene(); officer.p.role = 'police';
    expect(caught(officer)).toBeUndefined();
    const ordered = scene(); ordered.p.streetOrder = { type: 'goTo', targetPersonId: null, pos: ordered.dest };
    expect(caught(ordered)).toBeUndefined();
    const late = scene(); late.w.minute++;
    expect(caught(late)).toBeUndefined();
    // Part way over a road.
    const road = scene(); road.p.path[0].cross = 300 + 5;
    expect(caught(road)).toBeUndefined();
  }, 120000);

  it('takes no more than forty aboard', () => {
    const full = (n: number) => {
      const s = scene(), t = tramsAt(s.w, s.w.minute)[s.k];
      const others = peopleList(s.w).filter(q => q !== s.p && tramRideable(s.w, q)).slice(0, n);
      expect(others).toHaveLength(n);
      for (const q of others) {
        q.tram = { tram: s.k, phase: 'riding', drop: t.along + 300, kerb: s.start.y, dest: { ...q.pos }, since: 0 };
        q.dest = null; q.path = [];
      }
      const ride = caught(s);
      expect(others.every(q => q.tram?.phase === 'riding' && q.pos.x === t.x && q.pos.y === t.y)).toBe(true);
      return ride;
    };
    expect(TRAM_CAPACITY).toBe(40);
    expect(full(TRAM_CAPACITY - 1)).toBeDefined();
    expect(full(TRAM_CAPACITY)).toBeUndefined();
  }, 120000);
});

describe('riding a tram', () => {
  it('stands for him until he is aboard, then runs on that many minutes behind', () => {
    const s = scene(), { w, p, k } = s;
    tickTramRiding(w);
    expect(w.trams!.halted[k]).toBe(true);
    const stood = tramsAt(w, w.minute)[k];
    // Another on the line, well clear of its ends.
    const length = tramRoute(cityTramLines(w)[0]).length;
    const other = tramsAt(w, w.minute).findIndex((t, i) => i !== k && t.line === 0 && t.along > 300 && t.along < length - 300);
    let minutes = 0;
    while (p.tram?.phase === 'boarding' && minutes < TRAM_BOARD_WAIT) {
      // Standing, even part way through the minute; the others run on.
      const half = tramsAt(w, w.minute + .5), now = tramsAt(w, w.minute);
      expect([half[k].x, half[k].y]).toEqual([stood.x, stood.y]);
      expect(half[k].halted).toBe(true);
      expect(Math.abs(half[other].along - now[other].along)).toBeCloseTo(TRAM_SPEED / 2, 9);
      minute(w, p);
      minutes++;
    }
    expect(p.tram?.phase).toBe('riding');
    expect(minutes).toBeGreaterThan(20);
    // The halt ends as he gets in (0x622410); the tram is as many minutes behind as it stood.
    expect(w.trams!.halted[k]).toBe(false);
    expect(w.trams!.delay[k]).toBe(minutes);
    expect(w.trams!.delay.filter((_, i) => i !== k).every(d => d === 0)).toBe(true);
    // Aboard he keeps the tram's place, hidden from the street and from witnessing.
    for (let i = 0; i < 30; i++) {
      minute(w, p);
      const t = tramsAt(w, w.minute)[k];
      expect(p.pos).toEqual({ x: t.x, y: t.y });
      expect(t.along - stood.along).toBeCloseTo((i + 1) * TRAM_SPEED, 6);
    }
    expect(p.dest).toBeNull();
    expect(streetPersonVisible(p, null)).toBe(false);
    expect(streetPersonVisible(p, p.id)).toBe(false);
    expect(witnessesNear(w, p.pos, 5, [])).not.toContain(p);
  }, 120000);

  it('sets him down when the tram reaches his cell, without stopping, and he walks on', () => {
    const s = scene(), { w, p, k } = s;
    board(s);
    const drop = p.tram!.drop;
    let guard = 0;
    while (p.tram && guard++ < 2000) minute(w, p);
    expect(p.tram).toBeUndefined();
    const t = tramsAt(w, w.minute)[k];
    expect(Math.floor(t.along / FINE)).toBe(Math.floor(drop / FINE));
    expect(w.trams!.halted[k]).toBe(false);
    // Beside the tram on his side, then over to his footway and on to where he was going.
    expect(p.pos.x).toBeCloseTo(t.x, 9);
    expect(p.pos.y).toBeCloseTo(t.y - 1.6, 9);
    expect(p.path[0]).toEqual({ x: t.x, y: s.start.y });
    expect(p.dest).toEqual(s.dest);
    for (let i = 0; i < 2000 && p.dest; i++) stepPerson(p, 1);
    expect(p.pos).toEqual(s.dest);
  }, 120000);

  it('sets him down at once when the tram is already at or past his cell', () => {
    for (const back of [0, 30]) {
      const s = scene(), { w, p, k } = s;
      tickTramRiding(w);
      p.tram!.drop = tramsAt(w, w.minute)[k].along - back;
      let minutes = 0;
      while (p.tram && minutes < TRAM_BOARD_WAIT) { minute(w, p); minutes++; }
      expect(p.tram).toBeUndefined();
      expect(minutes).toBeLessThan(TRAM_BOARD_WAIT);
      expect(w.trams!.halted[k]).toBe(false);
      const t = tramsAt(w, w.minute)[k];
      expect(p.pos.x).toBeCloseTo(t.x, 9);
      expect(p.dest).toEqual(s.dest);
    }
  }, 120000);

  it('keeps a tram closing on one that stands waiting behind it', () => {
    const s = scene(), { w, k } = s;
    tickTramRiding(w);
    const trams = tramsAt(w, w.minute), loop = tramRoute(cityTramLines(w)[0]).loop;
    // The tram behind it round the loop, brought up to 10 m short of it.
    const behind = trams.map((t, i) => ({ i, gap: ((trams[k].loop - t.loop) % loop + loop) % loop }))
      .filter(({ i }) => i !== k && trams[i].line === 0).sort((a, b) => a.gap - b.gap)[0];
    w.trams!.delay[behind.i] = -(behind.gap - 10) / TRAM_SPEED;
    w.minute++;
    tickTramRiding(w);
    expect(w.trams!.halted[k]).toBe(true);
    expect(w.trams!.halted[behind.i]).toBe(true);
  }, 120000);
});

describe('tram riding and the save', () => {
  it('saves and loads mid-ride and plays on exactly', () => {
    const s = scene(), { w, p } = s;
    tickTramRiding(w);
    for (let i = 0; i < 30; i++) minute(w, p);
    expect(p.tram?.phase).toBe('boarding');
    for (const at of ['boarding', 'riding']) {
      if (at === 'riding') while (p.tram?.phase === 'boarding') minute(w, p);
      expect(p.tram?.phase).toBe(at);
      expect(() => validateSaveWorld(clone(w))).not.toThrow();
      const copy = clone(w), q = copy.people[p.id];
      const a = clone(w), pa = a.people[p.id];
      for (let i = 0; i < 400; i++) { minute(a, pa); minute(copy, q); }
      expect(JSON.stringify(copy)).toBe(JSON.stringify(a));
      expect(pa.tram).toBeUndefined(); // set down by then
    }
    const bad = clone(w);
    bad.people[p.id].tram!.tram = 999;
    expect(() => validateSaveWorld(bad)).toThrow(/tram ride/);
    const short = clone(w);
    short.trams!.delay.pop();
    expect(() => validateSaveWorld(short)).toThrow(/tram timetable/);
  }, 120000);

  it('saves nothing while nobody rides, and carries no one in a compact city', () => {
    // As shipped, nobody rides: the game never calls the riding tick.
    expect(TRAM_RIDING).toBe(false);
    const w = clone(base);
    for (let i = 0; i < 30; i++) { w.minute++; tickTramRiding(w); }
    expect(w.trams).toBeUndefined();
    expect(tramsAt(w, w.minute)).toEqual(tramsAt(base, w.minute));
    const compact = createWorld({ ...defaultGameOptions(), seed: 7 }).world;
    const before = JSON.stringify(compact);
    for (let i = 0; i < 30; i++) { compact.minute++; tickTramRiding(compact); compact.minute--; }
    expect(JSON.stringify(compact)).toBe(before);
  }, 120000);
});
