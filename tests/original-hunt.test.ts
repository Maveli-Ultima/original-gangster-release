import { describe, expect, it } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { issueOrder } from '../src/sim/api';
import { setAttitude } from '../src/sim/attitudes';
import { createWorld } from '../src/sim/citygen';
import { ORIGINAL_CELL_METRES } from '../src/sim/fireRoll';
import { Rng } from '../src/sim/rng';
import { MINUTES_PER_SECOND, Sim } from '../src/sim/sim';
import {
  askAtHall, HUNT_NEAR_CELLS, HUNT_PRESS_CELLS, huntGuide, nearestHall, originalHuntArrived, originalHuntFinds,
} from '../src/sim/systems/originalHunt';
import { allBuildings, buildingDoor, dist } from '../src/sim/world';
import type { Building, Order, Person, WorldState } from '../src/sim/types';

// Traced 28 October 2026: the chase step 0x5DE990 searches with 0x4E2130
// (where to head) and asks with 0x4E1F00 (the unattached hoods at a pool hall
// or gym); docs/audit/2026-10-28/hunt/review.md.
function setup() {
  const w: WorldState = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
  expect(w.cityLayout?.original).toBeTruthy();
  const player = Object.values(w.gangs).find(g => g.isPlayer)!;
  const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
  const people = Object.values(w.people);
  const crew = people.filter(p => p.gangId === player.id && p.role === 'hood').slice(0, 2);
  const target = people.find(p => p.gangId === rival.id && p.role === 'hood')!;
  player.knownPeople = player.knownPeople.filter(id => id !== target.id);
  for (const p of [...crew, target]) {
    p.status = 'active'; p.buildingId = null; p.inVehicle = false; p.path = []; p.dest = null; p.halted = false;
  }
  const halls = allBuildings(w).filter(b => b.state === 'trading' && (b.typeId === 'poolHall' || b.typeId === 'gym'));
  expect(halls.length).toBeGreaterThan(3);
  const order = { id: 9999, gangId: player.id, huntVisitedIds: [] } as unknown as Order;
  return { w, player, rival, crew, target, halls, order };
}

/** One unattached hood standing in `hall`, neutral to both gangs unless told otherwise. */
function informant(w: WorldState, hall: Building, mine: number, theirs: number, rivalId: number, playerId: number): Person {
  for (const p of Object.values(w.people)) if (p.buildingId === hall.id && p.gangId == null) p.buildingId = null;
  const p = Object.values(w.people).find(q => q.role === 'hood' && q.gangId == null)!;
  p.status = 'active'; p.buildingId = hall.id;
  setAttitude(p, playerId, { hostility: mine, fear: 0 });
  setAttitude(p, rivalId, { hostility: theirs, fear: 0 });
  return p;
}

describe('asking at a pool hall or gym (0x4E1F00)', () => {
  it('scores each unattached hood on attitude, the man\'s Stealth and the crew\'s Intimidation', () => {
    const { w, player, rival, crew, target, halls } = setup();
    const hall = halls[0];
    target.skills.stealth = 0.5; // byte 6, >> 2 = 1
    informant(w, hall, 128, 128, rival.id, player.id); // effective 192 both ways: no lean
    // Intimidation 5 stars (63): 63 − 1 = 62 ≥ 48, he is placed exactly.
    for (const p of crew) p.skills.intimidation = 5;
    expect(askAtHall(w, hall, crew, target, player.id)).toBe(2);
    // The best of the crew counts: one hard man is enough.
    crew[1].skills.intimidation = 0.5;
    expect(askAtHall(w, hall, crew, target, player.id)).toBe(2);
    // 3 stars (38): 37, above 16 but under 48, only the direction.
    for (const p of crew) p.skills.intimidation = 3;
    expect(askAtHall(w, hall, crew, target, player.id)).toBe(1);
    // 1 star (13): 12, nobody talks.
    for (const p of crew) p.skills.intimidation = 1;
    expect(askAtHall(w, hall, crew, target, player.id)).toBe(0);
    // An informant who hates the other gang talks: (255 − 128 = 127) / 8 → 15, 12 + 15 = 27.
    informant(w, hall, 0, 255, rival.id, player.id);
    expect(askAtHall(w, hall, crew, target, player.id)).toBe(1);
    // A stealthy man (5 stars, 63 >> 2 = 15) is harder to place.
    target.skills.stealth = 5;
    expect(askAtHall(w, hall, crew, target, player.id)).toBe(0);
  });

  it('nobody to ask, nothing learnt', () => {
    const { w, player, crew, target, halls } = setup();
    const hall = halls[0];
    for (const p of Object.values(w.people)) if (p.buildingId === hall.id && p.gangId == null) p.buildingId = null;
    for (const p of crew) p.skills.intimidation = 5;
    expect(askAtHall(w, hall, crew, target, player.id)).toBe(0);
  });
});

