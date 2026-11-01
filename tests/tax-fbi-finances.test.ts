import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { buyVehicle, hireRecruit, sackPerson, sellBuilding, sellVehicle } from '../src/sim/api';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { openFinances, payCash, receiveCash } from '../src/sim/finances';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { weeklyFbi } from '../src/sim/systems/fbi';
import { weeklyLaw } from '../src/sim/systems/law';
import { accountantSkillByte, exposeTaxRecords, originalLevy, weeklyTaxes } from '../src/sim/systems/taxes';
import { buildingValue } from '../src/sim/execution';
import { payOfficialRetainers, weeklyEconomy } from '../src/sim/systems/economy';
import { hostilityOf, setAttitude } from '../src/sim/attitudes';
import { businessCarryingCost } from '../src/sim/businessState';

afterEach(() => vi.restoreAllMocks());
function fixture(accountant = false) {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 500_000 });
  const w = sim.world, g = sim.playerGang;
  w.orders = {};
  for (const t of Object.values(w.teams)) { t.orderIds = []; t.timeUsed = 0; }
  for (const b of Object.values(w.buildings)) if (b.ownerGangId === g.id) b.state = 'ceased';
  const acct = Object.values(w.people).find(p => p.role === 'accountant' && p.gangId == null)!;
  if (accountant) expect(hireRecruit(w, g.id, acct.id, 'pool').ok).toBe(true);
  for (const p of Object.values(w.people)) if (p.gangId === g.id) { p.pay = 0; p.payDemand = 0; }
  return { sim, w, g, acct };
}
function settle(sim: Sim) {
  sim.launchWeek(); sim.world.minute = MINUTES_PER_WEEK - 1;
  sim.advance(1 / MINUTES_PER_SECOND, 1);
}
function previousLegal(s: ReturnType<typeof fixture>, legal: number) {
  s.w.week = 2; s.g.finances!.week = 2;
  s.g.lastFinanceReport = { ...structuredClone(s.g.finances!), week: 1, income: { legal, illegal: 0, protection: 0, other: 0 } };
}

