import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { assignStaffVehicle, buyVehicle, buyWeapon, canGoStraight, demote, hireRecruit, sellVehicle, sellWeapon, setGoStraight, transferVehicle, transferWeapon } from '../src/sim/api';
import { VEHICLES, VEHICLE_ORDER, WEAPONS, WEAPON_ORDER } from '../src/sim/constants';
import { Sim } from '../src/sim/sim';
import { allocateTransport, dismount, startStaffJourney } from '../src/sim/transport';
import { gangAssets, gangHoldings, gangWealth, powerRating } from '../src/sim/world';

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 500_000 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  return { sim, w, gang, team };
}
function legalAssets(s: ReturnType<typeof fixture>) {
  const lawyer = Object.values(s.w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
  expect(hireRecruit(s.w, s.gang.id, lawyer.id, 'pool').ok).toBe(true);
  for (const b of Object.values(s.w.buildings)) {
    if (b.ownerGangId === s.gang.id && b.cls === 'illegal' && b.typeId !== 'office') b.ownerGangId = null;
    if (gangAssets(s.w, s.gang) < 270_000 && b.ownerGangId == null && b.cls === 'commercial') b.ownerGangId = s.gang.id;
  }
  expect(gangAssets(s.w, s.gang)).toBeGreaterThanOrEqual(270_000);
  return lawyer;
}
// Exercise the real settlement boundary without pretending these are street-week campaigns.
function resolve(s: ReturnType<typeof fixture>, stage = 15) {
  s.w.phase = 'week'; s.w.settlementStage = stage; s.sim.finishWeek();
}

/** The far corner of the city from `p`: further than a man walks. */
const farFrom = (w: { gridW: number; gridH: number }, p: { x: number; y: number }) => ({ x: p.x < w.gridW * 27 ? w.gridW * 54 - 30 : 30, y: p.y < w.gridH * 27 ? w.gridH * 54 - 30 : 30 });

describe('separate cash, assets and total wealth', () => {
  it('cash changes wealth and power once, without changing the assets', () => {
    const s = fixture(), before = gangHoldings(s.w, s.gang), power = powerRating(s.w, s.gang);
    s.gang.cash += 100_000;
    expect(gangAssets(s.w, s.gang)).toBe(before.assets);
    expect(gangWealth(s.w, s.gang)).toBe(before.wealth + 100_000);
    expect(powerRating(s.w, s.gang)).toBe(power + 100);
  });

  it.each(WEAPON_ORDER)('%s: buying, transferring and selling reconcile without creating value', id => {
    const s = fixture(), before = gangHoldings(s.w, s.gang), resale = WEAPONS[id].cost / 2;
    expect(buyWeapon(s.w, s.gang.id, id, s.team.id).ok).toBe(true);
    const bought = gangHoldings(s.w, s.gang);
    expect(bought.cash).toBe(before.cash - WEAPONS[id].cost);
    expect(bought.assets).toBe(before.assets + resale);
    expect(bought.wealth).toBe(before.wealth - resale);
    expect(transferWeapon(s.w, s.gang.id, id, s.team.id, false).ok).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toEqual(bought);
    expect(sellWeapon(s.w, s.gang.id, id).ok).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toMatchObject({ assets: before.assets, cash: before.cash - resale, wealth: bought.wealth });
  });

  it.each(VEHICLE_ORDER)('%s: vehicle purchases and resale have the same valuation in crew or cache', id => {
    const s = fixture(), before = gangHoldings(s.w, s.gang), resale = VEHICLES[id].cost / 2;
    expect(buyVehicle(s.w, s.gang.id, id, s.team.id).ok).toBe(true);
    const bought = gangHoldings(s.w, s.gang);
    expect(bought.assets).toBe(before.assets + resale);
    expect(bought.wealth).toBe(before.wealth - resale);
    expect(transferVehicle(s.w, s.gang.id, id, s.team.id, false).ok).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toEqual(bought);
    expect(sellVehicle(s.w, s.gang.id, id).ok).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toMatchObject({ assets: before.assets, cash: before.cash - resale, wealth: bought.wealth });
  });

  it('staff allocation, actual journeys and return do not duplicate the car value', () => {
    const s = fixture(), lawyer = legalAssets(s);
    expect(buyVehicle(s.w, s.gang.id, 'coupe').ok).toBe(true);
    const before = gangHoldings(s.w, s.gang);
    expect(assignStaffVehicle(s.w, s.gang.id, 'lawyer', 'coupe').ok).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toEqual(before);
    // Far enough that he drives (the original's driving distance).
    startStaffJourney(s.w, lawyer, farFrom(s.w, lawyer.pos));
    expect(Object.values(s.w.vehicleFleet!).some(v => v.staffId === lawyer.id)).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toEqual(before);
    expect(assignStaffVehicle(s.w, s.gang.id, 'lawyer', null).ok).toBe(false);
    expect(gangHoldings(s.w, s.gang)).toEqual(before);
    dismount(s.w, lawyer);
    expect(assignStaffVehicle(s.w, s.gang.id, 'lawyer', null).ok).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toEqual(before);
  });

  it('a real crew car and its passengers are counted only through their inventory', () => {
    const s = fixture(), before = gangHoldings(s.w, s.gang);
    const lt = s.w.people[s.team.lieutenantId];
    allocateTransport(s.w, s.team, [lt], farFrom(s.w, lt.pos), s.w.nextId, 'patrol');
    expect(Object.values(s.w.vehicleFleet!).some(v => v.teamId === s.team.id)).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toEqual(before);
  });

  it('demoting a lieutenant returns both cars and weapons, including explosives, to the cache', () => {
    const s = fixture();
    for (const id of WEAPON_ORDER) expect(buyWeapon(s.w, s.gang.id, id, s.team.id).ok).toBe(true);
    expect(buyVehicle(s.w, s.gang.id, 'truck', s.team.id).ok).toBe(true);
    const before = gangHoldings(s.w, s.gang), weapons = { ...s.team.weapons }, cache = { ...s.gang.weapons };
    expect(demote(s.w, s.gang.id, s.team.id).ok).toBe(true);
    expect(gangHoldings(s.w, s.gang)).toEqual(before);
    for (const id of WEAPON_ORDER) expect(s.gang.weapons[id]).toBe(cache[id] + weapons[id]);
  });

  it('ceased property retains its value; damage reduces it and destruction removes it', () => {
    const s = fixture(), site = Object.values(s.w.buildings).find(b => b.ownerGangId == null && b.cls === 'commercial')!;
    site.ownerGangId = s.gang.id;
    const before = gangHoldings(s.w, s.gang);
    site.state = 'ceased'; expect(gangHoldings(s.w, s.gang)).toEqual(before);
    site.state = 'damaged'; const damaged = gangHoldings(s.w, s.gang);
    expect(damaged.property).toBeLessThan(before.property);
    site.state = 'destroyed'; expect(gangHoldings(s.w, s.gang).property).toBeLessThan(damaged.property);
    expect(gangHoldings(s.w, s.gang).cash).toBe(before.cash);
  });

  it('cannot demote a rival lieutenant and take their equipment', () => {
    const s = fixture(), rival = Object.values(s.w.teams).find(t => t.gangId !== s.gang.id)!;
    const before = structuredClone(s.w);
    expect(demote(s.w, s.gang.id, rival.id).ok).toBe(false);
    expect(s.w).toEqual(before);
  });

  it('goods awaiting sale are not booked as cash or as equipment', () => {
    const s = fixture(), site = Object.values(s.w.buildings).find(b => b.ownerGangId === s.gang.id)!;
    const before = gangHoldings(s.w, s.gang);
    site.stock = { liquor: 100, stolen: 200, counterfeit: 300 };
    expect(gangHoldings(s.w, s.gang)).toEqual(before);
  });
});

describe('objectives and saved financial history', () => {
  it('Wealth counts cash plus assets, including vehicles, at the real ending boundary', () => {
    const s = fixture(); s.w.options.mode = 'wealth';
    const assets = gangAssets(s.w, s.gang);
    s.w.options.wealthTarget = s.gang.cash + assets;
    // Isolate the assets threshold from simultaneous starting-wealth ties.
    for (const other of Object.values(s.w.gangs)) if (other.id !== s.gang.id) other.cash = 0;
    expect(s.gang.cash).toBeLessThan(s.w.options.wealthTarget);
    expect(assets).toBeLessThan(s.w.options.wealthTarget);
    resolve(s);
    expect(s.w.outcome).toMatchObject({ won: true });
    expect(s.w.targetRace?.tiedGangIds).toEqual([s.gang.id]);
    expect(s.w.outcome!.reason).toContain('total wealth');
  });

  it('Go Straight rejects cash alone and accepts legal assets with an available lawyer', () => {
    const s = fixture();
    const lawyer = Object.values(s.w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
    expect(hireRecruit(s.w, s.gang.id, lawyer.id, 'pool').ok).toBe(true);
    expect(canGoStraight(s.w, s.gang.id)).toMatchObject({ can: false });
    expect(canGoStraight(s.w, s.gang.id).reason).toContain('excluding cash');
    for (const b of Object.values(s.w.buildings)) if (b.ownerGangId == null && b.cls === 'commercial' && gangAssets(s.w, s.gang) < 270_000) b.ownerGangId = s.gang.id;
    expect(setGoStraight(s.w, s.gang.id, true).ok).toBe(true);
    resolve(s); expect(s.w.outcome?.reason).toMatch(/went straight/i);
  });

  it('rechecks lost assets before completing an already-started Go Straight application', () => {
    const s = fixture(); legalAssets(s);
    expect(setGoStraight(s.w, s.gang.id, true).ok).toBe(true);
    for (const b of Object.values(s.w.buildings)) if (b.ownerGangId === s.gang.id && b.typeId !== 'office') b.ownerGangId = null;
    resolve(s);
    expect(s.w.phase).toBe('planning'); expect(s.w.outcome).toBeNull();
    expect(s.gang.goingStraight).toBe(true);
    expect(canGoStraight(s.w, s.gang.id).can).toBe(false);
  });

  it('saves holdings and separate history while preserving legacy combined observations', () => {
    const s = fixture(), lawyer = legalAssets(s);
    expect(buyVehicle(s.w, s.gang.id, 'coupe').ok).toBe(true);
    expect(assignStaffVehicle(s.w, s.gang.id, 'lawyer', 'coupe').ok).toBe(true);
    startStaffJourney(s.w, lawyer, { x: 150, y: 150 });
    const holdings = gangHoldings(s.w, s.gang);
    s.gang.history = [{ week: 1, assets: -200, power: 1, territory: 0, manpower: 5, loyalty: 70, crimes: 0, suspicion: 0 }];
    s.w.week = 2;
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(s.w)));
    expect(gangHoldings(restored.world, restored.playerGang)).toEqual(holdings);
    const next = { ...s, sim: restored, w: restored.world, gang: restored.playerGang };
    resolve(next, 12);
    expect(next.gang.history[0]).not.toHaveProperty('cash');
    expect(next.gang.history[0].assets).toBe(-200);
    expect(next.gang.history.at(-1)).toMatchObject({ cash: holdings.cash, assets: holdings.assets });
    expect(() => Sim.fromSave(JSON.parse(JSON.stringify(next.w)))).not.toThrow();
    next.gang.history.at(-1)!.assets = -1;
    expect(() => Sim.fromSave(JSON.parse(JSON.stringify(next.w)))).toThrow(/asset history/);
  });
});
