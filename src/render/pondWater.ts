import * as THREE from 'three';

export interface WaterRect { x: number; y: number; w: number; h: number }

/** City water (park ponds and the original city's river), painted for the high
 * isometric camera without reflection render targets or bitmaps.
 *
 * - Ripples are procedural, world-space value noise with analytic derivatives
 *   (three rotated, flow-stretched octaves): no tiling, no repeat, and each
 *   octave fades out before it would alias at a far zoom.
 * - A fake sky reflection (zenith from the hemisphere light, horizon from the
 *   fog/background colour, drifting cloud brightness) is weighted by Fresnel on
 *   the rippled normal, so the water follows the day's light; the sun's own
 *   highlight comes from the physical material's specular.
 * - The river reads a small blurred mask of its own channel: a narrow blur
 *   gives the damp, shaded band along the embankment walls, a wide one the
 *   darker water mid-channel, and a third which way the reach runs. The
 *   original city's river runs across the map (+x) and steps up or down it
 *   for two or three blocks at a time; the water drifts along whichever way
 *   its reach runs, blended round the bends. */
export class PondWaterMaterial extends THREE.MeshPhysicalMaterial {
  readonly waterTime = { value: 0 };
  private readonly mask = { value: blankMask() };
  private readonly maskRect = { value: new THREE.Vector4(0, 0, 1, 1) };

  private readonly river: boolean;

