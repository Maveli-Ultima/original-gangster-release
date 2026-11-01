import { describe, expect, it } from 'vitest';
import type { Person } from '../src/sim/types';
import { previewPosition, stepPerson } from '../src/sim/movement';
import { previewActorMotion, previewStreetPosition } from '../src/render/previewActorMotion';
import { MINUTES_PER_SECOND, WALK_SPEED } from '../src/sim/constants';

/** Minutes for a walker to cover `metres`, and on-screen seconds in minutes. */
const m = (metres: number) => metres / WALK_SPEED;
const secs = (seconds: number) => seconds * MINUTES_PER_SECOND;

function walker() {
  return { id: 1, pos: { x: 0, y: 0 }, dest: { x: 4, y: 12 },
    path: [{ x: 4, y: 0 }, { x: 4, y: 12 }], inVehicle: false, halted: false } as Person;
}
const output = () => ({ x: 0, y: 0, facing: 0, moving: false });

describe('camera and body incident position',()=>{
  it('follows escape and held corpse positions instead of a stale walking destination, without mutating the world',()=>{
    const p=walker();p.burningEscape={week:1,buildingId:2,startMinute:120,fatal:true,door:{x:10,y:10},pavement:{x:10,y:12},end:{x:17,y:12},gangId:null,perpetratorId:null};
    const before=JSON.stringify(p);
    const doorway=previewStreetPosition(p,{week:1,minute:120},secs(.5),output());
    expect(doorway.x).toBe(10);expect(doorway.y).toBeCloseTo(11,10);
    const fleeing=previewStreetPosition(p,{week:1,minute:120},secs(2.6),output());
    expect(fleeing.x).toBeCloseTo(13.5,10);expect(fleeing.y).toBe(12);
    expect(previewStreetPosition(p,{week:1,minute:120+Math.ceil(secs(9))},0,output())).toMatchObject({x:17,y:12});
    expect(previewStreetPosition(p,{week:2,minute:120},m(2),output())).toMatchObject({x:2,y:0});
    expect(JSON.stringify(p)).toBe(before);
  });
  it('follows the witness retreat at sub-minute resolution and delays responder travel until impact',()=>{
    const p=walker();p.shockReaction={week:1,startMinute:120,untilMinute:120+secs(20),victimId:2,from:{x:4,y:4},to:{x:4.5,y:4},resume:null};
    expect(previewStreetPosition(p,{week:1,minute:120},secs(.65/2),output()).x).toBeCloseTo(4.25);
    expect(previewStreetPosition(p,{week:1,minute:120+Math.ceil(secs(1))},0,output())).toMatchObject({x:4.5,y:4});
    delete p.shockReaction;p.emergencyResponse={week:1,buildingId:2,startMinute:120.5,untilMinute:150,kind:'police',stage:'approaching',home:{x:0,y:0},target:{x:4,y:12},lookAt:{x:5,y:13}};
    expect(previewStreetPosition(p,{week:1,minute:120},.4,output())).toMatchObject({x:0,y:0});
    expect(previewStreetPosition(p,{week:1,minute:120},m(6),output())).toMatchObject({x:4,y:2});
  });
});

describe('rendered route facing and stopping', () => {
  it('turns after the displayed corner while the committed route still has its old waypoint', () => {
    const p = walker(), snapshot = JSON.stringify(p);
    expect(previewActorMotion(p, m(2), output())).toMatchObject({ x: 2, y: 0, moving: true, facing: Math.PI / 2 });
    expect(previewActorMotion(p, m(6), output())).toMatchObject({ x: 4, y: 2, moving: true, facing: 0 });
    expect(JSON.stringify(p)).toBe(snapshot);
  });
  it('uses the new segment at the corner itself', () => {
    expect(previewActorMotion(walker(), m(4), output())).toMatchObject({ x: 4, y: 0, facing: 0, moving: true });
  });
  it('stops at preview arrival before the simulation clears its destination', () => {
    const p = walker();
    expect(previewActorMotion(p, m(16), output())).toMatchObject({ x: 4, y: 12, moving: false });
    expect(previewActorMotion(p, m(19), output())).toMatchObject({ x: 4, y: 12, moving: false });
    expect(p.dest).toEqual({ x: 4, y: 12 });
    expect(p.path).toHaveLength(2);
  });
  it('keeps the same displayed position and heading on either side of a committed tick', () => {
    const p = walker(), before = previewActorMotion(p, 1, output());
    stepPerson(p, 1);
    expect(previewActorMotion(p, 0, output())).toEqual(before);
    expect(previewActorMotion(p, .2, output())).toMatchObject(previewPosition(p, .2, { x: 0, y: 0 }));
  });
  it('holds a walker halted at a crossing and returns to moving when released', () => {
    const p = walker(); p.halted = true;
    expect(previewActorMotion(p, .8, output())).toMatchObject({ x: 0, y: 0, moving: false });
    p.halted = false;
    expect(previewActorMotion(p, m(8), output())).toMatchObject({ x: 4, y: 4, moving: true });
  });
  it('handles several short route segments in one preview without consuming the route', () => {
    const p = walker(); p.dest = { x: 1, y: 8 }; p.path = [{x: 2, y: 0}, {x: 2, y: 3}, {x: 1, y: 3}, {x: 1, y: 8}];
    const result = previewActorMotion(p, m(8), output());
    expect(result).toMatchObject({ x: 1, y: 5, moving: true, facing: 0 });
    expect(p.path).toHaveLength(4);
  });
});
