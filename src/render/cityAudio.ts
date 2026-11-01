import * as THREE from 'three';
import { presentationEvents } from '../sim/presentationEvents';
import type { WorldState } from '../sim/types';
import { streetSound, type ShotKind } from '../audio/streetSound';

/** At most this many one-shots start in any tenth of a second; a fast clock
 * would otherwise fire a whole minute's gunfight at once. */
const BURST_LIMIT = 6;

/**
 * Hears the city the camera is looking at: the presentation stream's shots,
 * blows, falls, blasts and flashes become placed sounds, louder near the
 * centre of the view and in Street View; traffic and fire beds follow the
 * camera; horns and sirens come and go. Purely presentational.
 */
export class CityAudio {
  private sequence = 0;
  private world: WorldState | null = null;
  private week = -1;
  private window = 0;
  private started = 0;
  private nextHorn = 3;
  private nextSiren = 0;
  private clock = 0;
  /** When each gunman in a car was last given the engine roar, and which step-outs have had their door. */
  private roared = new Map<number, number>();
  private doors = new Set<string>();
  private scratch = new THREE.Vector3();

  /**
   * `reach` is the ground distance from the view centre to its edge, `zoom`
   * 0..1 from the plan up to Street View, `running` whether the week's clock moves.
   */
  update(world: WorldState, camera: THREE.Camera, target: THREE.Vector3, reach: number, zoom: number, delta: number,
    running: boolean, fast: boolean, fires: { x: number; z: number }[], responders: number): void {
    const stream = presentationEvents(world);
    if (world !== this.world || world.week !== this.week) { this.world = world; this.week = world.week; this.sequence = stream.sequence; this.roared.clear(); this.doors.clear(); }
    this.clock += delta;
    if (this.clock - this.window > .1) { this.window = this.clock; this.started = 0; }
    const near = .35 + .65 * zoom;
    const place = (x: number, z: number) => {
      const d = Math.hypot(x - target.x, z - target.z);
      const gain = Math.max(0, 1 - d / (reach * 1.3)) * near;
      this.scratch.set(x, 1, z).project(camera);
      return { gain: gain * gain, pan: THREE.MathUtils.clamp(this.scratch.x * .8, -.9, .9) };
    };
    for (const e of stream.events) {
      if (e.sequence <= this.sequence || e.week !== world.week || world.minute - e.minute > 1) continue;
      if (fast || this.started >= BURST_LIMIT) continue;
      const { gain, pan } = place(e.pos.x, e.pos.y);
      if (gain < .02) continue;
      this.started++;
      const actor = world.people[e.actorId];
      // A man out of his car to strike (a blow, a throw): its door goes first.
      const car = actor?.vehicleKey ? world.vehicleFleet?.[actor.vehicleKey] : undefined;
      const door = car?.boardAfter != null && !actor.inVehicle ? `${actor.vehicleKey}:${car.boardAfter}` : null;
      if (door && !this.doors.has(door)) { this.doors.add(door); streetSound.carDoor(gain, pan); }
      if (e.kind === 'attack') {
        if (e.weapon) streetSound.shot((e.weapon as ShotKind) ?? 'pistol', gain, pan);
        else streetSound.blow(!!e.hit, gain * .8, pan);
        // Shots from a car: the engine driven hard under them, once a burst.
        if (e.weapon && actor?.inVehicle && this.clock - (this.roared.get(actor.id) ?? -Infinity) > 4) {
          this.roared.set(actor.id, this.clock);
          streetSound.carSpeed(gain, pan);
        }
      } else if (e.kind === 'death') streetSound.fall(gain * .7, pan);
      else if (e.kind === 'explosion') streetSound.explosion(Math.min(1, gain * 1.4), pan);
      else if (e.kind === 'photo') streetSound.flash(gain * .6, pan);
    }
    this.sequence = stream.sequence;

    // Beds: traffic under every street scene, fire near a burning building.
    let fire = 0;
    for (const f of fires) fire = Math.max(fire, place(f.x, f.z).gain);
    streetSound.setBeds(running ? .25 + .75 * zoom : zoom * .3, fire);

    if (!running || fast) return;
    if (this.clock > this.nextHorn) {
      this.nextHorn = this.clock + 5 + Math.random() * 12;
      streetSound.horn((.3 + .5 * Math.random()) * near, Math.random() * 1.6 - .8);
    }
    if (responders > 0 && this.clock > this.nextSiren) {
      this.nextSiren = this.clock + 9 + Math.random() * 6;
      streetSound.siren(.6 * near, Math.random() * 1.2 - .6);
    }
  }
}
