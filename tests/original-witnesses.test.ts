import { describe, expect, it } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { setAttitude } from '../src/sim/attitudes';
import { recordCrime } from '../src/sim/events';
import { ORIGINAL_CELL_METRES } from '../src/sim/fireRoll';
import { Sim } from '../src/sim/sim';
import type { Person, Vec2 } from '../src/sim/types';

/** fileCrime 0x4DB700 witness rules in the original city. */
function scene(stealth: number) {
  const sim = new Sim({ ...newCampaignOptions(), seed: 404 });
  const w = sim.world, gang = sim.playerGang;
  const perp = w.people[w.teams[gang.teamIds[0]].lieutenantId];
  perp.skills.stealth = stealth;
  const pos: Vec2 = { x: perp.pos.x, y: perp.pos.y };
  // Clear the street of everyone else who could see it.
  for (const p of Object.values(w.people)) if (p.id !== perp.id && p.status !== 'dead') p.pos = { x: -9999, y: -9999 };
  const place = (role: Person['role'], d: number, hostile = true) => {
    const p = Object.values(w.people).find(q => q.role === role && q.status === 'active' && q.pos.x === -9999)!;
    p.pos = { x: pos.x + d, y: pos.y };
    setAttitude(p, gang.id, hostile ? { hostility: 200, fear: 20 } : { hostility: 60, fear: 20 });
    return p;
  };
  return { sim, w, gang, perp, pos, place };
}

describe('original crime filing witnesses (0x4DB700)', () => {
  it('only hostile civilians within five cells come forward; owners and clergy do not', () => {
    const { sim, w, gang, perp, pos, place } = scene(0.5);
    const near = place('citizen', ORIGINAL_CELL_METRES * 2);
    const calm = place('citizen', ORIGINAL_CELL_METRES, false);
    const far = place('citizen', ORIGINAL_CELL_METRES * 6);
    const owner = place('owner', ORIGINAL_CELL_METRES);
    const crime = recordCrime(w, sim.rng, { gangId: gang.id, perpetratorId: perp.id, type: 'streetKill', pos });
    expect(crime.witnesses).toContain(near.id);
    expect(crime.witnesses).not.toContain(calm.id);
    expect(crime.witnesses).not.toContain(far.id);
    expect(crime.witnesses).not.toContain(owner.id);
    expect(crime.reported).toBe(true);
  });

  it('keeps at most four, and a master of stealth sheds nearly all of them', () => {
    const a = scene(0.5);
    for (let i = 0; i < 8; i++) a.place('citizen', ORIGINAL_CELL_METRES * (1 + i * .3));
    const crowd = recordCrime(a.w, a.sim.rng, { gangId: a.gang.id, perpetratorId: a.perp.id, type: 'streetKill', pos: a.pos });
    expect(crowd.witnesses.length).toBe(4);
    const b = scene(5);
    for (let i = 0; i < 8; i++) b.place('citizen', ORIGINAL_CELL_METRES * (1 + i * .3));
    const quiet = recordCrime(b.w, b.sim.rng, { gangId: b.gang.id, perpetratorId: b.perp.id, type: 'streetKill', pos: b.pos });
    // Six found; 6·63/64 = 5 shed.
    expect(quiet.witnesses.length).toBe(1);
  });

  it('an owner files nothing for extortion against himself', () => {
    const { sim, w, gang, perp, pos, place } = scene(0.5);
    place('citizen', ORIGINAL_CELL_METRES);
    const owner = Object.values(w.people).find(p => p.role === 'owner' && p.status === 'active')!;
    const evidence = gang.evidence;
    const crime = recordCrime(w, sim.rng, { gangId: gang.id, perpetratorId: perp.id, type: 'extort', pos, victimId: owner.id });
    expect(crime.witnesses).toEqual([]);
    expect(crime.reported).toBe(false);
    expect(gang.evidence).toBe(evidence);
  });
});
