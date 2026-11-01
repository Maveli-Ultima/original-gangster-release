import { describe, expect, it } from 'vitest';
import { BLOCK_MODULES, LEGACY_BLOCK_MODULES, BLOCK_MODULE_BY_ID, MODULE_BUILDING_TYPES, moduleFacing, modulePoint, moduleRect, moduleSetback } from '../src/sim/blockModules';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { activeBlocks, blockRect } from '../src/sim/cityLayout';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import { profileForLot } from '../src/render/profile';
import { validateSaveWorld } from '../src/sim/saveSchema';
import type { ModuleRect } from '../src/sim/blockModules';

const overlaps = (a: ModuleRect, b: ModuleRect) =>
  a.x < b.x+b.w-.001 && a.x+a.w > b.x+.001 && a.y < b.y+b.h-.001 && a.y+a.h > b.y+.001;
const inside = (x:number,y:number,r:ModuleRect,margin=0) => x>r.x-margin && x<r.x+r.w+margin && y>r.y-margin && y<r.y+r.h+margin;

describe('authored block modules',()=>{
  it('keeps every parcel on the planning grid, non-overlapping and correctly rotated',()=>{
    for(const m of [...BLOCK_MODULES,...LEGACY_BLOCK_MODULES])for(const turn of [0,1,2,3]){
      const size=moduleRect(m,turn,{x:0,y:0,w:m.width,h:m.depth});
      expect(m.plots.filter(p=>p.index===4)).toHaveLength(1);
      expect(new Set(m.plots.map(p=>p.index)).size).toBe(m.plots.length);
      const plots=m.plots.map(p=>moduleRect(m,turn,p));
      for(const [i,p] of plots.entries()){
        for(const n of [p.x,p.y,p.w,p.h])expect(n%2,`${m.id} turn ${turn}`).toBe(0);
        expect(p.x).toBeGreaterThanOrEqual(0);expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x+p.w).toBeLessThanOrEqual(size.w);expect(p.y+p.h).toBeLessThanOrEqual(size.h);
        for(const q of plots.slice(i+1))expect(overlaps(p,q),`${m.id} parcels ${i}`).toBe(false);
      }
      for(const tree of m.trees){
        const p=modulePoint(m,turn,tree.x,tree.y);
        expect(plots.some(r=>inside(p.x,p.y,r,.75)),`${m.id} tree clearance`).toBe(false);
      }
      for(const wall of m.walls)for(const t of [0,.25,.5,.75,1]){
        const p=modulePoint(m,turn,wall.ax+(wall.bx-wall.ax)*t,wall.ay+(wall.by-wall.ay)*t);
        expect(plots.some(r=>inside(p.x,p.y,r,.08)),`${m.id} rear wall clearance`).toBe(false);
      }
    }
  });
  it('fills commercial blocks with adjoining premises, without a continuous rear void',()=>{
    const shops=BLOCK_MODULES.filter(m=>m.plots.some(p=>p.use==='shops'||p.use==='business'));
    expect(shops.length).toBeGreaterThan(0);
    for(const m of shops){
      // Combined with the overlap test, full area proves there are no unused strips.
      expect(m.plots.reduce((area,p)=>area+p.w*p.h,0)).toBe(m.width*m.depth);
      const hidden=m.plots.find(p=>p.index===4)!;
      expect(hidden.w*hidden.h/(m.width*m.depth)).toBeLessThan(.032);
      for(const p of m.plots.filter(p=>p.index!==4))expect(moduleSetback(p)).toBe(0);
      // Ground dressing is confined to the single gameplay back-lot parcel.
      for(const g of m.grounds){
        expect(g.x).toBeGreaterThanOrEqual(hidden.x);expect(g.y).toBeGreaterThanOrEqual(hidden.y);
        expect(g.x+g.w).toBeLessThanOrEqual(hidden.x+hidden.w);expect(g.y+g.h).toBeLessThanOrEqual(hidden.y+hidden.h);
      }
    }
  });
  it('still validates and restores v1 commercial parcels without changing their saved layout',()=>{
    const w=new Sim({...defaultGameOptions(),seed:404,citySize:14}).world;
    const used=new Set<string>();
    for(const b of activeBlocks(w)){
      const placement=b.layout?.module;if(!placement)continue;
      const legacy=LEGACY_BLOCK_MODULES.find(m=>m.id===placement.id.replace('-v2','-v1'));
      if(!legacy)continue;
      placement.id=legacy.id;used.add(legacy.id);
      const origin=blockRect(b);
      for(const id of b.lotIds){
        const lot=w.lots[id],slot=legacy.plots.find(p=>p.index===lot.index)!;
        const p=moduleRect(legacy,placement.turn,slot),margin=moduleSetback(slot);
        lot.bounds={...p,x:origin.x+p.x,y:origin.y+p.y};
        lot.center={x:lot.bounds.x+p.w/2,y:lot.bounds.y+p.h/2};
        lot.facing=moduleFacing(slot.facing,placement.turn);
        lot.footprint={w:p.w-margin*2,h:p.h-margin*2};
      }
    }
    expect(used.size).toBe(3);
    expect(()=>validateSaveWorld(w)).not.toThrow();
    expect(Sim.fromSave(structuredClone(w)).world).toEqual(w);
  });
  it('reserves landscaped courts for housing and keeps commercial centres compact',()=>{
    for(const m of BLOCK_MODULES){
      const residential=m.plots.some(p=>p.use==='homes');
      if(!residential){
        expect(m.grounds.some(g=>g.surface==='lawn')).toBe(false);
        expect(m.trees).toHaveLength(0);
        expect(m.plots.some(p=>p.vacant)).toBe(false);
        const occupied=m.plots.reduce((area,p)=>area+p.w*p.h,0);
        expect(occupied/(m.width*m.depth)).toBeGreaterThan(.85);
      }
      for(const p of m.plots)for(const id of MODULE_BUILDING_TYPES[p.use])expect(BUILDING_BY_ID[id],id).toBeDefined();
    }
  });
  it.each([404,405,1928])('places saved modules without stretching their authored envelopes (seed %i)',seed=>{
    const w=new Sim({...defaultGameOptions(),seed,citySize:10}).world;
    for(const b of activeBlocks(w).filter(b=>b.layout?.use==='urban')){
      expect(b.layout!.module).toBeDefined();
      const m=BLOCK_MODULE_BY_ID[b.layout!.module!.id],r=blockRect(b);
      expect(b.lotIds).toHaveLength(m.plots.length);
      for(const id of b.lotIds){
        const l=w.lots[id],building=w.buildings[l.buildingId];
        const p=profileForLot(building,BUILDING_BY_ID[building.typeId],l),rotated=l.facing==='east'||l.facing==='west';
        expect(rotated?p.depth:p.width).toBeCloseTo(l.footprint!.w);
        expect(rotated?p.width:p.depth).toBeCloseTo(l.footprint!.h);
        expect(l.bounds!.x).toBeGreaterThanOrEqual(r.x);expect(l.bounds!.y).toBeGreaterThanOrEqual(r.y);
      }
    }
    expect(()=>validateSaveWorld(w)).not.toThrow();
    expect(Sim.fromSave(structuredClone(w)).world).toEqual(w);
    const greens=activeBlocks(w).filter(b=>b.layout?.module?.id==='terrace-court-v1').length;
    const homes=activeBlocks(w).filter(b=>b.district==='residential'&&b.layout?.use==='urban').length;
    expect(greens/homes).toBeLessThan(.4);
  });
  it('rejects displaced/unknown kits and preserves older cities without module metadata',()=>{
    const w=new Sim({...defaultGameOptions(),seed:404,citySize:8}).world;
    const b=activeBlocks(w).find(b=>b.layout?.module)!;
    const wrong=structuredClone(w);wrong.blocks[b.id].layout!.module!.id='missing-kit';
    expect(()=>validateSaveWorld(wrong)).toThrow(/block module/);
    const displaced=structuredClone(w);displaced.lots[b.lotIds[0]].bounds!.x+=1;
    expect(()=>validateSaveWorld(displaced)).toThrow(/displaced block module/);
    const old=structuredClone(w);
    for(const b of old.blocks)if(b.layout)delete b.layout.module;
    for(const l of Object.values(old.lots))delete l.footprint;
    expect(Sim.fromSave(structuredClone(old)).world).toEqual(old);
  });
});
