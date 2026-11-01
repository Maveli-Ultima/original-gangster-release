import {presentationEvents,THROW_TIMING} from '../sim/presentationEvents';
import type {Vec2, WeaponId, WorldState} from '../sim/types';
import {policeResponseWeapon} from './characterPresentation';
import {WeaponHandling,drawDuration} from './weaponHandling';
import {SHOOT_DURATION,HIT_DURATION,hitDuration,PUNCH_CONTACT,PUNCH_DURATION} from './combatMotionTiming';
import {blowDuration,reactionClip,type PresentedBlow} from './closeMotion';

export type CharacterActionKind='shoot'|'strike'|'hit'|'death'|'burnDeath'|'fleeBurning'|'shock'|'firefight'|'photo'|'throw'|'draw'|'holster'|'ready';
export interface CharacterAction {kind:CharacterActionKind; time:number; weapon?:WeaponId; target?:Vec2; throwable?:'molotov'|'bomb'; origin?:Vec2;reverseDraw?:boolean;
  /** Close combat (Cart.txt): the attack type and the reaction it drew. */blow?:PresentedBlow}
/** An action's length, including close-combat clips. */
export function actionDuration(action:CharacterAction):number {
  return (action.blow&&(action.kind==='strike'||action.kind==='hit')?blowDuration(action.kind,action.blow):undefined)??
    (action.kind==='hit'?hitDuration(action.weapon):ACTION_DURATION[action.kind]);
}
export const ACTION_DURATION:Record<CharacterActionKind,number>={shoot:SHOOT_DURATION,strike:PUNCH_DURATION,hit:HIT_DURATION,death:8,burnDeath:4.5,fleeBurning:4.2,shock:14,firefight:60,photo:2.2,throw:THROW_TIMING.duration,draw:2,holster:2,ready:4};
export const THROW_RELEASE=THROW_TIMING.release;
export const ATTACK_CONTACT=.24;
/** Imported motions and incident reactions are available in normal play. */
export function liveCharacterAction(action?:CharacterAction,preview=false):CharacterAction|undefined {
  void preview;return action;
}

