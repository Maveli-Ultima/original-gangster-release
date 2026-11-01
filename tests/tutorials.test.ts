import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { applyTutorial, TUTORIALS } from '../src/app/tutorials';
import { buyVehicle, buyWeapon, issueOrder, sellWeapon } from '../src/sim/api';
import { Sim } from '../src/sim/sim';
import { allBuildings, territoryBlocks } from '../src/sim/world';

const war = TUTORIALS.find((lesson) => lesson.id === 4)!;
const weaponDone = war.steps[0].done;
const exploreDone = war.steps[1].done;
const newLesson = () => new Sim(applyTutorial(defaultGameOptions(), war));

function rivalTarget(sim: Sim) {
  const w = sim.world;
  const rival = Object.values(w.gangs).find((g) => !g.isPlayer)!;
  const building = allBuildings(w).find((b) => b.ownerGangId === rival.id && b.cls !== 'illegal')!;
  const block = w.blocks[building.blockId];
  return { rival, block, building };
}

describe('War tutorial action tracking', () => {
  it.each(['cache', 'crew'] as const)('requires a successful player weapon purchase into the %s', (destination) => {
    const sim = newLesson();
    const w = sim.world;
    const gang = sim.playerGang;
    expect(weaponDone(w, gang.id)).toBe(false);
    expect(buyVehicle(w, gang.id, 'coupe').ok).toBe(true);
    expect(gang.lastWeekCosts.purchases).toBeGreaterThan(0);
    expect(weaponDone(w, gang.id)).toBe(false);
    const rival = Object.values(w.gangs).find((g) => !g.isPlayer)!;
    expect(buyWeapon(w, rival.id, 'pistol').ok).toBe(true);
    expect(weaponDone(w, gang.id)).toBe(false);
    gang.cash = 0;
    expect(buyWeapon(w, gang.id, 'pistol').ok).toBe(false);
    expect(weaponDone(w, gang.id)).toBe(false);
    gang.cash = 100;
    const teamId = destination === 'crew' ? gang.teamIds[0] : undefined;
    expect(buyWeapon(w, gang.id, 'pistol', teamId).ok).toBe(true);
    expect(weaponDone(w, gang.id)).toBe(true);
    expect(weaponDone(w, rival.id)).toBe(false);
    // Selling it later must not erase an action the player already performed.
    expect(sellWeapon(w, gang.id, 'pistol', teamId).ok).toBe(true);
    expect(weaponDone(w, gang.id)).toBe(true);
  });

  it('does not count exploration of the player territory or an unclaimed block', () => {
    for (const targetKind of ['own', 'neutral']) {
      const sim = newLesson();
      const w = sim.world;
      const gang = sim.playerGang;
      const held = new Set(allBuildings(w).filter((b) => b.ownerGangId != null || b.protection != null).map((b) => b.blockId));
      const block = targetKind === 'own'
        ? w.blocks[allBuildings(w).find((b) => b.ownerGangId === gang.id)!.blockId]
        : w.blocks.find((b) => !held.has(b.id))!;
      expect(block).toBeDefined();
      expect(issueOrder(w, gang.id, { teamId: gang.teamIds[0], type: 'explore', blockIds: [block.id] }).ok).toBe(true);
      expect(exploreDone(w, gang.id)).toBe(false);
    }
  });

  it.each(['block', 'building'] as const)('counts an accepted rival exploration order selected by %s', (selection) => {
    const sim = newLesson();
    const w = sim.world;
    const gang = sim.playerGang;
    const { rival, block, building } = rivalTarget(sim);
    // A starting foothold is territory even with only one owned business.
    expect(territoryBlocks(w, rival.id).map(b => b.id)).toContain(block.layout?.mergedInto ?? block.id);
    const input = {
      teamId: gang.teamIds[0],
      type: 'explore' as const,
      ...(selection === 'block' ? { blockIds: [block.id] } : { buildingIds: [building.id] }),
    };
    // An invalid order must not earn the step just because its target qualifies.
    expect(issueOrder(w, gang.id, { ...input, opts: { manpower: 99 } }).ok).toBe(false);
    expect(exploreDone(w, gang.id)).toBe(false);
    expect(issueOrder(w, gang.id, input).ok).toBe(true);
    expect(exploreDone(w, gang.id)).toBe(true);
    expect(exploreDone(w, rival.id)).toBe(false);
  });

  it('keeps completed actions across the week boundary, territory changes and save restoration', () => {
    const sim = newLesson();
    const w = sim.world;
    const gang = sim.playerGang;
    const { block } = rivalTarget(sim);
    expect(buyWeapon(w, gang.id, 'pistol').ok).toBe(true);
    expect(issueOrder(w, gang.id, { teamId: gang.teamIds[0], type: 'explore', blockIds: [block.id] }).ok).toBe(true);
    sim.launchWeek();
    expect(gang.lastWeekCosts.purchases).toBe(100);
    for (const b of allBuildings(w).filter((b) => b.blockId === block.id)) {
      b.ownerGangId = null;
      b.protection = null;
    }
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(w)));
    expect(weaponDone(restored.world, gang.id)).toBe(true);
    expect(exploreDone(restored.world, gang.id)).toBe(true);
  });

  it('counts rival protection but excludes empty land, destroyed sites and eliminated gangs', () => {
    for (const kind of ['protected', 'empty', 'destroyed', 'eliminated']) {
      const sim = newLesson();
      const w = sim.world;
      const gang = sim.playerGang;
      const { rival, block, building } = rivalTarget(sim);
      for (const b of allBuildings(w).filter((b) => b.blockId === block.id)) {
        b.ownerGangId = null;
        b.protection = null;
      }
      if (kind === 'protected') {
        building.protection = { gangId: rival.id, weekly: 10, base: 10, refusing: false, grievance: 0 };
      } else {
        building.ownerGangId = rival.id;
        if (kind === 'empty') building.cls = 'empty';
        if (kind === 'destroyed') building.state = 'destroyed';
        if (kind === 'eliminated') rival.eliminated = true;
      }
      expect(issueOrder(w, gang.id, { teamId: gang.teamIds[0], type: 'explore', blockIds: [block.id] }).ok).toBe(true);
      expect(exploreDone(w, gang.id)).toBe(kind === 'protected');
    }
  });

  it('loads older saves without inventing completed actions from spending or inventory', () => {
    const sim = newLesson();
    const w = sim.world;
    delete w.tutorialActions;
    sim.playerGang.lastWeekCosts.purchases = 500;
    sim.playerGang.weapons.pistol = 2;
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(w)));
    expect(weaponDone(restored.world, restored.playerGang.id)).toBe(false);
    expect(exploreDone(restored.world, restored.playerGang.id)).toBe(false);
  });
});
