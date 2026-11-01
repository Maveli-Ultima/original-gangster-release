import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, rolloverOrders, setWaiting } from '../src/sim/api';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { allBuildings } from '../src/sim/world';
import type { Order } from '../src/sim/types';

function fixture(wait: boolean) {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 100_000 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  const site = allBuildings(w).find(b => b.cls === 'charity')!;
  expect(issueOrder(w, gang.id, { teamId: team.id, type: 'donate', buildingIds: [site.id],
    opts: { wait, amount: 1000, manpower: 1 } }).ok).toBe(true);
  const order = w.orders[team.orderIds.at(-1)!];
  sim.launchWeek();
  return { sim, w, gang, order };
}
function until(sim: Sim, order: Order, state: Order['state']) {
  for (let i = 0; i < 600 && order.state !== state; i++) sim.advance(1 / MINUTES_PER_SECOND, 1);
  expect(order.state, order.failReason ?? order.results.join(' ')).toBe(state);
}

describe('planned Wait and live Continue', () => {
  it('waits before the job, then completes after Continue without waiting again', () => {
    const s = fixture(true), cash = s.gang.cash;
    until(s.sim, s.order, 'waiting');
    for (let i = 0; i < 5; i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(s.gang.cash).toBe(cash);
    expect(setWaiting(s.w, s.order.id, false).ok).toBe(true);
    until(s.sim, s.order, 'done');
    expect(s.gang.cash).toBe(cash - 1000);
    expect(s.w.messages.filter(m => m.text.includes('in position and waiting'))).toHaveLength(1);
    expect(s.order.opts.wait).toBe(true); // Retain the original planning instruction for reissue.
  });

  it.each([false, true])('preserves completed work through a live pause (restore=%s)', restore => {
    const s = fixture(false);
    until(s.sim, s.order, 'executing');
    for (let i = 0; i < 30; i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    const remaining = s.order.workLeft;
    expect(remaining).toBeGreaterThan(0);
    expect(setWaiting(s.w, s.order.id, true).ok).toBe(true);
    expect(setWaiting(s.w, s.order.id, true).ok).toBe(true); // An idempotent pause must not overwrite the resume phase.
    const sim = restore ? Sim.fromSave(structuredClone(s.w)) : s.sim;
    const order = sim.world.orders[s.order.id];
    for (let i = 0; i < 3; i++) sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(order.workLeft).toBe(remaining);
    expect(setWaiting(sim.world, order.id, false).ok).toBe(true);
    sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(order.workLeft).toBe(remaining - order.assignedIds.length);
    until(sim, order, 'done');
    expect(sim.playerGang.cash).toBe(99_000);
  });

  it.each(['queued', 'done', 'failed', 'cancelled'] as const)('cannot revive or bypass assignment for a %s order', state => {
    const s = fixture(false);
    s.order.state = state;
    const before = structuredClone(s.order);
    expect(setWaiting(s.w, s.order.id, true).ok).toBe(false);
    expect(setWaiting(s.w, s.order.id, false).ok).toBe(false);
    expect(s.order).toEqual(before);
  });

  it('resumes a legacy waiting snapshot without the new phase fields', () => {
    const s = fixture(true);
    until(s.sim, s.order, 'waiting');
    delete s.order.waitReleased; delete s.order.waitResumeState;
    const sim = Sim.fromSave(structuredClone(s.w)), order = sim.world.orders[s.order.id];
    expect(setWaiting(sim.world, order.id, false).ok).toBe(true);
    until(sim, order, 'done');
    expect(sim.playerGang.cash).toBe(99_000);
  });

  it('clears the previous release when a repeated job rolls over to next week', () => {
    const s = fixture(true);
    // Repeat is supported by Collect Protection, not Donate. Only exercise the
    // boundary here; the multi-property execution is checked separately below.
    s.order.type = 'collectProtection'; s.order.opts.repeat = true;
    s.order.state = 'done'; s.order.waitReleased = true; s.order.waitResumeState = 'executing';
    rolloverOrders(s.w);
    expect(s.order.state).toBe('queued');
    expect(s.order.opts.wait).toBe(true);
    expect(s.order.waitReleased).toBeUndefined();
    expect(s.order.waitResumeState).toBeUndefined();
  });

  it('a single Continue releases the full selected area, including its next property', () => {
    const s = fixture(true), sites = allBuildings(s.w).filter(b => b.protection?.gangId === s.gang.id);
    // Compare the two collected payments without a seed-dependent skim.
    const lieutenant = s.w.people[s.w.teams[s.order.teamId].lieutenantId];
    lieutenant.loyalty = 100; lieutenant.skills.organization = 5;
    const first = sites[0];
    const second = allBuildings(s.w).find(b => b.id !== first.id && b.cls === 'commercial' && b.ownerGangId == null)!;
    second.protection = { ...first.protection! };
    for (const b of [first, second]) b.protection = { ...b.protection!, weekly: 80, refusing: false };
    s.order.type = 'collectProtection'; s.order.targetBuildingIds = [first.id, second.id];
    // Restart assignment from a planning snapshot with the final area selection.
    s.w.phase = 'planning'; s.sim.launchWeek();
    until(s.sim, s.order, 'waiting');
    expect(setWaiting(s.w, s.order.id, false).ok).toBe(true);
    until(s.sim, s.order, 'done');
    expect(s.order.completedTargets).toBe(2);
    expect(s.gang.cash).toBe(100_160);
  });
});
