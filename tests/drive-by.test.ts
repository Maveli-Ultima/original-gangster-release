import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { clearStreetOrder, issueOrder, issueStreetOrder } from '../src/sim/api';
import { inAmbushArea } from '../src/sim/ambush';
import { CELL, LANE_OFFSET, MINUTES_PER_WEEK } from '../src/sim/constants';
import { killPerson } from '../src/sim/execution';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { allocateTransport, stepOut, tryBoard } from '../src/sim/transport';
import { onRoad } from '../src/sim/vehicleNavigation';
import { allocateWeapons } from '../src/sim/weapons';
import { allBuildings, buildingDoor } from '../src/sim/world';
import type { Order } from '../src/sim/types';

function fixture(seed = 404) {
  const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 10, startMoney: 100_000, startHoods: 8 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  w.orders = {};
  for (const crew of Object.values(w.teams)) { crew.orderIds = []; crew.timeUsed = 0; }
  return { sim, w, gang, team };
}
const rivalHood = (w: ReturnType<typeof fixture>['w'], gangId: number) => {
  const rival = Object.values(w.gangs).find(g => g.id !== gangId)!;
  return w.people[w.teams[rival.teamIds[0]].memberIds[0]];
};
/** Seat the crew in one car, the first man at the wheel, on the road. */
function inCar(s: ReturnType<typeof fixture>, ids: number[]) {
  s.team.vehicles = { coupe: 1, truck: 0, speedster: 0 };
  const people = ids.map(id => s.w.people[id]);
  const office = allBuildings(s.w).find(b => b.isHQ && b.ownerGangId === s.gang.id)!;
  for (const p of people) p.pos = buildingDoor(s.w, office);
  allocateTransport(s.w, s.team, people, { x: 9 * CELL, y: 9 * CELL }, -1, 'goTo');
  const car = s.w.vehicleFleet![people[0].vehicleKey!];
  tryBoard(s.w, car);
  expect(people.every(p => p.inVehicle)).toBe(true);
  return car;
}

describe('attacking from cars', () => {
  it('a Kill order whose man is shot dead on the way is done, not failed', () => {
    const s = fixture(), victim = rivalHood(s.w, s.gang.id);
    s.gang.knownPeople.push(victim.id);
    expect(issueOrder(s.w, s.gang.id, { teamId: s.team.id, type: 'kill', personId: victim.id, opts: { priority: true, manpower: 1 } }).ok).toBe(true);
    const order = s.w.orders[s.team.orderIds[0]] as Order;
    s.sim.launchWeek();
    for (let i = 0; i < 30 && order.state !== 'travelling'; i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    killPerson(s.w, victim, 'shot in a street fight');
    for (let i = 0; i < 5 && !['done', 'failed'].includes(order.state); i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(order.state).toBe('done');
    expect(order.completedTargets).toBe(1);
  });

  it('when the driver is called off, his passengers on the same street order go on foot', () => {
    const s = fixture(), a = s.team.memberIds[0], b = s.team.lieutenantId;
    const car = inCar(s, [a, b]);
    const target = rivalHood(s.w, s.gang.id);
    s.w.phase = 'week';
    expect(issueStreetOrder(s.w, s.gang.id, [a, b], 'kill', target.id, null).ok).toBe(true);
    clearStreetOrder(s.w, [car.driverId!]);
    const passenger = s.w.people[car.driverId === a ? b : a];
    expect(passenger.inVehicle).toBe(false);
    expect(passenger.streetOrder?.type).toBe('kill');
    expect(onRoad(s.w, passenger.pos)).toBe(false);
  });

  it('a street order to a hood walking to his car releases the car', () => {
    const s = fixture(), [a] = s.team.memberIds, hood = s.w.people[a];
    s.team.vehicles = { coupe: 1, truck: 0, speedster: 0 };
    hood.pos = { x: 2 * CELL + 20, y: 2 * CELL - 9 };
    allocateTransport(s.w, s.team, [hood], { x: 9 * CELL, y: 9 * CELL }, -1, 'goTo');
    expect(hood.vehicleKey).toBeDefined(); expect(hood.inVehicle).toBe(false);
    s.w.phase = 'week';
    expect(issueStreetOrder(s.w, s.gang.id, [a], 'goTo', null, { x: 3 * CELL + 20, y: 3 * CELL - 9 }).ok).toBe(true);
    expect(hood.vehicleKey).toBeUndefined();
  });

  it('a man who steps out to throw stays out for the throw', () => {
    const s = fixture(), [a] = s.team.memberIds;
    const car = inCar(s, [a]);
    stepOut(s.w, s.w.people[a], { x: car.pos.x + 5, y: car.pos.y });
    tryBoard(s.w, car);
    expect(s.w.people[a].inVehicle).toBe(false);
    s.w.minute += 5;
    s.w.people[a].pos = { ...car.pos };
    tryBoard(s.w, car);
    expect(s.w.people[a].inVehicle).toBe(true);
  });

  it('the accountant and the lawyer draw no gun', () => {
    const s = fixture(), p = s.w.people[s.team.memberIds[0]];
    s.gang.weapons.pistol = 5;
    p.role = 'accountant'; p.teamId = null;
    expect(allocateWeapons(s.w).has(p.id)).toBe(false);
  });

  it('a man killed in a car falls on the pavement, not in the lane', () => {
    const s = fixture(), [a] = s.team.memberIds;
    inCar(s, [a]);
    killPerson(s.w, s.w.people[a], 'shot');
    expect(onRoad(s.w, s.w.people[a].pos)).toBe(false);
  });

  it('a car in the far lane of a street bordering the ambush area is in the area', () => {
    const s = fixture();
    const block = s.w.blocks.find(b => b.gx === 3 && b.gy === 3)!;
    const order = { targetBlockIds: [block.id], targetBuildingIds: [] } as unknown as Order;
    // The street along the block's east side runs at x = 4 * CELL; its far lane is just past it.
    expect(inAmbushArea(s.w, order, { x: 4 * CELL + LANE_OFFSET, y: 3 * CELL + 27 })).toBe(true);
    expect(inAmbushArea(s.w, order, { x: 4 * CELL + 9, y: 3 * CELL + 27 })).toBe(false);
    void MINUTES_PER_WEEK;
  });
});
