import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { restoreElectionTiming } from '../src/sim/electionTiming';
import { killPerson } from '../src/sim/execution';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { weeklyPolitics } from '../src/sim/systems/politics';

// Independent expected numbers come from the recovered constructor/weekly
// instructions, not constants imported from the implementation under test.
const fixture = () => new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 500_000 });
function politicsWeek(sim: Sim) {
  weeklyPolitics(sim.world, sim.rng);
  sim.world.rngState = sim.rng.state;
  sim.world.week++;
}
function firstElection(sim: Sim) {
  for (let i = 0; i < 18; i++) politicsWeek(sim);
  expect(sim.world.election.active).toBe(true);
  expect(sim.world.election.weeksLeft).toBe(6);
}

describe('recovered mayor election counter', () => {
  it('starts at four and calls the first race after 18 weekly passes, without waiting for week26', () => {
    const sim = fixture(), w = sim.world;
    expect(w.election.mayorTerm).toEqual({ personId: w.mayorId, weeks: 4 });
    for (let i = 0; i < 17; i++) {
      politicsWeek(sim);
      expect(w.election.active).toBe(false);
    }
    expect(w.election.mayorTerm!.weeks).toBe(21);
    politicsWeek(sim);
    expect(w.election.mayorTerm!.weeks).toBe(0);
    expect(w.election.weeksLeft).toBe(6);
    expect(w.election.active).toBe(true);
    expect(w.news.filter(n => n.headline === 'MAYORAL ELECTION CALLED')).toHaveLength(1);
  });

  it('retains the incumbent counter through the six-week race and calls again 22 ticks after the prior call', () => {
    const sim = fixture(), w = sim.world, mayorId = w.mayorId;
    firstElection(sim);
    w.people[mayorId].skills.intelligence = 5;
    for (const c of w.election.candidates) if (c.id !== mayorId) w.people[c.id].skills.intelligence = 0;
    for (let i = 0; i < 6; i++) politicsWeek(sim);
    expect(w.mayorId).toBe(mayorId);
    expect(w.election.active).toBe(false);
    expect(w.election.lastResultWeek).toBe(24);
    expect(w.election.mayorTerm).toEqual({ personId: mayorId, weeks: 6 });
    for (let i = 0; i < 15; i++) politicsWeek(sim);
    expect(w.election.active).toBe(false);
    politicsWeek(sim);
    expect(w.election.active).toBe(true);
    expect(w.week).toBe(41); // The call was made during settlement of week40.
  });

  it('gives a newly elected mayor a fresh counter and advances it after the result', () => {
    const sim = fixture(), w = sim.world, oldMayor = w.mayorId;
    firstElection(sim);
    const challenger = w.election.candidates.find(c => c.id !== oldMayor)!;
    w.people[oldMayor].skills.intelligence = 0;
    w.people[challenger.id].skills.intelligence = 5;
    for (let i = 0; i < 6; i++) politicsWeek(sim);
    expect(w.mayorId).toBe(challenger.id);
    // Original order: election pass -> construct mayor(counter4) -> mayor weekly.
    expect(w.election.mayorTerm).toEqual({ personId: challenger.id, weeks: 5 });
    for (let i = 0; i < 16; i++) politicsWeek(sim);
    expect(w.election.active).toBe(false);
    politicsWeek(sim);
    expect(w.election.active).toBe(true);
    expect(w.week).toBe(42);
  });

  it('does not age a dead mayor while a vacancy election is in progress', () => {
    const sim = fixture(), w = sim.world;
    killPerson(w, w.people[w.mayorId], 'vacancy timing fixture');
    politicsWeek(sim);
    expect(w.election.active).toBe(true);
    expect(w.election.candidates).toHaveLength(2);
    expect(w.election.mayorTerm!.weeks).toBe(4);
    for (let i = 0; i < 5; i++) politicsWeek(sim);
    expect(w.election.mayorTerm!.weeks).toBe(4);
    politicsWeek(sim);
    expect(w.people[w.mayorId].status).toBe('active');
    expect(w.election.mayorTerm).toEqual({ personId: w.mayorId, weeks: 5 });
  });

  it.each([17, 20])('restores at completed politics pass %i and follows the same counter, ballots and RNG', passes => {
    const sim = fixture();
    for (let i = 0; i < passes; i++) politicsWeek(sim);
    const restored = Sim.fromSave(structuredClone(sim.world));
    expect(restored.world.election).toEqual(sim.world.election);
    for (let i = 0; i < 10; i++) {
      politicsWeek(sim); politicsWeek(restored);
      expect(restored.world.election).toEqual(sim.world.election);
      expect(restored.world.mayorId).toBe(sim.world.mayorId);
      expect(restored.rng.state).toBe(sim.rng.state);
    }
  });

  it('reaches the first scheduled election through the real 18 weekly settlements', () => {
    let sim = fixture();
    for (let i = 0; i < 18; i++) {
      sim.launchWeek();
      // This fixture exercises every settlement stage, not full street travel.
      sim.world.minute = MINUTES_PER_WEEK - 1;
      sim.advance(1 / MINUTES_PER_SECOND, 1);
      expect(sim.world.phase).toBe('planning');
      expect(sim.world.election.active).toBe(i === 17);
      if (i === 9) sim = Sim.fromSave(structuredClone(sim.world));
    }
    expect(sim.world.week).toBe(19);
    expect(sim.world.election.weeksLeft).toBe(6);
    expect(sim.world.election.mayorTerm!.weeks).toBe(0);
  });
});

