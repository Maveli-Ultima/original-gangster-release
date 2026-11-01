import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { allBuildings, gangHoldings, gangManpower, protectedBuildings } from '../src/sim/world';

const SEEDS = [11, 222, 3333, 44444, 555555, 6666, 77, 888];
// Both tests use exactly the same deterministic first 40 weeks. Retain only
// their health observations while the first test continues to week 45. A
// filtered run of the second test still simulates its own complete 40 weeks.
interface HealthObservation { completedWeeks: number; phase: string; minute: number; observedAt40: boolean; healthy: boolean[] }
const healthAt40 = new Map<number, HealthObservation>();
function rivalHealth(sim: Sim): boolean[] {
  return Object.values(sim.world.gangs).filter(g => !g.isPlayer).map(g =>
    !g.eliminated && gangManpower(sim.world, g) > 0 && protectedBuildings(sim.world, g.id).length > 10);
}

function healthObservation(sim: Sim, completedWeeks: number): HealthObservation {
  return { completedWeeks, phase: sim.world.phase, minute: sim.world.minute, observedAt40: completedWeeks >= 40,
    healthy: rivalHealth(sim).map(healthy => completedWeeks >= 40 && healthy) };
}

function reportProgress(sim: Sim, completedWeeks: number, restoredAtWeeks: number[], final = false,
  elapsed = { weeksStarted: 0, simulatedMinutes: 0 }): void {
  const w = sim.world;
  console.info(JSON.stringify({ kind: 'integrity-observation', seed: w.options.seed, completedWeeks,
    ...elapsed, worldWeek: w.week, minute: w.minute, phase: w.phase, outcome: w.outcome, final, restoredAtWeeks,
    player: gangHoldings(w, sim.playerGang),
    rivals: Object.values(w.gangs).filter(g => !g.isPlayer).map(g => ({ id: g.id, eliminated: g.eliminated,
      manpower: gangManpower(w, g), protected: protectedBuildings(w, g.id).length, cash: g.cash })) }));
}

function workingWindow(sim: Sim) {
  const beforeWeek = sim.world.week;
  sim.launchWeek();
  const started = sim.world.phase === 'week';
  sim.finishWeek();
  const completed = started && (sim.world.week > beforeWeek || sim.world.minute >= MINUTES_PER_WEEK);
  return { started, completed, minutes: completed ? MINUTES_PER_WEEK : started ? sim.world.minute : 0 };
}

/** Every invariant the world must never break, whatever happens in it. */
function assertWorldIsSound(sim: Sim, label: string): void {
  const w = sim.world;

  for (const g of Object.values(w.gangs)) {
    for (const id of g.poolIds) expect(w.people[id], `${label} pool member ${id}`).toBeDefined();
    for (const id of g.prisonerIds) expect(w.people[id], `${label} prisoner ${id}`).toBeDefined();
    for (const id of g.recruitIds) expect(w.people[id], `${label} recruit ${id}`).toBeDefined();
    for (const id of g.employedPoliceIds) expect(w.people[id], `${label} officer ${id}`).toBeDefined();
    for (const id of g.knownPeople) expect(w.people[id], `${label} known person ${id}`).toBeDefined();

    for (const id of g.teamIds) {
      const t = w.teams[id];
      expect(t, `${label} team ${id} of ${g.name}`).toBeDefined();
      const lt = w.people[t.lieutenantId];
      expect(lt, `${label} lieutenant of ${t.name}`).toBeDefined();
      // A crew is never led by a corpse.
      expect(lt.status, `${label} lieutenant ${lt.name}`).not.toBe('dead');
      for (const m of t.memberIds) expect(w.people[m], `${label} crew member ${m}`).toBeDefined();
      // Nobody belongs to two crews at once.
      expect(t.memberIds).not.toContain(t.lieutenantId);
    }

    expect(Number.isFinite(g.cash), `${label} ${g.name} cash`).toBe(true);
    expect(g.suspicion).toBeGreaterThanOrEqual(0);
    expect(g.suspicion).toBeLessThanOrEqual(100);
    expect(g.popularity).toBeGreaterThanOrEqual(-100);
    expect(g.popularity).toBeLessThanOrEqual(100);
  }

  // Orders always belong to a crew that still exists.
  for (const o of Object.values(w.orders)) {
    expect(w.teams[o.teamId], `${label} order ${o.id} points at a live crew`).toBeDefined();
  }
  // And they do not pile up week after week.
  expect(Object.keys(w.orders).length, `${label} order count`).toBeLessThan(200);

  for (const b of allBuildings(w)) {
    if (b.frontId != null) expect(w.buildings[b.frontId], `${label} front of ${b.id}`).toBeDefined();
    if (b.hidesId != null) expect(w.buildings[b.hidesId], `${label} hidden site of ${b.id}`).toBeDefined();
    if (b.managerId != null) {
      const m = w.people[b.managerId];
      expect(m, `${label} manager of ${b.id}`).toBeDefined();
      expect(m.status, `${label} manager ${m.name}`).not.toBe('dead');
    }
    for (const gId of b.guardIds) {
      if (gId === -1) continue; // the police-guard sentinel
      const guard = w.people[gId];
      if (guard) expect(guard.status, `${label} guard ${guard.name}`).not.toBe('dead');
    }
    expect(Number.isFinite(b.lastProfit)).toBe(true);
  }

  for (const c of Object.values(w.cases)) {
    expect(w.people[c.defendantId], `${label} defendant of case ${c.id}`).toBeDefined();
  }
  const caseIds = Object.values(w.cases).map((c) => c.id);
  expect(new Set(caseIds).size, `${label} case ids are unique`).toBe(caseIds.length);
}

