import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, type IssueOrderInput } from '../src/sim/api';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { isValidAreaTarget } from '../src/sim/execution';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import type { Skills } from '../src/sim/types';
import { allBuildings } from '../src/sim/world';

function fixture(seed: number, skill: number) {
  const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 10, startMoney: 100_000, startHoods: 8 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  for (const id of [team.lieutenantId, ...team.memberIds]) {
    for (const k of Object.keys(w.people[id].skills) as (keyof Skills)[]) w.people[id].skills[k] = skill;
  }
  const site = allBuildings(w).find(b => b.ownerPersonId != null && b.state === 'trading' && isValidAreaTarget(w, gang.id, 'extort', b))!;
  return { sim, w, gang, team, site };
}

function run(s: ReturnType<typeof fixture>, input: Omit<IssueOrderInput, 'teamId'>) {
  const result = issueOrder(s.w, s.gang.id, { ...input, teamId: s.team.id, opts: { priority: true, manpower: 1 } });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const order = s.w.orders[s.team.orderIds.at(-1)!];
  s.sim.launchWeek();
  for (let minute = 0; minute < MINUTES_PER_WEEK - 1 && !['done', 'failed'].includes(order.state); minute++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
  return order;
}

describe('owners who refuse a protection racket', () => {
  it('marks the refusal in the report and offers the site to Intimidate', () => {
    let refusedOnce = false;
    for (let seed = 1; seed <= 12 && !refusedOnce; seed++) {
      const s = fixture(seed, 0.5);
      expect(isValidAreaTarget(s.w, s.gang.id, 'intimidate', s.site)).toBe(false);
      const order = run(s, { type: 'extort', buildingIds: [s.site.id] });
      const line = order.results.findIndex(r => r.endsWith('refused your protection.'));
      if (line < 0) continue;
      refusedOnce = true;
      expect(order.refusals).toEqual([{ line, buildingId: s.site.id }]);
      expect(isValidAreaTarget(s.w, s.gang.id, 'intimidate', s.site)).toBe(true);
      const rival = Object.values(s.w.gangs).find(g => !g.isPlayer)!;
      expect(isValidAreaTarget(s.w, rival.id, 'intimidate', s.site)).toBe(false);
    }
    expect(refusedOnce).toBe(true);
  });

  it('signs the owner up once Intimidate gets through to him', () => {
    let cowed = false;
    for (let seed = 1; seed <= 12 && !cowed; seed++) {
      const s = fixture(seed, 5);
      s.site.extortRefusedBy = [s.gang.id];
      const order = run(s, { type: 'intimidate', buildingIds: [s.site.id] });
      if (!order.results.join(' ').includes('has seen sense')) continue;
      cowed = true;
      expect(s.site.protection?.gangId).toBe(s.gang.id);
      expect(order.results.join(' ')).toContain('now pays');
      expect(s.site.extortRefusedBy).toBeUndefined();
      expect(isValidAreaTarget(s.w, s.gang.id, 'intimidate', s.site)).toBe(false);
    }
    expect(cowed).toBe(true);
  });
});

describe('gang names', () => {
  const names = (playerName: string) => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, playerName });
    return Object.values(sim.world.gangs).map(g => ({ isPlayer: g.isPlayer, name: g.name, boss: sim.world.people[g.bossId].name }));
  };

  it('names the player gang after the boss and keeps that surname off the rivals', () => {
    // Take a surname some rival would otherwise have drawn on this seed.
    const taken = names('Johnny Example').find(g => !g.isPlayer)!.name.replace(/^The | Gang$/g, '');
    const gangs = names(`Johnny ${taken}`);
    expect(gangs.find(g => g.isPlayer)!.name).toBe(`The ${taken} Gang`);
    const rivals = gangs.filter(g => !g.isPlayer);
    expect(rivals.map(g => g.name)).not.toContain(`The ${taken} Gang`);
    expect(new Set(gangs.map(g => g.name)).size).toBe(gangs.length);
    // A rival's boss still carries his own gang's name.
    for (const g of rivals) expect(g.boss.endsWith(g.name.replace(/^The | Gang$/g, ''))).toBe(true);
  });
});
