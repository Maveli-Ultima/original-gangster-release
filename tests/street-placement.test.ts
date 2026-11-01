import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { BLOCK_SIZE, CELL, PAVEMENT_OFFSET } from '../src/sim/constants';
import { Sim } from '../src/sim/sim';
import { repairLegacyStreetSpawns } from '../src/sim/streetPlacement';
import type { Person, Vec2, WorldState } from '../src/sim/types';
import { blockRect, cityBlockAt } from '../src/sim/cityLayout';

const fixture = () => new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, cityLayout: 'classic' });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function expectPavement(pos: Vec2, w?: WorldState) {
  if (w?.cityLayout) {
    const b = cityBlockAt(w, Math.floor(pos.x / CELL), Math.floor(pos.y / CELL))!;
    const r = blockRect(b);
    const dx = Math.max(r.x - pos.x, pos.x - r.x - r.w), dy = Math.max(r.y - pos.y, pos.y - r.y - r.h);
    expect(Math.max(dx, dy)).toBeCloseTo(1.6, 7);
    return;
  }
  const x = pos.x % CELL, y = pos.y % CELL;
  // The walking line lies outside the buildable block, inside its own cell.
  expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(CELL);
  expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(CELL);
  expect(Math.min(Math.abs(x - PAVEMENT_OFFSET), Math.abs(x - (CELL - PAVEMENT_OFFSET)),
    Math.abs(y - PAVEMENT_OFFSET), Math.abs(y - (CELL - PAVEMENT_OFFSET)))).toBeLessThan(1e-8);
}

function legacyFixture() {
  const sim = fixture(), w = sim.world;
  const block = w.blocks.find(b => w.buildings[w.lots[b.lotIds[4]].buildingId].state === 'empty')!;
  const officer = w.people[w.policeIds[0]], snitch = w.people[w.snitchIds[0]];
  officer.pos = { ...block.center }; snitch.pos = { ...block.center };
  return { sim, w, block, officer, snitch };
}

describe('street NPC placement', () => {
  it.each([[404, 10], [405, 14], [711, 18]])('starts street NPCs on pavements (seed %s, size %s)', (seed, citySize) => {
    const { world: w } = new Sim({ ...defaultGameOptions(), seed, citySize });
    expect(w.policeIds).toHaveLength(Math.round(w.gridW * w.gridH * .22));
    expect(w.snitchIds).toHaveLength(3);
    for (const id of [...w.policeIds, ...w.snitchIds, ...w.fbiIds, w.mayorId,
      w.policeChiefId, w.fbiHeadId, ...w.judgeIds, ...w.daIds]) expectPavement(w.people[id].pos, w);
    for (const person of Object.values(w.people).filter(p => p.role === 'citizen')) expectPavement(person.pos, w);
  });

  it('moves a legacy courtyard officer to the pavement of the same block', () => {
    const { w, block, officer } = legacyFixture();
    repairLegacyStreetSpawns(w);
    expect(officer.role).toBe('police');
    expect(Math.floor(officer.pos.x / CELL)).toBe(block.gx); expect(Math.floor(officer.pos.y / CELL)).toBe(block.gy);
    expectPavement(officer.pos);
    const centre = block.center;
    expect(Object.values(w.people).filter(p => ['police', 'snitch'].includes(p.role) &&
      Math.abs(p.pos.x - centre.x) < BLOCK_SIZE / 6 && Math.abs(p.pos.y - centre.y) < BLOCK_SIZE / 6)).toEqual([]);
  });

  it.each(['synchronous', 'responsive'])('repairs only stranded spawns when restoring a %s save', async mode => {
    const { w, officer, snitch } = legacyFixture();
    const original = copy(w);
    const restored = mode === 'synchronous' ? Sim.fromSave(copy(w)) : await Sim.fromSaveResponsive(copy(w));
    const after = restored.world;
    expectPavement(after.people[officer.id].pos); expectPavement(after.people[snitch.id].pos);
    expect(after.people[officer.id].pos).not.toEqual(officer.pos);
    expect(after.people[snitch.id].pos).not.toEqual(snitch.pos);
    // No changes to RNG, inventory, orders, clocks, or any other person's state.
    const expected = copy(original);
    expected.people[officer.id].pos = { ...after.people[officer.id].pos };
    expected.people[snitch.id].pos = { ...after.people[snitch.id].pos };
    expect(after).toEqual(expected); expect(w).toEqual(original);
    expect(restored.rng.state).toBe(w.rngState);
    expect(Sim.fromSave(copy(after)).world).toEqual(after);
  });

  it('preserves real activity, residents, and people away from the exact old spawn', () => {
    const { w, block, officer, snitch } = legacyFixture();
    const protectedStates: Partial<Person>[] = [
      { dest: { x: 100, y: 100 }, path: [{ x: 100, y: 100 }] },
      { orderId: Object.values(w.orders)[0].id },
      { streetOrder: { type: 'goTo', pos: { x: 100, y: 100 }, targetPersonId: null } },
      { buildingId: w.lots[block.lotIds[0]].buildingId },
      { gangId: Object.values(w.gangs)[0].id },
      { inVehicle: true }, { halted: true }, { status: 'arrested' }, { status: 'dead' },
      { path: [{ x: 100, y: 100 }] }, { pos: { x: block.center.x + .25, y: block.center.y } },
    ];
    protectedStates.forEach((state, i) => {
      const person = w.people[w.policeIds[i]];
      Object.assign(person, { pos: { ...block.center } }, state);
    });
    snitch.pos = { x: block.center.x, y: block.center.y - BLOCK_SIZE / 2 - 1.6 };
    const before = copy(w);
    repairLegacyStreetSpawns(w);
    expect(w).toEqual(before);
    expect(officer.dest).not.toBeNull();
  });

  it('preserves an officer visiting a developed centre lot', () => {
    const { w, block } = legacyFixture();
    const building = w.buildings[w.lots[block.lotIds[4]].buildingId];
    building.state = 'trading';
    const before = copy(w);
    repairLegacyStreetSpawns(w);
    expect(w).toEqual(before);
  });
});