  constructor(river = false) {
    super({ color: 0xffffff, roughness: .22, metalness: 0, ior: 1.333 });
    this.river = river;
    this.name = river ? 'river-water' : 'park-pond-water';
    this.onBeforeCompile = shader => {
      shader.uniforms.waterTime = this.waterTime;
      shader.uniforms.waterMask = this.mask;
      shader.uniforms.waterMaskRect = this.maskRect;
      // Murky city water: dark green-teal mid-channel, olive-brown silt nearer the banks.
      shader.uniforms.waterDeep = { value: new THREE.Color(river ? 0x12221f : 0x15241f) };
      shader.uniforms.waterMurk = { value: new THREE.Color(river ? 0x263a31 : 0x34483a) };
      shader.uniforms.waterSilt = { value: new THREE.Color(river ? 0x3c3b28 : 0x45452f) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;\nvarying vec2 vWaterUv;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWaterUv = uv;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWaterWorld;
          varying vec2 vWaterUv;
          uniform float waterTime;
          uniform sampler2D waterMask;
          uniform vec4 waterMaskRect;
          uniform vec3 waterDeep;
          uniform vec3 waterMurk;
          uniform vec3 waterSilt;
          float wHash(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * .1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
          }
          float wNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x),
              mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0)), f.x), f.y);
          }
          // Value noise and its gradient (x: value, yz: d/dp).
          vec3 wNoiseD(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
            float a = wHash(i), b = wHash(i + vec2(1.0, 0.0)), c = wHash(i + vec2(0.0, 1.0)), d = wHash(i + vec2(1.0));
            float k = a - b - c + d;
            return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
              du * (vec2(b - a, c - a) + k * u.yx));
          }
          // A rotated basis: wavelength L across the flow, stretched s times along it.
          mat2 wBasis(float a, float L, float s) {
            float c = cos(a), si = sin(a);
            return mat2(c / (L * s), -si / L, si / (L * s), c / L);
          }
          // One ripple octave of world-space slope (metres of height per metre).
          void wOctave(vec2 p, mat2 m, float amp, inout vec2 slope) {
            vec3 n = wNoiseD(m * p);
            slope += amp * (n.yz * m);
          }
          // The surface for water flowing along the unit vector flow: broad
          // silt variation, glassy slicks and three ripple octaves, each
          // stretched along the flow and carried downstream at its own pace.
          void wField(vec2 p, vec2 flow, float t, float speed, float px,
              out float broad, out float slick, out vec2 slope) {
            vec2 across = vec2(-flow.y, flow.x);
            vec2 q = vec2(dot(p, flow), dot(p, across));
            vec2 drift = q - vec2(t * .18 * speed, 0.0);
            broad = wNoise(drift * vec2(1.0 / 70.0, 1.0 / 38.0)) * .65 + wNoise(drift / 19.0 + 7.3) * .35;
            slick = smoothstep(.56, .82, wNoise(drift * vec2(1.0 / 48.0, 1.0 / 7.5) + 3.7));
            // Metres per pixel: ripple octaves fade before they alias.
            float f1 = 1.0 - smoothstep(.2, .45, px / 7.0);
            float f2 = 1.0 - smoothstep(.2, .45, px / 2.6);
            float f3 = 1.0 - smoothstep(.2, .45, px / 1.1);
            vec2 s = vec2(0.0);
            wOctave(q - vec2(t * .32 * speed, -t * .03), wBasis(.12, 7.0, 2.2), .3 * f1, s);
            wOctave(q - vec2(t * .5 * speed, t * .05), wBasis(-.38, 2.6, 1.6), .26 * f2, s);
            wOctave(q - vec2(t * .78 * speed - t * .04, 0.0), wBasis(.67, 1.1, 1.2), .11 * f3, s);
            slope = flow * s.x + across * s.y;
          }`)
        .replace('#include <map_fragment>', `
          vec2 wP = vWaterWorld.xz;
          float wT = waterTime;
          // Metres per pixel: ripple octaves fade before they alias.
          float wPx = max(length(fwidth(wP)), 1e-4);
          ${river ? `
          vec2 wMaskUv = (wP - waterMaskRect.xy) * waterMaskRect.zw;
          vec3 wMask = texture2D(waterMask, wMaskUv).rgb;
          // 0 against the wall, 1 a couple of metres out; deep water mid-channel.
          float wBand = smoothstep(.5, .97, wMask.r);
          float wDepth = smoothstep(.55, .97, wMask.g);
          // The reach runs along x (0) or y (1), blended round its bends.
          float wTurn = wMask.b;` : `
          float wRadius = length(vWaterUv * 2.0 - 1.0);
          float wBand = 1.0 - smoothstep(.9, .985, wRadius);
          float wDepth = 1.0 - smoothstep(.35, .95, wRadius);`}
          float wSpeed = ${river ? '1.0' : '.25'};
          // Silt plumes, calm slicks and ripples, drifting downstream.
          float wBroad, wSlick;
          vec2 wSlope;
          wField(wP, ${river ? 'vec2(1.0, 0.0)' : 'vec2(.8137, .5812)'}, wT, wSpeed, wPx, wBroad, wSlick, wSlope);${river ? `
          if (wTurn > .01) {
            float wBroadY, wSlickY;
            vec2 wSlopeY;
            wField(wP, vec2(0.0, 1.0), wT, wSpeed, wPx, wBroadY, wSlickY, wSlopeY);
            wBroad = mix(wBroad, wBroadY, wTurn);
            wSlick = mix(wSlick, wSlickY, wTurn);
            wSlope = mix(wSlope, wSlopeY, wTurn);
          }` : ''}
          vec3 waterColour = mix(waterMurk, waterDeep, wDepth);
          waterColour = mix(waterColour, waterSilt, smoothstep(.42, .9, wBroad) * (.55 - wDepth * .3));
          waterColour *= .9 + wBroad * .2;
          // Damp, shaded water against the embankment.
          waterColour *= mix(.5, 1.0, wBand);
          diffuseColor.rgb *= waterColour;

          // Slicks are glassy, and the water stills right against the wall.
          wSlope *= (1.0 - wSlick * .65) * mix(.55, 1.0, wBand);
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, .1, wSlick);`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          normal = normalize((viewMatrix * vec4(-wSlope.x, 1.0, -wSlope.y, 0.0)).xyz);`)
        .replace('#include <opaque_fragment>', `
          // Sky sheen: the reflected sky, brighter at the horizon, with drifting
          // cloud light, weighted by Fresnel on the rippled surface.
          {
            float wNV = saturate(dot(normal, geometryViewDir));
            float wFresnel = min(.02 + .98 * pow(1.0 - wNV, 5.0), .15);
            vec3 wR = (vec4(reflect(-geometryViewDir, normal), 0.0) * viewMatrix).xyz;
            #if NUM_HEMI_LIGHTS > 0
              vec3 wZenith = hemisphereLights[0].skyColor;
            #else
              vec3 wZenith = vec3(.45, .52, .62);
            #endif
            #ifdef USE_FOG
              vec3 wHorizon = fogColor * 1.25;
            #else
              vec3 wHorizon = wZenith * 1.2;
            #endif
            vec3 wSky = mix(wHorizon, wZenith * .8, smoothstep(.0, .75, wR.y));
            vec2 wCloud = (wP + wR.xz / max(wR.y, .2) * 30.0) / 150.0 + wT * vec2(.0025, .001);
            float wClouds = wNoise(wCloud) * .6 + wNoise(wCloud * 2.6 + 4.1) * .4;
            wSky *= .7 + .6 * smoothstep(.3, .85, wClouds);
            // The walls hide the low sky from the water beneath them.
            outgoingLight += wSky * wFresnel * (1.05 + wSlick * .6) * mix(.45, 1.0, wBand);
          }
          #include <opaque_fragment>`);
    };
    this.customProgramCacheKey = () => river ? 'river-water-v3' : 'park-pond-water-v3';
  }

  /** The river's channel, as the water rectangles of its blocks (world metres;
   * y is world z). Rectangles at the edge of the city are carried on past it,
   * since the river flows on off the map. */
  setRiverMask(rects: WaterRect[], cityW: number, cityH: number): void {
    if (!this.river || !rects.length) return;
    const margin = 14, past = 30;
    const open = rects.map(r => {
      const x0 = r.x <= 0 ? r.x - past : r.x, y0 = r.y <= 0 ? r.y - past : r.y;
      const x1 = r.x + r.w >= cityW ? r.x + r.w + past : r.x + r.w, y1 = r.y + r.h >= cityH ? r.y + r.h + past : r.y + r.h;
      return { x0, y0, x1, y1 };
    });
    const minX = Math.min(...open.map(r => r.x0)) - margin, minY = Math.min(...open.map(r => r.y0)) - margin;
    const maxX = Math.max(...open.map(r => r.x1)) + margin, maxY = Math.max(...open.map(r => r.y1)) + margin;
    // About 1.5 m a texel: the bands are soft, so this is plenty (and small).
    let step = 1.5;
    while (((maxX - minX) / step) * ((maxY - minY) / step) > 1_000_000) step *= 1.25;
    const W = Math.ceil((maxX - minX) / step), H = Math.ceil((maxY - minY) / step);
    // Water, and the part of it on a reach running down the map (a block whose
    // channel is longer north-south than east-west; a bend's square block is half).
    const cover = new Float32Array(W * H), turned = new Float32Array(W * H);
    for (const [k, r] of open.entries()) {
      const { w: rw, h: rh } = rects[k], along = rh > rw * 1.2 ? 1 : rw > rh * 1.2 ? 0 : .5;
      const i0 = Math.max(0, Math.floor((r.x0 - minX) / step)), i1 = Math.min(W - 1, Math.ceil((r.x1 - minX) / step));
      const j0 = Math.max(0, Math.floor((r.y0 - minY) / step)), j1 = Math.min(H - 1, Math.ceil((r.y1 - minY) / step));
      for (let j = j0; j <= j1; j++) {
        const ty = minY + j * step, oy = Math.min(r.y1, ty + step) - Math.max(r.y0, ty);
        if (oy <= 0) continue;
        for (let i = i0; i <= i1; i++) {
          const tx = minX + i * step, ox = Math.min(r.x1, tx + step) - Math.max(r.x0, tx);
          if (ox <= 0) continue;
          const n = j * W + i, add = Math.min(1 - cover[n], ox * oy / (step * step));
          cover[n] += add; turned[n] += add * along;
        }
      }
    }
    // Three box passes approximate a Gaussian: ~2 m for the wall band, ~8 m for
    // depth, and ~12 m to round the reach's direction off at its bends.
    const near = boxBlur(cover, W, H, 1), far = boxBlur(cover, W, H, 5);
    const wide = boxBlur(cover, W, H, 8), bend = boxBlur(turned, W, H, 8);
    const data = new Uint8Array(W * H * 4);
    for (let n = 0; n < W * H; n++) {
      data[n * 4] = Math.round(near[n] * 255);
      data[n * 4 + 1] = Math.round(far[n] * 255);
      data[n * 4 + 2] = Math.round(Math.min(1, bend[n] / Math.max(wide[n], 1e-3)) * 255);
      data[n * 4 + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.unpackAlignment = 1;
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.mask.value.dispose();
    this.mask.value = texture;
    this.maskRect.value.set(minX, minY, 1 / (W * step), 1 / (H * step));
  }

  override dispose(): void {
    this.mask.value.dispose();
    super.dispose();
  }
}

/** Open water everywhere: what the river reads before (or without) its mask. */
function blankMask(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Three passes of a separable box blur of radius r; outside the grid is land. */
function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const a = src.slice(), b = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let s = 0;
      for (let x = 0; x <= r && x < W; x++) s += a[row + x];
      for (let x = 0; x < W; x++) {
        b[row + x] = s / n;
        if (x + r + 1 < W) s += a[row + x + r + 1];
        if (x - r >= 0) s -= a[row + x - r];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = 0; y <= r && y < H; y++) s += b[y * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = s / n;
        if (y + r + 1 < H) s += b[(y + r + 1) * W + x];
        if (y - r >= 0) s -= b[(y - r) * W + x];
      }
    }
  }
  return a;
}
