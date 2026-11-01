import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, issueStreetOrder } from '../src/sim/api';
import { applyLiveMovement } from '../src/sim/movement';
import { Sim } from '../src/sim/sim';
import { buildingDoor, allBuildings } from '../src/sim/world';

/** A game saved between ticks carries on exactly as the one that was not saved. */
function compareAfterSave(prepare: (sim: Sim) => void, before: (sim: Sim) => void = () => {}) {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  before(sim);
  sim.launchWeek();
  for (let i = 0; i < 40; i++) sim.advance(0.3, 1);
  // Part way through a minute: some of its walking slices have run ahead.
  sim.advance(0.15, 1);
  prepare(sim);
  const copy = Sim.fromSave(structuredClone(sim.world));
  // A loaded game finishes the minute from its start (the clock's part-minute
  // is not saved); compare the two at the same minutes' ends.
  const target = sim.world.minute + 20;
  for (const s of [sim, copy]) while (s.world.minute < target) s.advance(0.02, 1);
  expect(copy.world.minute).toBe(sim.world.minute);
  expect(JSON.stringify(copy.world)).toBe(JSON.stringify(sim.world));
}

describe('a game saved mid-week', () => {
  it('carries on exactly after loading, part way through a minute', () => {
    compareAfterSave(() => {});
  });

  it('carries on exactly after a street order given part way through a minute', () => {
    compareAfterSave(sim => {
      const w = sim.world, gang = sim.playerGang;
      const hood = w.people[w.teams[gang.teamIds[0]].memberIds[0]];
      const office = allBuildings(w).find(b => b.isHQ && b.ownerGangId === gang.id)!;
      const door = buildingDoor(w, office);
      applyLiveMovement(w, 0.5, () => issueStreetOrder(w, gang.id, [hood.id], 'goTo', null, { x: door.x + 60, y: door.y }));
    });
  });

  it('carries on exactly with a crew driving through the traffic', () => {
    compareAfterSave(() => {}, sim => {
      const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
      team.vehicles = { coupe: 2, truck: 0, speedster: 0 };
      const office = allBuildings(w).find(b => b.isHQ && b.ownerGangId === gang.id)!, door = buildingDoor(w, office);
      const far = allBuildings(w).filter(b => b.ownerGangId == null && b.cls === 'commercial')
        .sort((a, b) => Math.hypot(buildingDoor(w, b).x - door.x, buildingDoor(w, b).y - door.y) - Math.hypot(buildingDoor(w, a).x - door.x, buildingDoor(w, a).y - door.y));
      for (const site of far.slice(0, 2)) expect(issueOrder(w, gang.id, { teamId: team.id, type: 'extort', buildingIds: [site.id], opts: { manpower: 2 } }).ok).toBe(true);
    });
  });
});
