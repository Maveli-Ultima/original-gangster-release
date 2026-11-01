import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { defaultGameOptions } from '../src/app/newGame';
import { cloneSavedWorld, loadGame, saveGame } from '../src/app/save';
import { issueOrder, issueStreetOrder } from '../src/sim/api';
import { respondToBureauViolence } from '../src/sim/bureauViolence';
import { tickOrders } from '../src/sim/execution';
import { originalFireOdds } from '../src/sim/fireRoll';
import { Sim } from '../src/sim/sim';
import { tickStreetOrders } from '../src/sim/systems/street';
import type { PersonRole, WorldState } from '../src/sim/types';

let initial: string;
beforeAll(() => { initial = JSON.stringify(new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 }).world); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function scene(role: PersonRole = 'fbi') {
  const sim = Sim.fromSave(JSON.parse(initial) as WorldState);
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  const actor = w.people[team.lieutenantId], head = w.people[w.fbiHeadId];
  const target = role === 'fbi' ? w.people[w.fbiIds[0]] : role === 'fbiHead' ? head :
    Object.values(w.people).find(p => p.role === role && p.gangId !== gang.id)!;
  const survivor = w.people[w.fbiIds[1]], inactive = w.people[w.fbiIds[2]];
  for (const p of Object.values(w.people)) p.status = 'jailed';
  w.orders = {};
  for (const t of Object.values(w.teams)) t.orderIds = [];
  for (const owner of [...Object.values(w.gangs), ...Object.values(w.teams)]) {
    for (const key of Object.keys(owner.weapons) as (keyof typeof owner.weapons)[]) owner.weapons[key] = 0;
  }
  for (const p of [actor, target, head, survivor]) {
    p.status = 'active'; p.hp = 1000; p.pos = { x: 100, y: 100 };
    p.orderId = null; p.streetOrder = null; p.dest = null; p.path = [];
  }
  for (const p of [head, ...w.fbiIds.map(id => w.people[id])]) p.opinion[gang.id] = 10;
  target.pos.x = 101; actor.skills.firearms = 5; actor.skills.fists = 5; actor.skills.knives = 5;
  gang.suspicion = 0; team.weapons.tommy = 1;
  w.messages = []; w.crimes = [];
  return { sim, w, gang, team, actor, target, head, survivor, inactive };
}

function planned(s: ReturnType<typeof scene>, type: 'kill' | 'assault') {
  expect(issueOrder(s.w, s.gang.id, { teamId: s.team.id, type, personId: s.target.id, opts: { manpower: 1 } }).ok).toBe(true);
  const order = s.w.orders[s.team.orderIds.at(-1)!];
  order.state = 'executing'; order.workLeft = 0; order.assignedIds = [s.actor.id];
  s.actor.orderId = order.id;
  return order;
}

function street(s: ReturnType<typeof scene>, type: 'kill' | 'assault') {
  expect(issueStreetOrder(s.w, s.gang.id, [s.actor.id], type, s.target.id, null).ok).toBe(true);
}

function hits(sim: Sim) {
  const chance = vi.spyOn(sim.rng, 'chance').mockReturnValue(true);
  vi.spyOn(sim.rng, 'range').mockReturnValue(1);
  vi.spyOn(sim.rng, 'int').mockReturnValue(30);
  return chance;
}

/** Hits that only wound: the original fire roll draws the kill at the exact
 * lethal share of the damage octet, which this refuses (no gunfire HP). */
function wounds(sim: Sim, s: ReturnType<typeof scene>) {
  const w = sim.world, actor = w.people[s.actor.id], target = w.people[s.target.id];
  const lethal = originalFireOdds(actor, target, 'tommy', Math.hypot(actor.pos.x - target.pos.x, actor.pos.y - target.pos.y)).killGivenHit;
  vi.spyOn(sim.rng, 'chance').mockImplementation(p => p !== lethal);
  vi.spyOn(sim.rng, 'range').mockReturnValue(1);
  vi.spyOn(sim.rng, 'int').mockReturnValue(30);
}

function expectResponse(s: ReturnType<typeof scene>) {
  expect(s.gang.suspicion).toBe(5);
  if (s.head.status !== 'dead' && s.head !== s.target) expect(s.head.opinion[s.gang.id]).toBe(0);
  expect(s.survivor.opinion[s.gang.id]).toBe(0);
  expect(s.inactive.opinion[s.gang.id]).toBe(10);
}

