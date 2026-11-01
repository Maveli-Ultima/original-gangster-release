import { beforeEach, describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { act, useGame } from '../src/app/store';
import { allocateBlocks, demote, moveToPool, promote } from '../src/sim/api';
import { activeBlocks } from '../src/sim/cityLayout';
import { Sim } from '../src/sim/sim';
import type { ApiResult } from '../src/sim/api';
import { buildingsOfBlock, territoryBlocks } from '../src/sim/world';
import { handleMapBox, handleMapHit } from '../src/ui/mapClick';

let sim: Sim;
beforeEach(() => {
  sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  const g = sim.playerGang, first = sim.world.teams[g.teamIds[0]], hood = first.memberIds[0];
  expect(moveToPool(sim.world, g.id, hood).ok).toBe(true);
  expect(promote(sim.world, g.id, hood).ok).toBe(true);
  useGame.setState({ sim, selectedTeamId: first.id, pickMode: null, jobCard: null, specialistCard: null,
    overlays: [], savingSnapshot: false, loadingSave: null, streetLoading: false });
});

function fixture() {
  const w = sim.world, g = sim.playerGang;
  const [first, second] = g.teamIds.map(id => w.teams[id]);
  const ordinary = activeBlocks(w).filter(b => buildingsOfBlock(w, b).some(site =>
    ['commercial', 'industrial', 'tenement'].includes(site.cls)));
  const [a, b] = ordinary;
  const outside = ordinary.find(block => block.id !== a.id && block.id !== b.id &&
    buildingsOfBlock(w, block).every(site => site.ownerGangId !== g.id && site.protection?.gangId !== g.id))!;
  for (const block of [a, b]) for (const site of buildingsOfBlock(w, block)) site.ownerGangId = g.id;
  expect(territoryBlocks(w, g.id).map(block => block.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  return { w, g, first, second, a, b, outside };
}
function rejectsAtomically(call: () => ApiResult) {
  const before = JSON.stringify(sim.world);
  expect(call().ok).toBe(false);
  expect(JSON.stringify(sim.world)).toBe(before);
}

describe('lieutenant areas, manual p.55', () => {
  it('accepts the starting HQ block even without a one-third majority', () => {
    const w = sim.world, g = sim.playerGang, first = w.teams[g.teamIds[0]];
    const hq = Object.values(w.buildings).find(site => site.ownerGangId === g.id && site.isHQ)!;
    const root = w.blocks[hq.blockId].layout?.mergedInto ?? hq.blockId;
    expect(territoryBlocks(w, g.id).some(block => block.id === root)).toBe(true);
    expect(allocateBlocks(w, g.id, first.id, [root]).ok).toBe(true);
    expect(first.allocatedBlockIds).toEqual([root]);
  });

  it('accepts one protected business even when rivals own more of the block', () => {
    const { w, g, first, outside } = fixture();
    const sites = buildingsOfBlock(w, outside).filter(site => site.cls !== 'illegal' && site.cls !== 'empty');
    const rival = Object.values(w.gangs).find(gang => gang.id !== g.id)!;
    for (const site of sites) { site.ownerGangId = rival.id; site.protection = null; }
    sites[0].ownerGangId = null;
    sites[0].protection = { gangId: g.id, weekly: 100, base: 100, grievance: 0, refusing: false };
    expect(allocateBlocks(w, g.id, first.id, [outside.id]).ok).toBe(true);
  });

  it('accepts owned territory and rejects outside blocks without changing existing allocations', () => {
    const { w, g, first, a, outside } = fixture();
    expect(allocateBlocks(w, g.id, first.id, [a.id]).ok).toBe(true);
    rejectsAtomically(() => allocateBlocks(w, g.id, first.id, [a.id, outside.id]));
    expect(first.allocatedBlockIds).toEqual([a.id]);
  });

  it('requires explicit release before another lieutenant can take an assigned block', () => {
    const { w, g, first, second, a, b } = fixture();
    expect(allocateBlocks(w, g.id, first.id, [a.id]).ok).toBe(true);
    expect(allocateBlocks(w, g.id, second.id, [b.id]).ok).toBe(true);
    rejectsAtomically(() => allocateBlocks(w, g.id, second.id, [b.id, a.id]));
    expect(allocateBlocks(w, g.id, first.id, []).ok).toBe(true);
    expect(allocateBlocks(w, g.id, second.id, [b.id, a.id]).ok).toBe(true);
    expect(first.allocatedBlockIds).toEqual([]);
    expect(second.allocatedBlockIds).toEqual([b.id, a.id]);
  });

  it('deduplicates merged territory and removes it when an alias is clicked', () => {
    const { w, g, first } = fixture();
    const alias = w.blocks.find(b => b.layout?.mergedInto != null &&
      buildingsOfBlock(w, w.blocks[b.layout.mergedInto]).some(site => ['commercial', 'industrial', 'tenement'].includes(site.cls)))!;
    const root = w.blocks[alias.layout!.mergedInto!];
    for (const site of buildingsOfBlock(w, root)) site.ownerGangId = g.id;
    useGame.setState({ pickMode: { kind: 'lieutenantArea', teamId: first.id } });
    handleMapBox([alias.id, root.id, alias.id]);
    expect(first.allocatedBlockIds).toEqual([root.id]);
    handleMapHit({ buildingId: null, personId: null, blockId: alias.id, point: alias.center });
    expect(first.allocatedBlockIds).toEqual([]);
  });

  it('lets an old or lost allocation be removed after restoration, without granting new outside territory', () => {
    const { w, g, first, outside } = fixture();
    const outside2 = activeBlocks(w).find(b => b.id !== outside.id &&
      buildingsOfBlock(w, b).every(site => site.ownerGangId !== g.id && site.protection?.gangId !== g.id))!;
    first.allocatedBlockIds = [outside.id, outside2.id];
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(w))), old = restored.world.teams[first.id];
    expect(allocateBlocks(restored.world, g.id, old.id, [outside2.id]).ok).toBe(true);
    expect(old.allocatedBlockIds).toEqual([outside2.id]);
    const before = JSON.stringify(restored.world);
    expect(allocateBlocks(restored.world, g.id, old.id, [outside.id, outside2.id]).ok).toBe(false);
    expect(JSON.stringify(restored.world)).toBe(before);
    expect(allocateBlocks(restored.world, g.id, old.id, []).ok).toBe(true);
  });

  it('switches the active map-edit target with the displayed lieutenant', () => {
    const { first, second, a } = fixture();
    useGame.setState({ pickMode: { kind: 'lieutenantArea', teamId: first.id } });
    useGame.getState().selectTeam(second.id);
    expect(useGame.getState().pickMode).toEqual({ kind: 'lieutenantArea', teamId: second.id });
    handleMapBox([a.id]);
    expect(first.allocatedBlockIds).toEqual([]);
    expect(second.allocatedBlockIds).toEqual([a.id]);
    useGame.getState().selectTeam(null);
    expect(useGame.getState().pickMode).toBeNull();
  });

  it('clears the edit target when its crew is demoted', () => {
    const { g, first } = fixture();
    useGame.setState({ pickMode: { kind: 'lieutenantArea', teamId: first.id } });
    expect(act(s => demote(s.world, g.id, first.id))?.ok).toBe(true);
    expect(useGame.getState().pickMode).toBeNull();
  });

  it('bounds eligible territory only, without taking another crew’s blocks', () => {
    const { w, g, first, second, a, b, outside } = fixture();
    expect(allocateBlocks(w, g.id, second.id, [b.id]).ok).toBe(true);
    useGame.setState({ pickMode: { kind: 'lieutenantArea', teamId: first.id } });
    handleMapBox([a.id, b.id, outside.id]);
    expect(first.allocatedBlockIds).toEqual([a.id]);
    expect(second.allocatedBlockIds).toEqual([b.id]);
    handleMapBox([outside.id, b.id, a.id]);
    expect(first.allocatedBlockIds).toEqual([]);
    expect(second.allocatedBlockIds).toEqual([b.id]);
  });

  it('does not retarget an open job card merely because another crew is selected', () => {
    const { first, second } = fixture();
    useGame.getState().beginOrder('extort', first.id);
    useGame.getState().selectTeam(second.id);
    expect(useGame.getState().jobCard?.teamId).toBe(first.id);
    expect(useGame.getState().pickMode?.kind).toBe('order');
  });

  it('enters and finishes allocation from the map overlay button', () => {
    const { first } = fixture();
    useGame.getState().toggleOverlay('lieutenant');
    expect(useGame.getState().pickMode).toEqual({ kind: 'lieutenantArea', teamId: first.id });
    expect(useGame.getState().overlays).toContain('lieutenant');
    useGame.getState().toggleOverlay('lieutenant');
    expect(useGame.getState().pickMode).toBeNull();
    useGame.getState().toggleOverlay('lieutenant');
    useGame.getState().setOverlays([]);
    expect(useGame.getState().pickMode).toBeNull();
  });

  it('does not replace an order target mode when viewing lieutenant areas', () => {
    const { first } = fixture();
    useGame.getState().beginOrder('extort', first.id);
    const before = JSON.stringify(useGame.getState().jobCard);
    useGame.getState().toggleOverlay('lieutenant');
    expect(JSON.stringify(useGame.getState().jobCard)).toBe(before);
    expect(useGame.getState().pickMode).toEqual({ kind: 'order' });
    expect(useGame.getState().overlays).toContain('lieutenant');
  });
});

