import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder } from '../src/sim/api';
import { buildingMapIntel, knownBlockOwners } from '../src/sim/mapIntel';
import { MINUTES_PER_SECOND, Sim } from '../src/sim/sim';
import { allBuildings, buildingsOfBlock, territoryBlocks } from '../src/sim/world';

function fixture(seed = 404, citySize = 10) {
  const sim = new Sim({ ...defaultGameOptions(), seed, citySize });
  const w = sim.world, viewer = sim.playerGang.id;
  const rival = Object.values(w.gangs).find(g => g.id !== viewer)!;
  const hq = allBuildings(w).find(b => b.isHQ && b.ownerGangId === rival.id)!;
  const front = w.buildings[hq.frontId!];
  return { sim, w, viewer, rival, hq, front };
}

describe('gang knowledge on the map', () => {
  it.each([[404, 10], [405, 14], [711, 18]])('starts week one with only the player markings (seed %s, size %s)', (seed, size) => {
    const { w, viewer } = fixture(seed, size);
    expect(w.week).toBe(1);
    const before = JSON.stringify(w);
    const marked = allBuildings(w).map(b => buildingMapIntel(b, viewer));
    expect(marked.filter(i => i.ownerGangId != null).every(i => i.ownerGangId === viewer)).toBe(true);
    expect(marked.filter(i => i.protectionGangId != null).every(i => i.protectionGangId === viewer)).toBe(true);
    expect(marked.filter(i => i.isHQ)).toHaveLength(1);
    expect(marked.filter(i => i.ownerGangId === viewer).length).toBeGreaterThan(0);
    expect(marked.filter(i => i.protectionGangId === viewer).length).toBeGreaterThan(0);
    expect(w.blocks.flatMap(b => knownBlockOwners(w, b, viewer)).every(id => id === viewer)).toBe(true);
    expect(JSON.stringify(w)).toBe(before);
  });

  it('shows public sites and landmarks without disclosing their gang', () => {
    const { w, front, viewer } = fixture();
    expect(buildingMapIntel(front, viewer)).toMatchObject({ siteKnown: true, ownerGangId: null, isHQ: false });
    expect(allBuildings(w).filter(b => b.cls === 'municipal').every(b => buildingMapIntel(b, viewer).siteKnown)).toBe(true);
    front.knowledge[viewer] = 1; // Type alone does not identify the owner.
    expect(buildingMapIntel(front, viewer).ownerGangId).toBeNull();
  });

  it('reveals an explored site without revealing the HQ or the rest of that gang', () => {
    const { w, front, hq, rival, viewer } = fixture();
    front.knowledge[viewer] = 3;
    expect(buildingMapIntel(front, viewer).ownerGangId).toBe(rival.id);
    expect(buildingMapIntel(hq, viewer)).toMatchObject({ siteKnown: false, ownerGangId: null, isHQ: false });
    expect(allBuildings(w).filter(b => buildingMapIntel(b, viewer).ownerGangId === rival.id).map(b => b.id)).toEqual([front.id]);
    hq.knowledge[viewer] = 3;
    expect(buildingMapIntel(hq, viewer)).toMatchObject({ siteKnown: true, ownerGangId: rival.id, isHQ: true });
  });

  it('does not borrow another gang’s intel, diplomatic contacts, or FBI discovery', () => {
    const { w, hq, front, rival, viewer } = fixture();
    hq.discovered = true;
    hq.knowledge[rival.id] = 4;
    w.gangs[viewer].known[rival.id] = 'peace';
    w.gangs[viewer].knownPeople.push(rival.bossId);
    expect(buildingMapIntel(hq, viewer)).toMatchObject({ siteKnown: false, ownerGangId: null, isHQ: false });
    expect(buildingMapIntel(front, viewer).ownerGangId).toBeNull();
    expect(buildingMapIntel(hq, rival.id).isHQ).toBe(true);
    expect(buildingMapIntel(hq, null).isHQ).toBe(false);
  });

  it('shows own holdings even if their saved knowledge is missing, including own protection', () => {
    const { w, viewer } = fixture();
    for (const b of allBuildings(w)) {
      delete b.knowledge[viewer];
      if (b.ownerGangId === viewer) expect(buildingMapIntel(b, viewer).ownerGangId).toBe(viewer);
      if (b.protection?.gangId === viewer) expect(buildingMapIntel(b, viewer).protectionGangId).toBe(viewer);
    }
  });

  it('reveals a rival’s protection only after that site is investigated', () => {
    const { w, viewer, rival } = fixture();
    const site = allBuildings(w).find(b => b.protection?.gangId === rival.id)!;
    expect(buildingMapIntel(site, viewer).protectionGangId).toBeNull();
    site.knowledge[viewer] = 1;
    expect(buildingMapIntel(site, viewer).protectionGangId).toBeNull();
    site.knowledge[viewer] = 3;
    expect(buildingMapIntel(site, viewer).protectionGangId).toBe(rival.id);
  });

  it('reveals a site through an actual explore order, not merely ordering the job', () => {
    const { sim, w, viewer, front, rival } = fixture();
    expect(issueOrder(w, viewer, { teamId: sim.playerGang.teamIds[0], type: 'explore', buildingIds: [front.id] }).ok).toBe(true);
    expect(buildingMapIntel(front, viewer).ownerGangId).toBeNull();
    sim.launchWeek();
    // Exercise travel and order execution in real ticks (the traffic moves with the clock).
    for (let i = 0; i < 100 && (front.knowledge[viewer] ?? 0) < 3; i++) sim.advance(10 / MINUTES_PER_SECOND, 1);
    expect(front.knowledge[viewer]).toBe(3);
    expect(buildingMapIntel(front, viewer).ownerGangId).toBe(rival.id);
  });

  it('preserves partial discovery through save restoration and later weeks', async () => {
    const { w, viewer, front, hq, rival } = fixture();
    front.knowledge[viewer] = 3;
    w.week = 7;
    for (const restore of [Sim.fromSave, Sim.fromSaveResponsive]) {
      const saved = await restore(JSON.parse(JSON.stringify(w)));
      expect(buildingMapIntel(saved.world.buildings[front.id], viewer).ownerGangId).toBe(rival.id);
      expect(buildingMapIntel(saved.world.buildings[hq.id], viewer).isHQ).toBe(false);
    }
  });
});

