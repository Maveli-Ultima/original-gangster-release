import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { activeBlocks, blockRect, blockPavement, cityBlockAt, cityStreetInset, lotRect } from '../src/sim/cityLayout';
import { CELL, PAVEMENT_OFFSET, STREET_WIDTH } from '../src/sim/constants';
import { walkRoute } from '../src/sim/movement';
import { vehicleRoute, vehiclePathOnRoad } from '../src/sim/vehicleNavigation';
import { buildingDoor } from '../src/sim/world';
import { Sim } from '../src/sim/sim';
import { validateSaveWorld } from '../src/sim/saveSchema';
import { profileFor, profileForLot } from '../src/render/profile';
import { carCount, carsAt } from '../src/sim/traffic';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';

const create = (seed=404) => new Sim({...defaultGameOptions(),citySize:10,seed}).world;
describe('open city spacing',()=>{
  it('widens new streets while preserving the intersection grid and valid sites',()=>{
    const w=create();
    expect(CELL).toBe(54);
    expect(STREET_WIDTH+cityStreetInset(w)*2).toBe(20);
    const ordinary=activeBlocks(w).find(b=>b.layout?.use==='urban'&&b.layout.spanX===1&&b.layout.spanY===1)!;
    expect(blockRect(ordinary).w).toBe(34);
    const yards=Object.values(w.buildings).filter(b=>b.cls==='empty'&&w.lots[b.lotId].index!==4);
    expect(yards.length).toBeGreaterThan(0);
    expect(yards.every(b=>w.blocks[b.blockId].district==='residential')).toBe(true);
    expect(Object.values(w.people).filter(p=>p.role==='citizen')).toHaveLength(1400);
    expect(carCount(w)).toBeLessThan((40+w.blocks.length*.85)*.65);
    expect(carsAt(w,0)).toHaveLength(carCount(w));
    expect(()=>validateSaveWorld(w)).not.toThrow();
    expect(Sim.fromSave(structuredClone(w)).world).toEqual(w);
  });
  it('preserves absent-field saved streets rather than silently migrating their geometry',()=>{
    const w=create();
    // Reconstruct the previous parcel coordinates, preserving every ID/state.
    for(const block of w.blocks){
      const before=blockRect(block);delete block.layout!.streetInset;delete block.layout!.module;const after=blockRect(block);
      if(block.layout?.use==='civic')continue;
      for(const id of block.lotIds){
        const lot=w.lots[id],r=lotRect(lot),sx=after.w/before.w,sy=after.h/before.h;
        delete lot.footprint;
        lot.bounds={x:after.x+(r.x-before.x)*sx,y:after.y+(r.y-before.y)*sy,w:r.w*sx,h:r.h*sy};
        lot.center={x:lot.bounds.x+lot.bounds.w/2,y:lot.bounds.y+lot.bounds.h/2};
      }
    }
    expect(cityStreetInset(w)).toBe(0);
    const saved=structuredClone(w),restored=Sim.fromSave(w).world;
    expect(restored).toEqual(saved);
    expect(STREET_WIDTH+cityStreetInset(restored)*2).toBe(14);
    // One density for every city, old saves included (about twice the original's: 12 at the least).
    expect(carCount(restored)).toBe(12);
    const broken=structuredClone(saved);broken.blocks[2].layout!.streetInset=3;
    expect(()=>validateSaveWorld(broken)).toThrow(/inconsistent street clearance/);
  });
  it('keeps pedestrian routes on the new pavements and vehicle routes on roads',()=>{
    const w=create(),blocks=activeBlocks(w).filter(b=>b.layout?.use==='urban').slice(12,22);
    for(let i=0;i<blocks.length-1;i++){
      const from=blockPavement(blocks[i],i),to=blockPavement(blocks[i+1],i+2);
      const route=[from,...walkRoute(from,to,501+i,w)];
      for(let n=1;n<route.length;n++)for(let t=.1;t<1;t+=.2){
        const a=route[n-1],b=route[n],p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
        const block=cityBlockAt(w,Math.floor(p.x/CELL),Math.floor(p.y/CELL));if(!block)continue;
        const r=blockRect(block);
        expect(p.x>r.x+.01&&p.x<r.x+r.w-.01&&p.y>r.y+.01&&p.y<r.y+r.h-.01,
          JSON.stringify({i,n,p,r,route})).toBe(false);
      }
      const a=w.buildings[w.lots[blocks[i].lotIds[0]].buildingId],b=w.buildings[w.lots[blocks[i+1].lotIds[0]].buildingId];
      const car=vehicleRoute(w,buildingDoor(w,a),buildingDoor(w,b),false);
      expect(vehiclePathOnRoad(w,car.start,car.path)).toBe(true);
    }
    expect(PAVEMENT_OFFSET+cityStreetInset(w)).toBeCloseTo(8.4);
  });
  it('retains narrow bodies and yards when fitting ordinary parcels',()=>{
    const w=create();
    const lot={...Object.values(w.lots).find(l=>l.index===4)!,footprint:undefined};
    const base=w.buildings[lot.buildingId];
    for(const typeId of ['tenementPoor','office','grocers']){
      const type=BUILDING_BY_ID[typeId],b={...base,typeId,cls:type.cls,state:'trading' as const};
      const raw=profileFor(b,type),p=profileForLot(b,type,lot),r=lotRect(lot);
      expect(p.width/r.w).toBeCloseTo(raw.width/(40/3));
      expect(p.depth).toBeLessThan(r.h);
      if(typeId!=='grocers')expect(p.width).toBeLessThan(r.w*.75);
    }
  });
});
