import * as THREE from 'three';
import { presentationEvents } from '../sim/presentationEvents';
import type { Vec2, WeaponId, WorldState } from '../sim/types';

/** How long a gun stays out of the window after the shot, in seconds. */
export const CAR_GUN_SECONDS = 1.4;
/** Height of a seated gunman's hands at the window, in metres. */
const WINDOW_HEIGHT = 1.25;
/** From the car's middle to its side window, in metres. */
const WINDOW_OUT = 0.85;
const POOL = 8;

interface Shot { actorId: number; weapon: WeaponId; target: Vec2; time: number }

/** When the muzzle flashes, for `t` seconds after the shot: a burst for the Tommy gun, one for the rest. */
export function carGunFlash(weapon: WeaponId, t: number): number {
  const shots = weapon === 'tommy' ? 5 : weapon === 'twinPistols' ? 2 : 1, every = weapon === 'tommy' ? .075 : .11;
  for (let i = 0; i < shots; i++) {
    const d = t - i * every;
    if (d >= 0 && d < .05) return 1 - d / .05;
  }
  return 0;
}

/** Where a gunman in a car at `car` shooting at `target` has his gun: out of the window on that side. */
export function carGunPlace(car: Vec2, target: Vec2): { x: number; z: number; yaw: number } {
  const dx = target.x - car.x, dz = target.y - car.y, d = Math.hypot(dx, dz) || 1;
  return { x: car.x + dx / d * WINDOW_OUT, z: car.y + dz / d * WINDOW_OUT, yaw: Math.atan2(dx, dz) };
}

/**
 * Shots fired from a car, seen: the gunman's arm and gun out of the window on
 * the side he is shooting, a muzzle flash for every round, and a streak to
 * where he aims. (The men in a car are not drawn, so a drive-by was only a
 * sound.) Purely presentational: it reads the presentation stream.
 */
export class CarGunfire {
  readonly group = new THREE.Group();
  private shots = new Map<number, Shot>();
  private sequence = 0;
  private week = -1;
  private world: WorldState | null = null;
  private slots: { arm: THREE.Mesh; gun: THREE.Mesh; flash: THREE.Sprite; tracer: THREE.Line }[] = [];
  private flashMap: THREE.Texture;

  constructor(scene: THREE.Scene) {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: .9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: .45, metalness: .7 });
    const flashMap = this.flashMap = flashTexture();
    for (let i = 0; i < POOL; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.11, .11, .5), sleeve);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(.06, .09, .42), steel);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashMap, color: 0xffd27a, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      flash.scale.setScalar(.7);
      const tracer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, depthWrite: false, toneMapped: false }));
      for (const o of [arm, gun, flash, tracer]) { o.visible = false; o.frustumCulled = false; this.group.add(o); }
      this.slots.push({ arm, gun, flash, tracer });
    }
    scene.add(this.group);
  }

  /** `carAt` gives where the man's car is drawn this frame; `ground` the street height there. */
  update(world: WorldState, delta: number, carAt: (id: number) => Vec2 | undefined, ground: (x: number, y: number) => number): void {
    const stream = presentationEvents(world);
    if (world !== this.world || world.week !== this.week) {
      this.world = world; this.week = world.week; this.sequence = stream.sequence; this.shots.clear();
    }
    for (const e of stream.events) {
      if (e.sequence <= this.sequence || e.week !== world.week || world.minute - e.minute > 1) continue;
      if (e.kind !== 'attack' || !e.weapon || e.weapon === 'explosives' || !e.targetPos) continue;
      if (!world.people[e.actorId]?.inVehicle) continue;
      this.shots.set(e.actorId, { actorId: e.actorId, weapon: e.weapon, target: { ...e.targetPos }, time: 0 });
    }
    this.sequence = stream.sequence;
    for (const [id, shot] of this.shots) {
      shot.time += Math.max(0, delta);
      if (shot.time > CAR_GUN_SECONDS || !world.people[id]?.inVehicle) this.shots.delete(id);
    }
    let i = 0;
    for (const shot of this.shots.values()) {
      if (i >= POOL) break;
      const car = carAt(shot.actorId);
      if (!car) continue;
      const slot = this.slots[i++], place = carGunPlace(car, shot.target);
      const y = ground(place.x, place.z) + WINDOW_HEIGHT, sin = Math.sin(place.yaw), cos = Math.cos(place.yaw);
      slot.arm.position.set(place.x + sin * .15, y - .05, place.z + cos * .15);
      slot.arm.rotation.set(0, place.yaw, 0);
      slot.gun.position.set(place.x + sin * .5, y, place.z + cos * .5);
      slot.gun.rotation.set(0, place.yaw, 0);
      const flash = carGunFlash(shot.weapon, shot.time), muzzle = new THREE.Vector3(place.x + sin * .75, y, place.z + cos * .75);
      slot.flash.position.copy(muzzle);
      (slot.flash.material as THREE.SpriteMaterial).opacity = flash;
      slot.flash.visible = flash > 0;
      const ty = ground(shot.target.x, shot.target.y) + 1.1;
      (slot.tracer.geometry.getAttribute('position') as THREE.BufferAttribute).setXYZ(0, muzzle.x, muzzle.y, muzzle.z).setXYZ(1, shot.target.x, ty, shot.target.y).needsUpdate = true;
      (slot.tracer.material as THREE.LineBasicMaterial).opacity = flash * .8;
      slot.tracer.visible = flash > 0;
      slot.arm.visible = slot.gun.visible = true;
    }
    for (; i < POOL; i++) { const s = this.slots[i]; s.arm.visible = s.gun.visible = s.flash.visible = s.tracer.visible = false; }
  }

  /** How many gunmen are shown at their windows (for tests and the profiler). */
  get showing(): number { return this.slots.filter(s => s.gun.visible).length; }

  dispose(): void {
    this.group.removeFromParent();
    for (const s of this.slots) {
      s.arm.geometry.dispose(); s.gun.geometry.dispose(); s.tracer.geometry.dispose();
      (s.flash.material as THREE.SpriteMaterial).dispose(); (s.tracer.material as THREE.Material).dispose();
    }
    (this.slots[0]?.arm.material as THREE.Material | undefined)?.dispose();
    (this.slots[0]?.gun.material as THREE.Material | undefined)?.dispose();
    this.flashMap.dispose();
  }
}

/** A soft star of light for the muzzle (drawn once; no file to load). */
function flashTexture(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return new THREE.Texture();
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(.25, 'rgba(255,220,120,.9)'); r.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = r; g.beginPath();
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, rad = k % 2 ? 12 : 32; g.lineTo(32 + Math.cos(a) * rad, 32 + Math.sin(a) * rad); }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
