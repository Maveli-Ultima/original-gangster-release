import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {DETAILED_CHARACTER_STYLES} from '../src/render/detailedCharacters';
const data=JSON.parse(readFileSync('public/art/city/sculpt/burning-motions.json'));
describe('supplied burning death retarget',()=>{
 it('preserves the supplied clip provenance and every frame on every installed body',()=>{
  const clip=data.clips.burnDeath;
  expect(clip.sha256).toBe('bd2c4d8c64ed88e8ca673832a13a74687cbebb3afa142fa3af008f362c87c543');
  expect(clip.duration).toBe(4.5);expect(data.fps).toBe(30);
  expect(Object.keys(clip.styles).sort()).toEqual([...DETAILED_CHARACTER_STYLES].sort());
  for(const style of DETAILED_CHARACTER_STYLES){
   const tracks=clip.styles[style].tracks;expect(tracks.some(t=>t.name==='Hips.position')).toBe(true);
   for(const track of tracks){expect(track.times).toHaveLength(136);expect(track.values.every(Number.isFinite)).toBe(true);
    const width=track.name.endsWith('quaternion')?4:3;expect(track.values).toHaveLength(136*width);
    if(width===4)for(let i=0;i<track.values.length;i+=4)expect(Math.hypot(...track.values.slice(i,i+4))).toBeCloseTo(1,5);
   }
  }
 });
});
