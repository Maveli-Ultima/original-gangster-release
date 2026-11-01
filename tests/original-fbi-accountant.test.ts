import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { Rng } from '../src/sim/rng';
import { validateSaveWorld } from '../src/sim/saveSchema';
import {
  CRACKDOWN_PAYROLL, accountantCheck, evasionWeeks, fbiZeal, payrollCrackdown, raidHeadquarters,
  recordAccountantWeek, serveAccountantWarrants, weeklyFbi,
} from '../src/sim/systems/fbi';
import type { Gang, Person, WorldState } from '../src/sim/types';
import { allBuildings } from '../src/sim/world';

function city(options = newCampaignOptions()) {
  const w = createWorld({ ...options, seed: 404 }).world;
  const player = Object.values(w.gangs).find(g => g.isPlayer)!;
  const ai = Object.values(w.gangs).find(g => !g.isPlayer)!;
  return { w, player, ai };
}

/** Make a gang member the gang's accountant. */
function accountant(w: WorldState, g: Gang, stars: number): Person {
  const p = Object.values(w.people).find(q => q.gangId === g.id && q.id !== g.bossId && q.role !== 'accountant')!;
  p.role = 'accountant'; p.status = 'active'; p.skills.intelligence = stars; p.teamId = null;
  delete p.taxEvasionWeeks; delete p.fbiWarrant;
  g.accountantId = p.id;
  return p;
}

const roundTrip = (w: WorldState) => validateSaveWorld(JSON.parse(JSON.stringify(w)));
const hq = (w: WorldState, g: Gang) => allBuildings(w).find(b => b.isHQ && b.ownerGangId === g.id)!;
const activeAgent = (w: WorldState) => { const a = w.people[w.fbiIds[0]]; a.status = 'active'; return a; };

describe('the FBI zeal (FBI+4, 0x4F3CE0)', () => {
  it('is rolled once, 128 + rand % 80, and saved', () => {
    const { w } = city();
    expect(w.fbiZeal).toBeUndefined();
    const zeal = fbiZeal(w, new Rng(7));
    expect(zeal).toBeGreaterThanOrEqual(128);
    expect(zeal).toBeLessThanOrEqual(207);
    expect(fbiZeal(w, new Rng(99))).toBe(zeal);
    for (let seed = 1; seed < 300; seed++) {
      const v = fbiZeal({ fbiZeal: undefined } as WorldState, new Rng(seed));
      expect(v >= 128 && v <= 207).toBe(true);
    }
    expect(() => roundTrip(w)).not.toThrow();
    w.fbiZeal = 208;
    expect(() => roundTrip(w)).toThrow('FBI zeal');
  });
});

describe('the accountant\'s sixteen weeks of evasion (+0xB0, 0x4BEF30, 0x4BF180, 0x4BF160)', () => {
  it('keeps the last sixteen weeks of levy kept back and counts those above 0', () => {
    const { w, player } = city();
    const p = accountant(w, player, 3);
    for (let i = 0; i < 20; i++) {
      player.taxEvaded.push(i % 3 === 0 ? 0 : 50 + i);
      recordAccountantWeek(w, player);
    }
    expect(p.taxEvasionWeeks!.length).toBe(16);
    // Weeks 4..19 of the twenty: 5 of them (6, 9, 12, 15, 18) were honest.
    expect(evasionWeeks(p)).toBe(11);
    expect(() => roundTrip(w)).not.toThrow();
    p.taxEvasionWeeks!.push(1);
    expect(() => roundTrip(w)).toThrow('evasion history');
  });

  it('advances the ring for a jailed accountant too (his weekly turn runs regardless)', () => {
    const { w, player } = city();
    const p = accountant(w, player, 3);
    p.status = 'jailed';
    player.taxEvaded.push(0);
    recordAccountantWeek(w, player);
    expect(p.taxEvasionWeeks).toEqual([0]);
    p.status = 'dead';
    recordAccountantWeek(w, player);
    expect(p.taxEvasionWeeks).toEqual([0]);
  });
});

