import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { assignStaffVehicle, bribeOfficial, canGoStraight, dismissPoliceOfficer, employPoliceInArea, employPoliceOfficer, hireRecruit, orderAudit, sackPerson, setGoStraight, toggleEvadeTax } from '../src/sim/api';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { killPerson } from '../src/sim/execution';
import { MINUTES_PER_SECOND, Sim } from '../src/sim/sim';
import { weeklyFbi } from '../src/sim/systems/fbi';
import type { PersonStatus } from '../src/sim/types';
import { gangAssets } from '../src/sim/world';

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 500_000 });
  const w = sim.world, gang = sim.playerGang;
  const lawyer = Object.values(w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
  const accountant = Object.values(w.people).find(p => p.role === 'accountant' && p.gangId == null)!;
  expect(hireRecruit(w, gang.id, lawyer.id, 'pool').ok).toBe(true);
  expect(hireRecruit(w, gang.id, accountant.id, 'pool').ok).toBe(true);
  const manager = Object.values(w.buildings).find(b => b.ownerGangId === gang.id && b.managerId != null)!;
  const officer = w.people[w.policeIds[0]];
  return { sim, w, gang, lawyer, accountant, manager, officer };
}
function settle(sim: Sim) {
  sim.launchWeek();
  sim.world.minute = MINUTES_PER_WEEK - 1;
  sim.advance(1 / MINUTES_PER_SECOND, 1);
}

