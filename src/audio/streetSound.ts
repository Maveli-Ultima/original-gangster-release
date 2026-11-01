import { audio } from './audio';
import { playSample, sample, type SampleName } from './samples';

/**
 * The street, heard: weapon reports, blasts, blows, fire, traffic and sirens,
 * synthesised and placed in the stereo field. Every one-shot passes through a
 * short procedural street reverb (brick fronts either side), so a pistol in an
 * alley rings rather than clicks. Nothing here touches the simulation.
 */
export type ShotKind = 'pistol' | 'twinPistols' | 'shotgun' | 'rifle' | 'tommy' | 'police';

interface Rig {
  ctx: AudioContext;
  dry: GainNode;
  wet: GainNode;
  noise: AudioBuffer;
  traffic: { gain: GainNode; filter: BiquadFilterNode; src: AudioBufferSourceNode; recorded: boolean } | null;
  fire: { gain: GainNode; stop: () => void; recorded: boolean } | null;
}

let rig: Rig | null = null;

function ready(): Rig | null {
  const bus = audio.bus();
  // A context still waiting for a click would play everything queued at once.
  if (!bus || bus.ctx.state !== 'running') return null;
  if (rig?.ctx === bus.ctx) return rig;
  const { ctx, out, noise } = bus;
  // Street reverb: 1.4 s of decaying, slightly darkened noise as an impulse.
  const length = Math.floor(ctx.sampleRate * 1.4);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      lp += ((Math.random() * 2 - 1) - lp) * .35;
      // Early reflections off the facades, then a smooth tail.
      const early = i < ctx.sampleRate * .06 && Math.random() < .004 ? 2.5 : 1;
      data[i] = lp * Math.pow(1 - t, 3.2) * early;
    }
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  const wet = ctx.createGain(); wet.gain.value = .55;
  const dry = ctx.createGain(); dry.gain.value = 1;
  wet.connect(convolver).connect(out);
  dry.connect(out);
  rig = { ctx, dry, wet, noise, traffic: null, fire: null };
  return rig;
}

/** A voice: gain and stereo position, feeding dry and reverb sends. */
function voice(r: Rig, gain: number, pan: number, wetness = .5): GainNode {
  const g = r.ctx.createGain(); g.gain.value = gain;
  const panner = r.ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(panner);
  const dry = r.ctx.createGain(); dry.gain.value = 1 - wetness * .5;
  const wet = r.ctx.createGain(); wet.gain.value = wetness;
  panner.connect(dry).connect(r.dry);
  panner.connect(wet).connect(r.wet);
  return g;
}

/** A recorded sound through a placed voice; recordings carry their own room,
 * so they take a lighter reverb send. False when not loaded yet. */
function recorded(r: Rig, name: SampleName, gain: number, pan: number, wet = .15, rate = 1): boolean {
  if (!sample(name)) return false;
  return playSample(name, voice(r, gain, pan, wet), 1, rate * (.96 + Math.random() * .08));
}

function burst(r: Rig, dest: AudioNode, at: number, duration: number, type: BiquadFilterType, freq: number, peak: number, q = .7): void {
  const src = r.ctx.createBufferSource(); src.buffer = r.noise;
  const f = r.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(.0004, at + duration);
  src.connect(f).connect(g).connect(dest);
  src.start(at, Math.random() * 1.5); src.stop(at + duration + .02);
}

function thump(r: Rig, dest: AudioNode, at: number, from: number, to: number, duration: number, peak: number): void {
  const o = r.ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(from, at); o.frequency.exponentialRampToValueAtTime(to, at + duration);
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(.0004, at + duration);
  o.connect(g).connect(dest); o.start(at); o.stop(at + duration + .02);
}

/** One report: a supersonic crack, the muzzle's body and a low thump. */
function report(r: Rig, dest: AudioNode, at: number, kind: ShotKind): void {
  const heavy = kind === 'shotgun', long = kind === 'rifle';
  burst(r, dest, at, long ? .05 : .03, 'highpass', long ? 2600 : 1800, long ? .9 : .7);
  burst(r, dest, at, heavy ? .32 : long ? .22 : .16, 'lowpass', heavy ? 900 : 1500, heavy ? 1.1 : .8);
  thump(r, dest, at, heavy ? 120 : 160, 45, heavy ? .22 : .14, heavy ? .9 : .6);
}

