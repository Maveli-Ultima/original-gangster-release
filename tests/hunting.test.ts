import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, whereaboutsUnknown } from '../src/sim/api';
import { killPerson } from '../src/sim/execution';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import type { Order } from '../src/sim/types';

function hunt(type: 'kill' | 'assault') {
  const sim = new Sim({ ...defaultGameOptions(), seed: 23, citySize: 10, startMoney: 100_000, startHoods: 8 });
  const w = sim.world, gang = sim.playerGang;
  w.orders = {};
  for (const team of Object.values(w.teams)) { team.orderIds = []; team.timeUsed = 0; }
  const rival = Object.values(w.people).find(p => p.gangId != null && p.gangId !== gang.id && p.role === 'hood')!;
  expect(whereaboutsUnknown(gang, rival)).toBe(true);
  expect(issueOrder(w, gang.id, { teamId: gang.teamIds[0], type, personId: rival.id, opts: { manpower: 2, priority: true } }).ok).toBe(true);
  const order = Object.values(w.orders).find(o => o.type === type) as Order;
  expect(order.hunting).toBe(true);
  sim.launchWeek();
  return { sim, w, order, rival };
}
const minute = (sim: Sim) => sim.advance(1 / MINUTES_PER_SECOND, 1);

describe('hunting a man nobody has placed', () => {
  it('takes time asking at each stop before trying the next', () => {
    const { sim, w, order } = hunt('assault');
    for (let i = 0; i < 2000 && order.huntAsking === undefined && order.hunting; i++) minute(sim);
    expect(order.huntAsking).toBeDefined();
    const started = w.minute, stop = order.cursor;
    for (let i = 0; i < 200 && order.hunting && order.cursor === stop && order.huntAsking !== undefined; i++) minute(sim);
    // Half an hour at the least (a sharp crew), an hour and a half for a dull one.
    expect(w.minute - started).toBeGreaterThanOrEqual(28);
  });

  it('a sharper crew asks for less time than a dull one', () => {
    const minutesAsking = (skill: number) => {
      const { sim, w, order } = hunt('assault');
      for (const id of order.assignedIds) for (const k of ['intelligence', 'intimidation'] as const) w.people[id].skills[k] = skill;
      for (let i = 0; i < 2000 && order.huntAsking === undefined && order.hunting; i++) minute(sim);
      return order.huntAsking ?? 0;
    };
    expect(minutesAsking(5)).toBeLessThan(minutesAsking(0.5));
  });

  it('goes round every pool hall and gym, not just the nearest few', () => {
    const { w, order } = hunt('assault');
    expect(order.huntStopIds!.length).toBe(Object.values(w.buildings).filter(b => b.state === 'trading' && (b.typeId === 'poolHall' || b.typeId === 'gym')).length);
  });

  it('a man killed while they look for him leaves a Kill order done', () => {
    const { sim, w, order, rival } = hunt('kill');
    for (let i = 0; i < 30 && order.state !== 'travelling'; i++) minute(sim);
    expect(order.hunting).toBe(true);
    killPerson(w, rival, 'shot in a street fight');
    for (let i = 0; i < 5 && !['done', 'failed'].includes(order.state); i++) minute(sim);
    expect(order.state).toBe('done');
    expect(order.completedTargets).toBe(1);
  });
});
