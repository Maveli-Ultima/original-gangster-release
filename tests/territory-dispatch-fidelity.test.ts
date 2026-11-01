import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder } from '../src/sim/api';
import { beginWeekOrders, tickOrders } from '../src/sim/execution';
import { isValidAreaTarget } from '../src/sim/execution';
import { orderStaffing } from '../src/sim/orderStaffing';
import { Sim } from '../src/sim/sim';
import { Rng } from '../src/sim/rng';
import { dist } from '../src/sim/world';
import { distanceToTerritory } from '../src/sim/territory';
import { blockRect } from '../src/sim/cityLayout';

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  const w = sim.world, g = sim.playerGang, t = w.teams[g.teamIds[0]];
  for (const team of Object.values(w.teams)) { team.orderIds = []; team.timeUsed = 0; }
  w.orders = {};
  t.vehicles = { coupe: 0, truck: 0, speedster: 0 };
  const lt = w.people[t.lieutenantId], hood = w.people[t.memberIds[0]];
  lt.skills.intimidation = 5; hood.skills.intimidation = 1;
  const office = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === g.id)!;
  const site = Object.values(w.buildings).filter(b => isValidAreaTarget(w, g.id, 'extort', b) &&
    Object.values(w.buildings).some(other => other.id !== b.id && other.blockId === b.blockId && other.cls === 'commercial' && other.typeId !== 'office'))
    .sort((a,b) => dist(w.lots[b.lotId].center,w.lots[office.lotId].center) - dist(w.lots[a.lotId].center,w.lots[office.lotId].center))[0];
  return { sim, w, g, t, lt, hood, office, site };
}

describe('lieutenant willingness on dangerous assignments (manual p.88)', () => {
  it.each([1, 5])('dispatches by competence while a poor leader avoids danger (leadership %s)', leadership => {
    const s = fixture(); s.lt.skills.intelligence = s.lt.skills.organization = leadership;
    const result = issueOrder(s.w,s.g.id,{type:'extort',teamId:s.t.id,buildingIds:[s.site.id],opts:{manpower:1}});
    expect(result.ok).toBe(true);
    const order = s.w.orders[s.t.orderIds[0]], expected = leadership === 5 ? s.lt.id : s.hood.id;
    expect(orderStaffing(s.w,s.t,order,true).chosen.map(p=>p.id)).toEqual([expected]);
    beginWeekOrders(s.w); expect(order.assignedIds).toEqual([expected]);
    const restored = Sim.fromSave(structuredClone(s.w));
    expect(restored.world.orders[order.id].assignedIds).toEqual([expected]);
  });

  it('a good lieutenant still delegates to the more suitable hood', () => {
    const s=fixture(); s.lt.skills.intelligence=s.lt.skills.organization=5;
    s.lt.skills.intimidation=3; s.hood.skills.intimidation=5;
    const staffing=orderStaffing(s.w,s.t,{type:'extort',opts:{manpower:1,priority:false,wait:false,repeat:false,isPublic:false,preferredHoodId:null}});
    expect(staffing.chosen.map(p=>p.id)).toEqual([s.hood.id]);
  });

  it.each([1,5])('named people and full manpower override lieutenant preference (%s)', leadership => {
    const s=fixture(); s.lt.skills.intelligence=s.lt.skills.organization=leadership;
    const opts={manpower:1,priority:false,wait:false,repeat:false,isPublic:false,preferredHoodId:null};
    expect(orderStaffing(s.w,s.t,{type:'extort',opts:{...opts,preferredHoodId:s.lt.id}}).chosen.map(p=>p.id)).toEqual([s.lt.id]);
    expect(orderStaffing(s.w,s.t,{type:'extort',opts:{...opts,preferredHoodId:s.hood.id}}).chosen.map(p=>p.id)).toEqual([s.hood.id]);
    expect(orderStaffing(s.w,s.t,{type:'extort',opts:{...opts,manpower:2}}).chosen.map(p=>p.id).sort()).toEqual([s.lt.id,s.hood.id].sort());
    s.lt.status='arrested';
    expect(orderStaffing(s.w,s.t,{type:'extort',opts}).chosen.map(p=>p.id)).toEqual([s.hood.id]);
  });

  it('keeps the lieutenant out of a permanent business-manager assignment', () => {
    const s=fixture(); s.lt.skills.intelligence=s.lt.skills.organization=s.lt.skills.business=5; s.hood.skills.business=1;
    const staffing=orderStaffing(s.w,s.t,{type:'runBusiness',opts:{manpower:1,priority:false,wait:false,repeat:false,isPublic:false,preferredHoodId:null}});
    expect(staffing.chosen.map(p=>p.id)).toEqual([s.hood.id]);
  });
});

