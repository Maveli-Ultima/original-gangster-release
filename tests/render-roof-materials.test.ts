import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cornicePlacement, mouldingsFor, pitchedRoofGeometry, RUSTICATION_TOP, rusticationCourses } from '../src/render/architecture';
import { slabGeometry } from '../src/render/geometry';
import { TextureOwner } from '../src/render/textureOwnership';
import { createPitchedRoofMaterials, createRoofCourses, ROOF_COURSE, roofSurfaceMetres } from '../src/render/roofMaterials';

describe('physical roof courses and clear cornices', () => {
  it('keeps the entire solid cornice top below the true roof plane', () => {
    for (const bodyHeight of [3.78, 8.4, 21.3, 36.96]) for (const pitched of [false, true]) {
      const band = cornicePlacement(bodyHeight, pitched), geometry = slabGeometry();
      geometry.applyMatrix4(new THREE.Matrix4().makeScale(12.99, band.height, 14.75));
      geometry.translate(0, band.bottom, 0); geometry.computeBoundingBox();
      expect(geometry.boundingBox!.max.y).toBeCloseTo(bodyHeight - .04, 5);
      expect(geometry.boundingBox!.max.y).toBeLessThan(bodyHeight - .035);
      geometry.dispose();
    }
  });

  it('crown, bed mould and string course all sit below the roof plane, in order', () => {
    for (const bodyHeight of [3.78, 8.4, 21.3]) for (const pitched of [false, true]) {
      const bands = mouldingsFor(bodyHeight, pitched, 4.2);
      for (const band of bands) expect(band.bottom + band.height).toBeLessThan(bodyHeight - .035);
      for (const band of bands.slice(1)) expect(bands[0].projection).toBeGreaterThan(band.projection);
    }
    // A single-storey front has no storey above a string course.
    expect(mouldingsFor(3.78, false, 4.2).map(b => b.height)).toEqual([.38, .18]);
    expect(mouldingsFor(8.4, false, 4.2)).toHaveLength(3);
    expect(mouldingsFor(8.4, false, null)).toHaveLength(2);
  });

  it('rusticated courses make a base below sill height, each with a joint above it', () => {
    const courses = rusticationCourses(4.2);
    expect(courses.length).toBe(3);
    for (let i = 1; i < courses.length; i++) expect(courses[i].bottom).toBeGreaterThan(courses[i - 1].bottom + courses[i - 1].height);
    expect(courses.at(-1)!.bottom + courses.at(-1)!.height).toBeLessThanOrEqual(RUSTICATION_TOP + .001);
  });

  it('binds vertical gable ends separately from roof slopes and hip ends', () => {
    const gable = pitchedRoofGeometry(), hip = pitchedRoofGeometry(true);
    expect(gable.groups).toEqual([{start:0,count:12,materialIndex:0},{start:12,count:6,materialIndex:1}]);
    expect(hip.groups).toEqual([{start:0,count:18,materialIndex:0}]);
    const gn = gable.getAttribute('normal'), hn = hip.getAttribute('normal');
    for(let i=0;i<12;i++) expect(gn.getY(i)).toBeGreaterThan(0);
    for(let i=12;i<18;i++) expect(gn.getY(i)).toBeCloseTo(0,8);
    for(let i=0;i<18;i++) expect(hn.getY(i)).toBeGreaterThan(0);
    const material = new THREE.MeshBasicMaterial();
    for(const geometry of [gable,hip]) {
      const mesh=new THREE.Mesh(geometry,geometry===gable?[material,material]:material);
      const ray=new THREE.Raycaster(new THREE.Vector3(.25,2,0),new THREE.Vector3(0,-1,0));
      expect(ray.intersectObject(mesh)[0].point.y).toBeCloseTo(.5,5);
      geometry.dispose();
    }
    material.dispose();
  });

  it('retains .42 by .27 metre course spacing across different roof dimensions', () => {
    for(const size of [new THREE.Vector3(7.09,2.27,12.16),new THREE.Vector3(12.95,2.79,14.71),new THREE.Vector3(24,3,30)]) {
      const origin=new THREE.Vector3(.1,0,-.1), initial=roofSurfaceMetres(origin,size);
      const across=roofSurfaceMetres(origin.clone().add(new THREE.Vector3(0,0,ROOF_COURSE.width/size.z)),size);
      expect(across.x-initial.x).toBeCloseTo(ROOF_COURSE.width,8);
      const slope=Math.hypot(size.x*.5,size.y);
      const up=roofSurfaceMetres(origin.clone().add(new THREE.Vector3(ROOF_COURSE.rise/(2*slope),0,0)),size);
      expect(up.y-initial.y).toBeCloseTo(ROOF_COURSE.rise,8);
      const end=new THREE.Vector3(.1,0,.3), a=roofSurfaceMetres(end,size,true);
      const endSlope=Math.hypot(size.z*.22,size.y);
      const b=roofSurfaceMetres(end.clone().add(new THREE.Vector3(0,0,ROOF_COURSE.rise*.22/endSlope)),size,true);
      expect(b.y-a.y).toBeCloseTo(ROOF_COURSE.rise,8);
    }
  });

  it('generates opaque staggered dark courses and separate non-colour relief deterministically', () => {
    for(const style of ['slate','weathered-tile'] as const) {
      const a=createRoofCourses(style),b=createRoofCourses(style);
      const bytes=a.albedo.image.data as Uint8Array, height=a.height.image.data as Uint8Array;
      expect(bytes).toEqual(b.albedo.image.data);
      expect(height).toEqual(b.height.image.data);
      const pixel=(x:number,y:number)=>bytes[(y*ROOF_COURSE.pixels+x)*4];
      expect(pixel(0,10)).toBeLessThan(pixel(32,10)-12);
      expect(pixel(32,74)).toBeLessThan(pixel(0,74)-12);
      expect(pixel(10,0)).toBeLessThan(pixel(10,10)-12);
      let min=255,max=0,nonOpaque=0;
      for(let i=0;i<bytes.length;i+=4) {
        min=Math.min(min,bytes[i]); max=Math.max(max,bytes[i]);
        if(bytes[i+3]!==255||height[i+3]!==255) nonOpaque++;
      }
      expect(nonOpaque).toBe(0); expect(min).toBeGreaterThan(11); expect(max).toBeLessThan(133);
      expect(a.albedo.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(a.height.colorSpace).toBe(THREE.NoColorSpace);
      expect(a.albedo.wrapS).toBe(THREE.RepeatWrapping);
      expect(a.albedo.generateMipmaps).toBe(true);
      for(const texture of [a.albedo,a.height,b.albedo,b.height]) texture.dispose();
    }
  });

  it('owns and disposes every generated texture once without changing shared facade materials', () => {
    const owner=new TextureOwner(), materials=createPitchedRoofMaterials(owner);
    const roof=[materials.gable[0],materials.hip];
    const textures=roof.flatMap(material=>[material.map!,material.bumpMap!]);
    expect(new Set(textures).size).toBe(4);
    const disposed=new Map(textures.map(texture=>[texture,0]));
    for(const texture of textures) texture.addEventListener('dispose',()=>disposed.set(texture,disposed.get(texture)!+1));
    for(const material of roof) {
      expect(material.vertexColors).toBe(false);
      expect(material.bumpScale).toBeCloseTo(.022);
      expect(material.color.getHex()).toBe(0xffffff);
    }
    expect(materials.gableWall.map).toBeNull();
    expect(materials.gableWall.color.getHex()).toBe(0x776956);
    owner.dispose(); owner.dispose();
    expect([...disposed.values()]).toEqual([1,1,1,1]);
    for(const material of [...materials.gable,materials.hip]) material.dispose();
  });
});
