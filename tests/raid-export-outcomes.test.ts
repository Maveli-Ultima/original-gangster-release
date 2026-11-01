import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder } from '../src/sim/api';
import { killPerson } from '../src/sim/execution';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { typeOf } from '../src/sim/world';
import type { Order } from '../src/sim/types';
import { staffFirstCrew } from './helpers/crew';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startHoods: 8, startMoney: 100000 });
  staffFirstCrew(sim);
  const w = sim.world, g = sim.playerGang, t = w.teams[g.teamIds[0]];
  w.orders = {}; for (const team of Object.values(w.teams)) { team.orderIds = []; team.timeUsed = 0; }
  t.vehicles = { coupe: 0, truck: 1, speedster: 0 };
  const warehouses = Object.values(w.buildings).filter(b => b.typeId === 'warehouse');
  for (const b of warehouses) b.ownerGangId = null;
  warehouses[0].ownerGangId = g.id; warehouses[0].stock = { liquor: 0, stolen: 0, counterfeit: 0 };
  for (const id of [t.lieutenantId, ...t.memberIds]) for (const key of Object.keys(w.people[id].skills) as (keyof typeof w.people[number]['skills'])[]) w.people[id].skills[key] = 5;
  return { sim, w, g, t, store: warehouses[0], target: warehouses[1] };
}
function raid(s: ReturnType<typeof fixture>): Order {
  s.target.stock = { liquor: 60, stolen: 0, counterfeit: 0 };
  expect(issueOrder(s.w, s.g.id, { teamId: s.t.id, type: 'raid', buildingIds: [s.target.id], opts: { manpower: 1 } }).ok).toBe(true);
  const o = s.w.orders[s.t.orderIds.at(-1)!];
  s.sim.launchWeek();
  return o;
}
const until = (s: ReturnType<typeof fixture>, test: () => boolean, max = 1600) => { for (let i = 0; i < max && !test(); i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1); expect(test()).toBe(true); };

describe('raid and export outcomes', () => {
  it('a botched raid has failed, not been done', () => {
    const s = fixture();
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    const o = raid(s);
    until(s, () => o.state === 'done' || o.state === 'failed');
    expect(o.state).toBe('failed');
    expect(o.failReason).toMatch(/botched/);
    expect(o.completedTargets).toBe(0);
  });

  it('a raid whose haul was taken is done, even when its delivery is cut short', () => {
    const s = fixture();
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    vi.spyOn(s.sim.rng, 'pick').mockImplementation((items) => items.includes('liquor') ? 'liquor' : items[0]);
    const o = raid(s);
    until(s, () => !!o.raidDelivery);
    expect(o.completedTargets).toBe(1);
    for (const id of o.assignedIds) killPerson(s.w, s.w.people[id], 'shot');
    until(s, () => o.state === 'done' || o.state === 'failed', 20);
    expect(o.state).toBe('done');
    expect(o.failReason).toBeTruthy();
    expect(o.completedTargets).toBe(1);
  });

  it('a raid delivered in full counts its target once', () => {
    const s = fixture();
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    vi.spyOn(s.sim.rng, 'pick').mockImplementation((items) => items.includes('liquor') ? 'liquor' : items[0]);
    const o = raid(s);
    until(s, () => o.state === 'done' || o.state === 'failed');
    expect(o.state).toBe('done');
    expect(o.failReason).toBeNull();
    expect(o.completedTargets).toBe(1);
    expect(typeOf(s.target)).toBeTruthy();
  });

  it('a smash-up that never got in has failed, with the reason', () => {
    const s = fixture();
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    const site = Object.values(s.w.buildings).find(b => b.ownerGangId == null && b.cls === 'commercial' && b.state === 'trading')!;
    expect(issueOrder(s.w, s.g.id, { teamId: s.t.id, type: 'smashUp', buildingIds: [site.id], opts: { manpower: 1 } }).ok).toBe(true);
    const o = s.w.orders[s.t.orderIds.at(-1)!];
    s.sim.launchWeek();
    until(s, () => o.state === 'done' || o.state === 'failed');
    expect(o.state).toBe('failed');
    expect(o.failReason).toMatch(/Could not get into/);
  });
});
