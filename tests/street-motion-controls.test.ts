import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { applyLiveMovement, personSpeed, stepPerson } from '../src/sim/movement';
import { buildingDoor } from '../src/sim/world';
import { cancelOrder, clearStreetOrder, issueStreetOrder, setWaiting } from '../src/sim/api';
import { previewActorMotion } from '../src/render/previewActorMotion';
import { tickStreetOrders } from '../src/sim/systems/street';

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  sim.launchWeek();
  const person = Object.values(sim.world.people).find(p => p.gangId === sim.playerGang.id && p.teamId != null)!;
  person.orderId = null; person.buildingId = null; person.halted = false;
  person.pos = { x: 100, y: 100 }; person.dest = { x: 400, y: 100 };
  person.path = [{ ...person.dest }];
  person.streetOrder = { type: 'goTo', targetPersonId: null, pos: { ...person.dest } };
  return { sim, person, w: sim.world };
}
const preview = (person: ReturnType<typeof fixture>['person'], minute: number) =>
  previewActorMotion(person, minute, { x:0, y:0, facing:0, moving:false });

describe('visible street-order movement', () => {
  it.each([false, true])('moves a live-order hood once per tick (driving=%s)', driving => {
    const { sim, person } = fixture();
    person.inVehicle = driving;
    const step = personSpeed(person);
    // A walker is drawn part way to where the next tick puts them; a car is
    // drawn along the minute it has just driven, so it sets off at the tick.
    sim.advance(.5 / MINUTES_PER_SECOND, 1);
    expect(preview(person, sim.subMinute).x).toBeCloseTo(driving ? 100 : 100 + step * .5);
    sim.advance(.5 / MINUTES_PER_SECOND, 1);
    expect(person.pos.x).toBeCloseTo(100 + step);
    expect(preview(person, sim.subMinute).x).toBeCloseTo(driving ? 100 : 100 + step);
    if (driving) {
      sim.advance(.5 / MINUTES_PER_SECOND, 1);
      expect(preview(person, sim.subMinute).x).toBeCloseTo(100 + step * .5);
    }
  });

  it('replaces the old route immediately and stops when Cancel is clicked', () => {
    const { sim, person, w } = fixture();
    const result = issueStreetOrder(w, sim.playerGang.id, [person.id], 'goTo', null, { x:100, y:200 });
    expect(result.ok).toBe(true);
    expect(person.dest).toEqual({ x:100,y:200 });
    clearStreetOrder(w,[person.id]);
    expect(person.dest).toBeNull();
    expect(person.path).toEqual([]);
    expect(preview(person,.8).moving).toBe(false);
  });

  it('stops Wait immediately and replaces a cancelled planned route with the journey home', () => {
    const { person, w } = fixture();
    const order = Object.values(w.orders)[0];
    expect(order).toBeDefined();
    person.streetOrder=null; person.orderId=order.id;
    order.assignedIds=[person.id]; order.state='travelling';
    setWaiting(w,order.id,true);
    expect(order.state).toBe('waiting');
    expect(preview(person,.8).moving).toBe(false);
    setWaiting(w,order.id,false);
    expect(order.state).toBe('travelling');
    person.dest={x:200,y:100}; person.path=[{...person.dest}];
    cancelOrder(w,order.id);
    expect(person.orderId).toBeNull();
    const office = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === person.gangId)!;
    expect(person.dest).toEqual(buildingDoor(w,office));
    expect(preview(person,.8).moving).toBe(true);
    stepPerson(person,10000,undefined,w);
    expect(person.pos).toEqual(buildingDoor(w,office));
    expect(preview(person,.8).moving).toBe(false);
  });

  it.each([false, true])('cancels at the displayed position between ticks (driving=%s)', driving => {
    const { sim, person, w } = fixture(); person.inVehicle = driving;
    sim.advance(.65 / MINUTES_PER_SECOND, 1);
    const shown = preview(person, sim.subMinute);
    applyLiveMovement(w, sim.subMinute, () => clearStreetOrder(w, [person.id]));
    expect(preview(person, sim.subMinute).x).toBeCloseTo(shown.x);
    expect(person.dest).toBeNull();
    sim.advance(.35 / MINUTES_PER_SECOND, 1);
    expect(person.pos.x).toBeCloseTo(shown.x);
  });

  it('starts a replacement route now, from where the car really is', () => {
    const { sim, person, w } = fixture(); person.inVehicle = true;
    // Use a real open road: the old fixture drove through a building at 100,100.
    person.pos = { x:10, y:1.95 }; person.dest = { x:200, y:1.95 }; person.path = [{...person.dest}];
    const speed = personSpeed(person);
    sim.advance(.6 / MINUTES_PER_SECOND, 1);
    const shown = preview(person, sim.subMinute);
    applyLiveMovement(w, sim.subMinute, () => issueStreetOrder(w, sim.playerGang.id,
      [person.id], 'goTo', null, {x:shown.x+100,y:shown.y}));
    const immediate = preview(person, sim.subMinute);
    expect(immediate.x).toBeCloseTo(shown.x); expect(immediate.y).toBeCloseTo(shown.y);
    // The car holds where it is shown until the tick, drives the whole minute
    // on its new route (nothing is lost to the command), and is drawn along it.
    sim.advance(.2 / MINUTES_PER_SECOND, 1);
    expect(preview(person, sim.subMinute).x).toBeCloseTo(shown.x);
    sim.advance(.2 / MINUTES_PER_SECOND, 1);
    expect(person.pos.x).toBeCloseTo(shown.x + speed);
    expect(preview(person, sim.subMinute).x).toBeCloseTo(shown.x);
    sim.advance(.5 / MINUTES_PER_SECOND, 1);
    expect(preview(person, sim.subMinute).x).toBeCloseTo(shown.x + speed * .5);
  });

  it('leaves motion untouched for unrelated commands', () => {
    const { sim, person, w } = fixture();
    sim.advance(.6 / MINUTES_PER_SECOND, 1);
    const path = person.path, position = {...person.pos};
    const result = applyLiveMovement(w, sim.subMinute, () => 'no route change');
    expect(result).toBe('no route change'); expect(person.path).toBe(path); expect(person.pos).toEqual(position);
    expect(preview(person, sim.subMinute).x).toBeCloseTo(100 + personSpeed(person) * .6);
  });

  it('a tailing hood holds position instead of interpolating along an old route', () => {
    const { sim, person, w } = fixture();
    const target=Object.values(w.people).find(p=>p.id!==person.id && p.role==='citizen')!;
    target.pos={x:105,y:100};
    person.streetOrder={type:'tail',targetPersonId:target.id,pos:null};
    tickStreetOrders(w,sim.rng,1);
    expect(person.pos).toEqual({x:100,y:100});
    expect(preview(person,.8).moving).toBe(false);
  });
});