describe('territory as known to the viewer', () => {
  it('one identified holding reveals that block, and shared claims retain both gangs', () => {
    const { w, viewer, rival } = fixture();
    const blocks = w.blocks.slice(0, 2);
    for (const block of blocks) for (const b of buildingsOfBlock(w, block)) {
      b.cls = 'commercial'; b.state = 'trading'; b.ownerGangId = rival.id;
      b.protection = null; b.knowledge[viewer] = 0;
    }
    const sites = buildingsOfBlock(w, blocks[0]);
    expect(territoryBlocks(w, rival.id).map(b => b.id)).toEqual(expect.arrayContaining(blocks.map(b => b.id)));
    expect(knownBlockOwners(w, blocks[0], viewer)).toEqual([]);
    sites[0].knowledge[viewer] = 2;
    expect(knownBlockOwners(w, blocks[0], viewer)).toEqual([rival.id]);
    expect(knownBlockOwners(w, blocks[1], viewer)).toEqual([]);
    sites[1].ownerGangId = viewer;
    expect(knownBlockOwners(w, blocks[0], viewer)).toEqual([viewer, rival.id].sort((a,b)=>a-b));
    sites[0].state = 'destroyed';
    expect(knownBlockOwners(w, blocks[0], viewer)).toEqual([viewer]);
    // The rival still has undiscovered standing businesses here.
    expect(territoryBlocks(w, rival.id).map(b=>b.id)).toContain(blocks[0].id);
  });

  it('keeps protection visible without revealing a hidden owner on the same site', () => {
    const { w, viewer, rival, front } = fixture();
    front.protection = { gangId: viewer, weekly: 100, base: 100, grievance: 0, refusing: false };
    expect(knownBlockOwners(w, w.blocks[front.blockId], viewer)).toEqual([viewer]);
    front.knowledge[viewer] = 2;
    expect(knownBlockOwners(w, w.blocks[front.blockId], viewer)).toEqual([viewer, rival.id].sort((a,b)=>a-b));
    rival.eliminated = true;
    expect(knownBlockOwners(w, w.blocks[front.blockId], viewer)).toEqual([viewer]);
  });

  it('includes an identified hidden HQ independently of its public front', () => {
    const { w, viewer, rival, front, hq } = fixture();
    front.ownerGangId = null; front.protection = null;
    hq.knowledge[viewer] = 3;
    expect(knownBlockOwners(w, w.blocks[hq.blockId], viewer)).toEqual([rival.id]);
    hq.state = 'destroyed';
    expect(knownBlockOwners(w, w.blocks[hq.blockId], viewer)).toEqual([]);
  });
});
