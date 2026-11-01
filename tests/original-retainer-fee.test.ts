import { describe, expect, it } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { fearOf, hostilityOf, setAttitude } from '../src/sim/attitudes';
import { openFinances } from '../src/sim/finances';
import { completePoliceEmployment } from '../src/sim/officials';
import { onGangPayroll } from '../src/sim/payrollMark';
import { originalRetainerFloor, originalRetainerQuote } from '../src/sim/originalWages';
import { Sim } from '../src/sim/sim';
import { payOfficialRetainers } from '../src/sim/systems/economy';

/** Original city: officials' retainers, hire 0x75D3B0 and weekly pass 0x75DA90. */
function city(cash = 5000) {
  const sim = new Sim({ ...newCampaignOptions(), seed: 404 });
  const w = sim.world, g = sim.playerGang;
  expect(w.cityLayout?.original).toBeTruthy();
  openFinances(w, g); g.cash = cash;
  const free = Object.values(w.people).filter(p => p.role === 'police' && p.status === 'active' && p.employedBy == null);
  return { w, g, free };
}

function onPayroll(c: ReturnType<typeof city>, attitudes: [number, number][], fee: number) {
  return attitudes.map(([hostility, fear], i) => {
    const o = c.free[i];
    o.employedBy = c.g.id; o.weeklyRetainer = fee; c.g.employedPoliceIds.push(o.id);
    setAttitude(o, c.g.id, { hostility, fear });
    return o;
  });
}

describe('the retainer quote and floor (original dollars)', () => {
  it('quotes (eff >> 1) + 50 with eff = (h − f + 256) >> 1; the floor is a fifth', () => {
    const { g, free } = city();
    const o = free[0];
    setAttitude(o, g.id, { hostility: 40, fear: 20 });     // eff 138
    expect(originalRetainerQuote(o, g.id)).toBe(119);
    expect(originalRetainerFloor(o, g.id)).toBe(23);
    setAttitude(o, g.id, { hostility: 255, fear: 0 });     // eff 255
    expect(originalRetainerQuote(o, g.id)).toBe(177);
    expect(originalRetainerFloor(o, g.id)).toBe(35);
    setAttitude(o, g.id, { hostility: 0, fear: 255 });     // eff 0
    expect(originalRetainerQuote(o, g.id)).toBe(50);
    expect(originalRetainerFloor(o, g.id)).toBe(10);
  });
});

describe('the lawyer hires an officer (0x75D3B0)', () => {
  it('sets the fee to his quote before the hire, then halves his hostility; no cash check', () => {
    const { w, g, free } = city(0);
    const o = free[0];
    setAttitude(o, g.id, { hostility: 80, fear: 20 });     // eff 158 → fee 129
    expect(completePoliceEmployment(w, g.id, o).ok).toBe(true);
    expect(o.employedBy).toBe(g.id);
    expect(o.weeklyRetainer).toBe(129);
    expect(hostilityOf(o, g.id)).toBe(40);
    expect(fearOf(o, g.id)).toBe(20);
    expect(g.employedPoliceIds).toContain(o.id);
  });
});

describe('the weekly pass over the payroll (0x75DA90)', () => {
  it('adds the shortfall below the floor to hostility', () => {
    const c = city();
    const [o] = onPayroll(c, [[40, 20]], 5);                // floor 23 → +18
    payOfficialRetainers(c.w, c.g);
    expect(hostilityOf(o, c.g.id)).toBe(58);
    expect(o.employedBy).toBe(c.g.id);
    expect(c.g.cash).toBe(5000 - 5);
  });

  it('a fee at or above the floor costs nothing', () => {
    const c = city();
    const [o] = onPayroll(c, [[40, 20]], 23);
    payOfficialRetainers(c.w, c.g);
    expect(hostilityOf(o, c.g.id)).toBe(40);
  });

  it('pays the most hostile first', () => {
    const c = city(150);
    const [a, b, d] = onPayroll(c, [[40, 20], [100, 20], [70, 20]], 100);
    payOfficialRetainers(c.w, c.g);
    // Order b (eff 168), d (153), a (138): b in full, d halved, a cannot get half.
    expect(c.g.employedPoliceIds).toEqual([b.id, d.id]);
    expect(b.retainerShort).toBeUndefined();
    expect(hostilityOf(b, c.g.id)).toBe(100);
    expect(d.retainerShort).toBe(true);
    expect(hostilityOf(d, c.g.id)).toBe(105);
    expect(a.employedBy).toBeNull();
    expect(hostilityOf(a, c.g.id)).toBe(120);                // +20 for the half, then +60
    expect(c.g.cash).toBe(0);
  });

  it('a quitter gains 32 hostility and every later official loses 32 fear per quitter', () => {
    const c = city();
    const [q1, q2, k] = onPayroll(c, [[220, 20], [190, 40], [40, 100]], 100);
    payOfficialRetainers(c.w, c.g);
    expect(q1.employedBy).toBeNull();
    expect(hostilityOf(q1, c.g.id)).toBe(252);
    expect(fearOf(q2, c.g.id)).toBe(8);                      // 40 − 32
    expect(q2.employedBy).toBeNull();                        // 190 − 8 > 128
    expect(hostilityOf(q2, c.g.id)).toBe(222);
    expect(fearOf(k, c.g.id)).toBe(36);                      // 100 − 64
    expect(k.employedBy).toBe(c.g.id);
    expect(c.g.employedPoliceIds).toEqual([k.id]);
    expect(c.g.cash).toBe(5000 - 100);
  });

  it('a quitter keeps the payroll bit: still the gang\'s man, and never hired by it again', () => {
    const c = city();
    const [q] = onPayroll(c, [[220, 20]], 100);
    payOfficialRetainers(c.w, c.g);
    expect(q.employedBy).toBeNull();
    expect(q.quitPayrollOf).toEqual([c.g.id]);
    expect(onGangPayroll(q, c.g.id)).toBe(true);             // investigations and the street still spare the gang
    const again = completePoliceEmployment(c.w, c.g.id, q);
    expect(again.ok).toBe(false);
    expect(q.employedBy).toBeNull();
    const rival = Object.values(c.w.gangs).find(g => !g.isPlayer)!;
    expect(onGangPayroll(q, rival.id)).toBe(false);
    expect(completePoliceEmployment(c.w, rival.id, q).ok).toBe(true);   // another gang's bit is clear
  });

  it('one let go when the safe runs short carries no bit', () => {
    const c = city(0);
    const [a, b] = onPayroll(c, [[40, 100], [40, 100]], 100);
    payOfficialRetainers(c.w, c.g);
    expect(b.employedBy).toBeNull();
    expect(b.quitPayrollOf).toBeUndefined();
    expect(onGangPayroll(b, c.g.id)).toBe(false);
    expect(a.quitPayrollOf).toBeUndefined();
  });
});