describe('profit, evasion and the Bureau ledger', () => {
  it('taxes all operating profit, including protection and crime receipts, after operating costs', () => {
    const s = fixture();
    receiveCash(s.w, s.g, 'legal', 4000); receiveCash(s.w, s.g, 'illegal', 6000);
    receiveCash(s.w, s.g, 'protection', 2000); receiveCash(s.w, s.g, 'other', 1000);
    payCash(s.w, s.g, 'upkeep', 2000);
    settle(s.sim);
    const report=s.g.lastFinanceReport!;
    expect(report.closedSiteUpkeep).toBeGreaterThan(0);
    expect(report.costs.upkeep).toBe(2000+report.closedSiteUpkeep!);
    expect(report.taxableProfit).toBe(11000-report.closedSiteUpkeep!);
    expect(report.costs.tax).toBe(Math.round((11000-report.closedSiteUpkeep!)*.24));
  });

  it('taxes realized asset profit instead of gross sale proceeds and preserves the basis through saves', () => {
    const s = fixture(); receiveCash(s.w, s.g, 'legal', 4000);
    expect(buyVehicle(s.w, s.g.id, 'coupe').ok).toBe(true);
    expect(sellVehicle(s.w, s.g.id, 'coupe').ok).toBe(true);
    const sim = Sim.fromSave(structuredClone(s.w)); settle(sim);
    // $4,000 receipts less the $1,500 car loss and the ceased front's carrying cost.
    const report=sim.playerGang.lastFinanceReport!;
    expect(report.taxableProfit).toBe(2500-report.closedSiteUpkeep!);
    expect(report.costs.tax).toBe(Math.round((2500-report.closedSiteUpkeep!)*.24));
    expect(sim.playerGang.lastFinanceReport!.income.other).toBe(1500);
  });

  it('uses the previous legal-income report and accountant skill for evasion', () => {
    const held: number[] = [];
    for (const legal of [0, 6000]) {
      const s = fixture(true); previousLegal(s, legal); s.acct.skills.intelligence = 3; s.g.evadingTax = true;
      vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false); // No exceptional over-evasion in this case.
      receiveCash(s.w, s.g, 'legal', 10_000); settle(s.sim);
      held.push(s.g.taxEvaded.at(-1)!);
    }
    expect(held).toEqual([0, 1500]);
  });

  it.each([false, true])('covers old unpaid tax only with an available accountant (available=%s)', available => {
    const s = fixture(available); previousLegal(s, 4000); s.acct.skills.intelligence = 3;
    s.g.uncoveredTax = 5000; s.g.evadingTax = false;
    settle(s.sim);
    expect(s.g.uncoveredTax).toBe(available ? 4000 : 5000);
    expect(s.g.taxEvaded.at(-1)).toBe(0);
  });

  it('stops new risky money in a quiet week while suspicion remains', () => {
    const s = fixture(); receiveCash(s.w, s.g, 'illegal', 5000);
    weeklyFbi(s.w, s.sim.rng); expect(s.g.suspicion).toBeGreaterThan(0);
    const before = s.g.suspicion;
    s.w.week++; openFinances(s.w, s.g); s.g.lastWeekIncome = { legal: 0, illegal: 0, protection: 0, other: 0 };
    weeklyFbi(s.w, s.sim.rng);
    expect(s.g.riskyMoney).toBe(0); expect(s.g.suspicion).toBeGreaterThan(0); expect(s.g.suspicion).toBeLessThan(before);
  });

  it('a dismissed accountant keeps evidence and exposes it only once if arrested', () => {
    const s = fixture(true); s.g.uncoveredTax = 5000; settle(s.sim);
    expect(sackPerson(s.w, s.g.id, s.acct.id).ok).toBe(true);
    s.acct.status = 'arrested';
    const sim = Sim.fromSave(structuredClone(s.w)), before = sim.playerGang.evidence;
    vi.spyOn(sim.rng, 'chance').mockReturnValue(false);
    weeklyLaw(sim.world, sim.rng);
    expect(sim.playerGang.evidence).toBeGreaterThan(before);
    expect(sim.world.crimes.some(c => c.kind === 'taxEvasion' && c.perpetratorId === sim.playerGang.bossId && c.witnesses.includes(s.acct.id))).toBe(true);
    const after = sim.playerGang.evidence;
    sim.world.people[s.acct.id].status = 'arrested'; weeklyLaw(sim.world, sim.rng);
    expect(sim.playerGang.evidence).toBe(after);
    expect(sim.world.crimes.filter(c => c.kind === 'taxEvasion')).toHaveLength(1);
  });

  it('keeps exceptional over-evasion on record and covers it before hiding new tax', () => {
    const s = fixture(true); previousLegal(s, 4000); s.acct.skills.intelligence = 3; s.g.evadingTax = true;
    receiveCash(s.w, s.g, 'legal', 10_000);
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    weeklyTaxes(s.w, s.sim.rng);
    expect(s.g.taxEvaded).toEqual([1720]); expect(s.g.uncoveredTax).toBe(720);
    expect(s.acct.taxRecords?.[s.g.id]).toBe(720);
    const restored = Sim.fromSave(structuredClone(s.w)), g = restored.playerGang;
    restored.world.week++; openFinances(restored.world, g);
    g.lastFinanceReport = { ...structuredClone(g.finances!), week: 2, income: { legal: 4000, illegal: 0, protection: 0, other: 0 } };
    receiveCash(restored.world, g, 'legal', 10_000);
    vi.spyOn(restored.rng, 'chance').mockReturnValue(false);
    weeklyTaxes(restored.world, restored.rng);
    expect(g.taxEvaded).toEqual([1720, 280]); expect(g.uncoveredTax).toBe(0);
    expect(restored.world.people[s.acct.id].taxRecords?.[g.id]).toBe(0);
  });

  it('retains only eight weeks and gives no concealment for stale or negative prior income', () => {
    const s = fixture(true); previousLegal(s, -500); s.g.evadingTax = true; s.g.taxEvaded = [1,2,3,4,5,6,7,8];
    receiveCash(s.w, s.g, 'legal', 1000); vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    weeklyTaxes(s.w, s.sim.rng); expect(s.g.taxEvaded).toEqual([2,3,4,5,6,7,8,0]);
    s.g.lastFinanceReport!.week = 0; s.g.lastFinanceReport!.income.legal = 10_000;
    weeklyTaxes(s.w, s.sim.rng); expect(s.g.taxEvaded.at(-1)).toBe(0);
  });

  it('books a saved property gain and deducts operating purchases, not capital purchases', () => {
    const s = fixture();
    const b = Object.values(s.w.buildings).find(b => b.ownerGangId == null && !b.isHQ && b.hidesId == null && b.cls === 'commercial')!;
    b.ownerGangId = s.g.id;
    b.acquisitionCost = buildingValue(s.w, b) - 1000;
    const sim = Sim.fromSave(structuredClone(s.w));
    expect(sellBuilding(sim.world, sim.playerGang.id, b.id).ok).toBe(true);
    payCash(sim.world, sim.playerGang, 'purchases', 200);
    expect(buyVehicle(sim.world, sim.playerGang.id, 'coupe').ok).toBe(true);
    weeklyTaxes(sim.world, sim.rng);
    expect(sim.playerGang.finances!.taxableProfit).toBe(800);
    expect(sim.playerGang.finances!.costs.tax).toBe(192);
    expect(sim.playerGang.finances!.riskyIncome).toBe(0);
  });

  it('loads older cash ledgers conservatively without inventing asset gains or old risky money', () => {
    const s = fixture(); const report = s.g.finances!;
    report.income = {legal: 2000, illegal: 500, protection: 100, other: 10_000};
    report.costs = { wages: 200, purchases: 6000, upkeep: 100, tax: 0 };
    delete report.taxableProfit; delete report.riskyIncome; s.g.riskyMoney = 50_000;
    const sim = Sim.fromSave(structuredClone(s.w));
    expect(sim.playerGang.finances).toMatchObject({partial: true, taxableProfit: 2300, riskyIncome: 600});
    weeklyTaxes(sim.world, sim.rng); expect(sim.playerGang.finances!.costs.tax).toBe(552);
    sim.world.week++; openFinances(sim.world, sim.playerGang); sim.playerGang.lastWeekIncome.legal = 0;
    weeklyFbi(sim.world, sim.rng); expect(sim.playerGang.riskyMoney).toBe(0);
  });

  it('does not expose a dead accountant or duplicate records from a replacement', () => {
    const s = fixture(true); s.g.uncoveredTax = 5000;
    const next = Object.values(s.w.people).find(p => p.role === 'accountant' && p.gangId == null)!;
    expect(hireRecruit(s.w, s.g.id, next.id, 'pool').ok).toBe(true);
    expect(s.acct.taxRecords?.[s.g.id]).toBe(5000);
    s.acct.status = 'dead'; expect(exposeTaxRecords(s.w)).toHaveLength(0);
    next.status = 'arrested'; expect(exposeTaxRecords(s.w)).toHaveLength(1);
    s.acct.status = 'arrested'; expect(exposeTaxRecords(s.w)).toHaveLength(0);
    expect(s.g.evidence).toBe(10);
  });

  it('does not let an old accountant claim knowledge of new debt after their records were covered', () => {
    const s = fixture(true); previousLegal(s, 4000); s.acct.skills.intelligence = 3; s.g.uncoveredTax = 1000;
    expect(sackPerson(s.w, s.g.id, s.acct.id).ok).toBe(true);
    const next = Object.values(s.w.people).find(p => p.role === 'accountant' && p.gangId == null && p.id !== s.acct.id)!;
    expect(hireRecruit(s.w, s.g.id, next.id, 'pool').ok).toBe(true); next.skills.intelligence = 3;
    weeklyTaxes(s.w, s.sim.rng); expect(s.g.uncoveredTax).toBe(0);
    expect(s.acct.taxRecords?.[s.g.id]).toBe(0);
    s.g.uncoveredTax = 1000; s.acct.status = 'arrested'; expect(exposeTaxRecords(s.w)).toHaveLength(0);
    next.status = 'arrested'; expect(exposeTaxRecords(s.w)).toHaveLength(1);
  });

  it('uses a new accountant arrest to open a tax case against the boss in the same settlement', () => {
    const s = fixture(true); s.g.uncoveredTax = 5000;
    s.w.crimes.push({id: s.w.sequences.crime++, week:s.w.week, gangId:s.g.id, perpetratorId:s.acct.id,
      kind:'raid', buildingId:null, victimId:null, witnesses:[], reported:true, arrestRisk:1});
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    weeklyLaw(s.w, s.sim.rng);
    expect(s.w.crimes.filter(c => c.kind === 'taxEvasion')).toHaveLength(1);
    expect(Object.values(s.w.cases).some(c => c.defendantId === s.g.bossId && c.crime === 'tax evasion')).toBe(true);
  });

  it('counts protection, crime and laundered receipts once and excludes asset receipts', () => {
    const s = fixture(); receiveCash(s.w, s.g, 'protection', 700); receiveCash(s.w, s.g, 'other', 300);
    expect(buyVehicle(s.w, s.g.id, 'coupe').ok).toBe(true); expect(sellVehicle(s.w, s.g.id, 'coupe').ok).toBe(true);
    const b = Object.values(s.w.buildings).find(b => b.ownerGangId === s.g.id && b.cls !== 'illegal')!;
    b.typeId = 'jewellers'; b.cls = 'commercial'; // A legal fence supports both goods kinds.
    b.state = 'trading'; b.stock.counterfeit = 2; b.stock.stolen = 12; b.managerId = null;
    weeklyEconomy(s.w, s.sim.rng);
    expect(s.g.finances!.riskyIncome).toBe(2720);
  });

  it('rejects corrupt saved records while allowing negative operating profit', () => {
    const s = fixture(true); s.g.finances!.taxableProfit = -100;
    expect(() => Sim.fromSave(structuredClone(s.w))).not.toThrow();
    s.g.finances!.riskyIncome = -1; expect(() => Sim.fromSave(structuredClone(s.w))).toThrow(/risky income/);
    s.g.finances!.riskyIncome = 0; s.acct.taxRecords = {[s.g.id]:-1};
    expect(() => Sim.fromSave(structuredClone(s.w))).toThrow(/tax records/);
    s.acct.taxRecords = {[999999]:1}; expect(() => Sim.fromSave(structuredClone(s.w))).toThrow(/tax records/);
    s.acct.taxRecords = {}; s.g.exposedTax = 1; expect(() => Sim.fromSave(structuredClone(s.w))).toThrow(/disclosed tax/);
  });
});

