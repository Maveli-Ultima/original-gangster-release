import type {BurningEscape, Vec2} from './types';
import {MINUTES_PER_SECOND} from './constants';

// Kept in simulation units so pause, acceleration and save/restore agree.
export const BURNING_TIMING={minutesPerSecond:MINUTES_PER_SECOND,flee:4.2,death:4.5,doorExit:1.0} as const;
export function escapeSample(escape:BurningEscape,minute:number){
  const time=(minute-escape.startMinute)/BURNING_TIMING.minutesPerSecond;
  const leg=time<BURNING_TIMING.doorExit;
  const from=leg?escape.door:escape.pavement,to=leg?escape.pavement:escape.end;
  const fraction=Math.max(0,Math.min(1,leg?time/BURNING_TIMING.doorExit:
    (time-BURNING_TIMING.doorExit)/(BURNING_TIMING.flee-BURNING_TIMING.doorExit)));
  const pos:Vec2={x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction};
  return {time,pos,facing:Math.atan2(to.x-from.x,to.y-from.y),
    fleeing:time>=0&&time<BURNING_TIMING.flee,
    deathTime:Math.max(0,time-BURNING_TIMING.flee),
    finished:time>=BURNING_TIMING.flee+(escape.fatal?BURNING_TIMING.death:0)};
}
