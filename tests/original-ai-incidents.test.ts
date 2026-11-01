import { describe, expect, it } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { INCIDENT_HOSTILITY, leadingRival, originalPowerShares, originalWeeklyStance, provoke, strengthBooking } from '../src/sim/aiStance';
import { territoryCount } from '../src/sim/world';
import { createWorld } from '../src/sim/citygen';
import { Rng } from '../src/sim/rng';

// Traced 28 October 2026: the four-week incident window at gang+0x52C is read
// by the weekly turn (0x6D6070) but never written in the retail build, so an
// incident between two gangs acts once, through the direct book 0x6DF6E0
// (add, clamp to a byte, floor 106), and the stance machine answers it in the
// week it lands. docs/audit/2026-10-28/ai-incidents/review.md
function setup() {
  const w = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
  const [a, b] = Object.values(w.gangs).filter(g => !g.isPlayer);
  // No drift, damper or noise; Aggressive band takes the change as it is.
  a.aiProfile = [0, 0, 0, 0, 128, 0, 1];
  a.known[b.id] = 'peace';
  return { w, a, b };
}

describe('incidents between computer gangs (0x6DF6E0; window gang+0x52C empty in retail)', () => {
  it('the direct book: added at once, clamped to a byte, never below 106', () => {
    const { w, a, b } = setup();
    a.aiHostility = { [b.id]: 100 };
    provoke(w, a.id, b.id, INCIDENT_HOSTILITY.sabotage);
    expect(a.aiHostility[b.id]).toBe(112);
    a.aiHostility[b.id] = 0;
    provoke(w, a.id, b.id, INCIDENT_HOSTILITY.sabotage);
    expect(a.aiHostility[b.id]).toBe(106);
    a.aiHostility[b.id] = 250;
    provoke(w, a.id, b.id, INCIDENT_HOSTILITY.kill);
    expect(a.aiHostility[b.id]).toBe(255);
  });

  it('a computer gang is wronged by another computer gang just as by the player', () => {
    const { w, a, b } = setup();
    const before = a.aiHostility?.[b.id] ?? 122;
    provoke(w, a.id, b.id, INCIDENT_HOSTILITY.bomb);
    expect(a.aiHostility![b.id]).toBe(Math.min(255, before + INCIDENT_HOSTILITY.bomb));
  });

  it('a bombing brings war the week it lands and is not booked again in the weeks after', () => {
    const { w, a, b } = setup();
    expect(leadingRival(w, a)).toBeNull();
    const rng = new Rng(5);
    originalWeeklyStance(w, rng, a);                     // settle the snapshot at the start
    const start = a.aiHostility![b.id];
    expect(start).toBe(122);
    provoke(w, a.id, b.id, INCIDENT_HOSTILITY.bomb);
    const stances: string[] = [], levels: number[] = [];
    for (let week = 0; week < 6; week++) {
      const s = originalWeeklyStance(w, rng, a);
      stances.push(s.get(b.id)!); levels.push(a.aiHostility![b.id]);
    }
    expect(stances[0]).toBe('war');
    expect(levels[0]).toBe(start + INCIDENT_HOSTILITY.bomb);
    // Afterwards only the quiet-week decay: never war again, never rising.
    expect(stances.slice(1)).not.toContain('war');
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
  });

  it('compact cities keep the remake\'s answer: a killing is war, a lesser incident aggression', () => {
    const { w, a, b } = setup();
    delete a.aiProfile;
    a.offered[b.id] = 'peace';
    provoke(w, a.id, b.id, INCIDENT_HOSTILITY.sabotage);
    expect(a.offered[b.id]).toBe('aggression');
    provoke(w, a.id, b.id, INCIDENT_HOSTILITY.kill);
    expect(a.offered[b.id]).toBe('war');
  });
});

