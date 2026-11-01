/**
 * A procedural 1920s small band for the game's score: stride piano (bass on
 * the beat, chord on the off-beat), brushes on two and four, and a clarinet
 * that improvises phrases from the blues scale over a minor progression, all
 * swung. Notes are scheduled a little ahead of the clock (the Web Audio
 * look-ahead pattern), so the tempo holds while the game is busy.
 */
const TEMPO = 96;
const BEAT = 60 / TEMPO;
const SWING = .64;          // the second eighth of a beat lands at 64%
const LOOKAHEAD = .25;      // seconds of music scheduled in advance

// Two bars a chord: i–iv–V7–i, then VI7–V7–i–V7, in A minor (Hz roots).
const PROGRESSION: { root: number; chord: number[] }[] = [
  { root: 110.0, chord: [220.0, 261.6, 329.6, 392.0] },   // Am7
  { root: 146.8, chord: [220.0, 261.6, 293.7, 349.2] },   // Dm7
  { root: 164.8, chord: [207.7, 246.9, 293.7, 329.6] },   // E7
  { root: 110.0, chord: [220.0, 261.6, 329.6, 392.0] },   // Am7
  { root: 174.6, chord: [220.0, 261.6, 311.1, 349.2] },   // F7
  { root: 164.8, chord: [207.7, 246.9, 293.7, 329.6] },   // E7
  { root: 110.0, chord: [220.0, 261.6, 329.6, 392.0] },   // Am7
  { root: 164.8, chord: [207.7, 246.9, 293.7, 329.6] },   // E7
];
// A minor blues scale across two octaves, for the clarinet.
const BLUES = [440, 523.3, 587.3, 622.3, 659.3, 784, 880, 1046.5, 1174.7, 1244.5, 1318.5];

export class JazzBand {
  private timer: number | null = null;
  private beat = 0;
  private nextBeatTime = 0;
  private melodyIndex = 4;
  private phraseLeft = 0;
  private restLeft = 2;

  constructor(private ctx: AudioContext, private out: AudioNode, private noise: AudioBuffer) {}

  start(): void {
    if (this.timer != null) return;
    this.nextBeatTime = this.ctx.currentTime + .1;
    this.timer = window.setInterval(() => this.schedule(), 60);
    this.schedule();
  }

  stop(): void {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    while (this.nextBeatTime < this.ctx.currentTime + LOOKAHEAD) {
      this.playBeat(this.beat, this.nextBeatTime);
      this.nextBeatTime += BEAT;
      this.beat++;
    }
  }

  private playBeat(beat: number, t: number): void {
    const bar = Math.floor(beat / 4), inBar = beat % 4;
    const { root, chord } = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length];
    // Stride: bass on 1 and 3 (root, then fifth), chord on 2 and 4.
    if (inBar === 0) this.piano(t, [root / 2, root], .34, 1.1);
    else if (inBar === 2) this.piano(t, [root * .75, root * 1.5], .27, 1.0);
    else this.piano(t, chord, .12, .55);
    // Brushes: a swish on 2 and 4, a light tap on the swung eighth.
    if (inBar === 1 || inBar === 3) this.brush(t, .05, .22);
    this.brush(t + BEAT * SWING, .02, .06);
    // Clarinet: phrases of a few bars separated by rests.
    for (const [offset, accent] of [[0, 1], [BEAT * SWING, .8]] as const) {
      if (this.restLeft > 0) { if (offset === 0) this.restLeft -= .25; continue; }
      if (Math.random() < .3) continue;
      const step = Math.random() < .5 ? 1 : -1;
      this.melodyIndex = Math.max(0, Math.min(BLUES.length - 1, this.melodyIndex + step * (Math.random() < .25 ? 2 : 1)));
      // Land on a chord tone at the start of a bar.
      let f = BLUES[this.melodyIndex];
      if (inBar === 0 && offset === 0) f = chord.reduce((best, c) => Math.abs(c * 2 - f) < Math.abs(best - f) ? c * 2 : best, chord[0] * 2);
      this.clarinet(t + offset, f, BEAT * (offset === 0 ? SWING : 1 - SWING) * 1.05, .09 * accent);
      this.phraseLeft -= .5;
      if (this.phraseLeft <= 0) { this.restLeft = 1 + Math.floor(Math.random() * 3); this.phraseLeft = 4 + Math.random() * 6; }
    }
  }

  /** A piano note: a few detuned partials with a hammer's quick decay. */
  private piano(t: number, freqs: number[], level: number, length: number): void {
    for (const f of freqs) for (const [mult, amp] of [[1, 1], [2, .35], [3, .12]] as const) {
      const o = this.ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = f * mult * (1 + (Math.random() - .5) * .002);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * amp / freqs.length * 2, t + .006);
      g.gain.exponentialRampToValueAtTime(.0004, t + length / mult);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + length + .05);
    }
  }

  private brush(t: number, level: number, length: number): void {
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = .5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + length * .3);
    g.gain.exponentialRampToValueAtTime(.0004, t + length);
    src.connect(f).connect(g).connect(this.out); src.start(t, Math.random()); src.stop(t + length + .02);
  }

  /** A woody reed: a soft square through a low-pass, with breath and vibrato. */
  private clarinet(t: number, f: number, length: number, level: number): void {
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const vib = this.ctx.createOscillator(); vib.frequency.value = 5.2;
    const vibDepth = this.ctx.createGain(); vibDepth.gain.value = f * .006;
    vib.connect(vibDepth).connect(o.frequency);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * 3; lp.Q.value = .3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .03);
    g.gain.setValueAtTime(level * .85, t + length * .7); g.gain.linearRampToValueAtTime(0, t + length);
    o.connect(lp).connect(g).connect(this.out);
    o.start(t); vib.start(t); o.stop(t + length + .02); vib.stop(t + length + .02);
  }
}
