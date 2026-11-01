import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, type IssueOrderInput } from '../src/sim/api';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { damageBuilding, destroyBuilding, killPerson } from '../src/sim/execution';
import { walkRoute } from '../src/sim/movement';
import { startBuildingEmergency } from '../src/sim/systems/buildingEmergency';
import { streetPersonVisible } from '../src/render/characterPresentation';
import { allBuildings, buildingDoor } from '../src/sim/world';
import { activeBlocks, blockPavement } from '../src/sim/cityLayout';

function fixture(seed = 404) {
  const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 10, startMoney: 100_000, startHoods: 8 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  w.orders = {};
  for (const crew of Object.values(w.teams)) { crew.orderIds = []; crew.timeUsed = 0; }
  for (const id of [team.lieutenantId, ...team.memberIds])
    for (const skill of Object.keys(w.people[id].skills) as (keyof typeof w.people[number]['skills'])[]) w.people[id].skills[skill] = 5;
  return { sim, w, gang, team };
}
type Fixture = ReturnType<typeof fixture>;
const issue = (s: Fixture, input: Omit<IssueOrderInput, 'teamId'>) => {
  const result = issueOrder(s.w, s.gang.id, { ...input, teamId: s.team.id, opts: { priority: true, manpower: 1, ...input.opts } });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return s.w.orders[s.team.orderIds.at(-1)!];
};
const untilDone = (s: Fixture, done: () => boolean) => {
  for (let i = 0; i < MINUTES_PER_WEEK - 1 && !done(); i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
};

describe('orders on people who are gone', () => {
  it('an assault on a man killed while the crew worked fails, and he stays dead', () => {
    const s = fixture();
    const rival = Object.values(s.w.gangs).find(g => !g.isPlayer)!;
    const victim = s.w.people[s.w.teams[rival.teamIds[0]].memberIds[0]];
    const home = allBuildings(s.w).find(b => b.isHQ && b.ownerGangId === s.gang.id)!;
    victim.pos = buildingDoor(s.w, home); victim.buildingId = null; victim.dest = null; victim.path = []; victim.halted = true;
    s.gang.knownPeople.push(victim.id);
    const order = issue(s, { type: 'assault', personId: victim.id });
    s.sim.launchWeek();
    untilDone(s, () => order.state === 'executing' || order.state === 'done' || order.state === 'failed');
    expect(order.state).toBe('executing');
    killPerson(s.w, victim, 'shot in the street');
    untilDone(s, () => order.state === 'done' || order.state === 'failed');
    expect(order.state).toBe('failed');
    expect(victim.status).toBe('dead');
  });
});

describe('sites that are gone', () => {
  it('rubble is not damaged back into a repairable shop', () => {
    const s = fixture(), site = allBuildings(s.w).find(b => b.cls === 'commercial' && b.ownerGangId == null)!;
    destroyBuilding(s.w, site);
    expect(site.state).toBe('destroyed');
    damageBuilding(s.w, site, .5);
    expect(site.state).toBe('destroyed');
  });
});

describe('protection', () => {
  it('a racket pays once a week, however many crews call to collect', () => {
    const s = fixture();
    const site = allBuildings(s.w).find(b => b.protection?.gangId === s.gang.id && b.state === 'trading' && !b.protection.refusing)!;
    expect(site).toBeDefined();
    const first = issue(s, { type: 'collectProtection', buildingIds: [site.id] });
    const second = issue(s, { type: 'collectProtection', buildingIds: [site.id] });
    s.sim.launchWeek();
    untilDone(s, () => ['done', 'failed'].includes(first.state) && ['done', 'failed'].includes(second.state));
    const paid = [...first.results, ...second.results].filter(r => r.startsWith('Collected')).length;
    expect(paid).toBe(1);
  });
});

describe('walkers', () => {
  it('never walk a long way on to a corner and back', () => {
    const w = fixture().w, blocks = activeBlocks(w);
    for (let i = 0; i < blocks.length; i++) for (let k = 0; k < 12; k++) {
      const from = blockPavement(blocks[i], k), to = blockPavement(blocks[(i + 5 + k) % blocks.length], k * 3 + 1);
      const pts = [from, ...walkRoute(from, to, k * 31 + i, w)];
      for (let j = 2; j < pts.length; j++) {
        const ax = pts[j - 1].x - pts[j - 2].x, ay = pts[j - 1].y - pts[j - 2].y;
        const bx = pts[j].x - pts[j - 1].x, by = pts[j].y - pts[j - 1].y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        const reversal = Math.min(la, lb) > 6 && (ax * bx + ay * by) / (la * lb) < -0.9;
        expect(reversal, JSON.stringify(pts.slice(j - 2, j + 1))).toBe(false);
      }
    }
  });
});

describe('fires and the street', () => {
  it('the fire crew goes back to the station', () => {
    const s = fixture(), sites = allBuildings(s.w).filter(b => b.cls === 'commercial' && b.ownerPersonId != null);
    startBuildingEmergency(s.w, s.sim.rng, sites[0], 'fire', 0, undefined, false);
    const crew = Object.values(s.w.people).filter(p => p.role === 'firefighter');
    const station = { ...crew[0].emergencyResponse!.home };
    // Stranded where the last fire left them, then called out again.
    crew.forEach((p, i) => { delete p.emergencyResponse; p.dest = null; p.path = []; p.pos = { x: 100 + i * 40, y: 100 }; });
    startBuildingEmergency(s.w, s.sim.rng, sites[1], 'fire', 0, undefined, false);
    for (const p of crew) expect(p.emergencyResponse?.home).toEqual(station);
  });

  it('a man awaiting trial is not drawn on the street', () => {
    const s = fixture(), hood = s.w.people[s.team.memberIds[0]];
    hood.status = 'onTrial';
    expect(streetPersonVisible(hood, hood.id)).toBe(false);
  });
});
