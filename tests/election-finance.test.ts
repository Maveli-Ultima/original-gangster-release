import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { hireRecruit, setRunForOffice } from '../src/sim/api';
import { openFinances, financeNet } from '../src/sim/finances';
import { Sim } from '../src/sim/sim';
import { weeklyEconomy } from '../src/sim/systems/economy';
import { campaignWeeklyCost, canRunForOffice, weeklyPolitics } from '../src/sim/systems/politics';
import { territorySites } from '../src/sim/territory';
import { gangMembers, territoryBlocks } from '../src/sim/world';

const protection = (gangId: number) => ({ gangId, weekly: 100, base: 100, grievance: 0, refusing: false });
function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), citySize: 10, seed: 404, startMoney: 500_000 });
  const w = sim.world, gang = sim.playerGang;
  const lawyer = Object.values(w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
  expect(hireRecruit(w, gang.id, lawyer.id, 'pool').ok).toBe(true);
  // Explicit 28-block electorate and known land values. Damaged premises have
  // no trading income or ceased-site cost, isolating payroll then campaign cost.
  for (const b of Object.values(w.buildings)) {
    b.state = 'damaged';
    if (b.protection?.gangId === gang.id) b.protection = null;
  }
  for (const block of w.blocks) {
    block.landValue = 20;
    if (territoryBlocks(w, gang.id).length >= 28) continue;
    const site = territorySites(w, block).find(b => b.cls === 'commercial' && b.ownerGangId == null);
    if (site) site.protection = protection(gang.id);
  }
  expect(territoryBlocks(w, gang.id)).toHaveLength(28);
  for (const p of gangMembers(w, gang)) { p.pay = 0; p.payDemand = 0; }
  lawyer.pay = 100; lawyer.payDemand = 100;
  gang.cash = 5000;
  w.election = { ...w.election, active: true, weeksLeft: 6,
    candidates: [w.mayorId, w.judgeIds[0]].map((id, i) => ({ id, kind: i ? 'judge' : 'mayor', gangId: null, votes: 0 })) };
  openFinances(w, gang);
  return { sim, w, gang, lawyer };
}