describe('the original boss levy (0x6CFB30 / 0x4BF180)', () => {
  it('takes 20% of the whole ledger net, purchases included, and nothing from a loss', () => {
    const r = openFinances({ week: 1 } as never, { cash: 0 } as never);
    r.income.legal = 5000; r.income.illegal = 3000; r.income.other = 2000;
    r.costs.wages = 1000; r.costs.purchases = 2500; r.costs.upkeep = 500;
    expect(originalLevy(r)).toBe(1200);
    r.costs.purchases = 20_000;
    expect(originalLevy(r)).toBe(0);
  });

  it('a player accountant told to evade saves levy·skill/256; an AI gang’s always does', () => {
    const sim = new Sim({ ...newCampaignOptions(), seed: 404 });
    const w = sim.world, g = sim.playerGang;
    expect(w.cityLayout?.original).toBeTruthy();
    const acct = Object.values(w.people).find(p => p.role === 'accountant' && p.gangId == null)!;
    expect(hireRecruit(w, g.id, acct.id, 'pool').ok).toBe(true);
    acct.skills.intelligence = 2.5;                   // byte 128: saves half the levy
    openFinances(w, g); receiveCash(w, g, 'legal', 10_000);
    g.evadingTax = false; weeklyTaxes(w, sim.rng);
    expect(g.finances!.costs.tax).toBe(2000);
    openFinances(w, g); receiveCash(w, g, 'legal', 10_000);
    g.evadingTax = true; weeklyTaxes(w, sim.rng);
    expect(g.taxEvaded.at(-1)).toBe(Math.floor(2000 * accountantSkillByte(2.5) / 256));
    expect(g.finances!.costs.tax).toBe(2000 - g.taxEvaded.at(-1)!);
  });
});

