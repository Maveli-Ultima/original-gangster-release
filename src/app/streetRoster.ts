import type { Gang, Person, Team, WorldState } from '../sim/types';
import { specialistJobActive } from '../sim/specialistJobs';
import { peopleList } from '../sim/entityLists';

export interface StreetRosterGroup {
  key: string;
  name: string;
  team: Team | null;
  people: Person[];
  crewSize: number;
}

/** Manual pp.69,78–79: people deployed on the streets, grouped by their
 * lieutenant. A crew portrait, the gang roster and an open tag are different
 * things; neither selecting someone nor owning a business deploys a hood. */
export function streetRoster(w: WorldState, gang: Gang): { count: number; groups: StreetRosterGroup[] } {
  const deployed = new Map<number,Person>();
  const staffWorking = new Set(Object.values(w.specialistJobs ?? {}).filter(j => j.week === w.week && specialistJobActive(j) && j.state !== 'queued').map(j => j.actorId));
  for (const p of peopleList(w)) {
    if (p.gangId !== gang.id || p.id === gang.bossId || p.role === 'boss' || p.status !== 'active') continue;
    const order = p.orderId == null ? null : w.orders[p.orderId];
    const onJob = order && order.gangId === gang.id && order.assignedIds.includes(p.id) &&
      ['travelling','executing','waiting'].includes(order.state);
    const working = p.streetOrder != null || p.dest != null || onJob || staffWorking.has(p.id);
    // A resident with an old vehicle flag is still inside their premises.
    if (p.buildingId != null && !working) continue;
    if (working || p.inVehicle) deployed.set(p.id,p);
  }
  const count = deployed.size, groups: StreetRosterGroup[] = [];
  for (const teamId of new Set(gang.teamIds)) {
    const team = w.teams[teamId];
    if (!team || team.gangId !== gang.id) continue;
    const crew = [...new Set([team.lieutenantId,...team.memberIds])].map(id=>w.people[id])
      .filter(p=>p && p.gangId===gang.id && p.teamId===team.id && p.status!=='dead');
    const people = crew.filter(p=>deployed.has(p.id));
    if (!people.length) continue;
    groups.push({key:`team-${team.id}`,name:team.name,team,people,crewSize:crew.length});
    for (const p of people) deployed.delete(p.id);
  }
  for (const specialists of [true,false]) {
    const people = [...deployed.values()].filter(p=>['accountant','lawyer'].includes(p.role)===specialists)
      .sort((a,b)=>a.id-b.id);
    if (people.length) groups.push({key:specialists?'staff':'independent',name:specialists?'Specialists':'Independent hoods',
      team:null,people,crewSize:people.length});
  }
  return {count,groups};
}