describe('world integrity', () => {
  it('holds across many seeds and a long unattended run', () => {
    for (const seed of SEEDS) {
      let sim = new Sim({ ...defaultGameOptions(), seed, citySize: 12 });
      let weeks = 0;
      const elapsed = { weeksStarted: 0, simulatedMinutes: 0 };
      const restoredAtWeeks: number[] = [];
      reportProgress(sim, weeks, restoredAtWeeks);
      while (sim.world.phase !== 'gameOver' && weeks < 45) {
        const window = workingWindow(sim);
        weeks += Number(window.completed);
        elapsed.weeksStarted += Number(window.started); elapsed.simulatedMinutes += window.minutes;
        if (weeks === 40) healthAt40.set(seed, healthObservation(sim, weeks));
        if (weeks % 5 === 0) {
          assertWorldIsSound(sim, `seed ${seed}, completed week ${weeks}`);
          reportProgress(sim, weeks, restoredAtWeeks, false, elapsed);
        }
        if (weeks % 10 === 0 && sim.world.outcome == null) {
          const saved = JSON.parse(JSON.stringify(sim.world));
          sim = Sim.fromSave(structuredClone(saved));
          expect(sim.world, `seed ${seed}, restore after ${weeks} weeks`).toEqual(saved);
          restoredAtWeeks.push(weeks);
        }
      }
      if (!healthAt40.has(seed)) healthAt40.set(seed, healthObservation(sim, weeks));
      expect(sim.world.week).toBe(weeks + (sim.world.minute >= MINUTES_PER_WEEK ? 0 : 1));
      assertWorldIsSound(sim, `seed ${seed}`);
      reportProgress(sim, weeks, restoredAtWeeks, true, elapsed);
    }
  }, 10800000);

  it('leaves the computer gangs standing when nobody interferes with them', () => {
    // The player does nothing, so the rivals are only fighting each other and
    // the law. Most of them should still be running rackets at the end.
    let healthy = 0;
    let total = 0;
    for (const seed of SEEDS) {
      let health = healthAt40.get(seed);
      if (!health) {
        const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 12 });
        let completedWeeks = 0;
        while (completedWeeks < 40 && sim.world.phase !== 'gameOver') {
          completedWeeks += Number(workingWindow(sim).completed);
        }
        health = healthObservation(sim, completedWeeks);
      }
      console.info(JSON.stringify({ kind: 'rival-health-observation', seed, ...health }));
      total += health.healthy.length;
      healthy += health.healthy.filter(Boolean).length;
    }
    // A gang can legitimately be broken, but the city must not empty out.
    expect(healthy / total).toBeGreaterThan(0.7);
    console.info(JSON.stringify({ kind: 'rival-health-summary', healthy, total, fraction: healthy / total }));
  }, 5400000);

  it('ends the player\'s game rather than handing his gang to somebody else', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 606, citySize: 10 });
    const gang = sim.playerGang;
    const originalBoss = gang.bossId;
    sim.world.people[originalBoss].status = 'dead';
    sim.launchWeek();
    sim.finishWeek();

    expect(sim.world.phase).toBe('gameOver');
    expect(sim.world.outcome?.won).toBe(false);
    // No successor was installed, and the gang was not quietly written off.
    expect(gang.bossId).toBe(originalBoss);
    expect(gang.eliminated).toBe(false);
  });

  it('replaces a computer boss who is sent down for good', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 707, citySize: 10 });
    const rival = Object.values(sim.world.gangs).find((g) => !g.isPlayer)!;
    const oldBoss = sim.world.people[rival.bossId];
    oldBoss.status = 'jailed';
    oldBoss.jailWeeks = 999;

    sim.launchWeek();
    sim.finishWeek();

    expect(rival.eliminated).toBe(false);
    expect(rival.bossId).not.toBe(oldBoss.id);
    const heir = sim.world.people[rival.bossId];
    expect(heir.role).toBe('boss');
    expect(heir.status).not.toBe('dead');
  });
});
