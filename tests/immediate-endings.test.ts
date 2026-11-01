import { afterEach, describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { act, useGame } from '../src/app/store';
import { issueOrder } from '../src/sim/api';
import { killPerson } from '../src/sim/execution';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { weeklyLaw } from '../src/sim/systems/law';

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  const w = sim.world, gang = sim.playerGang, boss = w.people[gang.bossId];
  return { sim, w, gang, boss };
}
afterEach(() => useGame.setState({ sim: null }));

describe('terminal defeats stop at the next safe simulation boundary', () => {
  it.each(['advance', 'skip', 'slice'] as const)('stops a dead boss before more work or settlement through %s', action => {
    const { sim, w, gang, boss } = fixture();
    sim.launchWeek(); w.minute = 137;
    killPerson(w, boss, 'shot in an ending audit');
    const cash = gang.cash;
    if (action === 'advance') sim.advance(1 / MINUTES_PER_SECOND, 1);
    else if (action === 'skip') sim.finishWeek();
    else sim.finishWeekSlice(0);
    expect(w.phase).toBe('gameOver');
    expect(w.minute).toBe(137); expect(w.week).toBe(1);
    expect(w.outcome).toMatchObject({ won: false });
    expect(w.outcome?.reason).toContain('killed');
    expect(gang.cash).toBe(cash); expect(w.settlementStage).toBeUndefined();
    expect(gang.bossId).toBe(boss.id); expect(gang.eliminated).toBe(false);
    const final = structuredClone(w);
    sim.advance(100, 40); sim.finishWeek(); sim.launchWeek();
    expect(w).toEqual(final);
  });

  it.each(['death', 'permanent prison', 'rival mayor'] as const)('ends unfinished saved %s without simulating the rest of the week', cause => {
    const { sim, w, boss } = fixture();
    sim.launchWeek(); w.minute = 73;
    if (cause === 'death') killPerson(w, boss, 'shot in an ending audit');
    if (cause === 'permanent prison') { boss.status = 'jailed'; boss.jailWeeks = 999; }
    if (cause === 'rival mayor') w.electionWinnerGangId = Object.values(w.gangs).find(g => !g.isPlayer)!.id;
    const original = structuredClone(w);
    const restored = Sim.fromSave(structuredClone(w));
    expect(restored.world.phase).toBe('gameOver'); expect(restored.world.minute).toBe(73);
    expect(restored.world.outcome?.won).toBe(false);
    expect(w).toEqual(original);
    expect(Sim.fromSave(structuredClone(restored.world)).world).toEqual(restored.world);
  });

  it('resolves an already terminal planning state before accepting another action', () => {
    const { sim, w, boss, gang } = fixture();
    useGame.setState({ sim, savingSnapshot: false, loadingSave: null, streetLoading: false });
    killPerson(w, boss, 'shot in an ending audit');
    const before = gang.cash;
    act(s => { s.playerGang.cash += 1000; });
    expect(w.phase).toBe('gameOver'); expect(gang.cash).toBe(before);
  });

  it('resolves defeat produced by a planning action immediately afterwards', () => {
    const { sim, w, boss } = fixture();
    useGame.setState({ sim, savingSnapshot: false, loadingSave: null, streetLoading: false });
    act(s => { killPerson(s.world, boss, 'shot in an ending audit'); });
    expect(w.phase).toBe('gameOver'); expect(w.outcome?.won).toBe(false);
  });

  it('does not treat temporary imprisonment or a rival boss death as player defeat', () => {
    const { sim, w, boss } = fixture();
    sim.launchWeek(); boss.status = 'jailed'; boss.jailWeeks = 3;
    const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
    killPerson(w, w.people[rival.bossId], 'shot in an ending audit');
    sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(w.phase).toBe('week'); expect(w.minute).toBe(1); expect(w.outcome).toBeNull();
  });

  it('ends in the same tick that a real rival Kill order kills the player boss', () => {
    // The success roll is real; the fixture is deterministic, so vary the
    // dice by drawing a few numbers first, and check the first attempt that kills.
    const start = 136;
    for (let burn = 0; burn < 12; burn++) {
      const { sim, w, boss } = fixture();
      w.orders = {};
      for (const team of Object.values(w.teams)) { team.orderIds = []; team.timeUsed = 0; }
      const rival = Object.values(w.gangs).find(g => !g.isPlayer)!, team = w.teams[rival.teamIds[0]];
      rival.knownPeople.push(boss.id);
      for (const id of [team.lieutenantId, ...team.memberIds]) for (const skill of Object.keys(w.people[id].skills) as Array<keyof typeof boss.skills>) w.people[id].skills[skill] = 5;
      expect(issueOrder(w, rival.id, { teamId: team.id, type: 'kill', personId: boss.id, opts: { manpower: 1 } }).ok).toBe(true);
      sim.launchWeek(); w.minute = start;
      const order = w.orders[team.orderIds[0]];
      // Arrival is isolated here; execution, success roll, crime and death are real.
      order.state = 'executing'; order.workLeft = 1;
      for (let i = 0; i < burn; i++) sim.rng.next();
      sim.advance(1 / MINUTES_PER_SECOND, 1);
      if (boss.status !== 'dead') { expect(w.phase).toBe('week'); continue; }
      expect(w.crimes.some(c => c.kind === 'kill')).toBe(true);
      expect(w.phase).toBe('gameOver'); expect(w.minute).toBe(start + 1); expect(w.outcome?.won).toBe(false);
      return;
    }
    throw new Error('No seeded attempt killed the boss.');
  });

  it('keeps insolvency at settlement so remaining weekly receipts can still matter', () => {
    const { sim, w, gang, boss } = fixture();
    for (const p of Object.values(w.people)) if (p.gangId === gang.id && p.id !== boss.id) killPerson(w, p, 'ending fixture');
    gang.cash = -1_000_000;
    sim.launchWeek(); sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(w.phase).toBe('week'); expect(w.minute).toBe(1);
    w.settlementStage = 15; sim.finishWeek();
    expect(w.outcome?.won).toBe(false); expect(w.outcome?.reason).toContain('bankrupt');
  });

  it('resolves an actual boss conviction before later settlement stages', () => {
    const { sim, w, gang, boss } = fixture();
    sim.launchWeek(); boss.status = 'arrested';
    weeklyLaw(w, sim.rng);
    const court = Object.values(w.cases).find(c => c.defendantId === boss.id)!;
    expect(boss.status).toBe('onTrial'); expect(w.outcome).toBeNull();
    court.weeksToTrial = 1; court.strength = 100; gang.evidence = 100;
    w.people[court.daId].skills.intelligence = 5;
    w.people[court.judgeId].opinion[gang.id] = 0;
    for (const id of court.jurorIds) w.people[id].opinion[gang.id] = -100;
    w.settlementStage = 4;
    sim.finishWeekSlice(0);
    expect(court.status).toBe('convicted'); expect(boss.status).toBe('jailed'); expect(boss.jailWeeks).toBe(999);
    expect(w.phase).toBe('gameOver'); expect(w.outcome?.reason).toContain('convicted');
    expect(w.settlementStage).toBeUndefined(); expect(w.week).toBe(1);
  });
});
