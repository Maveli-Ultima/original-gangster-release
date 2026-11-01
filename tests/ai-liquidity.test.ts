import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { planGang } from '../src/sim/ai';
import * as api from '../src/sim/api';
import { VEHICLES } from '../src/sim/constants';
import { Sim } from '../src/sim/sim';
import { resetWeekTransport } from '../src/sim/transport';
import type { Gang, Team } from '../src/sim/types';
import { roadPosition } from '../src/sim/vehicleNavigation';
import { buildingDoor, gangMembers, teamsOf } from '../src/sim/world';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  const w = sim.world, gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
  gang.cash = 0;
  gang.recruitIds = [];
  for (const owner of [gang, ...teamsOf(w, gang)]) {
    for (const key of Object.keys(owner.weapons)) owner.weapons[key as keyof typeof owner.weapons] = 0;
    for (const key of Object.keys(owner.vehicles)) owner.vehicles[key as keyof typeof owner.vehicles] = 0;
  }
  // Keep the payroll shortfall after selling one car, so the planner must
  // discover that the remaining loaded truck cannot be sold.
  for (const p of gangMembers(w, gang).filter(p => p.role !== 'boss')) p.pay = 2_000;
  return { sim, gang, team: teamsOf(w, gang)[0] };
}

function loadedTruck(sim: Sim, gang: Gang, owner: Gang | Team) {
  const w = sim.world, teamId = 'gangId' in owner ? owner.id : null;
  const source = Object.values(w.buildings).find(b => b.ownerGangId === gang.id && b.isHQ)!;
  const key = teamId == null ? `cache:${gang.id}:truck:0` : `team:${teamId}:truck:0`;
  owner.vehicles.truck = 1;
  (w.vehicleFleet ??= {})[key] = {
    kind: 'truck', gangId: gang.id, teamId, staffId: null, slot: 0,
    pos: roadPosition(w, buildingDoor(w, source)), driverId: null, occupantIds: [],
    orderId: null, destination: null, boarding: false, returning: true,
    cargo: { goods: { liquor: 50, stolen: 0, counterfeit: 0 }, sourceId: source.id,
      orderId: null, purpose: 'return', destinationId: null },
  };
  return key;
}

function watchSales() {
  const sell = api.sellVehicle;
  const refusals = new Set<string>();
  const receipts: { kind: string; teamId: number | undefined; amount: number }[] = [];
  const spy = vi.spyOn(api, 'sellVehicle').mockImplementation((w, gangId, kind, teamId) => {
    const key = `${gangId}:${teamId ?? 'cache'}:${kind}`;
    // Fail fast if the old infinite loop returns. All first attempts still
    // execute the real API, including its busy-vehicle check and bookkeeping.
    if (refusals.has(key)) throw new Error(`Repeated rejected vehicle sale: ${key}`);
    const before = w.gangs[gangId].cash;
    const result = sell(w, gangId, kind, teamId);
    if (!result.ok) refusals.add(key);
    else receipts.push({ kind, teamId, amount: w.gangs[gangId].cash - before });
    return result;
  });
  return { spy, receipts, refusals };
}

describe('rival payroll when vehicles cannot be sold', () => {
  it.each(['cache', 'team'] as const)('finishes planning and preserves a loaded %s truck', location => {
    const { sim, gang, team } = fixture();
    const key = loadedTruck(sim, gang, location === 'cache' ? gang : team);
    const cargo = structuredClone(sim.world.vehicleFleet![key].cargo);
    const { spy, receipts, refusals } = watchSales();

    expect(() => planGang(sim.world, sim.rng, gang)).not.toThrow();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(refusals.size).toBe(1);
    expect(receipts).toEqual([]);
    expect(sim.world.vehicleFleet![key].cargo).toEqual(cargo);
    expect((location === 'cache' ? gang : team).vehicles.truck).toBe(1);
  });

  it('moves on from a loaded cache truck to a free crew truck and another vehicle type', () => {
    const { sim, gang, team } = fixture();
    const key = loadedTruck(sim, gang, gang);
    team.vehicles.truck = 1;
    gang.vehicles.speedster = 1;
    const { receipts, refusals } = watchSales();

    expect(() => planGang(sim.world, sim.rng, gang)).not.toThrow();

    expect(refusals.size).toBe(1);
    expect(receipts).toEqual([
      { kind: 'truck', teamId: team.id, amount: Math.round(VEHICLES.truck.cost * .5) },
      { kind: 'speedster', teamId: undefined, amount: Math.round(VEHICLES.speedster.cost * .5) },
    ]);
    expect(sim.world.vehicleFleet![key].cargo?.goods.liquor).toBe(50);
    expect(team.vehicles.truck).toBe(0);
    expect(gang.vehicles.speedster).toBe(0);
  });

  it('sells a free truck once, then leaves the loaded truck and considers property', () => {
    const { sim, gang, team } = fixture();
    const key = loadedTruck(sim, gang, team);
    team.vehicles.truck = 2;
    const property = Object.values(sim.world.buildings).find(b =>
      b.ownerGangId == null && b.cls === 'commercial' && !b.isHQ && b.hidesId == null)!;
    property.ownerGangId = gang.id;
    const sellProperty = vi.spyOn(api, 'sellBuilding');
    const { receipts, refusals } = watchSales();

    expect(() => planGang(sim.world, sim.rng, gang)).not.toThrow();

    expect(refusals.size).toBe(1);
    expect(receipts).toEqual([
      { kind: 'truck', teamId: team.id, amount: Math.round(VEHICLES.truck.cost * .5) },
    ]);
    expect(team.vehicles.truck).toBe(1);
    expect(sim.world.vehicleFleet![key].cargo?.goods.liquor).toBe(50);
    expect(sellProperty).toHaveBeenCalled();
    expect(property.ownerGangId).not.toBe(gang.id);
  });

  it('can plan after restoring a week-boundary save containing undelivered goods', () => {
    const { sim, gang, team } = fixture();
    const key = loadedTruck(sim, gang, team);
    sim.world.vehicleFleet![key].cargo!.purpose = 'export';
    resetWeekTransport(sim.world);
    const saved = JSON.parse(JSON.stringify(sim.world));
    const restored = Sim.fromSave(saved);
    const { receipts, refusals } = watchSales();

    expect(() => planGang(restored.world, restored.rng, restored.world.gangs[gang.id])).not.toThrow();

    expect(refusals.size).toBe(1);
    expect(receipts).toEqual([]);
    expect(restored.world.vehicleFleet![key].cargo).toEqual(sim.world.vehicleFleet![key].cargo);
    expect(restored.world.vehicleFleet![key].cargo?.purpose).toBe('return');
    expect(restored.world.teams[team.id].vehicles.truck).toBe(1);
  });
});
