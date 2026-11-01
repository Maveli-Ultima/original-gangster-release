import type { OrderType, Person, PersonRole, WorldState } from '../sim/types';
import { buildingDoor } from '../sim/world';
import type { ActorStyle } from './actors';
import { serviceWeapon } from '../sim/weapons';

/** Patrol/go-to movement is not a threat response. An officer must have a
 * live hostile target and a route towards it before drawing while travelling. */
export function policeResponseWeapon(world: WorldState, person: Person) {
  // Federal agents go to and through a raid with their guns out.
  if (person.role === 'fbi' && person.status === 'active' && !person.inVehicle && person.fbiAssignment != null && person.fbiAssignment.kind !== 'search')
    return serviceWeapon(person);
  if (person.role !== 'police' || person.status !== 'active' || person.inVehicle ||
      !person.dest || !person.path.length || person.streetOrder?.type !== 'kill') return undefined;
  const id = person.streetOrder.targetPersonId, target = id == null ? undefined : world.people[id];
  if (!target || target.id === person.id || target.status !== 'active' || target.hp <= 0) return undefined;
  return serviceWeapon(person);
}

export function characterStyle(person: Pick<Person,'female'|'role'|'gangId'|'id'>):ActorStyle {
  if(person.role==='firefighter')return 'worker';
  if(person.role==='police' || person.role==='policeChief') return 'police';
  if(person.female) return 'woman';
  // The worker rig supports the judge's fitted robe and uncovered head variant.
  if(person.role==='judge') return 'worker';
  if(person.gangId!=null || ['fbi','fbiHead','reporter','da','mayor','lawyer','accountant','clergy'].includes(person.role)) return 'fedora';
  return person.id%3===0?'fedora':'worker';
}

/** Jobs done across a counter or an office desk: the crew goes in to do them. */
const INDOOR_ORDERS: ReadonlySet<OrderType> = new Set(['extort', 'collectProtection', 'adjustProtection', 'intimidate',
  'buyPremises', 'setUpBusiness', 'runBusiness', 'donate', 'recruit']);

/**
 * A hood at work on an indoor job is inside the premises, as in the original:
 * he goes in at the door, is off the street while the job takes, and comes
 * back out at the door when it resolves. (A crew a car left further along
 * the kerb is still on the street.)
 */
export function workingInside(world: WorldState, person: Person): boolean {
  if (person.orderId == null || person.inVehicle) return false;
  const order = world.orders[person.orderId];
  if (!order || order.state !== 'executing' || !INDOOR_ORDERS.has(order.type)) return false;
  const b = world.buildings[order.targetBuildingIds[order.cursor]];
  if (!b || b.state === 'destroyed') return false;
  const door = buildingDoor(world, b);
  // Within the distance the order counts as arrived (execution.ts).
  return Math.hypot(person.pos.x - door.x, person.pos.y - door.y) <= 6.5;
}

export function bossInsideOffice(person: Person): boolean {
  return person.role === 'boss' && person.buildingId != null && !person.dest && !person.streetOrder &&
    person.orderId == null && person.status !== 'arrested';
}

const OFF_STREET=new Set(['dead','jailed','kidnapped','onTrial']);
const PUBLIC_ROLES=new Set(['citizen','police','firefighter','policeChief','fbi','fbiHead','judge','da','mayor','snitch','reporter']);

export function streetPersonVisible(person:Person,selected:number|null):boolean {
  // Awaiting trial is custody, as much as a cell.
  if(OFF_STREET.has(person.status)) return false;
  // Inside a street tram: taken off the map while he rides (0x712810).
  if(person.tram?.phase==='riding') return false;
  // The boss is an office resident, not a street actor exposed by lowering a roof.
  if (bossInsideOffice(person)) return false;
  if(person.id===selected || person.dest || person.streetOrder || person.inVehicle || person.status==='arrested') return true;
  if(person.gangId!=null) return person.orderId!=null;
  // The editor at his desk is inside the newspaper, not standing in it.
  if(person.role==='reporter'&&person.buildingId!=null) return false;
  // Officials are real pickable people, even when standing outside their offices.
  return PUBLIC_ROLES.has(person.role);
}

export function characterPriority(person:Person,selected:number|null,watched:number|null,viewer:number|null):number {
  if(person.id===watched) return 0;
  if(person.id===selected) return 1;
  if(viewer!=null && person.gangId===viewer) return 2;
  if(['police','policeChief','fbi','fbiHead','judge','reporter'].includes(person.role)) return 3;
  return 4;
}

export function roleCoat(role:PersonRole,coat:number):number {
  switch(role) {
    case 'fbi': case 'fbiHead': return 0x303840;
    // The original's constables wear a blue that reads at a glance: a deep
    // navy-royal, dyed wool rather than paint, so the cloth's shading and kit
    // still show under the colour.
    case 'police': return 0x2a3a64;
    case 'policeChief': return 0x232f52;
    case 'judge': case 'clergy': return 0x29282a;
    case 'reporter': return 0x6f6557;
    default: return coat;
  }
}

/** Assets load in normal play; explicit zero preserves the lightweight fallback. */
export function useDetailedModels(search:string):boolean {
  return new URLSearchParams(search).get('sculptModels')!=='0';
}

/** One visible prop carrier for a live bombing assignment with remaining stock.
 * This does not reserve/consume stock or alter the simulation's firearm loadout. */
export function carriesExplosives(world:WorldState,person:Person):boolean {
  if(person.status!=='active' || person.orderId==null) return false;
  const order=world.orders[person.orderId];
  if(!order || order.type!=='bomb' || !['travelling','executing','waiting'].includes(order.state))return false;
  const team=world.teams[order.teamId],gang=world.gangs[order.gangId];
  if(!team || !gang || team.gangId!==person.gangId || order.gangId!==person.gangId ||
    (team.weapons.explosives??0)+(gang.weapons.explosives??0)<=0)return false;
  return order.assignedIds.find(id=>world.people[id]?.status==='active' && world.people[id].orderId===order.id)===person.id;
}
