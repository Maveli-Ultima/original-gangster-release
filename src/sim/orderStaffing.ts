import { ORDERS } from './constants';
import type { Order, Person, Team, WorldState } from './types';
import { skillAvg } from './world';

export function crewPeople(w: WorldState, team: Team): Person[] {
  return [...new Set([team.lieutenantId, ...team.memberIds])].map(id => w.people[id])
    .filter((p): p is Person => !!p && p.gangId === team.gangId && p.teamId === team.id &&
      (p.id === team.lieutenantId ? p.role === 'lieutenant' : p.role === 'hood'));
}

/** Current jobs and return journeys can finish before a queued job begins. */
export function readyForPlanning(w: WorldState, p: Person): boolean {
  return p.status === 'active' && p.buildingId == null && p.burningEscape?.week !== w.week;
}

export function orderStaffing(w: WorldState, team: Team, order: Pick<Order, 'type' | 'opts'>, planning = false) {
  const members = crewPeople(w, team).filter(p => p.status !== 'dead');
  const available = members.filter(p => readyForPlanning(w, p) &&
    (planning || !p.vehicleKey && p.orderId == null && !p.dest && !p.streetOrder));
  const want = Math.max(1, order.opts.manpower);
  const preferred = order.opts.preferredHoodId == null ? null : members.find(p => p.id === order.opts.preferredHoodId);
  let reason: string | null = null, impossible = false;
  if (order.opts.preferredHoodId != null && !preferred) {
    reason = 'The preferred person is no longer available in this crew.'; impossible = true;
  } else if (members.length < want) {
    reason = `This order needs ${want} people, but only ${members.length} remain in the crew.`; impossible = true;
  } else if (preferred && !available.includes(preferred)) {
    reason = `${preferred.name} is ${planning ? 'unavailable' : 'not free yet'}; this order needs that person.`;
  } else if (available.length < want) {
    reason = `This order needs ${want} people; ${available.length} ${available.length === 1 ? 'is' : 'are'} ${planning ? 'available' : 'free'}.`;
  }
  const chosen = preferred && available.includes(preferred) ? [preferred] : [];
  const lt = available.find(p => p.id === team.lieutenantId);
  const def = ORDERS[order.type];
  const dangerous = def.group === 'minor' || def.group === 'violent' || order.type === 'guardBusiness' || order.type === 'patrol';
  // Manual p.88: poor leaders avoid danger even when best suited to the job.
  // Three stars is remake tuning. A capable leader competes on task skill;
  // otherwise they remain the fallback, so accepted manpower is still filled.
  const willing = dangerous && lt && skillAvg(lt, ['organization', 'intelligence']) >= 3;
  const candidates = available.filter(p => p !== preferred && (p.id !== team.lieutenantId || willing))
    .sort((a, b) => skillAvg(b, def.skills) - skillAvg(a, def.skills) ||
      Number(a.id === team.lieutenantId) - Number(b.id ===team.lieutenantId));
  while (chosen.length < want && candidates.length) chosen.push(candidates.shift()!);
  if (chosen.length < want && lt && !chosen.includes(lt)) chosen.push(lt);
  return { chosen, available: available.length, reason, impossible };
}