describe('the accountant check in the FBI\'s weekly turn (0x4F5AE0)', () => {
  it('wants him when (Intelligence >> 1) + 150 < zeal + n × 10', () => {
    const { w, player } = city();
    const p = accountant(w, player, 0);                  // byte 0: 150
    w.fbiZeal = 150;
    expect(accountantCheck(w, player)).toBe(false);      // 150 < 150 fails
    expect(p.fbiWarrant).toBeUndefined();
    w.fbiZeal = 151;
    expect(accountantCheck(w, player)).toBe(true);       // no evasion needed
    expect(p.fbiWarrant).toBe(true);

    const q = accountant(w, player, 5);                  // byte 255: 127 + 150 = 277
    w.fbiZeal = 207;
    q.taxEvasionWeeks = [1, 1, 1, 1, 1, 1, 1];           // 207 + 70 = 277
    expect(accountantCheck(w, player)).toBe(false);
    q.taxEvasionWeeks.push(1);                           // 287
    expect(accountantCheck(w, player)).toBe(true);
    expect(q.fbiWarrant).toBe(true);
    expect(() => roundTrip(w)).not.toThrow();
  });

  it('passes over a gang whose boss is under arrest, or a gang with no accountant', () => {
    const { w, player } = city();
    const p = accountant(w, player, 0);
    w.fbiZeal = 207;
    w.people[player.bossId].status = 'arrested';
    expect(accountantCheck(w, player)).toBe(false);
    w.people[player.bossId].status = 'active';
    player.accountantId = null;
    expect(accountantCheck(w, player)).toBe(false);
    expect(p.fbiWarrant).toBeUndefined();
  });
});

describe('serving the accountant\'s warrant (remake mapping of 0x49A530 + 0x4F47C3)', () => {
  it('arrests a bright accountant and charges him with tax evasion', () => {
    const { w, player } = city();
    const p = accountant(w, player, 5);
    p.fbiWarrant = true;
    const agent = activeAgent(w);
    const crimes = w.crimes.length;
    serveAccountantWarrants(w, new Rng(3));
    expect(p.status).toBe('arrested');
    expect(p.fbiWarrant).toBeUndefined();
    const charge = w.crimes.slice(crimes).find(c => c.perpetratorId === p.id)!;
    expect(charge.kind).toBe('taxEvasion');
    expect(charge.gangId).toBe(player.id);
    expect(charge.witnesses).toEqual([agent.id]);
    expect(() => roundTrip(w)).not.toThrow();
  });

  it('leaves the warrant standing when he resists or breaks away', () => {
    const { w, player, ai } = city();
    const dull = accountant(w, player, 0);               // −16..15: resists
    const middling = accountant(w, ai, 1);               // 35..66: breaks away
    dull.fbiWarrant = true; middling.fbiWarrant = true;
    activeAgent(w);
    serveAccountantWarrants(w, new Rng(3));
    expect(dull.status).toBe('active');
    expect(middling.status).toBe('active');
    expect(dull.fbiWarrant).toBe(true);
    expect(middling.fbiWarrant).toBe(true);
  });

  it('needs an agent on duty', () => {
    const { w, player } = city();
    const p = accountant(w, player, 5);
    p.fbiWarrant = true;
    for (const id of w.fbiIds) w.people[id].status = 'dead';
    serveAccountantWarrants(w, new Rng(3));
    expect(p.status).toBe('active');
    expect(p.fbiWarrant).toBe(true);
  });

  it('charges a wanted accountant taken in a raid on the office with tax evasion', () => {
    const { w, player } = city();
    const office = hq(w, player);
    const p = accountant(w, player, 5);
    p.fbiWarrant = true; p.buildingId = office.id; p.inVehicle = false;
    const boss = w.people[player.bossId];
    boss.buildingId = null; boss.inVehicle = false; boss.pos = { x: -500, y: -500 };
    player.fbiRaidWeek = w.week;
    const crimes = w.crimes.length;
    raidHeadquarters(w, new Rng(4), office, activeAgent(w));
    expect(p.status).toBe('arrested');
    expect(p.fbiWarrant).toBeUndefined();
    expect(w.crimes.slice(crimes).find(c => c.perpetratorId === p.id)!.kind).toBe('taxEvasion');
  });

  it('runs in the weekly turn: wanted one week, the agents come the next', () => {
    const { w, player, ai } = city();
    for (const g of Object.values(w.gangs)) g.accountantId = null;
    const p = accountant(w, player, 5);
    p.taxEvasionWeeks = Array(15).fill(100);
    player.taxEvaded.push(100);                          // this week's makes sixteen
    w.fbiZeal = 128;                                     // 277 < 128 + 160
    activeAgent(w);
    weeklyFbi(w, new Rng(1));
    expect(evasionWeeks(p)).toBe(16);
    expect(p.fbiWarrant).toBe(true);
    expect(p.status).toBe('active');
    weeklyFbi(w, new Rng(1));
    expect(p.status).toBe('arrested');
    expect(p.fbiWarrant).toBeUndefined();
    void ai;
  });

  it('leaves the compact cities alone', () => {
    const { w, player } = city(defaultGameOptions());
    const p = accountant(w, player, 0);
    weeklyFbi(w, new Rng(1));
    expect(w.fbiZeal).toBeUndefined();
    expect(p.taxEvasionWeeks).toBeUndefined();
    expect(p.fbiWarrant).toBeUndefined();
  });
});