export const streetSound = {
  /** A shot `distance` metres from the listener, `pan` -1..1 across the screen. */
  shot(kind: ShotKind, gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    const name: SampleName = kind === 'tommy' ? 'shot-tommy' : kind === 'twinPistols' ? 'shot-twin' : kind === 'shotgun' ? 'shot-shotgun'
      : kind === 'rifle' ? 'shot-rifle' : 'shot-pistol';
    if (recorded(r, name, gain, pan, .2 + (1 - gain) * .3)) return;
    const t = r.ctx.currentTime + Math.random() * .02;
    const v = voice(r, gain, pan, .45 + (1 - gain) * .4);
    if (kind === 'tommy') for (let i = 0; i < 5; i++) report(r, v, t + i * .075, 'pistol');
    else if (kind === 'twinPistols') { report(r, v, t, 'pistol'); report(r, v, t + .11, 'pistol'); }
    else report(r, v, t, kind === 'police' ? 'pistol' : kind);
  },

  /** A bomb or a gas main: a deep boom, debris rattle and a long rumble. */
  explosion(gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    if (recorded(r, 'explosion', gain, pan, .3)) return;
    const t = r.ctx.currentTime;
    const v = voice(r, gain, pan, .6);
    thump(r, v, t, 90, 28, 1.6, 1.4);
    burst(r, v, t, .25, 'highpass', 1200, .9);
    burst(r, v, t, 2.4, 'lowpass', 380, 1.2);
    for (let i = 0; i < 9; i++) burst(r, v, t + .25 + Math.random() * 1.2, .06, 'bandpass', 2200 + Math.random() * 2500, .12 + Math.random() * .15, 3);
  },

  /** A fist or a club landing; a whoosh for a miss. */
  blow(hit: boolean, gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    if (hit && recorded(r, 'punch', gain, pan, .1)) return;
    const t = r.ctx.currentTime, v = voice(r, gain, pan, .25);
    burst(r, v, t, .12, 'bandpass', 900, .25, 1.5);
    if (hit) { thump(r, v, t + .08, 140, 60, .12, .8); burst(r, v, t + .08, .06, 'lowpass', 700, .7); }
  },

  /** A body falling to the pavement. */
  fall(gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    if (sample('fall')) { window.setTimeout(() => recorded(r, 'fall', gain, pan, .1), 350); return; }
    const t = r.ctx.currentTime + .35, v = voice(r, gain, pan, .3);
    thump(r, v, t, 90, 40, .25, .7); burst(r, v, t, .18, 'lowpass', 500, .5);
  },

  /** A camera's shutter and flash powder. */
  flash(gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    if (recorded(r, 'camera-flash', gain, pan, .1)) return;
    const t = r.ctx.currentTime, v = voice(r, gain, pan, .2);
    burst(r, v, t, .04, 'highpass', 3000, .35); burst(r, v, t + .05, .25, 'bandpass', 1200, .25, .8);
  },

  /** A car driven hard past: under the shots fired from it. (Recorded only: nothing synthesised stands in.) */
  carSpeed(gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    recorded(r, 'car-speed', gain * .6, pan, .3);
  },

  /** A car door slammed: a man getting out to strike. */
  carDoor(gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    if (recorded(r, 'car-door', gain * .7, pan, .15)) return;
    const t = r.ctx.currentTime, v = voice(r, gain * .6, pan, .2);
    thump(r, v, t, 110, 50, .12, .7); burst(r, v, t, .05, 'bandpass', 1800, .25);
  },

  /** A motor horn, two-tone, somewhere down the street. */
  horn(gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    if (recorded(r, 'horn', gain * .35, pan, .4)) return;
    const t = r.ctx.currentTime, v = voice(r, gain * .25, pan, .7);
    const lp = r.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(v);
    const len = .25 + Math.random() * .35;
    for (const f of [330, 415]) {
      const o = r.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (.9 + Math.random() * .2);
      const g = r.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.3, t + .02);
      g.gain.setValueAtTime(.3, t + len); g.gain.linearRampToValueAtTime(0, t + len + .05);
      o.connect(g).connect(lp); o.start(t); o.stop(t + len + .1);
    }
  },

  /** A police bell or a fire engine's siren passing. */
  siren(gain: number, pan: number): void {
    const r = ready(); if (!r || gain < .01) return;
    if (recorded(r, 'siren', gain * .3, pan, .4)) return;
    const t = r.ctx.currentTime, v = voice(r, gain * .2, pan, .7);
    const o = r.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(520, t);
    for (let i = 0; i < 3; i++) { o.frequency.linearRampToValueAtTime(860, t + i * 1.1 + .55); o.frequency.linearRampToValueAtTime(520, t + i * 1.1 + 1.1); }
    const g = r.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + .3); g.gain.linearRampToValueAtTime(0, t + 3.3);
    o.connect(g).connect(v); o.start(t); o.stop(t + 3.4);
  },

  /**
   * The continuous beds: traffic and the crowd's murmur, scaled by how close
   * the camera is to the street, and fire crackle near a burning building.
   */
  /** Stop the beds outright (the city view is gone). */
  quiet(): void {
    if (!rig) return;
    try { rig.traffic?.src.stop(); } catch { /* already stopped */ }
    try { rig.fire?.stop(); } catch { /* already stopped */ }
    rig.traffic = null; rig.fire = null;
  },

  setBeds(traffic: number, fire: number): void {
    const r = ready(); if (!r) return;
    const now = r.ctx.currentTime;
    // A recorded bed replaces the synthesised one as soon as it has loaded.
    const street = sample('bed-street');
    if (r.traffic && !r.traffic.recorded && street) { r.traffic.src.stop(); r.traffic = null; }
    if (!r.traffic && traffic > 0) {
      const src = r.ctx.createBufferSource(); src.buffer = street ?? r.noise; src.loop = true;
      const filter = r.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = street ? 1200 : 420;
      const gain = r.ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(r.dry); src.start(0, street ? Math.random() * street.duration : 0);
      r.traffic = { gain, filter, src, recorded: !!street };
    }
    if (r.traffic) {
      // Far off, the street is a muffled hum; close, its detail comes through.
      r.traffic.gain.gain.setTargetAtTime(traffic * (r.traffic.recorded ? .5 : .12), now, .6);
      r.traffic.filter.frequency.setTargetAtTime(r.traffic.recorded ? 600 + traffic * 9000 : 260 + traffic * 500, now, .6);
    }
    const flames = sample('bed-fire');
    if (r.fire && !r.fire.recorded && flames) { r.fire.stop(); r.fire = null; }
    if (!r.fire && fire > 0 && flames) {
      const src = r.ctx.createBufferSource(); src.buffer = flames; src.loop = true;
      const gain = r.ctx.createGain(); gain.gain.value = 0;
      src.connect(gain); gain.connect(r.dry); gain.connect(r.wet); src.start(0, Math.random() * flames.duration);
      r.fire = { gain, stop: () => src.stop(), recorded: true };
    }
    if (!r.fire && fire > 0) {
      // Crackle: sparse, randomly loud snaps of wood, looped, over a low roar.
      const seconds = 3, rate = r.ctx.sampleRate, crackle = r.ctx.createBuffer(1, seconds * rate, rate);
      const data = crackle.getChannelData(0);
      for (let k = 0; k < seconds * 38; k++) {
        const at = Math.floor(Math.random() * (seconds * rate - 2000)), amp = Math.pow(Math.random(), 2.2);
        const len = 80 + Math.floor(Math.random() * 900);
        for (let i = 0; i < len; i++) data[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4));
      }
      const snaps = r.ctx.createBufferSource(); snaps.buffer = crackle; snaps.loop = true;
      const bright = r.ctx.createBiquadFilter(); bright.type = 'highpass'; bright.frequency.value = 700;
      const roarSrc = r.ctx.createBufferSource(); roarSrc.buffer = r.noise; roarSrc.loop = true;
      const roar = r.ctx.createBiquadFilter(); roar.type = 'lowpass'; roar.frequency.value = 260;
      const roarGain = r.ctx.createGain(); roarGain.gain.value = .6;
      const gain = r.ctx.createGain(); gain.gain.value = 0;
      snaps.connect(bright).connect(gain);
      roarSrc.connect(roar).connect(roarGain).connect(gain);
      gain.connect(r.wet); gain.connect(r.dry); snaps.start(); roarSrc.start();
      r.fire = { gain, stop: () => { snaps.stop(); roarSrc.stop(); }, recorded: false };
    }
    if (r.fire) r.fire.gain.gain.setTargetAtTime(fire * (r.fire.recorded ? .7 : .35), now, .4);
  },
};