/** Per-view playback. Restores do not replay saved messages or resurrect old corpses. */
export class CharacterActions {
  private sequence=0;
  private week=0;
  private actions=new Map<number,CharacterAction>();
  private drawn=new Map<number,{weapon:WeaponId;remaining:number;targetId?:number;finishShot?:boolean}>();
  private handling=new WeaponHandling();
  constructor(private world:WorldState){this.reset(world);}
  reset(world:WorldState):void {
    this.world=world;this.sequence=presentationEvents(world).sequence;this.week=world.week;this.clear();
  }
  /** `shownAt` gives where a man is drawn when that is not his simulation place (carrying crates). */
  update(world:WorldState,delta:number,shownAt:(id:number)=>Vec2|undefined=()=>undefined):void {
    if(world!==this.world||world.week!==this.week)this.reset(world);
    for(const [id,entry] of this.drawn){
      entry.remaining-=Math.max(0,delta);
      if(entry.remaining<=0||world.people[id]?.status!=='active'||world.people[id]?.inVehicle)this.drawn.delete(id);
    }
    for(const [id,action] of this.actions){
      action.time+=Math.max(0,delta);
      if(action.time>actionDuration(action)||!world.people[id])this.actions.delete(id);
    }
    const stream=presentationEvents(world),attacks=new Map<number,CharacterAction>();
    const contacts=new Map<number,{actorId:number;weapon?:WeaponId}>(),newReactions=new Set<number>();
    for(const event of stream.events){
      if(event.sequence<=this.sequence||event.week!==world.week||world.minute-event.minute>1)continue;
      if(event.kind==='death'){this.actions.set(event.actorId,{kind:'death',time:-.22});this.drawn.delete(event.actorId);newReactions.add(event.actorId);}
      else if(event.kind==='throw'){
        if(this.actions.get(event.actorId)?.kind!=='death')this.actions.set(event.actorId,
          {kind:'throw',time:0,throwable:event.throwable,target:(event.targetId!=null?shownAt(event.targetId):undefined)??event.targetPos,origin:shownAt(event.actorId)??event.pos});
      }else if(event.kind==='photo'){
        if(!this.actions.has(event.actorId))this.actions.set(event.actorId,{kind:'photo',time:0});
      }else if(event.kind==='attack'){
        if(event.weapon&&event.weapon!=='explosives'&&world.people[event.actorId]?.status==='active'&&!world.people[event.actorId]?.inVehicle){
          const finishShot=!!event.hit&&event.targetId!=null&&world.people[event.targetId]?.status==='dead';
          this.drawn.set(event.actorId,{weapon:event.weapon,remaining:finishShot?Math.max(3,drawDuration(event.weapon)+SHOOT_DURATION):3,targetId:event.targetId,finishShot});
        }
        const current=this.actions.get(event.actorId),kind=event.weapon?'shoot':'strike';
        if(current?.kind!=='death'){
          const continuing=current?.kind===kind&&current.weapon===event.weapon;
          // Several simulation attacks can arrive before one rendered action
          // reaches contact. Preserve its wind-up; subsequent gunfire recoils
          // from the raised pose instead of dropping the weapon every tick.
          const time=continuing?(kind==='shoot'?(current.time<.30?current.time:.18):
            current.time<PUNCH_DURATION?current.time:0):0;
          const aim=(event.targetId!=null?shownAt(event.targetId):undefined)??event.targetPos;
          if(current?.kind!=='hit')this.actions.set(event.actorId,{kind,time:event.blow?0:time,weapon:event.weapon,target:aim,...(event.blow?{blow:event.blow}:{})});
          // Keep the attack cue even if another event gives this attacker a hit
          // reaction in the same batch. A reaction is never queued as a shot.
          if(kind==='shoot')attacks.set(event.actorId,{kind,time,weapon:event.weapon,target:aim});
        }
        if(event.hit&&event.targetId!=null)contacts.set(event.targetId,{actorId:event.actorId,weapon:event.weapon});
        // A missed close-combat blow still shows the dodge or duck it drew.
        const shown=event.hit||(event.blow&&reactionClip(event.blow)!==null);
        if(shown&&event.targetId!=null&&this.actions.get(event.targetId)?.kind!=='death'){
          const reaction=this.actions.get(event.targetId);
          // Each close-combat blow is its own reaction; gunfire hits keep one flinch.
          const time=reaction?.kind==='hit'&&!event.blow?reaction.time:-.22;
          this.actions.set(event.targetId,{kind:'hit',time,target:shownAt(event.actorId)??event.pos,weapon:this.heldWeapon(event.targetId),...(event.blow?{blow:event.blow}:{})});
          if(reaction?.kind!=='hit')newReactions.add(event.targetId);
        }
      }
    }
    this.sequence=stream.sequence;
    const ids=new Set([...this.handling.ids(),...this.drawn.keys(),...(world.policeIds??[])]);
    for(const id of ids){
      const p=world.people[id],action=this.actions.get(id);
      if(!p||p.status!=='active'||p.inVehicle||action?.kind==='death'||action?.kind==='throw'||action?.kind==='strike'){
        this.handling.remove(id);continue;
      }
      const combat=this.drawn.get(id);
      // A completed lethal simulation attack still needs its visible final
      // shot. This does not authorize a new shot at an ended/arrested target.
      this.handling.update(id,this.drawnWeapon(id)??(combat?.finishShot?combat.weapon:undefined),Math.max(0,delta),attacks.get(id));
    }
    for(const id of newReactions){
      const contact=contacts.get(id),reaction=this.actions.get(id);
      if(!contact||!reaction||reaction.kind!=='hit'&&reaction.kind!=='death')continue;
      const shown=contact.weapon?this.handling.get(contact.actorId):this.actions.get(contact.actorId);
      const delay=contact.weapon?this.handling.timeUntilReady(contact.actorId):0;
      reaction.time=-(delay+Math.max(0,(contact.weapon?ATTACK_CONTACT:PUNCH_CONTACT)-(shown?.kind==='shoot'||shown?.kind==='strike'?shown.time:0)));
      reaction.target={...(shownAt(contact.actorId)??world.people[contact.actorId]?.pos??reaction.target??world.people[id].pos)};
    }
  }
  get(id:number):CharacterAction|undefined{return this.actions.get(id);}
  /** Rendered cue includes drawing/holstering and queues the first firing pose. */
  presentation(id:number):CharacterAction|undefined {
    const raw=this.actions.get(id);
    return raw&&raw.kind!=='shoot'?raw:this.handling.get(id);
  }
  heldWeapon(id:number):WeaponId|undefined{return this.handling.weapon(id);}
  /** Real gunfire or a police threat response; routine patrols stay holstered. */
  drawnWeapon(id:number):WeaponId|undefined{
    const person=this.world.people[id];
    if(!person||person.status!=='active'||person.inVehicle)return undefined;
    const response=policeResponseWeapon(this.world,person);
    if(response)return response;
    const combat=this.drawn.get(id);
    if(person.role==='police'||person.role==='policeChief'){
      const target=combat?.targetId==null?undefined:this.world.people[combat.targetId];
      if(!target||target.status!=='active'||target.hp<=0){
        if(!combat?.finishShot||target?.status!=='dead')this.drawn.delete(id);
        return undefined;
      }
    }
    return combat?.weapon;
  }
  has(id:number):boolean{return this.actions.has(id);}
  /** Keep the victim present until the visible attack reaches contact. */
  hasPendingDeath(id:number):boolean{const action=this.actions.get(id);return action?.kind==='death'&&action.time<0;}
  hasDeath(id:number):boolean{return this.actions.get(id)?.kind==='death';}
  clear():void{this.actions.clear();this.drawn.clear();this.handling.clear();}
}

export function actionEnvelope(time:number,duration:number,fadeIn=.18,fadeOut=.22):number {
  const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
  return smooth(time/fadeIn)*smooth((duration-time)/fadeOut);
}
export function actionFlash(action?:CharacterAction):number {
  if(!action)return 0;
  const trigger=action.kind==='photo'?1.05:action.kind==='shoot'?ATTACK_CONTACT:Infinity;
  return Math.max(0,1-Math.abs(action.time-trigger)/.055);
}