describe('the payroll crackdown (0x4F6750)', () => {
  /** Put `n` people on the gang's payroll, as its lawyer would. */
  function payroll(w: WorldState, g: Gang, n: number, withLawyer = true): Person[] {
    const staff = Object.values(w.people).filter(p => p.gangId == null && p.status === 'active' && p.employedBy == null).slice(0, n);
    expect(staff.length).toBe(n);
    for (const p of staff) { p.employedBy = g.id; p.weeklyRetainer = 200; }
    g.employedPoliceIds = staff.map(p => p.id);
    if (withLawyer) {
      const l = Object.values(w.people).find(q => q.gangId === g.id && q.id !== g.bossId && q.id !== g.accountantId)!;
      l.role = 'lawyer'; g.lawyerId = l.id;
    } else g.lawyerId = null;
    return staff;
  }

  it('falls due once more than 100 are on the payrolls, then dismisses zeal × n / 512 of each gang\'s', () => {
    const { w, player } = city();
    for (const p of Object.values(w.people)) { p.employedBy = null; }
    for (const g of Object.values(w.gangs)) g.employedPoliceIds = [];
    w.fbiZeal = 200;
    const staff = payroll(w, player, CRACKDOWN_PAYROLL + 1);
    const extra = staff.pop()!;
    extra.employedBy = null; player.employedPoliceIds.pop();
    payrollCrackdown(w, new Rng(5));
    expect(w.fbiCrackdownDue).toBeUndefined();          // 100 is not above 100
    extra.employedBy = player.id; player.employedPoliceIds.push(extra.id); staff.push(extra);
    payrollCrackdown(w, new Rng(5));
    expect(w.fbiCrackdownDue).toBe(true);
    expect(() => roundTrip(w)).not.toThrow();

    const wasPolice = new Set(staff.filter(p => p.role === 'police').map(p => p.id));
    payrollCrackdown(w, new Rng(5));
    expect(w.fbiCrackdownDue).toBeUndefined();
    const dismissed = Math.trunc(200 * 101 / 512);       // 39
    expect(player.employedPoliceIds.length).toBe(101 - dismissed);
    const gone = staff.filter(p => p.employedBy == null);
    expect(gone.length).toBe(dismissed);
    expect(gone.every(p => p.weeklyRetainer === 0 && !player.employedPoliceIds.includes(p.id))).toBe(true);
    expect(gone.every(p => !w.policeIds.includes(p.id) && p.role !== 'police')).toBe(true);
    expect(gone.filter(p => wasPolice.has(p.id)).every(p => p.role === 'citizen')).toBe(true);
    expect(() => roundTrip(w)).not.toThrow();

    // The week after it counts again: 62 is not enough.
    payrollCrackdown(w, new Rng(5));
    expect(w.fbiCrackdownDue).toBeUndefined();
  });

  it('takes nobody from a gang with no lawyer, and still spends the crackdown', () => {
    const { w, player } = city();
    for (const p of Object.values(w.people)) { p.employedBy = null; }
    for (const g of Object.values(w.gangs)) g.employedPoliceIds = [];
    w.fbiZeal = 207;
    payroll(w, player, 120, false);
    w.fbiCrackdownDue = true;
    payrollCrackdown(w, new Rng(5));
    expect(w.fbiCrackdownDue).toBeUndefined();
    expect(player.employedPoliceIds.length).toBe(120);
  });
});
