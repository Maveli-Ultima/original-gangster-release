import type { ActorStyle } from './actors';
import type { PersonRole } from '../sim/types';

/** Dedicated Sculpt bodies retain their own geometry and authored textures. */
/** People are drawn 1.3× their modelled size (playtest, 1 October): the original's
 * people read larger against its doors and storeys (person ÷ door 0.83 and
 * ÷ storey 0.59, against 0.67 and 0.43 at true scale; A23 coverage matrix).
 * Applied to each person's whole render group, so props and animation scale
 * with the body; simulation positions are unchanged. */
export const CHARACTER_SCALE = 1.3;
export const DETAILED_CHARACTER_HEIGHTS = {
  fedora:1.82, woman:1.73, worker:1.79, police:1.84,
  fbi:1.82, fbiChief:1.77, policeChief:1.79, judge:1.78, judgeWoman:1.69, photographer:1.80,
  firefighter:1.82,
} as const;
export type DetailedCharacterStyle=keyof typeof DETAILED_CHARACTER_HEIGHTS;
export const DETAILED_CHARACTER_STYLES=Object.keys(DETAILED_CHARACTER_HEIGHTS) as DetailedCharacterStyle[];
export function detailedCharacterStyle(base:ActorStyle,role?:PersonRole):DetailedCharacterStyle {
  switch(role) {
    case 'fbi':return 'fbi';
    case 'fbiHead':return 'fbiChief';
    case 'policeChief':return 'policeChief';
    case 'judge':return base==='woman'?'judgeWoman':'judge';
    case 'reporter':return 'photographer';
    case 'firefighter':return 'firefighter';
    default:return base;
  }
}
export function hasDedicatedBody(style:DetailedCharacterStyle):boolean {
  return !['fedora','worker','woman','police'].includes(style);
}
