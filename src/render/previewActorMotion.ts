import type { Person, Vec2, WorldState } from '../sim/types';
import { previewPosition } from '../sim/movement';
import { escapeSample } from '../sim/burningEscape';
import { MINUTES_PER_SECOND } from '../sim/constants';

export interface PreviewActorMotion { x: number; y: number; facing: number; moving: boolean }

/** Match the tangent at the displayed position, including corners consumed
 * between simulation ticks. Sampling never changes the person's route. */
export function previewActorMotion(p: Person, minutes: number, out: PreviewActorMotion, world?:WorldState): PreviewActorMotion {
  previewPosition(p, minutes, out,world);
  const x = out.x, y = out.y;
  // A millimetre of normal walking looks ahead without smoothing over a corner.
  previewPosition(p, minutes + .0001, out,world);
  const dx = out.x - x, dy = out.y - y;
  out.moving = dx * dx + dy * dy > 1e-10;
  out.facing = out.moving ? Math.atan2(dx, dy) : 0;
  out.x = x; out.y = y;
  return out;
}

/** Cameras, culling and cutaways must follow the same incident position as the
 * visible body, even before the next simulation minute commits its route. */
export function previewStreetPosition(p: Person, world: Pick<WorldState, 'week' | 'minute'> & Partial<Pick<WorldState,'people'|'vehicleFleet'|'gangs'>>,
  subMinute: number, out: Vec2): Vec2 {
  const now = world.minute + subMinute;
  if (p.burningEscape?.week === world.week) {
    Object.assign(out, escapeSample(p.burningEscape, now).pos);
  } else if (p.shockReaction?.week === world.week) {
    const reaction = p.shockReaction;
    const fraction = Math.max(0, Math.min(1, (now - reaction.startMinute) / (MINUTES_PER_SECOND * .65)));
    const step = fraction * fraction * (3 - 2 * fraction);
    out.x = reaction.from.x + (reaction.to.x - reaction.from.x) * step;
    out.y = reaction.from.y + (reaction.to.y - reaction.from.y) * step;
  } else if (p.emergencyResponse?.week === world.week && now < p.emergencyResponse.startMinute) {
    Object.assign(out, p.pos);
  } else previewPosition(p, subMinute, out,world.people ? world as WorldState : undefined);
  return out;
}
