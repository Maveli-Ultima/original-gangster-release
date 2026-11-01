import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { bribeOfficial, bribePrice, hireRecruit, sackPerson, setRunForOffice } from '../src/sim/api';
import { killPerson } from '../src/sim/execution';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { weeklyLaw } from '../src/sim/systems/law';
import { weeklyEconomy } from '../src/sim/systems/economy';
import { campaignWeeklyCost, canRunForOffice, weeklyPolitics } from '../src/sim/systems/politics';
import { allBuildings, typeOf } from '../src/sim/world';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 500_000 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  const lawyer = Object.values(w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
  expect(hireRecruit(w, gang.id, lawyer.id, 'pool').ok).toBe(true);
  const defendant = w.people[team.memberIds[0]];
  return { sim, w, gang, lawyer, defendant };
}
type Fixture = ReturnType<typeof fixture>;
function openCase(s: Fixture) {
  // Arrest is the declared fixture boundary; this suite tests courts, not the
  // separate probabilistic police investigation already covered elsewhere.
  s.defendant.status = 'arrested';
  weeklyLaw(s.w, s.sim.rng);
  const court = Object.values(s.w.cases).find(c => c.defendantId === s.defendant.id)!;
  expect(court.status).toBe('onTrial'); expect(court.weeksToTrial).toBeGreaterThan(0);
  return court;
}
function electionFixture() {
  const s = fixture();
  for (const b of allBuildings(s.w)) if (b.ownerGangId == null && !typeOf(b)?.special && b.cls !== 'empty') b.ownerGangId = s.gang.id;
  killPerson(s.w, s.w.people[s.w.mayorId], 'election test');
  weeklyPolitics(s.w, s.sim.rng);
  expect(s.w.election.candidates).toHaveLength(2);
  expect(s.w.election.weeksLeft).toBe(6);
  expect(canRunForOffice(s.w, s.gang.id)).toBe(true);
  return s;
}