describe('where the hunt heads (0x4E2130, 0x60B950)', () => {
  it('within 15 cells, straight to where he is', () => {
    const { w, crew, target, order } = setup();
    target.pos = { x: crew[0].pos.x + (HUNT_NEAR_CELLS - 1) * ORIGINAL_CELL_METRES, y: crew[0].pos.y };
    expect(huntGuide(w, order, crew[0].pos, crew[0], target)).toEqual({ pos: target.pos });
  });

  it('further off, the hall nearest a point Intelligence / 256 of the way to him', () => {
    const { w, crew, target, halls, order } = setup();
    // The two halls furthest apart: the crew at one, the man at the other.
    let a = halls[0], b = halls[1];
    for (const x of halls) for (const y of halls)
      if (dist(w.lots[x.lotId].center, w.lots[y.lotId].center) > dist(w.lots[a.lotId].center, w.lots[b.lotId].center)) { a = x; b = y; }
    crew[0].pos = { ...w.lots[a.lotId].center };
    target.pos = { ...w.lots[b.lotId].center };
    crew[0].skills.intelligence = 0.5; // byte 26: about a tenth of the way
    const dull = huntGuide(w, { ...order, huntVisitedIds: [] }, crew[0].pos, crew[0], target);
    crew[0].skills.intelligence = 5; // byte 255: all but the last 1/256
    const sharp = huntGuide(w, { ...order, huntVisitedIds: [] }, crew[0].pos, crew[0], target);
    expect('hallId' in dull && 'hallId' in sharp).toBe(true);
    const far = (g: typeof dull) => dist(w.lots[w.buildings[(g as { hallId: number }).hallId].lotId].center, target.pos);
    expect(far(sharp)).toBeLessThan(far(dull));
    expect((sharp as { hallId: number }).hallId).toBe(b.id);
  });

  it('never sends the order to the same hall twice until every one has been visited', () => {
    const { w, crew, halls, order } = setup();
    const seen = new Set<number>();
    for (let i = 0; i < halls.length; i++) seen.add(nearestHall(w, order, crew[0].pos)!.id);
    expect(seen.size).toBe(halls.length);
    // All visited: the set is cleared and the round starts again from the nearest.
    const again = nearestHall(w, order, crew[0].pos)!;
    expect(order.huntVisitedIds).toEqual([again.id]);
  });
});

