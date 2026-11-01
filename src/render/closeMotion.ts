import type {CloseMotionName} from './combatMotions';
import type {CombatPosture} from '../sim/types';

/** A close-combat blow as presented: the Cart attack type and reaction. */
export interface PresentedBlow {attack:number;reaction:number}

/** Durations of the imported clips (public/art/city/sculpt/close-motions.json). */
export const CLOSE_DURATION:Record<CloseMotionName,number>={headBack:85/30,stomachHit:49/30,kneelDown:32/30,getUpKnees:39/30,
  knockDown:63/30,twitch:2,standUp:5,kick:43/30,swing:45/30};

/** Club and knife attacks swing; a downed man is kicked; fists punch (the
 * existing strike) and so does the coup de grâce until a pistol clip exists. */
const SWINGS=new Set([0,3,4,6,7,8,10,11,13]);
export function attackClip(blow:PresentedBlow):CloseMotionName|null {
  return blow.attack===14?'kick':SWINGS.has(blow.attack)?'swing':null;
}

/** Cart reactions (CART_REACTIONS) onto clips; 7 ("do nothing") has none. */
const REACTION_CLIPS:(CloseMotionName|null)[]=['headBack','stomachHit','stomachHit','kneelDown','knockDown','knockDown',
  'twitch',null,'stomachHit','knockDown','getUpKnees','standUp','standUp'];
export function reactionClip(blow:PresentedBlow):CloseMotionName|null {return REACTION_CLIPS[blow.reaction]??null;}

/** Reactions that leave him kneeling or down hold their last pose. */
export const ENDS_IN_POSTURE=new Set<CloseMotionName>(['kneelDown','knockDown','twitch']);

/** The pose a kneeling or fallen fighter holds between blows. */
export function postureHold(posture?:CombatPosture):CloseMotionName|null {
  return posture==='kneeling'?'kneelDown':posture==='down'?'knockDown':null;
}

/** How long the action lasts: its clip, or the existing strike/hit timing. */
export function blowDuration(kind:'strike'|'hit',blow:PresentedBlow):number|undefined {
  const clip=kind==='strike'?attackClip(blow):reactionClip(blow);
  return clip?CLOSE_DURATION[clip]:undefined;
}