describe('the original wage ladder (0x6D3D20)', () => {
  it('half pay: crew +8 hostility, −16/255 loyalty; no pay: +32, −48/255', () => {
    for (const [cash, hostility, loyalty] of [['half', 8, 16], ['none', 32, 48]] as const) {
      const sim = new Sim({ ...newCampaignOptions(), seed: 404 });
      const w = sim.world, g = sim.playerGang;
      const hood = Object.values(w.people).find(p => p.gangId === g.id && p.role === 'hood')!;
      w.orders = {};
      for (const t of Object.values(w.teams)) { t.orderIds = []; t.timeUsed = 0; }
      for (const b of Object.values(w.buildings)) if (b.ownerGangId === g.id) b.state = 'ceased';
      const bill = Object.values(w.people).filter(p => p.gangId === g.id && p.role !== 'boss').reduce((a, p) => a + p.pay, 0)
        + Object.values(w.buildings).filter(b => b.ownerGangId === g.id).reduce((a, b) => a + businessCarryingCost(b), 0)
        + g.employedPoliceIds.reduce((a, id) => a + (w.people[id]?.weeklyRetainer ?? 0), 0);
      hood.loyalty = 80;
      const before = hostilityOf(hood, g.id);
      g.cash = cash === 'half' ? Math.ceil(bill * .75) : 0;
      settle(sim);
      expect(hostilityOf(hood, g.id)).toBe(Math.min(255, before + hostility));
      // 0x460300 then judges the agreed wage, not the cash: a member on his
      // quote gains 4 (byte) the same week, whatever the treasury paid.
      expect(hood.loyalty).toBeCloseTo(Math.min(100, 80) - loyalty * 100 / 255 + 4 * 100 / 255, 5);
    }
  });
});

