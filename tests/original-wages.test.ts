import { describe, expect, it } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { fearOf, hostilityOf, setAttitude } from '../src/sim/attitudes';
import { createWorld } from '../src/sim/citygen';
import { originalSkimFraction, originalWageQuote, originalWeeklyWage, skillByte } from '../src/sim/originalWages';
import { SKILLS, type Person } from '../src/sim/types';
import { gangMembers } from '../src/sim/world';
import { launderPool } from '../src/sim/systems/taxes';
import type { FinanceReport } from '../src/sim/types';

const person = (role: Person['role'], stars: number): Person => ({
  id: 1, role, pay: 0, payDemand: 0, loyalty: 50, opinion: {},
  skills: Object.fromEntries(SKILLS.map(s => [s, stars])),
} as unknown as Person);

describe('original wage quote (0x460300 step 6)', () => {
  it('maps half-stars to the Character Generation star bands', () => {
    const p = person('hood', 5);
    expect(skillByte(p, 'intelligence')).toBe(241);
    expect(skillByte(p, 'fists')).toBe(60);
    p.skills.fists = .5;
    expect(skillByte(p, 'fists')).toBe(2);
  });

  it('prices a crew hood from his best and average skill, and an accountant from intelligence only', () => {
    const hood = person('hood', 3), clerk = person('accountant', 3);
    for (const p of [hood, clerk]) setAttitude(p, 1, { hostility: 100, fear: 60 });
    // 3 stars: intelligence 138, other skills 34; h − f = 40.
    const avg = Math.trunc(((138 >> 2) + 34 * 10) / 11), best = 34;
    expect(originalWageQuote(hood, 1)).toBe(50 + Math.trunc((best + 40 + 138 + avg) / 4));
    expect(originalWageQuote(clerk, 1)).toBe(100 + Math.trunc(((138 >> 2) + 40 + 138 + (138 >> 2)) / 4));
    // Each skill above 52 (4½ stars) adds 10 for gang classes.
    const star = person('lieutenant', 5);
    setAttitude(star, 1, { hostility: 0, fear: 0 });
    expect(originalWageQuote(star, 1)).toBe(100 + Math.trunc((60 + 241 + Math.trunc(((241 >> 2) + 600) / 11)) / 4) + 100);
  });
});

describe('weekly pay satisfaction (0x460300 step 7)', () => {
  it('ratchets the demand, rewards full pay and punishes a big shortfall with hostility', () => {
    const p = person('hood', 3);
    setAttitude(p, 1, { hostility: 100, fear: 100 });
    const quote = originalWageQuote(p, 1);
    p.pay = quote; p.payDemand = quote; p.loyalty = 50;
    originalWeeklyWage(p, 1);
    expect(p.loyalty).toBeCloseTo(50 + 4 * 100 / 255);
    // Paid a quarter of the quote: −32 loyalty (byte) and +4 hostility.
    p.pay = Math.round(quote * .25); p.loyalty = 50;
    const h = hostilityOf(p, 1);
    originalWeeklyWage(p, 1);
    expect(p.payDemand).toBe(quote);
    expect(p.loyalty).toBeCloseTo(50 - 32 * 100 / 255);
    expect(hostilityOf(p, 1)).toBe(h + 4);
    // Within 20 of the demand: no change either way.
    p.pay = quote - 15; p.loyalty = 50; originalWeeklyWage(p, 1);
    expect(p.loyalty).toBe(50);
  });
});

describe('greed skim (0x48E140 / 0x4C3AA0)', () => {
  it('skims only when hostile beyond fear by more than 64 and underpaid', () => {
    const p = person('lieutenant', 3);
    p.pay = 100; p.payDemand = 150;
    setAttitude(p, 1, { hostility: 164, fear: 100 });
    expect(originalSkimFraction(p, 1)).toBe(0);
    setAttitude(p, 1, { hostility: 165, fear: 100 });
    expect(originalSkimFraction(p, 1)).toBeCloseTo(((65 + 256) >> 1) / 256);
    p.pay = 150;
    expect(originalSkimFraction(p, 1)).toBe(0);
  });

  it('offers every starting member in the original city his quote', () => {
    const w = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
    for (const g of Object.values(w.gangs)) for (const p of gangMembers(w, g)) {
      if (p.role === 'boss') continue;
      expect([p.pay, p.payDemand]).toEqual([originalWageQuote(p, g.id), originalWageQuote(p, g.id)]);
      expect(fearOf(p, g.id)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('laundering pool (+0x830)', () => {
  it('is laundered by the accountant and raises every premises above $2,000', () => {
    const w = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
    const gang = Object.values(w.gangs).find(g => g.isPlayer)!;
    const owned = Object.values(w.buildings).filter(b => b.ownerGangId === gang.id && b.state !== 'destroyed');
    const report = { income: { legal: 0, illegal: 0, protection: 0, other: 0 } } as FinanceReport;
    gang.launderPool = 1999;
    launderPool(w, gang, report, null);
    expect(owned.every(b => b.fbiSuspicion === 0)).toBe(true);
    gang.launderPool = 4500;
    launderPool(w, gang, report, null);
    expect(owned.every(b => b.fbiSuspicion === 3)).toBe(true);
    // A 2½-star accountant (byte 128) launders legal takings × 128/31.
    const clerk = { skills: { intelligence: 2.5 } } as Person;
    report.income.legal = 1000;
    launderPool(w, gang, report, clerk);
    expect(gang.launderPool).toBe(4500 - Math.trunc(1000 * 128 / 31));
    report.income.legal = 100_000;
    launderPool(w, gang, report, clerk);
    expect(gang.launderPool).toBe(0);
  });
});

