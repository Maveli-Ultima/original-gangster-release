import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { buyWeapon, sellWeapon } from '../src/sim/api';
import { financeNet, openFinances } from '../src/sim/finances';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { weeklyEconomy } from '../src/sim/systems/economy';
import type { FinanceReport } from '../src/sim/types';

const create = () => new Sim({ ...defaultGameOptions(), seed: 202, citySize: 10 });
function reconciles(report: FinanceReport) {
  expect(report.openingCash + financeNet(report)).toBeCloseTo(report.closingCash, 8);
}

describe('Monday-to-Friday financial reports', () => {
  it.each([false, true])('books a loss-making charity once and never grants a negative tax bill (evasion=%s)', evading => {
    const sim = create(), w = sim.world, gang = sim.playerGang;
    const site = Object.values(w.buildings).find(b => b.ownerGangId === gang.id && b.managerId != null)!;
    for (const b of Object.values(w.buildings)) if (b.ownerGangId === gang.id) b.state = 'ceased';
    site.typeId = 'soupKitchen'; site.cls = 'charity'; site.state = 'trading';
    if (evading) {
      const accountant = Object.values(w.people).find(p => p.role === 'accountant' && p.gangId == null)!;
      accountant.gangId = gang.id; gang.accountantId = accountant.id; gang.evadingTax = true;
    }
    sim.launchWeek(); w.minute = MINUTES_PER_WEEK - 1; sim.advance(1 / MINUTES_PER_SECOND, 1);
    const report = gang.lastFinanceReport!;
    expect(report.income.legal).toBeLessThan(0);
    expect(report.income.legal).toBe(site.lastProfit);
    expect.soft(report.costs.upkeep).toBe(0);
    expect.soft(report.costs.tax).toBe(0); expect.soft(gang.taxEvaded.at(-1)).toBe(0);
    expect.soft(gang.riskyMoney).toBe(0);
    expect(gang.cash).toBe(report.openingCash + site.lastProfit - report.costs.wages);
    reconciles(report);
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();
  });

  it('keeps planning purchases and sales through launch and a saved-game restoration', () => {
    const sim = create(), gang = sim.playerGang;
    const opening = gang.cash;
    expect(buyWeapon(sim.world, gang.id, 'pistol').ok).toBe(true);
    expect(sellWeapon(sim.world, gang.id, 'pistol').ok).toBe(true);
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(sim.world)));
    restored.launchWeek();
    expect(restored.playerGang.finances).toMatchObject({ openingCash: opening, closingCash: opening - 50, costs: { purchases: 100 }, income: { other: 50 } });
    expect(restored.playerGang.lastWeekCosts.purchases).toBe(100);
    expect(restored.playerGang.lastWeekIncome.other).toBe(50);
    reconciles(restored.playerGang.finances!);
  });

  it.each([false, true])('reconciles taxes and settlement with evasion=%s, retaining a separate completed report', (evading) => {
    const sim = create(), gang = sim.playerGang, w = sim.world;
    if (evading) {
      const accountant = Object.values(w.people).find(p => p.role === 'accountant')!;
      accountant.gangId = gang.id;
      gang.accountantId = accountant.id;
      gang.evadingTax = true;
    }
    buyWeapon(w, gang.id, 'pistol');
    sim.launchWeek();
    buyWeapon(w, gang.id, 'pistol');
    sim.finishWeek();
    const completed = gang.lastFinanceReport!;
    expect(completed.costs.purchases).toBe(200);
    const profit = Object.values(completed.income).reduce((a, b) => a + b, 0) - completed.costs.wages - completed.costs.upkeep;
    // The only purchases above are capital weapons; they are not operating expenses.
    expect(completed.taxableProfit).toBeCloseTo(profit, 8);
    expect(completed.costs.tax).toBe(Math.round(Math.max(0, profit) * .24) - gang.taxEvaded.at(-1)!);
    for (const g of Object.values(w.gangs)) reconciles(g.lastFinanceReport!);
    const preserved = JSON.stringify(completed);
    buyWeapon(w, gang.id, 'pistol');
    expect(JSON.stringify(gang.lastFinanceReport)).toBe(preserved);
    expect(gang.finances!.week).toBe(2);
    expect(gang.finances!.costs.purchases).toBe(100);
    expect(gang.finances!.openingCash).toBe(completed.closingCash);
    sim.launchWeek();
    expect(gang.lastWeekCosts.purchases).toBe(100);
    reconciles(gang.finances!);
  }, 60000);

  it('reports only wages and retainers actually paid when money runs short', () => {
    const sim = create(), gang = sim.playerGang, w = sim.world;
    for (const b of Object.values(w.buildings)) b.state = 'ceased';
    gang.cash = 0;
    gang.runningForOffice = true;
    gang.campaignSpend = 1000;
    openFinances(w, gang);
    weeklyEconomy(w, sim.rng);
    expect(gang.finances!.costs.wages).toBe(0);
    expect(gang.finances!.costs.upkeep).toBe(0);
    expect(gang.lastWeekCosts.upkeep).toBe(0);
    reconciles(gang.finances!);
  });

  it('marks older saves as partial instead of inventing missing transactions', () => {
    const sim = create();
    buyWeapon(sim.world, sim.playerGang.id, 'pistol');
    const saved = JSON.parse(JSON.stringify(sim.world));
    for (const gang of Object.values(saved.gangs) as any[]) delete gang.finances;
    const restored = Sim.fromSave(saved);
    expect(restored.playerGang.finances!.partial).toBe(true);
    expect(restored.playerGang.finances!.openingCash).toBe(restored.playerGang.cash);
    expect(restored.playerGang.finances!.costs.purchases).toBe(0);
    buyWeapon(restored.world, restored.playerGang.id, 'pistol');
    reconciles(restored.playerGang.finances!);
  });
});