describe('officials on the payroll in the original city (0x75DA90)', () => {
  function payroll(cash: number) {
    const sim = new Sim({ ...newCampaignOptions(), seed: 404 });
    const w = sim.world, g = sim.playerGang;
    const cops = Object.values(w.people).filter(p => p.role === 'police' && p.status === 'active' && p.employedBy == null).slice(0, 3);
    for (const c of cops) {
      c.employedBy = g.id; c.weeklyRetainer = 400; g.employedPoliceIds.push(c.id);
      setAttitude(c, g.id, { hostility: 40, fear: 20 });
    }
    openFinances(w, g); g.cash = cash;
    return { w, g, cops };
  }

  it('pays everyone in full when the safe allows', () => {
    const { w, g, cops } = payroll(5000);
    payOfficialRetainers(w, g);
    expect(g.cash).toBe(5000 - 1200);
    expect(cops.every(c => c.employedBy === g.id && !c.retainerShort && hostilityOf(c, g.id) === 40)).toBe(true);
  });

  it('halves the first it cannot cover, halves or lets go the rest', () => {
    // 1,100: two paid in full (800); the third's 1,200 does not fit → half (1,000).
    const a = payroll(1100);
    payOfficialRetainers(a.w, a.g);
    expect(a.g.cash).toBe(100);
    expect(a.cops.map(c => [c.employedBy === a.g.id, !!c.retainerShort, hostilityOf(c, a.g.id)])).toEqual([[true, false, 40], [true, false, 40], [true, true, 60]]);
    // 700: second halved (total 600), third's half (800) does not fit → let go.
    const b = payroll(700);
    payOfficialRetainers(b.w, b.g);
    expect(b.g.cash).toBe(100);
    expect(b.cops[2].employedBy).toBeNull();
    expect(hostilityOf(b.cops[2], b.g.id)).toBe(120);            // +20, then +60
    expect(b.g.employedPoliceIds).not.toContain(b.cops[2].id);
  });

  it('takes back the cut when full pay resumes, and loses anyone too hostile', () => {
    const { w, g, cops } = payroll(5000);
    cops[0].retainerShort = true; setAttitude(cops[0], g.id, { hostility: 60, fear: 20 });
    setAttitude(cops[1], g.id, { hostility: 200, fear: 20 });
    payOfficialRetainers(w, g);
    expect(hostilityOf(cops[0], g.id)).toBe(30);
    expect(cops[0].retainerShort).toBeUndefined();
    expect(cops[1].employedBy).toBeNull();
    expect(g.cash).toBe(5000 - 800);
  });
});