describe('recovered campaign payment and entry', () => {
  it('sums each controlled block once and truncates only the total divided by four', () => {
    const { w, gang } = fixture();
    const blocks = territoryBlocks(w, gang.id);
    blocks[0].landValue = 21; blocks[1].landValue = 23;
    expect(campaignWeeklyCost(w, gang.id)).toBe(141); // (26*20 +21+23)/4
    const site = territorySites(w, blocks[0])[0];
    site.ownerGangId = gang.id; site.protection = protection(gang.id);
    expect(campaignWeeklyCost(w, gang.id)).toBe(141);
    blocks[1].landValue = 22;
    expect(campaignWeeklyCost(w, gang.id)).toBe(140); // floor(563/4)
  });

  it.each([139, 140, 141])('uses the actual quote at the player cash boundary: %s', cash => {
    const { w, gang } = fixture(); gang.cash = cash;
    const before = structuredClone(w);
    expect(canRunForOffice(w, gang.id)).toBe(cash >= 140);
    const result = setRunForOffice(w, gang.id, true);
    expect(result.ok).toBe(cash >= 140);
    if (!result.ok) { expect(w).toEqual(before); expect(result.error).toContain('$140'); }
    else expect(gang.cash).toBe(cash); // Entry doesn't debit another bill.
  });

  it.each([6, 5, 4, 3, 2, 1])('applies the player nomination deadline with %s weeks remaining', weeks => {
    const { w, gang } = fixture(); w.election.weeksLeft = weeks;
    const before = structuredClone(w);
    const result = setRunForOffice(w, gang.id, true);
    expect(result.ok).toBe(weeks >= 2);
    if (!result.ok) { expect(w).toEqual(before); expect(result.error).toContain('Nominations'); }
  });

  it('uses the earlier AI deadline and strict cash surplus at its entry gate', () => {
    const { w, gang } = fixture(); gang.isPlayer = false;
    gang.cash = 140; expect(canRunForOffice(w, gang.id)).toBe(false);
    gang.cash = 141; w.election.weeksLeft = 3;
    expect(canRunForOffice(w, gang.id)).toBe(true);
    w.election.weeksLeft = 2; expect(canRunForOffice(w, gang.id)).toBe(false);
  });

  it('does not duplicate an existing nomination or bill when reconfirmed after closing', () => {
    const { w, gang } = fixture();
    expect(setRunForOffice(w, gang.id, true).ok).toBe(true);
    const before = gang.cash;
    w.election.weeksLeft = 1;
    expect(setRunForOffice(w, gang.id, true).ok).toBe(true);
    expect(w.election.candidates.filter(c => c.gangId === gang.id)).toHaveLength(1);
    expect(gang.cash).toBe(before);
    expect(setRunForOffice(w, gang.id, false).ok).toBe(true);
    expect(w.election.candidates.some(c => c.gangId === gang.id)).toBe(false);
  });

  it.each([239, 240, 241])('pays wages first, then the whole campaign or withdraws: %s cash', cash => {
    const { sim, w, gang, lawyer } = fixture();
    expect(setRunForOffice(w, gang.id, true).ok).toBe(true);
    gang.cash = cash; openFinances(w, gang);
    const loyalty = lawyer.loyalty;
    weeklyEconomy(w, sim.rng);
    const paid = cash >= 240 ? 140 : 0;
    expect(gang.finances!.costs.wages).toBe(100);
    expect(gang.finances!.costs.upkeep).toBe(paid);
    expect(gang.finances!.campaignCost).toBe(paid);
    expect(gang.cash).toBe(cash - 100 - paid);
    expect(gang.runningForOffice).toBe(cash >= 240);
    expect(w.election.candidates.some(c => c.gangId === gang.id)).toBe(cash >= 240);
    expect(lawyer.loyalty).toBeGreaterThanOrEqual(loyalty);
    expect(gang.finances!.openingCash + financeNet(gang.finances!)).toBe(gang.cash);
    if (!paid) expect(w.messages.some(m => m.text.includes('$140') && m.text.includes('withdrew'))).toBe(true);
  });

  it('recalculates next-week cost after territory and land-value changes, including restored campaigns', () => {
    const { sim, w, gang } = fixture();
    expect(setRunForOffice(w, gang.id, true).ok).toBe(true);
    weeklyEconomy(w, sim.rng);
    expect(gang.finances!.campaignCost).toBe(140);
    const blocks = territoryBlocks(w, gang.id);
    for (const site of territorySites(w, blocks[0])) {
      if (site.ownerGangId === gang.id) site.ownerGangId = null;
      if (site.protection?.gangId === gang.id) site.protection = null;
    }
    blocks[1].landValue = 40;
    w.week++; openFinances(w, gang);
    const loaded = Sim.fromSave(structuredClone(w));
    weeklyEconomy(w, sim.rng); weeklyEconomy(loaded.world, loaded.rng);
    expect(gang.finances!.campaignCost).toBe(140); // 27 blocks; one now worth40.
    expect(loaded.playerGang.finances).toEqual(gang.finances);
    expect(loaded.playerGang.cash).toBe(gang.cash);
    blocks[1].landValue = 44;
    expect(campaignWeeklyCost(w, gang.id)).toBe(141);
  });

  it('ignores the legacy arbitrary budget in payment and voting, and preserves old reports', () => {
    const { sim, w, gang } = fixture();
    expect(setRunForOffice(w, gang.id, true).ok).toBe(true);
    gang.campaignSpend = 999_999;
    delete gang.finances!.campaignCost;
    const loaded = Sim.fromSave(structuredClone(w));
    gang.campaignSpend = 0;
    weeklyEconomy(w, sim.rng); weeklyEconomy(loaded.world, loaded.rng);
    weeklyPolitics(w, sim.rng); weeklyPolitics(loaded.world, loaded.rng);
    expect(loaded.playerGang.finances).toEqual(gang.finances);
    expect(loaded.playerGang.finances!.campaignCost).toBe(140);
    expect(loaded.world.election.candidates).toEqual(w.election.candidates);
  });

  it.each(['inactive', 'not on ballot', 'withdrawn'])('does not charge a %s campaign', condition => {
    const { sim, w, gang } = fixture();
    expect(setRunForOffice(w, gang.id, true).ok).toBe(true);
    if (condition === 'inactive') w.election.active = false;
    if (condition === 'not on ballot') w.election.candidates = w.election.candidates.filter(c => c.gangId == null);
    if (condition === 'withdrawn') setRunForOffice(w, gang.id, false);
    weeklyEconomy(w, sim.rng);
    expect(gang.finances!.campaignCost).toBe(0);
    expect(gang.finances!.costs.upkeep).toBe(0);
    expect(gang.runningForOffice).toBe(false);
  });

  it.each([-1, 1.5, 141])('rejects a corrupt paid campaign breakdown: %s', cost => {
    const { sim, w, gang } = fixture();
    expect(setRunForOffice(w, gang.id, true).ok).toBe(true);
    weeklyEconomy(w, sim.rng);
    gang.finances!.campaignCost = cost;
    expect(() => Sim.fromSave(structuredClone(w))).toThrow(/campaign costs/);
  });
});
