import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { hireRecruit } from '../src/sim/api';
import { killPerson } from '../src/sim/execution';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { weeklyLaw } from '../src/sim/systems/law';
import { weeklyPolitics } from '../src/sim/systems/politics';
import { buildingDoor, gangManpower, gangWealth, territoryCount } from '../src/sim/world';

const fresh = () => new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });

function electionFixture() {
  const sim = fresh(), w = sim.world, gang = sim.playerGang;
  gang.cash = 100_000;
  const lawyer = Object.values(w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
  expect(hireRecruit(w, gang.id, lawyer.id, 'pool').ok).toBe(true);
  const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
  const guard = w.people[w.teams[rival.teamIds[0]].memberIds[0]];
  const buildings = Object.values(w.buildings);
  const factory = buildings.find(b => b.typeId === 'foundry')!;
  factory.ownerGangId = rival.id; factory.guardIds = [];
  const front = buildings.find(b => b.typeId === 'tradeUnion')!;
  const shop = buildings.find(b => b.typeId === 'cafe')!;
  shop.ownerGangId = gang.id;
  // Declared operation fixture: the tally is real; buying and fitting out a
  // Teamsters office is covered separately by industrial-purchases.
  const operation = buildings.find(b => b.cls === 'empty')!;
  operation.cls = 'illegal'; operation.typeId = 'teamsters'; operation.state = 'trading';
  operation.ownerGangId = gang.id; operation.frontId = shop.id; shop.hidesId = operation.id;
  gang.popularity = 70; gang.campaignSpend = 1000;
  w.election = { ...w.election, active: true, weeksLeft: 2,
    candidates: [{ id: gang.bossId, kind: 'gang', gangId: gang.id, votes: 0 }] };
  const tally = (enabled: boolean) => {
    operation.state = enabled ? 'trading' : 'ceased';
    w.election.weeksLeft = 2;
    weeklyPolitics(w, new Rng(73));
    // The weekly refresh (0x4BD090) puts two civic principals ahead of the gang.
    return w.election.candidates.find(c => c.gangId === gang.id)!.votes;
  };
  return { sim, w, gang, rival, guard, factory, front, operation, tally };
}

describe('Teamsters voting and actual industrial guards', () => {
  it('one trading operation helps, multiple operations do not stack, and a union front wins the contest', () => {
    const s = electionFixture();
    const baseline = s.tally(false), supported = s.tally(true);
    expect(supported).toBeGreaterThan(baseline);
    const extra = Object.values(s.w.buildings).find(b => b.cls === 'empty')!;
    Object.assign(extra, { cls: 'illegal', typeId: 'teamsters', state: 'ceased', ownerGangId: s.gang.id });
    const sameTerritoryOneOperation = s.tally(true);
    extra.state = 'trading';
    expect(s.tally(true)).toBe(sameTerritoryOneOperation);
    extra.ownerGangId = s.rival.id; extra.frontId = s.front.id; s.front.hidesId = extra.id;
    extra.state = 'ceased';
    const sameTerritoryNoUnionVote = s.tally(false);
    extra.state = 'trading';
    expect(s.tally(true)).toBe(sameTerritoryNoUnionVote);
    console.log('Teamsters tally fixture', { baseline, supported, duplicate: sameTerritoryOneOperation, rivalUnionFront: sameTerritoryNoUnionVote });
  });

  it('a rival hood at an operating industrial doorway counters the union vote', () => {
    const s = electionFixture(), baseline = s.tally(false);
    s.guard.pos = buildingDoor(s.w, s.factory); s.guard.inVehicle = false;
    s.factory.guardIds = [s.guard.id];
    expect(s.tally(true)).toBe(baseline);
    s.w.blocks[s.factory.blockId].district = 'residential';
    expect(s.tally(true)).toBe(baseline);
  });

  it('an eliminated rival cannot keep the union vote through its abandoned Teamsters office', () => {
    const s = electionFixture();
    const other = Object.values(s.w.buildings).find(b => b.cls === 'empty')!;
    Object.assign(other, { cls: 'illegal', typeId: 'teamsters', state: 'trading',
      ownerGangId: s.rival.id, frontId: s.front.id });
    const blocked = s.tally(true);
    s.rival.eliminated = true;
    expect(s.tally(true)).toBeGreaterThan(blocked);
  });

  it.each(['missing', 'police marker', 'dead', 'jailed', 'distant', 'driving', 'wrong gang', 'own gang', 'nonindustrial', 'destroyed', 'ceased', 'eliminated owner'] as const)
  ('does not let a %s guard/site cancel the union vote', condition => {
    const s = electionFixture();
    s.guard.pos = buildingDoor(s.w, s.factory); s.guard.inVehicle = false;
    s.factory.guardIds = [s.guard.id];
    if (condition === 'missing') s.factory.guardIds = [99999999];
    if (condition === 'police marker') s.factory.guardIds = [-1];
    if (condition === 'dead') s.guard.status = 'dead';
    if (condition === 'jailed') s.guard.status = 'jailed';
    if (condition === 'distant') s.guard.pos = { x: 0, y: 0 };
    if (condition === 'driving') s.guard.inVehicle = true;
    if (condition === 'wrong gang') s.guard.gangId = s.gang.id;
    if (condition === 'own gang') { s.factory.ownerGangId = s.gang.id; s.guard.gangId = s.gang.id; }
    if (condition === 'nonindustrial') { s.factory.cls = 'commercial'; s.factory.typeId = 'cafe'; }
    if (condition === 'destroyed') s.factory.state = 'destroyed';
    if (condition === 'ceased') s.factory.state = 'ceased';
    if (condition === 'eliminated owner') s.rival.eliminated = true;
    const guardIds = s.factory.guardIds;
    s.factory.guardIds = [];
    const supported = s.tally(true);
    s.factory.guardIds = guardIds;
    expect(s.tally(true)).toBe(supported);
  });
});

describe('reported minor crime versus murder investigation', () => {
  it('more identical reported murders reach court than minor offences across paired random seeds', () => {
    const sim = fresh(), snapshot = structuredClone(sim.world), gangId = sim.playerGang.id;
    const actorId = snapshot.teams[sim.playerGang.teamIds[0]].memberIds[0];
    const totals = { extort: 0, intimidate: 0, kill: 0 };
    const arrests = { extort: new Set<number>(), intimidate: new Set<number>(), kill: new Set<number>() };
    for (let seed = 1; seed <= 128; seed++) for (const kind of ['extort', 'intimidate', 'kill'] as const) {
      const w = structuredClone(snapshot);
      w.crimes = [{ id: w.sequences.crime++, week: w.week, gangId, perpetratorId: actorId,
        kind, buildingId: null, victimId: null, witnesses: [], arrestRisk: .6, reported: true }];
      weeklyLaw(w, new Rng(seed));
      if (Object.values(w.cases).some(c => c.defendantId === actorId)) { totals[kind]++; arrests[kind].add(seed); }
    }
    expect(totals.extort).toBeGreaterThan(0);
    expect(totals.intimidate).toBe(totals.extort);
    expect(totals.kill).toBeGreaterThan(totals.extort);
    expect(totals.kill).toBeLessThan(128);
    for (const seed of arrests.extort) expect(arrests.kill.has(seed)).toBe(true);
    console.log('Paired reported-crime fixture (128 seeds, equal .6 pre-weight risk)', totals);
  });
});

function depletedFixture(cash: number, keepSite = false, keepManager = false) {
  const sim = fresh(), w = sim.world, gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
  const site = Object.values(w.buildings).find(b => b.ownerGangId === gang.id && b.managerId != null)!;
  const managerId = keepManager ? site.managerId! : null;
  for (const p of Object.values(w.people)) if (p.gangId === gang.id && p.id !== gang.bossId && p.id !== managerId)
    killPerson(w, p, 'Declared depletion fixture');
  for (const b of Object.values(w.buildings)) {
    if (b.ownerGangId === gang.id && (!keepSite || b.id !== site.id)) { b.ownerGangId = null; b.managerId = null; }
    if (b.protection?.gangId === gang.id) b.protection = null;
  }
  gang.cash = cash;
  const emptyWeapons = { pistol: 0, shotgun: 0, rifle: 0, tommy: 0, twinPistols: 0, explosives: 0 };
  const emptyVehicles = { coupe: 0, truck: 0, speedster: 0 };
  gang.weapons = { ...emptyWeapons }; gang.vehicles = { ...emptyVehicles };
  gang.staffVehicles = { accountant: null, lawyer: null };
  for (const id of gang.teamIds) {
    w.teams[id].weapons = { ...emptyWeapons }; w.teams[id].vehicles = { ...emptyVehicles };
  }
  gang.recruitIds = [];
  return { sim, w, gang, site, managerId };
}

function settleCommandAndSurvival(sim: Sim) {
  // Start at the explicit end-of-week command/succession boundary. Earlier
  // combat/economy/law are intentionally excluded from these paired fixtures.
  sim.world.phase = 'week'; sim.world.minute = 2400; sim.world.settlementStage = 11;
  for (let i = 0; i < 4 && sim.world.phase === 'week' && sim.world.settlementStage! < 14; i++) sim.advance(0, 1, 1);
  expect(sim.world.settlementStage).toBe(14);
}

describe('rival depletion and rebuilding at settlement', () => {
  it.each([1499, 1500])('checks the explicit remake wealth threshold with no men or claims ($%s)', cash => {
    const s = depletedFixture(cash);
    expect(gangManpower(s.w, s.gang)).toBe(0); expect(territoryCount(s.w, s.gang.id)).toBe(0);
    expect(gangWealth(s.w, s.gang)).toBe(cash);
    settleCommandAndSurvival(s.sim);
    expect(s.gang.eliminated).toBe(cash < 1500);
    expect(s.w.people[s.gang.bossId].status).toBe('active');
  });

  it('keeps a broke gang with surviving premises and promotes its remaining manager', () => {
    const s = depletedFixture(0, true, true);
    settleCommandAndSurvival(s.sim);
    expect(s.gang.eliminated).toBe(false);
    expect(s.gang.teamIds).toHaveLength(1);
    expect(s.w.teams[s.gang.teamIds[0]].lieutenantId).toBe(s.managerId);
    expect(s.site.managerId).toBeNull();
    expect(s.w.people[s.managerId!].buildingId).toBeNull();
  });

  it('offers recruits and lets the actual rival planner hire and rebuild a crew', () => {
    const s = depletedFixture(5000, true);
    settleCommandAndSurvival(s.sim);
    expect(s.gang.eliminated).toBe(false); expect(s.gang.recruitIds).toHaveLength(2);
    for (let i = 0; i < 15 && s.w.phase === 'week'; i++) s.sim.advance(0, 1, 1);
    expect(s.w.phase).toBe('planning'); expect(gangManpower(s.w, s.gang)).toBeGreaterThan(0);
    settleCommandAndSurvival(s.sim);
    expect(s.gang.teamIds.length).toBeGreaterThan(0);
    const restored = Sim.fromSave(structuredClone(s.w));
    expect(restored.world.gangs[s.gang.id].eliminated).toBe(false);
    expect(restored.world.teams[s.gang.teamIds[0]].lieutenantId).toBe(s.w.teams[s.gang.teamIds[0]].lieutenantId);
  });
});