describe('court outcomes and lawyer actions', () => {
  it('DA bribes reveal witnesses then jurors, survive restoration, and a judge bribe dismisses the case', () => {
    const s = fixture(), court = openCase(s);
    const opening = s.gang.cash, da = s.w.people[court.daId];
    const first = bribePrice(s.w, da, s.gang.id);
    expect(bribeOfficial(s.w, s.gang.id, da.id).ok).toBe(true);
    expect(court.knowsWitnesses).toBe(false);
    s.sim.launchWeek();
    const visit = () => {
      for (let i = 0; i < MINUTES_PER_WEEK && Object.values(s.w.specialistJobs ?? {}).some(j => j.actorId === s.lawyer.id && ['queued','travelling','working'].includes(j.state)); i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
      expect(Object.values(s.w.specialistJobs ?? {}).filter(j => j.actorId === s.lawyer.id).every(j => j.state === 'done')).toBe(true);
    };
    visit();
    expect(court.knowsWitnesses).toBe(true); expect(court.knowsJurors).toBe(false);
    const second = bribePrice(s.w, da, s.gang.id);
    expect(bribeOfficial(s.w, s.gang.id, da.id).ok).toBe(true);
    visit();
    expect(court.knowsJurors).toBe(true);
    const judge = bribePrice(s.w, s.w.people[court.judgeId], s.gang.id);
    expect(bribeOfficial(s.w, s.gang.id, court.judgeId).ok).toBe(true);
    visit();
    expect(court.status).toBe('dismissed');
    expect(s.gang.cash).toBe(opening - first - second - judge);
    s.w.rngState = s.sim.rng.state;
    const sim = Sim.fromSave(structuredClone(s.w)), savedCase = sim.world.cases[court.id];
    for (let i = 0; i < 4 && ['awaiting', 'onTrial'].includes(savedCase.status); i++) {
      sim.world.week++; weeklyLaw(sim.world, sim.rng);
    }
    expect(savedCase.status).toBe('dismissed');
    expect(sim.world.people[s.defendant.id].status).toBe('active');
    expect(sim.playerGang.cash).toBe(s.gang.cash);
  });

  it('draws six different jurors even when successive random draws choose the same slot', () => {
    const s = fixture();
    vi.spyOn(s.sim.rng, 'next').mockReturnValue(0);
    const court = openCase(s);
    expect(court.jurorIds).toHaveLength(6);
    expect(new Set(court.jurorIds).size).toBe(6);
  });

  it('a conviction serves the full sentence before release', () => {
    const s = fixture(), court = openCase(s);
    s.gang.lawyerId = null; court.strength = 100; court.weeksToTrial = 1;
    s.w.people[court.judgeId].opinion[s.gang.id] = -50;
    vi.spyOn(s.sim.rng, 'int').mockReturnValue(3);
    vi.spyOn(s.sim.rng, 'range').mockReturnValue(1);
    s.w.week++; weeklyLaw(s.w, s.sim.rng);
    expect(court.status).toBe('convicted'); expect(s.defendant.status).toBe('jailed');
    expect(s.defendant.jailWeeks).toBe(3);
    for (const remaining of [2, 1, 0]) {
      s.w.week++; weeklyLaw(s.w, s.sim.rng);
      expect(s.defendant.jailWeeks).toBe(remaining);
      expect(s.defendant.status).toBe(remaining ? 'jailed' : 'active');
    }
  });

  it('replaces unavailable court officials without invalid case IDs or inherited bribes', () => {
    const s = fixture(), court = openCase(s), oldJudge = court.judgeId, oldDa = court.daId;
    court.judgeBribed = true; court.weeksToTrial = 1;
    for (const id of [...s.w.judgeIds, ...s.w.daIds]) killPerson(s.w, s.w.people[id], 'court succession test');
    s.w.week++; weeklyLaw(s.w, s.sim.rng);
    expect(s.w.judgeIds.length).toBeGreaterThan(0); expect(s.w.daIds.length).toBeGreaterThan(0);
    expect(court.judgeId).not.toBe(oldJudge); expect(court.daId).not.toBe(oldDa);
    expect(s.w.people[court.judgeId].status).toBe('active'); expect(s.w.people[court.daId].status).toBe('active');
    expect(court.judgeBribed).toBe(false); expect(court.status).toBe('onTrial');
    expect(() => Sim.fromSave(structuredClone(s.w))).not.toThrow();
  });

  it.each(['dead official', 'jailed lawyer'] as const)('rejects a bribe with %s without spending money', condition => {
    const s = fixture(), official = s.w.people[s.w.judgeIds[0]], cash = s.gang.cash;
    if (condition === 'dead official') killPerson(s.w, official, 'unavailable official');
    else s.lawyer.status = 'jailed';
    expect(bribeOfficial(s.w, s.gang.id, official.id).ok).toBe(false);
    expect(s.gang.cash).toBe(cash);
  });
});

describe('election candidates, campaign controls and settlement', () => {
  it('cannot elect a candidate who died after nominations', () => {
    const s = electionFixture(), dead = s.w.people[s.w.election.candidates[0].id], living = s.w.people[s.w.election.candidates[1].id];
    dead.skills.intelligence = 5; living.skills.intelligence = 0.5;
    killPerson(s.w, dead, 'candidate killed');
    // 0x4BD090 refills the dead principal's slot with the next judge at once.
    expect(s.w.election.candidates.some(c => c.id === dead.id)).toBe(false);
    expect(s.w.election.candidates.some(c => c.id === living.id)).toBe(true);
    s.w.election.weeksLeft = 1;
    weeklyPolitics(s.w, s.sim.rng);
    expect(s.w.mayorId).not.toBe(dead.id);
    expect(s.w.people[s.w.mayorId].status).toBe('active');
  });

  it('reopens nominations with living candidates if the whole ballot is lost', () => {
    const s = electionFixture();
    for (const id of [...s.w.judgeIds]) killPerson(s.w, s.w.people[id], 'ballot lost');
    s.w.election.weeksLeft = 1; weeklyPolitics(s.w, s.sim.rng);
    expect(s.w.election.active).toBe(true); expect(s.w.election.weeksLeft).toBe(6);
    expect(s.w.election.candidates).toHaveLength(2);
    expect(s.w.election.candidates.every(c => s.w.people[c.id].status === 'active')).toBe(true);
  });

  it('a full ballot refuses nomination without changing cash or campaign state', () => {
    const s = electionFixture();
    const people = [...s.w.judgeIds, s.w.policeChiefId, s.w.fbiHeadId];
    s.w.election.candidates = people.map(id => ({ id, kind: 'judge', gangId: null, votes: 0 }));
    const previous = s.gang.cash;
    expect(setRunForOffice(s.w, s.gang.id, true).ok).toBe(false);
    expect(s.gang.cash).toBe(previous); expect(s.gang.runningForOffice).toBe(false);
  });

  it('an unavailable lawyer cannot enter a new campaign', () => {
    const s = electionFixture(); s.lawyer.status = 'jailed';
    expect(canRunForOffice(s.w, s.gang.id)).toBe(false);
    expect(setRunForOffice(s.w, s.gang.id, true).ok).toBe(false);
  });

  it.each(['killed', 'sacked', 'jailed'] as const)('withdraws before charging or polling when the lawyer is %s during the campaign', reason => {
    const s = electionFixture();
    expect(setRunForOffice(s.w, s.gang.id, true).ok).toBe(true);
    s.gang.popularity = 100;
    s.w.election.weeksLeft = 1;
    if (reason === 'killed') killPerson(s.w, s.lawyer, 'campaign lawyer killed');
    if (reason === 'sacked') expect(sackPerson(s.w, s.gang.id, s.lawyer.id).ok).toBe(true);
    if (reason === 'jailed') { s.lawyer.status = 'jailed'; s.lawyer.jailWeeks = 3; }
    const sim = Sim.fromSave(structuredClone(s.w));
    // Compare actual settlement costs against the identical withdrawn campaign.
    const withoutCampaign = Sim.fromSave(structuredClone(s.w));
    expect(setRunForOffice(withoutCampaign.world, s.gang.id, false).ok).toBe(true);
    weeklyEconomy(sim.world, sim.rng); weeklyEconomy(withoutCampaign.world, withoutCampaign.rng);
    expect(sim.playerGang.finances!.costs.upkeep).toBe(withoutCampaign.playerGang.finances!.costs.upkeep);
    expect(sim.playerGang.runningForOffice).toBe(false);
    expect(sim.world.election.candidates.some(c => c.gangId === s.gang.id)).toBe(false);
    expect(sim.world.messages.some(m => /campaign.*lawyer|lawyer.*campaign/i.test(m.text))).toBe(true);
    weeklyPolitics(sim.world, sim.rng);
    expect(sim.world.electionWinnerGangId).not.toBe(s.gang.id);
  });

  it('can replace a lost lawyer before settlement and continue the same nomination', () => {
    const s = electionFixture();
    expect(setRunForOffice(s.w, s.gang.id, true).ok).toBe(true);
    killPerson(s.w, s.lawyer, 'campaign lawyer killed');
    const replacement = Object.values(s.w.people).find(p => p.role === 'lawyer' && p.gangId == null && p.status === 'active')!;
    expect(hireRecruit(s.w, s.gang.id, replacement.id, 'pool').ok).toBe(true);
    const sim = Sim.fromSave(structuredClone(s.w));
    weeklyEconomy(sim.world, sim.rng); weeklyPolitics(sim.world, sim.rng);
    expect(sim.playerGang.runningForOffice).toBe(true);
    expect(sim.world.election.candidates.filter(c => c.gangId === s.gang.id)).toHaveLength(1);
    expect(sim.world.election.weeksLeft).toBe(5);
    expect(sim.playerGang.finances!.campaignCost).toBe(campaignWeeklyCost(sim.world, sim.playerGang.id));
  });

  it('rechecks the lawyer at the poll when they become unavailable after campaign costs were paid', () => {
    const s = electionFixture();
    s.gang.popularity = 100;
    expect(setRunForOffice(s.w, s.gang.id, true).ok).toBe(true);
    weeklyEconomy(s.w, s.sim.rng);
    s.lawyer.status = 'arrested'; s.w.election.weeksLeft = 1;
    weeklyPolitics(s.w, s.sim.rng);
    expect(s.w.electionWinnerGangId).not.toBe(s.gang.id);
    expect(s.gang.runningForOffice).toBe(false);
    // Costs already incurred are retained, not retrospectively refunded.
    expect(s.gang.finances!.campaignCost).toBe(campaignWeeklyCost(s.w, s.gang.id));
    expect(s.w.messages.some(m => /campaign.*lawyer|lawyer.*campaign/i.test(m.text))).toBe(true);
  });

  it('runs six settlement weeks, survives a mid-campaign save, charges the land-value bill and produces the mayoral win', () => {
    const s = electionFixture();
    for (const p of Object.values(s.w.people)) p.opinion[s.gang.id] = 95;
    s.gang.popularity = 95;
    expect(setRunForOffice(s.w, s.gang.id, true).ok).toBe(true);
    let sim = s.sim;
    for (let week = 0; week < 6; week++) {
      sim.launchWeek();
      // Exercise complete weekly settlement, not 14,400 unrelated street ticks.
      sim.world.minute = MINUTES_PER_WEEK - 1;
      sim.advance(1 / MINUTES_PER_SECOND, 1);
      expect(sim.playerGang.lastFinanceReport!.campaignCost).toBe(campaignWeeklyCost(sim.world, sim.playerGang.id));
      if (week < 5) {
        expect(sim.world.election.active).toBe(true);
        expect(sim.world.election.weeksLeft).toBe(5 - week);
      }
      if (week === 2) sim = Sim.fromSave(structuredClone(sim.world));
    }
    expect(sim.world.electionWinnerGangId).toBe(s.gang.id);
    expect(sim.world.phase).toBe('gameOver'); expect(sim.world.outcome?.won).toBe(true);
    expect(sim.world.outcome?.reason).toMatch(/Mayor/);
  });
});
