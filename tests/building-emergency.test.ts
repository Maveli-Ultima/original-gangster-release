import {describe,it,expect} from 'vitest';
import {Sim} from '../src/sim/sim';
import {defaultGameOptions} from '../src/app/newGame';
import {startBuildingEmergency,tickBuildingEmergencies} from '../src/sim/systems/buildingEmergency';
import {BURNING_TIMING,escapeSample} from '../src/sim/burningEscape';
import {burnBuilding,destroyBuilding} from '../src/sim/execution';
import {buildingDoor} from '../src/sim/world';
import {tickAmbient} from '../src/sim/systems/ambient';
import {policeResponseWeapon} from '../src/render/characterPresentation';
import {presentationEvents} from '../src/sim/presentationEvents';
import {MINUTES_PER_SECOND} from '../src/sim/constants';

/** On-screen seconds in simulated minutes, as the emergency choreography is timed. */
const secs=(s:number)=>s*MINUTES_PER_SECOND;

function fixture(){
 const sim=new Sim({...defaultGameOptions(),seed:404,citySize:10});sim.launchWeek();
 const w=sim.world;w.minute=120;
 const b=Object.values(w.buildings).find(b=>b.cls==='commercial'&&b.ownerPersonId!=null&&!b.hidesId&&!b.isHQ)!;
 const owner=w.people[b.ownerPersonId!];owner.dest=null;owner.path=[];
 return {sim,w,b,owner};
}
describe('building escape, casualties and emergency dispatch',()=>{
 it.each(['fire','explosion'] as const)('stages a %s escape after impact and records one death after the full motion',kind=>{
  const {sim,w,b,owner}=fixture(),actor=w.people[sim.playerGang.bossId];
  const victims=startBuildingEmergency(w,sim.rng,b,kind,2.25,actor,true);
  expect(victims).toContain(owner);expect(owner.status).toBe('active');
  const escape=owner.burningEscape!;
  expect(escapeSample(escape,w.minute).time).toBeLessThan(0);
  const start=escape.startMinute;expect(escapeSample(escape,start).pos).toEqual(escape.door);
  const end=escapeSample(escape,start+secs(BURNING_TIMING.flee)).pos;
  expect(end.x).toBeCloseTo(escape.end.x,8);expect(end.y).toBeCloseTo(escape.end.y,8);
  if(kind==='fire')burnBuilding(w,b);else destroyBuilding(w,b);
  const dies=start+secs(BURNING_TIMING.flee+BURNING_TIMING.death);
  w.minute=Math.floor(dies)-1;tickBuildingEmergencies(w,sim.rng,1);expect(owner.status).toBe('active');
  w.minute=Math.ceil(dies)+1;tickBuildingEmergencies(w,sim.rng,1);expect(owner.status).toBe('dead');
  expect(owner.pos).toEqual(escape.end);expect(owner.hp).toBe(0);expect(owner.diedWeek).toBe(1);
  tickBuildingEmergencies(w,sim.rng,1);expect(w.crimes.filter(c=>c.kind==='kill'&&c.victimId===owner.id)).toHaveLength(1);
  expect(presentationEvents(w).events.filter(e=>e.kind==='death'&&e.actorId===owner.id)).toHaveLength(0);
 });
 it('round-trips active escape and the held charred corpse without replaying a fall',()=>{
  const {sim,w,b,owner}=fixture();startBuildingEmergency(w,sim.rng,b,'fire',0,undefined,true);
  let loaded=Sim.fromSave(JSON.parse(JSON.stringify(w)));
  expect(loaded.world.people[owner.id].burningEscape).toEqual(owner.burningEscape);
  const later=Math.ceil(secs(BURNING_TIMING.flee+BURNING_TIMING.death))+1;loaded.world.minute+=later;tickBuildingEmergencies(loaded.world,loaded.rng,later);
  loaded=Sim.fromSave(JSON.parse(JSON.stringify(loaded.world)));
  const p=loaded.world.people[owner.id];expect(p.status).toBe('dead');
  expect(escapeSample(p.burningEscape!,loaded.world.minute).deathTime).toBeGreaterThan(BURNING_TIMING.death);
  expect(presentationEvents(loaded.world).events).toHaveLength(0);
 });
 it('sends real police, firemen and a field reporter along pavement routes, then releases them',()=>{
  const {sim,w,b}=fixture(),door=buildingDoor(w,b);
  const reporter=Object.values(w.people).find(p=>p.role==='reporter'&&w.buildings[p.buildingId??-1]?.ownerPersonId!==p.id)!;
  reporter.pos={x:door.x+8,y:door.y};reporter.dest=null;
  startBuildingEmergency(w,sim.rng,b,'fire',0,undefined,true);
  const responders=Object.values(w.people).filter(p=>p.emergencyResponse);
  expect(responders.map(p=>p.emergencyResponse!.kind).sort()).toEqual(['fire','fire','police','reporter']);
  for(const p of responders){expect(p.path.length).toBeGreaterThan(0);expect(policeResponseWeapon(w,p)).toBeUndefined();}
  const positions=responders.map(p=>({...p.pos}));tickAmbient(w,sim.rng,1);expect(responders.map(p=>p.pos)).toEqual(positions);
  for(let n=0;n<Math.ceil(secs(300))+1;n++){w.minute++;tickBuildingEmergencies(w,sim.rng,1);}
  expect(responders.every(p=>!p.emergencyResponse)).toBe(true);
  expect(presentationEvents(w).events.some(e=>e.kind==='photo'&&e.actorId===reporter.id)).toBe(true);
  expect(Object.values(w.people).filter(p=>p.role==='firefighter')).toHaveLength(2);
 });
 it('allows uninjured occupants to escape without a corpse or murder record',()=>{
  const {sim,w,b,owner}=fixture();startBuildingEmergency(w,sim.rng,b,'explosion',0,undefined,false);
  const end={...owner.burningEscape!.end};
  const later=Math.ceil(secs(BURNING_TIMING.flee+BURNING_TIMING.death))+1;w.minute+=later;tickBuildingEmergencies(w,sim.rng,later);
  // Out on the pavement and free again: the escape is over.
  expect(owner.status).toBe('active');expect(owner.buildingId).toBeNull();expect(owner.pos).toEqual(end);
  expect(owner.burningEscape).toBeUndefined();
  expect(w.crimes.some(c=>c.kind==='kill'&&c.victimId===owner.id)).toBe(false);
 });
 it('limits shocked bystanders, preserves their destinations, and resumes their journeys',()=>{
  const {sim,w,b}=fixture(),door=buildingDoor(w,b);
  const citizens=Object.values(w.people).filter(p=>p.role==='citizen').slice(0,10);
  for(const [i,p] of citizens.entries()){p.pos={x:door.x+(i+1)*.5,y:door.y};p.dest={x:door.x+9,y:door.y};p.path=[{...p.dest}];}
  startBuildingEmergency(w,sim.rng,b,'fire',0,undefined,true);
  const shocked=citizens.filter(p=>p.shockReaction);expect(shocked.length).toBeGreaterThan(0);expect(shocked.length).toBeLessThanOrEqual(6);
  for(const p of shocked){expect(p.dest).toBeNull();expect(p.shockReaction!.resume).not.toBeNull();
    const s=p.shockReaction!;expect(Math.hypot(s.to.x-s.from.x,s.to.y-s.from.y)).toBeLessThanOrEqual(.551);}
  const copy=Sim.fromSave(JSON.parse(JSON.stringify(w)));expect(copy.world.people[shocked[0].id].shockReaction).toEqual(shocked[0].shockReaction);
  const later=Math.ceil(secs(16))+1;w.minute+=later;tickBuildingEmergencies(w,sim.rng,later);
  for(const p of shocked){expect(p.shockReaction).toBeUndefined();expect(p.dest).not.toBeNull();}
 });
});