describe('specialist planning validation and ownership', () => {
  it.each(['jailed', 'kidnapped', 'beaten', 'dead'] as PersonStatus[])('unavailable %s staff cannot accept new work', status => {
    const s = fixture();
    s.lawyer.status = status; s.accountant.status = status;
    const before = structuredClone(s.w);
    expect(orderAudit(s.w, s.gang.id, s.manager.managerId!).ok).toBe(false);
    expect(toggleEvadeTax(s.w, s.gang.id).ok).toBe(false);
    expect(bribeOfficial(s.w, s.gang.id, s.w.policeChiefId).ok).toBe(false);
    expect(employPoliceOfficer(s.w, s.gang.id, s.officer.id).ok).toBe(false);
    expect(employPoliceInArea(s.w, s.gang.id, s.w.blocks.map(b => b.id)).ok).toBe(false);
    expect(canGoStraight(s.w, s.gang.id).can).toBe(false);
    expect(s.w).toEqual(before);
  });

  it('stale specialist IDs cannot use somebody who no longer belongs to the gang', () => {
    const s = fixture();
    s.lawyer.gangId = null; s.accountant.gangId = null;
    expect(orderAudit(s.w, s.gang.id, s.manager.managerId!).ok).toBe(false);
    expect(toggleEvadeTax(s.w, s.gang.id).ok).toBe(false);
    expect(employPoliceOfficer(s.w, s.gang.id, s.officer.id).ok).toBe(false);
    expect(canGoStraight(s.w, s.gang.id).can).toBe(false);
  });

  it('an audit cannot be scheduled against a rival or retain a rejected replacement', () => {
    const s = fixture(), rival = Object.values(s.w.gangs).find(g => !g.isPlayer)!;
    expect(orderAudit(s.w, s.gang.id, s.manager.managerId!).ok).toBe(true);
    expect(orderAudit(s.w, s.gang.id, rival.bossId).ok).toBe(false);
    expect(s.w.auditTargets[s.gang.id]).toBe(s.manager.managerId);
  });

  it('retainers cannot steal rival officers, dismiss them or bribe ordinary residents as officials', () => {
    const s = fixture(), rival = Object.values(s.w.gangs).find(g => !g.isPlayer)!;
    s.officer.employedBy = rival.id; s.officer.weeklyRetainer = 300; rival.employedPoliceIds.push(s.officer.id);
    const before = structuredClone(s.w);
    expect(employPoliceOfficer(s.w, s.gang.id, s.officer.id).ok).toBe(false);
    expect(dismissPoliceOfficer(s.w, s.gang.id, s.officer.id).ok).toBe(false);
    expect(bribeOfficial(s.w, s.gang.id, s.manager.managerId!).ok).toBe(false);
    expect(s.w).toEqual(before);
  });

  it('hiring the same officer twice does not manufacture extra goodwill; dismissal clears both sides', () => {
    const s = fixture();
    expect(employPoliceOfficer(s.w, s.gang.id, s.officer.id).ok).toBe(true);
    expect(s.officer.employedBy).toBeNull();
    s.sim.launchWeek();
    for (let i = 0; i < MINUTES_PER_WEEK && s.officer.employedBy !== s.gang.id; i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(s.officer.employedBy).toBe(s.gang.id);
    const opinion = s.officer.opinion[s.gang.id], cash = s.gang.cash;
    expect(employPoliceOfficer(s.w, s.gang.id, s.officer.id).ok).toBe(true);
    expect(s.officer.opinion[s.gang.id]).toBe(opinion); expect(s.gang.cash).toBe(cash);
    expect(s.gang.employedPoliceIds.filter(id => id === s.officer.id)).toHaveLength(1);
    expect(dismissPoliceOfficer(s.w, s.gang.id, s.officer.id).ok).toBe(true);
    expect(s.officer.employedBy).toBeNull(); expect(s.officer.weeklyRetainer).toBe(0);
    expect(s.gang.employedPoliceIds).not.toContain(s.officer.id);
  });
});

describe('staff vehicle allocation preserves the fleet', () => {
  it('a failed replacement leaves the current car, stock and driver unchanged', () => {
    const s = fixture(); s.gang.vehicles.coupe = 1; s.gang.vehicles.truck = 0;
    expect(assignStaffVehicle(s.w, s.gang.id, 'lawyer', 'coupe').ok).toBe(true);
    const before = structuredClone(s.w);
    expect(assignStaffVehicle(s.w, s.gang.id, 'lawyer', 'truck').ok).toBe(false);
    expect(s.w).toEqual(before);
    expect(assignStaffVehicle(s.w, s.gang.id, 'lawyer', 'coupe').ok).toBe(true);
    expect(s.w).toEqual(before);
  });

  it.each(['replace', 'sack', 'kill'] as const)('reclaims keys when staff leave by %s, without leaving a phantom driver', action => {
    const s = fixture(); s.gang.vehicles.coupe = 1;
    expect(assignStaffVehicle(s.w, s.gang.id, 'lawyer', 'coupe').ok).toBe(true);
    if (action === 'replace') {
      const next = Object.values(s.w.people).find(p => p.role === 'lawyer' && p.gangId == null && p.status === 'active')!;
      expect(hireRecruit(s.w, s.gang.id, next.id, 'pool').ok).toBe(true);
      expect(next.inVehicle).toBe(false);
    } else if (action === 'sack') expect(sackPerson(s.w, s.gang.id, s.lawyer.id).ok).toBe(true);
    else killPerson(s.w, s.lawyer, 'staff vehicle lifecycle test');
    expect(s.gang.staffVehicles?.lawyer).toBeNull(); expect(s.gang.vehicles.coupe).toBe(1);
    expect(s.lawyer.inVehicle).toBe(false);
    expect(Sim.fromSave(structuredClone(s.w)).playerGang.vehicles.coupe).toBe(1);
  });

  it('cannot hire a dead recruit', () => {
    const s = fixture(), next = Object.values(s.w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
    next.status = 'dead';
    const before = structuredClone(s.w);
    expect(hireRecruit(s.w, s.gang.id, next.id, 'pool').ok).toBe(false);
    expect(s.w).toEqual(before);
  });
});

describe('losing a specialist before weekly settlement', () => {
  it('clears an unperformable audit instead of silently retrying next week; taxes are paid in full', () => {
    const s = fixture();
    expect(orderAudit(s.w, s.gang.id, s.manager.managerId!).ok).toBe(true);
    expect(toggleEvadeTax(s.w, s.gang.id).ok).toBe(true);
    s.accountant.status = 'jailed'; s.accountant.jailWeeks = 5;
    const sim = Sim.fromSave(structuredClone(s.w));
    settle(sim);
    const gang = sim.playerGang;
    expect(sim.world.auditTargets[gang.id]).toBeUndefined(); expect(sim.world.auditResults[gang.id]).toBeNull();
    expect(gang.taxEvaded.at(-1)).toBe(0);
    expect(gang.lastFinanceReport!.costs.tax).toBe(Math.round(Math.max(0, gang.lastFinanceReport!.taxableProfit!) * 0.24));
    expect(sim.world.weekLog.some(x => /audit/i.test(x) && /available|unable|could not/i.test(x))).toBe(true);
  });

  it('a jailed accountant provides no additional FBI concealment', () => {
    const s = fixture(); s.accountant.status = 'jailed'; s.accountant.skills.intelligence = 5;
    s.gang.lastWeekIncome.legal = 1000; s.gang.finances!.riskyIncome = 5000; s.gang.suspicion = 0;
    weeklyFbi(s.w, s.sim.rng);
    expect(s.gang.riskyMoney).toBe(4800);
  });

  it('Go Straight cannot finish after losing its lawyer, but may be cancelled without one', () => {
    const s = fixture();
    for (const b of Object.values(s.w.buildings)) if (b.ownerGangId === s.gang.id && b.cls === 'illegal' && b.typeId !== 'office') b.ownerGangId = null;
    // Go Straight requires actual assets, independently of the cash fixture.
    for (const b of Object.values(s.w.buildings)) {
      if (gangAssets(s.w, s.gang) >= 250_000) break;
      if (b.ownerGangId == null && b.cls === 'commercial') b.ownerGangId = s.gang.id;
    }
    expect(setGoStraight(s.w, s.gang.id, true).ok).toBe(true);
    s.lawyer.status = 'jailed'; s.lawyer.jailWeeks = 5;
    settle(s.sim);
    expect(s.w.outcome?.reason ?? '').not.toMatch(/went straight/i);
    expect(setGoStraight(s.w, s.gang.id, false).ok).toBe(true);
    expect(s.gang.goingStraight).toBe(false);
  });
});
