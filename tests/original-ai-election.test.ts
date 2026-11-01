import { describe, expect, it, vi } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { planGang } from '../src/sim/ai';
import { stanceOfHostility, startingHostility } from '../src/sim/aiStance';
import { createWorld } from '../src/sim/citygen';
import { Rng } from '../src/sim/rng';
import { electionBlocksRequired } from '../src/sim/systems/politics';
import { territoryCount } from '../src/sim/world';
import type { ID } from '../src/sim/types';

// The entry week recounts the poll (0x4BCC50 after 0x4BC040); a test may fix
// that recount instead of building an electorate that gives the wanted shares.
const recount: { votes: Map<ID, number> | null } = { votes: null };
vi.mock('../src/sim/originalElection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sim/originalElection')>();
  return {
    ...actual,
    originalElectionPoll: (w: Parameters<typeof actual.originalElectionPoll>[0]) =>
      recount.votes ? { votes: recount.votes, result: {} as never } : actual.originalElectionPoll(w),
  };
});

// Traced 29 October 2026: the computer gangs' election task 0x32 (0x6AFA90).
// docs/audit/2026-10-28/ai-incidents/review.md, "the election campaign".
function setup() {
  recount.votes = null;
  const w = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
  const [a, rival] = Object.values(w.gangs).filter(g => !g.isPlayer);
  // No drift, damper or noise; the Aggressive band takes a rise as it is.
  a.aiProfile = [0, 0, 0, 0, 128, 0, 1];
  a.cash = 5_000_000;
  // A rising week to 255 against everyone: the stance machine says War.
  a.aiHostility = {}; a.aiHostilitySnapshot = {};
  for (const o of Object.values(w.gangs)) if (o.id !== a.id) { a.aiHostility[o.id] = 255; a.aiHostilitySnapshot[o.id] = 106; }
  const [judge] = w.judgeIds;
  const ballot = (judgeVotes: number, rivalVotes: number, ownVotes?: number) => {
    w.election = { ...w.election, active: true, weeksLeft: 4, candidates: [
      { id: judge, kind: 'judge', gangId: null, votes: judgeVotes },
      { id: rival.bossId, kind: 'gang', gangId: rival.id, votes: rivalVotes },
      ...(ownVotes == null ? [] : [{ id: a.bossId, kind: 'gang' as const, gangId: a.id, votes: ownVotes }])] };
  };
  const starting = () => Object.fromEntries(Object.values(w.gangs).filter(o => o.id !== a.id)
    .map(o => [o.id, stanceOfHostility(startingHostility(a, o))]));
  const allWar = () => Object.fromEntries(Object.values(w.gangs).filter(o => o.id !== a.id).map(o => [o.id, 'war']));
  const offered = () => Object.fromEntries(Object.values(w.gangs).filter(o => o.id !== a.id).map(o => [o.id, a.offered[o.id]]));
  return { w, a, rival, judge, ballot, starting, allWar, offered };
}

function hireLawyer(w: ReturnType<typeof setup>['w'], gang: ReturnType<typeof setup>['a']) {
  const lawyer = Object.values(w.people).find(p => p.role === 'lawyer' && p.gangId == null && p.status === 'active')!;
  lawyer.gangId = gang.id; gang.lawyerId = lawyer.id;
}

describe('a gang\'s boss leading the poll (0x6AFA90: stance 4, then 0x6DDE60)', () => {
  it('a gang that cannot stand falls back to its starting stances toward everyone, not War', () => {
    const { w, a, ballot, starting, offered } = setup();
    expect(territoryCount(w, a.id)).toBeLessThan(electionBlocksRequired(w));
    ballot(10, 60);
    planGang(w, new Rng(5), a);
    expect(offered()).toEqual(starting());
    expect(a.runningForOffice).toBe(false);
    // The player started at Cease-fire toward this profile (188); computer gangs at Peace.
    expect(Object.values(starting())).toContain('ceasefire');
  });

  it('a civic leader leaves a gang that cannot stand as the stance machine set it', () => {
    const { w, a, ballot, allWar, offered } = setup();
    ballot(60, 10);
    planGang(w, new Rng(5), a);
    expect(offered()).toEqual(allWar());
  });

  it('a standing gang behind a rival boss does the same (the remake used to declare War on him)', () => {
    const { w, a, rival, ballot, starting, offered } = setup();
    a.runningForOffice = true;
    ballot(10, 60, 20);
    planGang(w, new Rng(5), a);
    expect(offered()).toEqual(starting());
    expect(a.offered[rival.id]).not.toBe('war');
  });

  it('a standing gang that leads the poll does nothing', () => {
    const { w, a, ballot, allWar, offered } = setup();
    a.runningForOffice = true;
    ballot(10, 20, 60);
    planGang(w, new Rng(5), a);
    expect(offered()).toEqual(allWar());
  });

  it('draws nothing from the RNG beyond what the week draws without an election', () => {
    // A civic leader and no lawyer, so the stances (and the crews' plots) match.
    const runs = [false, true].map(election => {
      const { w, a, ballot } = setup();
      if (election) ballot(60, 10); else w.election.active = false;
      const rng = new Rng(5);
      planGang(w, rng, a);
      return rng.int(0, 1_000_000);
    });
    expect(runs[1]).toBe(runs[0]);
  });
});