describe('attributed Bureau violence', () => {
  it.each(['fbi', 'fbiHead'] as const)('responds once to a planned killing of %s', role => {
    const s = scene(role), order = planned(s, 'kill'); hits(s.sim);
    tickOrders(s.w, s.sim.rng, 1);
    expect(order.state).toBe('done'); expect(s.target.status).toBe('dead');
    expectResponse(s);
    expect(s.w.crimes).toHaveLength(1);
    expect(s.w.crimes[0]).toMatchObject({ kind: 'kill', victimId: s.target.id });
    tickOrders(s.w, s.sim.rng, 1);
    expectResponse(s);
  });

  it.each([false, true])('counts a planned assault once when lethal=%s', lethal => {
    const s = scene(), order = planned(s, 'assault');
    hits(s.sim).mockReturnValueOnce(true).mockReturnValueOnce(lethal);
    tickOrders(s.w, s.sim.rng, 1);
    expect(order.state).toBe('done'); expect(s.target.status).toBe(lethal ? 'dead' : 'beaten');
    expectResponse(s);
    expect(s.w.crimes).toHaveLength(1);
    expect(s.w.crimes[0]).toMatchObject({ kind: lethal ? 'kill' : 'assault', victimId: s.target.id });
  });

  it('responds to the injury in a survived planned killing attempt', () => {
    const s = scene(); planned(s, 'kill');
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    tickOrders(s.w, s.sim.rng, 1);
    expect(s.target.hp).toBe(970); expect(s.target.status).toBe('active');
    expectResponse(s);
  });

  it('does not respond when an assault target was not found and no violence occurred', () => {
    const s = scene(); planned(s, 'assault');
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    tickOrders(s.w, s.sim.rng, 1);
    expect(s.target.hp).toBe(1000); expect(s.w.crimes).toHaveLength(0);
    expect(s.gang.suspicion).toBe(0); expect(s.head.opinion[s.gang.id]).toBe(10);
  });

  it.each(['fbi', 'fbiHead'] as const)('responds to a street assault against %s', role => {
    const s = scene(role); street(s, 'assault'); hits(s.sim);
    tickStreetOrders(s.w, s.sim.rng, 1);
    expect(s.actor.streetOrder).toBeNull(); expect(s.target.status).toBe('beaten');
    expectResponse(s);
    if (role === 'fbiHead') expect(s.head.opinion[s.gang.id]).toBe(0);
    expect(s.w.crimes).toHaveLength(1);
  });

  it('does not treat paused ticks, misses, movement or tailing as attributed injury', () => {
    const s = scene(); street(s, 'kill');
    hits(s.sim).mockReturnValue(false);
    tickStreetOrders(s.w, s.sim.rng, 0); // no time elapsed: no shot
    tickStreetOrders(s.w, s.sim.rng, 1); // missed shot, normal crime still recorded
    expect(s.w.crimes).toHaveLength(1);
    expect(s.w.crimes[0].victimId).toBeNull();
    s.target.pos.x = 200;
    tickStreetOrders(s.w, s.sim.rng, 1); // approaching the target
    expect(issueStreetOrder(s.w, s.gang.id, [s.actor.id], 'tail', s.target.id, null).ok).toBe(true);
    tickStreetOrders(s.w, s.sim.rng, 1);
    expect(s.target.hp).toBe(1000); expect(s.gang.suspicion).toBe(0);
    expect(s.head.opinion[s.gang.id]).toBe(10);
  });

  it('responds on the first street hit and does not multiply further hits or death', () => {
    const s = scene(); street(s, 'kill'); wounds(s.sim, s);
    tickStreetOrders(s.w, s.sim.rng, 1);
    expectResponse(s); expect(s.actor.streetOrder?.bureauResponseApplied).toBe(true);
    tickStreetOrders(s.w, s.sim.rng, 1);
    // A second wound: gunfire has no hit points, so the target is still standing.
    expectResponse(s); expect(s.target.status).toBe('active');
    hits(s.sim);
    tickStreetOrders(s.w, s.sim.rng, 1);
    expectResponse(s); expect(s.target.status).toBe('dead'); expect(s.actor.streetOrder).toBeNull();
    expect(s.w.crimes).toHaveLength(1);
    expect(s.w.crimes[0]).toMatchObject({ kind: 'streetKill', victimId: s.target.id });
  });

  it('counts a first-hit lethal street attack once and excludes the dead official', () => {
    const s = scene(); s.target.hp = 1; street(s, 'kill'); hits(s.sim);
    tickStreetOrders(s.w, s.sim.rng, 1);
    expectResponse(s); expect(s.target.status).toBe('dead');
    expect(s.target.opinion[s.gang.id]).toBe(10);
    expect(s.w.fbiIds).not.toContain(s.target.id);
  });

  it.each(['police', 'policeChief', 'owner', 'citizen', 'lieutenant'] as const)(
    'leaves Bureau response unchanged for a non-Bureau %s victim on both routes', role => {
      const plannedScene = scene(role); planned(plannedScene, 'kill'); hits(plannedScene.sim);
      tickOrders(plannedScene.w, plannedScene.sim.rng, 1);
      expect(plannedScene.gang.suspicion).toBe(0);
      expect(plannedScene.head.opinion[plannedScene.gang.id]).toBe(10);
      const streetScene = scene(role); street(streetScene, 'assault'); hits(streetScene.sim);
      tickStreetOrders(streetScene.w, streetScene.sim.rng, 1);
      expect(streetScene.gang.suspicion).toBe(0);
      expect(streetScene.head.opinion[streetScene.gang.id]).toBe(10);
    },
  );

  it('caps hostility and suspicion and attributes consequences to the attacking gang only', () => {
    const s = scene(); s.gang.suspicion = 98;
    s.head.opinion[s.gang.id] = -95; s.survivor.opinion[s.gang.id] = -96;
    const other = Object.values(s.w.gangs).find(g => g.id !== s.gang.id)!;
    const otherSuspicion = other.suspicion, otherOpinion = s.head.opinion[other.id];
    const rngState = s.sim.rng.state;
    expect(respondToBureauViolence(s.w, s.gang.id, s.target)).toBe(true);
    expect(s.gang.suspicion).toBe(100); expect(s.head.opinion[s.gang.id]).toBe(-100);
    expect(s.survivor.opinion[s.gang.id]).toBe(-100);
    expect(other.suspicion).toBe(otherSuspicion); expect(s.head.opinion[other.id]).toBe(otherOpinion);
    expect(s.sim.rng.state).toBe(rngState);
    expect(respondToBureauViolence(s.w, -1, s.target)).toBe(false);
  });

  it('persists a mid-attack response through the real save envelope without repeating it', async () => {
    const s = scene(); street(s, 'kill'); wounds(s.sim, s);
    tickStreetOrders(s.w, s.sim.rng, 1);
    expectResponse(s); s.w.rngState = s.sim.rng.state;
    vi.stubGlobal('indexedDB', new IDBFactory());
    await saveGame('Bureau attack', s.w);
    const [slot] = await loadGame(); expect(slot.error).toBeUndefined();
    const restored = Sim.fromSave(cloneSavedWorld(slot.world!));
    expect(restored.world).toEqual(s.w);
    expect(restored.world.people[s.actor.id].streetOrder?.bureauResponseApplied).toBe(true);
    hits(restored); hits(s.sim);
    s.target.hp = 1; restored.world.people[s.target.id].hp = 1;
    tickStreetOrders(s.w, s.sim.rng, 1);
    tickStreetOrders(restored.world, restored.rng, 1);
    expect(restored.world).toEqual(s.w);
    expect(restored.playerGang.suspicion).toBe(5);
    expect(restored.rng.state).toBe(s.sim.rng.state);
  });

  it('loads historical street orders without the optional flag and treats a reissued order as a new attack', () => {
    const s = scene(); street(s, 'kill');
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(s.w)) as WorldState);
    expect(restored.world.people[s.actor.id].streetOrder).not.toHaveProperty('bureauResponseApplied');
    wounds(restored, s); tickStreetOrders(restored.world, restored.rng, 1);
    expect(restored.playerGang.suspicion).toBe(5);
    expect(issueStreetOrder(restored.world, s.gang.id, [s.actor.id], 'kill', s.target.id, null).ok).toBe(true);
    tickStreetOrders(restored.world, restored.rng, 1);
    expect(restored.playerGang.suspicion).toBe(10);
  });

  it('rejects a malformed persisted response flag before installing the save', () => {
    const s = scene(); street(s, 'kill');
    const damaged = JSON.parse(JSON.stringify(s.w));
    damaged.people[s.actor.id].streetOrder.bureauResponseApplied = 'yes';
    expect(() => Sim.fromSave(damaged)).toThrow('Cannot load save');
  });
});
