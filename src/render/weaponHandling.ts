import type {WeaponId} from '../sim/types';
import type {CharacterAction} from './characterActions';
import {SHOOT_DURATION} from './combatMotionTiming';

export const longGun=(weapon?:WeaponId)=>weapon==='rifle'||weapon==='shotgun'||weapon==='tommy';
export const drawDuration=(weapon?:WeaponId)=>longGun(weapon)?61/30:2;
export const holsterDuration=(weapon?:WeaponId)=>longGun(weapon)?2.3:2;
export const handlingAction=(action?:CharacterAction)=>!!action&&['draw','holster','ready'].includes(action.kind);
export function handlingDuration(action:CharacterAction):number {
  return action.kind==='holster'&&!action.reverseDraw?holsterDuration(action.weapon):drawDuration(action.weapon);
}
/** Pickup/stow cues in the authored motion, in seconds. */
export function weaponVisible(action?:CharacterAction):boolean {
  if(!action||!handlingAction(action)||action.kind==='ready')return true;
  const pickup=longGun(action.weapon)?.73:.6;
  if(action.kind==='draw')return action.time>=pickup;
  return action.reverseDraw||!longGun(action.weapon)?action.time<=drawDuration(action.weapon)-pickup:action.time<1.3;
}
interface Handling {action:CharacterAction;pending?:CharacterAction;shot?:CharacterAction}
/** Presentation only: never changes combat damage, orders, inventory or saves. */
export class WeaponHandling {
  private states=new Map<number,Handling>();
  update(id:number,weapon:WeaponId|undefined,delta:number,attack?:CharacterAction):void {
    let state=this.states.get(id);
    if(!state){
      if(!weapon)return;
      state={action:{kind:'draw',time:0,weapon,target:attack?.target},pending:attack&&{...attack,time:0}};
      this.states.set(id,state);return;
    }
    const a=state.action;
    if(!weapon){state.pending=undefined;state.shot=undefined;}
    if(attack) {
      a.target=attack.target;
      if(a.kind==='ready'&&a.weapon===weapon){
        const prior=state.shot;
        state.shot={...attack,time:prior?(prior.time<.3?prior.time:.18):0};
      }else state.pending={...attack,time:0};
    }
    if(state.shot){state.shot.time+=delta;if(state.shot.time>SHOOT_DURATION)state.shot=undefined;}
    a.time+=delta;
    if(a.kind==='draw'&&a.time>=drawDuration(a.weapon)){
      const extra=a.time-drawDuration(a.weapon);a.kind='ready';a.time=0;
      if(state.pending){state.shot={...state.pending,time:Math.min(extra,SHOOT_DURATION)};state.pending=undefined;}
    }else if(a.kind==='holster'&&a.time>=handlingDuration(a)){
      this.states.delete(id);
      if(weapon)this.update(id,weapon,0,state.pending);
      return;
    }
    if(a.kind==='holster'&&weapon===a.weapon){
      // Pistol holstering (and a cancelled partial draw) is exactly reversible.
      // A complete rifle stow finishes before its distinct pull-out begins.
      if(!longGun(weapon)||a.reverseDraw){a.time=Math.max(0,drawDuration(weapon)-a.time);a.kind='draw';delete a.reverseDraw;}
    }else if(a.kind!=='holster'&&weapon!==a.weapon&&!state.shot){
      const partial=a.kind==='draw';
      if(partial&&!weaponVisible(a)){this.states.delete(id);if(weapon)this.update(id,weapon,0,state.pending);return;}
      a.time=partial?drawDuration(a.weapon)-a.time:0;a.reverseDraw=partial;a.kind='holster';
      if(!weapon)state.pending=undefined;
    }
  }
  get(id:number):CharacterAction|undefined {const s=this.states.get(id);return s?.shot??s?.action;}
  /** Remaining preparation before a queued shot, after this frame's update. */
  timeUntilReady(id:number):number {
    const s=this.states.get(id);if(!s)return 0;
    const a=s.action;
    if(a.kind==='draw')return Math.max(0,drawDuration(a.weapon)-a.time);
    if(a.kind==='holster')return Math.max(0,handlingDuration(a)-a.time)+drawDuration(s.pending?.weapon??a.weapon);
    return 0;
  }
  weapon(id:number):WeaponId|undefined{return this.states.get(id)?.action.weapon;}
  ids():IterableIterator<number>{return this.states.keys();}
  remove(id:number):void{this.states.delete(id);}
  clear():void{this.states.clear();}
}