describe('the entry week (0x6AFA90 loops from entry into the standing branch)', () => {
  function qualifying() {
    const s = setup();
    hireLawyer(s.w, s.a);
    // Protect a trading site in every block: well over the blocks required.
    for (const block of s.w.blocks) {
      const site = block.lotIds.map(id => s.w.buildings[s.w.lots[id].buildingId])
        .find(b => b && b.state === 'trading' && b.cls === 'commercial' && b.ownerGangId == null && b.protection == null);
      if (site) site.protection = { gangId: s.a.id, weekly: 100, base: 100, grievance: 0, refusing: false };
    }
    expect(territoryCount(s.w, s.a.id)).toBeGreaterThanOrEqual(electionBlocksRequired(s.w));
    s.ballot(0, 0);
    return s;
  }
  const bribed = (w: ReturnType<typeof setup>['w'], gangId: ID, personId: ID) =>
    Object.values(w.specialistJobs ?? {}).some(j => j.gangId === gangId && j.type === 'bribeOfficials' && j.targetPersonId === personId);

  it('enters within four-fifths of a civic leader and bribes him the same week', () => {
    const { w, a, rival, judge } = qualifying();
    recount.votes = new Map([[judge, 50], [rival.bossId, 5], [a.bossId, 45]]);
    planGang(w, new Rng(5), a);
    expect(a.runningForOffice).toBe(true);
    expect(w.election.candidates.some(c => c.gangId === a.id)).toBe(true);
    expect(bribed(w, a.id, judge)).toBe(true);
  });

  it('withdraws at once at four-fifths or less, and does nothing more', () => {
    const { w, a, rival, judge } = qualifying();
    recount.votes = new Map([[judge, 50], [rival.bossId, 10], [a.bossId, 40]]);
    planGang(w, new Rng(5), a);
    expect(a.runningForOffice).toBe(false);
    expect(w.election.candidates.some(c => c.gangId === a.id)).toBe(false);
    expect(bribed(w, a.id, judge)).toBe(false);
  });

  it('posts no entry headline (0x4BC040), so a weekly enter-and-withdraw stays quiet', () => {
    const { w, a, rival, judge } = qualifying();
    recount.votes = new Map([[judge, 50], [rival.bossId, 10], [a.bossId, 40]]);
    const before = w.news.length;
    planGang(w, new Rng(5), a);
    expect(w.news.slice(before).some(n => n.headline === 'BUSINESSMAN ENTERS MAYORAL RACE')).toBe(false);
  });

  it('without a lawyer it does not enter (task 0x27, recruiting one, is not ported)', () => {
    const s = setup();
    for (const block of s.w.blocks) {
      const site = block.lotIds.map(id => s.w.buildings[s.w.lots[id].buildingId])
        .find(b => b && b.state === 'trading' && b.cls === 'commercial' && b.ownerGangId == null && b.protection == null);
      if (site) site.protection = { gangId: s.a.id, weekly: 100, base: 100, grievance: 0, refusing: false };
    }
    expect(territoryCount(s.w, s.a.id)).toBeGreaterThanOrEqual(electionBlocksRequired(s.w));
    s.ballot(10, 60);
    s.a.lawyerId = null;
    // No free lawyer for manageSpecialists to hire this turn either.
    for (const p of Object.values(s.w.people)) if (p.role === 'lawyer' && p.gangId == null) p.status = 'dead';
    planGang(s.w, new Rng(5), s.a);
    expect(s.a.lawyerId).toBeNull();
    expect(s.a.runningForOffice).toBe(false);
    // The gates passed, so the boss-leader branch is not taken either.
    expect(s.offered()).toEqual(s.allWar());
  });
});