describe('the hunt\'s legs (0x5DE990)', () => {
  it('an exact answer sends the crew to where he is, not a blurred tip; not there, they press 20 cells on', () => {
    const { w, player, rival, crew, target, halls, order } = setup();
    const hall = halls[0];
    informant(w, hall, 128, 128, rival.id, player.id);
    for (const p of crew) { p.skills.intimidation = 5; p.pos = buildingDoor(w, hall); }
    target.skills.stealth = 0.5;
    target.pos = { x: crew[0].pos.x + 60 * ORIGINAL_CELL_METRES, y: crew[0].pos.y };
    order.huntHallId = hall.id;
    expect(originalHuntArrived(w, order, crew, target)).toMatch(/was told where/);
    expect(order.huntTip).toEqual(target.pos);
    expect(order.huntLeg).toBe('told');
    // He has moved on; they reach the spot and press on towards him.
    const told = { ...order.huntTip! };
    for (const p of crew) p.pos = { ...told };
    target.pos = { x: told.x + 100 * ORIGINAL_CELL_METRES, y: told.y };
    originalHuntArrived(w, order, crew, target);
    expect(order.huntLeg).toBe('press');
    expect(dist(order.huntTip!, told)).toBeCloseTo(HUNT_PRESS_CELLS * ORIGINAL_CELL_METRES, 6);
    expect(order.huntTip!.y).toBeCloseTo(told.y, 6);
    // Then the search again, from there.
    for (const p of crew) p.pos = { ...order.huntTip! };
    originalHuntArrived(w, order, crew, target);
    expect(order.huntLeg === 'near' || order.huntHallId != null).toBe(true);
  });

  it('nobody talks: on to the nearest hall not yet visited', () => {
    const { w, crew, target, halls, order } = setup();
    const hall = halls[0];
    for (const p of Object.values(w.people)) if (p.buildingId === hall.id && p.gangId == null) p.buildingId = null;
    for (const p of crew) p.pos = buildingDoor(w, hall);
    target.pos = { x: crew[0].pos.x + 60 * ORIGINAL_CELL_METRES, y: crew[0].pos.y };
    order.huntVisitedIds = [hall.id];
    order.huntHallId = hall.id;
    expect(originalHuntArrived(w, order, crew, target)).toBeNull();
    expect(order.huntHallId).not.toBe(hall.id);
    expect(order.huntHallId).toBe(nearestHall(w, { ...order, huntVisitedIds: [hall.id] } as Order, crew[0].pos)!.id);
  });
});

describe('finding him (0x6F6EB0)', () => {
  it('the gang learning of him, or his being in the building at whose door they stand', () => {
    const { w, player, crew, target, halls, order } = setup();
    const rng = new Rng(1);
    target.pos = { x: crew[0].pos.x + 300, y: crew[0].pos.y };
    expect(originalHuntFinds(w, rng, order, crew, target)).toBeNull();
    target.buildingId = halls[0].id;
    for (const p of crew) p.pos = buildingDoor(w, halls[0]);
    expect(originalHuntFinds(w, rng, order, crew, target)).toBe(crew[0]);
    target.buildingId = null;
    target.pos = { x: crew[0].pos.x + 300, y: crew[0].pos.y };
    player.knownPeople.push(target.id);
    expect(originalHuntFinds(w, rng, order, crew, target)).toBe(crew[0]);
  });
});

describe('a hunt in the original city', () => {
  it('sets out for a pool hall or gym and never waits to ask or blurs a tip', () => {
    const sim = new Sim({ ...newCampaignOptions(), seed: 404, startMoney: 100_000 });
    const w = sim.world, gang = sim.playerGang;
    expect(w.cityLayout?.original).toBeTruthy();
    w.orders = {};
    for (const team of Object.values(w.teams)) { team.orderIds = []; team.timeUsed = 0; }
    const rival = Object.values(w.people).find(p => p.gangId != null && p.gangId !== gang.id && p.role === 'hood')!;
    gang.knownPeople = gang.knownPeople.filter(id => id !== rival.id);
    const team = w.teams[gang.teamIds[0]];
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'assault', personId: rival.id, opts: { manpower: 1, priority: true } }).ok).toBe(true);
    const order = Object.values(w.orders).find(o => o.type === 'assault') as Order;
    sim.launchWeek();
    expect(order.hunting).toBe(true);
    expect(order.huntHallId != null || order.huntLeg === 'near').toBe(true);
    let visited = order.huntVisitedIds!.length;
    for (let i = 0; i < 600 && order.hunting && order.state === 'travelling'; i++) {
      sim.advance(1 / MINUTES_PER_SECOND, 1);
      expect(order.huntAsking).toBeUndefined();
      visited = Math.max(visited, order.huntVisitedIds?.length ?? 0);
    }
    expect(visited).toBeGreaterThan(0);
  });
});