// 0x6AF840, the AI planner's task 0x19 (child of 0x31), run in the weekly
// turn after the stance machine; its score is 0x6608E0's power share.
describe('the strength comparison (0x6AF840 on city+0x2598, 0x6608E0)', () => {
  it('scores each gang as a percentage of the city: cash / 1000 (capped at 20 000) + head count + blocks / 3', () => {
    const { w } = setup();
    const gangs = Object.values(w.gangs);
    for (const g of gangs) g.cash = 0;
    const heads = (id: number) => Object.values(w.people).filter(p => p.gangId === id && p.status !== 'dead').length;
    const power = gangs.map(g => heads(g.id) + Math.trunc(territoryCount(w, g.id) / 3));
    const total = power.reduce((s, v) => s + v, 0);
    const shares = originalPowerShares(w);
    gangs.forEach((g, i) => expect(shares.get(g.id)).toBe(Math.trunc(power[i] * 100 / total)));
    gangs[0].cash = 1e12;                                // 20 000 at most
    expect(originalPowerShares(w).get(gangs[0].id)).toBe(Math.trunc((20000 + power[0]) * 100 / (total + 20000)));
  });

  it('books 10/20/30 or 20/40/60 by band against a rival 2k or 3k times weaker or stronger', () => {
    const { w, a, b } = setup();
    const shares = (own: number, rival: number) => new Map([[a.id, own], [b.id, rival]]);
    a.aiProfile = [0, 0, 0, 0, 128, 0, 0];               // k = 1, band 0
    expect(strengthBooking(w, a, shares(20, 20)).size).toBe(0);
    expect(strengthBooking(w, a, shares(41, 20)).get(b.id)).toBe(10);   // over 2k times
    expect(strengthBooking(w, a, shares(61, 20)).get(b.id)).toBe(20);   // over 3k times
    expect(strengthBooking(w, a, shares(9, 20)).get(b.id)).toBe(10);    // under r / 2k
    expect(strengthBooking(w, a, shares(5, 20)).get(b.id)).toBe(20);    // under trunc(r / 3k) = 6
    expect(strengthBooking(w, a, shares(10, 20)).size).toBe(0);         // r / 2k exactly
    a.aiProfile = [10, 0, 0, 0, 128, 0, 2];              // k = 3, band 2
    expect(strengthBooking(w, a, shares(61, 10)).get(b.id)).toBe(30);   // over 6 times
    expect(strengthBooking(w, a, shares(91, 10)).get(b.id)).toBe(60);   // over 9 times
    expect(strengthBooking(w, a, shares(41, 10)).size).toBe(0);
  });

  it('runs after the stance machine, so the booking is next week’s rising week', () => {
    const { w, a, b } = setup();
    a.aiHostility = { [b.id]: 140 };
    a.aiHostilitySnapshot = { [b.id]: 140 };
    for (const g of Object.values(w.gangs)) if (g.id !== a.id && g.id !== b.id) g.eliminated = true;
    a.cash = 1e12; b.cash = 0;                           // a holds nearly all the power
    originalWeeklyStance(w, new Rng(1), a);
    const snap = a.aiHostilitySnapshot![b.id];
    expect(a.aiHostility![b.id]).toBe(Math.min(255, snap + 40));       // Aggressive band 1, k = 1: over 3 times, (4 + 4) * 5
  });

  // Traced 29 October 2026: 0x31 is the permanent root of every gang's planner
  // tree (0x677B40 at 0x6CC4F8 and 0x6D1410); 0x6D4690 expands it every AI
  // week (0x677DE0) and 0x31 and 0x19 re-run each time (+0x46), so the
  // comparison books every week, against every rival that qualifies.
  it('books every AI week, against every rival that qualifies at once', () => {
    const { w, a } = setup();
    for (const g of Object.values(w.gangs)) g.cash = 0;
    a.cash = 1e12;                                       // every rival far weaker
    const rng = new Rng(2);
    originalWeeklyStance(w, rng, a);
    const rivals = Object.values(w.gangs).filter(g => g.id !== a.id && !g.eliminated).map(g => g.id);
    for (let week = 0; week < 4; week++) {
      const booking = strengthBooking(w, a);
      expect([...booking.keys()].sort()).toEqual([...rivals].sort());
      originalWeeklyStance(w, rng, a);
      for (const id of rivals)
        expect(a.aiHostility![id]).toBe(Math.min(255, a.aiHostilitySnapshot![id] + booking.get(id)!));
    }
  });

  it('books nothing outside the original city', () => {
    const { w, a } = setup();
    for (const g of Object.values(w.gangs)) g.cash = 0;
    a.cash = 1e12;
    delete w.cityLayout!.original;
    originalWeeklyStance(w, new Rng(2), a);
    for (const [id, v] of Object.entries(a.aiHostility!)) expect(v).toBe(a.aiHostilitySnapshot![Number(id)]);
  });
});

// Traced 29 October 2026 (0x6AFA90, 0x6AF840, 0x4B0990, 0x73A130, 0x6773F0):
// the planner's two rare weeks hang on whether the subtasks of 0x32 (the
// election tasks 0x1A/0x24/0x25/0x27, kept only while city+0x2555 marks an
// election) and of 0x19 (0x16 "make me strong", 0x17 "make them weak") are
// still pending from an earlier week. The remake has no planner tree, so it
// books once every AI week, in an election week as in any other.
describe('the planner\'s rare weeks are not modelled (0x6AFA90 / 0x6AF840)', () => {
  it('books exactly once in an election week too', () => {
    const { w, a } = setup();
    for (const g of Object.values(w.gangs)) g.cash = 0;
    a.cash = 1e12;
    w.election.active = true;
    const rng = new Rng(3);
    originalWeeklyStance(w, rng, a);
    const booking = strengthBooking(w, a);
    expect(booking.size).toBeGreaterThan(0);
    originalWeeklyStance(w, rng, a);
    for (const [id, amount] of booking)
      expect(a.aiHostility![id]).toBe(Math.min(255, a.aiHostilitySnapshot![id] + amount));
  });
});