describe('election counter save compatibility', () => {
  it('migrates an old inactive save once, without issuing an election during load', () => {
    const sim = fixture();
    sim.world.week = 40;
    delete sim.world.election.mayorTerm;
    const old = structuredClone(sim.world), restored = Sim.fromSave(structuredClone(old));
    expect(restored.world.election.active).toBe(false);
    expect(restored.world.election.mayorTerm!.weeks).toBe(21);
    expect(restored.rng.state).toBe(old.rngState);
    expect(restored.playerGang.cash).toBe(sim.playerGang.cash);
    const again = Sim.fromSave(structuredClone(restored.world));
    expect(again.world.election).toEqual(restored.world.election);
    politicsWeek(again);
    expect(again.world.election.active).toBe(true);
  });

  it('preserves an old active ballot and its remaining weeks', () => {
    const sim = fixture(); firstElection(sim);
    politicsWeek(sim); politicsWeek(sim);
    delete sim.world.election.mayorTerm;
    const before = structuredClone(sim.world.election), restored = Sim.fromSave(structuredClone(sim.world));
    expect(restored.world.election).toEqual({ ...before, mayorTerm: { personId: sim.world.mayorId, weeks: 2 } });
    expect(restored.world.election.weeksLeft).toBe(4);
  });

  it('keeps a missing historical mayor vacant and starts a fresh counter when its replacement wins', () => {
    const sim = fixture();
    delete sim.world.election.mayorTerm;
    delete sim.world.people[sim.world.mayorId];
    restoreElectionTiming(sim.world);
    expect(sim.world.election.mayorTerm).toBeUndefined();
    politicsWeek(sim);
    expect(sim.world.election.active).toBe(true);
    expect(sim.world.election.mayorTerm).toBeUndefined();
    for (let i = 0; i < 6; i++) politicsWeek(sim);
    expect(sim.world.election.active).toBe(false);
    expect(sim.world.people[sim.world.mayorId].role).toBe('mayor');
    expect(sim.world.election.mayorTerm).toEqual({ personId: sim.world.mayorId, weeks: 5 });
  });

  it.each([-1, 22, 1.5, Infinity])('rejects a corrupt persisted counter %s', value => {
    const sim = fixture(); sim.world.election.mayorTerm!.weeks = value;
    expect(() => Sim.fromSave(structuredClone(sim.world))).toThrow(/mayor election counter|election\.mayorTerm.*invalid/);
  });

  it('rejects a counter bound to a nonexistent person', () => {
    const sim = fixture(); sim.world.election.mayorTerm!.personId = sim.world.nextId + 100;
    expect(() => Sim.fromSave(structuredClone(sim.world))).toThrow(/mayor election counter/);
  });
});