describe('Extort resistance follows current territory (manual p.13)', () => {
  it('measures from merged block edges and ignores destroyed, empty and eliminated claims', () => {
    const s=fixture();
    for(const b of Object.values(s.w.buildings)) {
      if(b.ownerGangId===s.g.id)b.ownerGangId=null;
      if(b.protection?.gangId===s.g.id)b.protection=null;
    }
    const block=s.w.blocks.find(b=>b.layout?.mergedInto==null && (b.layout?.spanX??1)>1)!;
    expect(block).toBeDefined();
    const site=Object.values(s.w.buildings).find(b=>b.blockId===block.id && b.cls!=='empty')!;
    expect(site).toBeDefined(); site.ownerGangId=s.g.id; site.state='trading';
    const r=blockRect(block), edge={x:r.x+r.w,y:r.y+r.h/2};
    expect(distanceToTerritory(s.w,s.g.id,edge)).toBe(0);
    expect(distanceToTerritory(s.w,s.g.id,{x:edge.x+25,y:edge.y})).toBe(25);
    const originalClass=site.cls;
    site.state='destroyed'; expect(distanceToTerritory(s.w,s.g.id,edge)).toBe(Infinity);
    site.state='trading'; site.cls='empty'; expect(distanceToTerritory(s.w,s.g.id,edge)).toBe(Infinity);
    site.cls=originalClass; s.g.eliminated=true; expect(distanceToTerritory(s.w,s.g.id,edge)).toBe(Infinity);
  });

  it('nearby protection reduces actual refusals without another office, and lost claims remove that advantage', () => {
    const s=fixture(); s.hood.skills.intimidation=3;
    s.lt.skills.intelligence=s.lt.skills.organization=1;
    // Keep one distant HQ claim; this paired fixture changes only a nearby racket.
    for(const b of Object.values(s.w.buildings)) {
      if(b.ownerGangId===s.g.id && b.id!==s.office.id)b.ownerGangId=null;
      if(b.protection?.gangId===s.g.id)b.protection=null;
    }
    const local=Object.values(s.w.buildings).find(b=>b.id!==s.site.id && b.blockId===s.site.blockId && b.cls==='commercial')!;
    expect(local).toBeDefined(); expect(local.typeId).not.toBe('office');
    local.ownerGangId=null; local.protection=null; local.state='trading';
    const accepted=issueOrder(s.w,s.g.id,{type:'extort',teamId:s.t.id,buildingIds:[s.site.id],opts:{manpower:1,preferredHoodId:s.hood.id}});
    expect(accepted.ok).toBe(true); beginWeekOrders(s.w);
    const order=s.w.orders[s.t.orderIds[0]];
    // Resolution fixture: same actor, target, opinion and PRNG seed at the end of work.
    order.state='executing'; order.workLeft=1;
    const snapshot=structuredClone(s.w);
    const rates={distant:0,nearby:0,destroyed:0,released:0};
    for(let seed=1;seed<=64;seed++) {
      const outcomes: boolean[]=[];
      for(const mode of Object.keys(rates) as (keyof typeof rates)[]) {
        const w=structuredClone(snapshot), claim=w.buildings[local.id];
        if(mode==='nearby'||mode==='destroyed')claim.protection={gangId:s.g.id,weekly:50,base:50,refusing:false,grievance:0};
        if(mode==='destroyed')claim.state='destroyed';
        tickOrders(w,new Rng(seed),1);
        const paid=w.buildings[s.site.id].protection?.gangId===s.g.id;
        // A refusal is a failed attempt.
        expect(w.orders[order.id].state).toBe(paid ? 'done' : 'failed');
        rates[mode]+=Number(paid); outcomes.push(paid);
        expect(w.crimes.some(c=>c.kind==='extort'&&c.buildingId===s.site.id)).toBe(true);
      }
      expect(Number(outcomes[1])).toBeGreaterThanOrEqual(Number(outcomes[0]));
      expect(outcomes[2]).toBe(outcomes[0]); expect(outcomes[3]).toBe(outcomes[0]);
    }
    console.info('Paired Extort successes / 64:',rates);
    expect(rates.nearby).toBeGreaterThan(rates.distant);
    expect(rates.destroyed).toBe(rates.distant); expect(rates.released).toBe(rates.distant);
  });
});
