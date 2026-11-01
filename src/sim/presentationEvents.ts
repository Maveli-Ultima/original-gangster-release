import type {Building, Person, Vec2, WeaponId, WorldState} from './types';
export const THROW_TIMING={duration:115/30,release:1.6,flight:.65} as const;

export interface PresentationEvent {
  sequence:number;
  week:number;
  minute:number;
  kind:'attack'|'death'|'photo'|'fire'|'explosion'|'throw';
  actorId:number;
  pos:Vec2;
  targetId?:number;
  targetPos?:Vec2;
  weapon?:WeaponId;
  hit?:boolean;
  buildingId?:number;
  throwable?:'molotov'|'bomb';
  delay?:number;
  buildingBefore?:Building;
  /** Close combat: the Cart attack type and the reaction it drew. */
  blow?:{attack:number;reaction:number};
}
export function presentThrow(world:WorldState,actor:Person,target:Vec2,throwable:'molotov'|'bomb'):void {
  if(!actor.inVehicle&&actor.status==='active')emit(world,{kind:'throw',actorId:actor.id,pos:{...actor.pos},targetPos:{...target},throwable});
}
interface Stream {sequence:number; events:PresentationEvent[]}
// Presentation is transient, bounded and independent of saved state and the RNG.
// Multiple views can read the same events without consuming one another's cues.
const streams=new WeakMap<WorldState,Stream>();
export function presentationEvents(world:WorldState):Readonly<Stream> {
  return streams.get(world)??{sequence:0,events:[]};
}
function emit(world:WorldState,event:Omit<PresentationEvent,'sequence'|'week'|'minute'>):void {
  let stream=streams.get(world);
  if(!stream){stream={sequence:0,events:[]};streams.set(world,stream);}
  stream.events.push({...event,sequence:++stream.sequence,week:world.week,minute:world.minute});
  if(stream.events.length>128)stream.events.splice(0,stream.events.length-128);
}
export function presentAttack(world:WorldState,actor:Person,target:Person,weapon:WeaponId|undefined,hit:boolean,blow?:{attack:number;reaction:number}):void {
  emit(world,{kind:'attack',actorId:actor.id,pos:{...actor.pos},targetId:target.id,targetPos:{...target.pos},weapon,hit,...(blow?{blow}:{})});
}
export function presentDeath(world:WorldState,person:Person):void {
  if(!person.inVehicle&&person.status!=='jailed'&&person.status!=='kidnapped')
    emit(world,{kind:'death',actorId:person.id,pos:{...person.pos}});
}
export function presentPhoto(world:WorldState,person:Person):void {
  emit(world,{kind:'photo',actorId:person.id,pos:{...person.pos}});
}
export function presentBuildingEffect(world:WorldState,kind:'fire'|'explosion',pos:Vec2,buildingId?:number,delay=0,buildingBefore?:Building):void {
  emit(world,{kind,actorId:0,pos:{...pos},buildingId,delay,buildingBefore});
}
