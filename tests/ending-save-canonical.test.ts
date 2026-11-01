import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { cloneSavedWorld } from '../src/app/save';
import { issueOrder } from '../src/sim/api';
import { Sim } from '../src/sim/sim';

describe('a finished game saves in its canonical state', () => {
  it('releases vehicles held by failed orders when the game ends, so restore changes nothing', () => {
    // Found by the balance matrix (power-10-404-weak-aggressive): the week-end
    // ending failed the unfinished orders but skipped the transport release a
    // restore performs, so the final save and its restore differed.
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, mode: 'power', powerWeeks: 1 });
    const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
    // Far enough from the office that the crew drives there.
    const hq = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === gang.id)!, home = w.lots[hq.lotId].center;
    const block = w.blocks.find(b => b.lotIds.length && Math.hypot(b.center.x - home.x, b.center.y - home.y) > 260)!;
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'patrol', blockIds: [block.id], opts: { manpower: 1 } }).ok).toBe(true);
    const order = w.orders[team.orderIds.at(-1)!];
    sim.launchWeek();
    const [key, car] = Object.entries(w.vehicleFleet ?? {}).find(([, v]) => v.teamId === team.id)!;
    car.orderId = order.id;   // the crew's car is out on the standing order
    sim.finishWeek();
    expect(w.phase).toBe('gameOver');
    expect(['done', 'failed']).toContain(order.state);
    expect(w.vehicleFleet![key].orderId).toBeNull();
    const saved = JSON.stringify(w);
    expect(JSON.stringify(Sim.fromSave(cloneSavedWorld(JSON.parse(saved))).world)).toBe(saved);
  });
});
