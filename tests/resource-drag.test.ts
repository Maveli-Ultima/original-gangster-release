import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { moveToPool } from '../src/sim/api';
import { applyResourceDrop } from '../src/ui/resourceDrag';

describe('resources drag and drop (original §4.10)', () => {
  const setup = () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 7, citySize: 10, startMoney: 10_000, startHoods: 8 });
    const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
    return { w, gang, team };
  };

  it('a hood dropped on a crew joins it, and dropped on the pool leaves it', () => {
    const { w, gang, team } = setup();
    const hood = team.memberIds[0];
    expect(moveToPool(w, gang.id, hood).ok).toBe(true);
    expect(applyResourceDrop(w, gang.id, { kind: 'hood', id: hood }, { kind: 'team', teamId: team.id }).ok).toBe(true);
    expect(team.memberIds).toContain(hood);
    expect(gang.poolIds).not.toContain(hood);
    expect(applyResourceDrop(w, gang.id, { kind: 'hood', id: hood }, { kind: 'pool' }).ok).toBe(true);
    expect(gang.poolIds).toContain(hood);
    expect(team.memberIds).not.toContain(hood);
  });

  it('weapons and vehicles move from the cache to the crew they are dropped on', () => {
    const { w, gang, team } = setup();
    gang.weapons.pistol = 2; gang.vehicles.coupe = 1;
    const guns = team.weapons.pistol ?? 0, cars = team.vehicles.coupe ?? 0;
    expect(applyResourceDrop(w, gang.id, { kind: 'weapon', id: 'pistol' }, { kind: 'team', teamId: team.id }).ok).toBe(true);
    expect(applyResourceDrop(w, gang.id, { kind: 'vehicle', id: 'coupe' }, { kind: 'team', teamId: team.id }).ok).toBe(true);
    expect([gang.weapons.pistol, team.weapons.pistol, gang.vehicles.coupe, team.vehicles.coupe]).toEqual([1, guns + 1, 0, cars + 1]);
  });

  it('refuses what the buttons refuse: an empty cache, or gear dropped on the pool', () => {
    const { w, gang, team } = setup();
    gang.vehicles.truck = 0;
    expect(applyResourceDrop(w, gang.id, { kind: 'vehicle', id: 'truck' }, { kind: 'team', teamId: team.id })).toEqual({ ok: false, error: 'None in the cache.' });
    expect(applyResourceDrop(w, gang.id, { kind: 'weapon', id: 'pistol' }, { kind: 'pool' }).ok).toBe(false);
  });
});
