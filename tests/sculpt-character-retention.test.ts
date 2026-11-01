import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SculptReviewLayer } from '../src/render/sculptReviewLayer';
vi.mock('../src/render/weaponMotions',()=>({loadWeaponMotions:async()=>({fps:30,clips:{}})}));
vi.mock('../src/render/combatMotions',()=>({loadCombatMotions:async()=>({fps:30,clips:{}})}));

function asset(skinned: boolean): GLTF {
  const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial();
  if (skinned) {
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const mesh = new THREE.SkinnedMesh(geometry, material), bone = new THREE.Bone();
    bone.name = 'hip';
    mesh.add(bone); mesh.bind(new THREE.Skeleton([bone])); scene.add(mesh);
  } else scene.add(new THREE.Mesh(geometry, material));
  const tracks = skinned ? [new THREE.VectorKeyframeTrack('hip.position', [0, .5, 1], [0, 0, 0, 0, .2, 0, 0, 0, 0])] : [];
  return { scene, animations: [new THREE.AnimationClip('walking', 1, tracks)] } as unknown as GLTF;
}
async function populated() {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => asset(!url.endsWith('/coupe.glb')));
  const scene = new THREE.Scene(), layer = new SculptReviewLayer(scene, 1, () => {});
  await layer.load(); expect(layer.ready).toBe(true); expect(layer.error).toBeNull();
  const matrix = new THREE.Matrix4();
  for (let id = 1; id <= 96; id++) expect(layer.pushCharacter(id, 'fedora', matrix, 0, true)).toBe(true);
  layer.commitCharacters();
  const groups = Array.from({ length: 96 }, (_, i) => scene.getObjectByName(`sculpt-review-actor-${i + 1}`)!);
  return { scene, layer, matrix, groups };
}
afterEach(() => vi.restoreAllMocks());

describe('Sculpt character retention at capacity', () => {
  it('fills a busy city view beyond 96 actors and trims spare rigs after panning away', async () => {
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => asset(!url.endsWith('/coupe.glb')));
    const scene = new THREE.Scene(), layer = new SculptReviewLayer(scene, 1, () => {}, 480);
    await layer.load();
    try {
      const matrix = new THREE.Matrix4();
      for (let id = 1; id <= 446; id++) expect(layer.pushCharacter(id, 'worker', matrix, .2, true)).toBe(true);
      layer.commitCharacters(); expect(layer.characterCount).toBe(446);
      const retained = scene.getObjectByName('sculpt-review-actor-446');
      layer.resetCharacters(); layer.retainCharacters(new Set([446]));
      expect(layer.characterCount).toBe(1); expect(layer.cachedCharacterCount).toBe(96);
      expect(layer.pushCharacter(446, 'worker', matrix, .3, true)).toBe(true);
      expect(scene.getObjectByName('sculpt-review-actor-446')).toBe(retained);
      for (let id = 500; id < 650; id++) expect(layer.pushCharacter(id, 'worker', matrix, .3, true)).toBe(true);
      layer.commitCharacters(); expect(layer.characterCount).toBe(151);
      expect(layer.cachedCharacterCount).toBe(0);
    } finally { layer.dispose(); }
    expect(scene.children).toHaveLength(0);
  });
  it('supplies independent reference bounds for opaque clones without sharing their animated skeletons', async () => {
    const { layer, matrix, groups } = await populated();
    try {
      const meshes = groups.map(group => group.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh);
      const referenceBox = meshes[1].boundingBox!.clone(), referenceSphere = meshes[1].boundingSphere!.clone();
      for (const mesh of meshes) {
        expect(mesh.boundingBox).not.toBeNull(); expect(mesh.boundingSphere).not.toBeNull();
        expect(mesh.boundingBox!.equals(referenceBox)).toBe(true);
        expect(mesh.boundingSphere!.equals(referenceSphere)).toBe(true);
        expect(mesh.frustumCulled).toBe(false);
      }
      expect(new Set(meshes.map(mesh => mesh.boundingBox)).size).toBe(96);
      expect(new Set(meshes.map(mesh => mesh.boundingSphere)).size).toBe(96);
      expect(new Set(meshes.map(mesh => mesh.skeleton)).size).toBe(96);
      layer.pushCharacter(1, 'fedora', matrix, Math.PI, true);
      expect(groups[0].getObjectByName('hip')!.position.y).toBeCloseTo(.2);
      expect(groups[1].getObjectByName('hip')!.position.y).toBe(0);
      meshes[0].boundingBox!.translate(new THREE.Vector3(100, 100, 100));
      meshes[0].boundingSphere!.translate(new THREE.Vector3(100, 100, 100));
      expect(meshes[1].boundingBox!.equals(referenceBox)).toBe(true);
      expect(meshes[1].boundingSphere!.equals(referenceSphere)).toBe(true);
    } finally { layer.dispose(); }
  });

  it('keeps first-draw animated sphere calculation for transparent character meshes', async () => {
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
      const model = asset(!url.endsWith('/coupe.glb'));
      model.scene.traverse(child => { if (child instanceof THREE.SkinnedMesh) (child.material as THREE.Material).transparent = true; });
      return model;
    });
    const scene = new THREE.Scene(), layer = new SculptReviewLayer(scene, 1, () => {});
    await layer.load();
    try {
      for (const id of [1, 2]) {
        expect(layer.pushCharacter(id, 'woman', new THREE.Matrix4(), Math.PI, true)).toBe(true);
        const mesh = scene.getObjectByName(`sculpt-review-actor-${id}`)!.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
        expect(mesh.boundingSphere).toBeNull();
      }
    } finally { layer.dispose(); }
  });

  it('keeps existing characters when a newcomer is visited before them in the next frame', async () => {
    const { scene, layer, matrix, groups } = await populated();
    try {
      for (let frame = 0; frame < 3; frame++) {
        layer.resetCharacters();
        expect(layer.pushCharacter(1000, 'worker', matrix, frame, true)).toBe(false);
        for (let id = 1; id <= 96; id++) {
          expect(layer.pushCharacter(id, 'fedora', matrix, frame, true)).toBe(true);
          expect(scene.getObjectByName(`sculpt-review-actor-${id}`)).toBe(groups[id - 1]);
        }
        layer.commitCharacters();
        expect(layer.characterCount).toBe(96);
      }
    } finally { layer.dispose(); }
  });

  it('reuses a departed rig for a matching newcomer and disposes it only when the layer closes', async () => {
    const { scene, layer, matrix, groups } = await populated();
    const removedMesh = groups[0].getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const disposed = vi.spyOn(removedMesh.skeleton, 'dispose');
    try {
      layer.resetCharacters();
      expect(layer.pushCharacter(1000, 'worker', matrix, 0, true)).toBe(false);
      for (let id = 2; id <= 96; id++) layer.pushCharacter(id, 'fedora', matrix, .2, true);
      layer.commitCharacters();
      expect(layer.characterCount).toBe(95); expect(layer.cachedCharacterCount).toBe(1); expect(disposed).not.toHaveBeenCalled();
      expect(scene.getObjectByName('sculpt-review-actor-1')).toBeUndefined();
      layer.resetCharacters();
      expect(layer.pushCharacter(1000, 'fedora', matrix, .3, true)).toBe(true);
      for (let id = 2; id <= 96; id++) {
        layer.pushCharacter(id, 'fedora', matrix, .3, true);
        expect(scene.getObjectByName(`sculpt-review-actor-${id}`)).toBe(groups[id - 1]);
      }
      layer.commitCharacters(); expect(layer.characterCount).toBe(96);
      const newcomer = scene.getObjectByName('sculpt-review-actor-1000')!;
      expect(newcomer).toBe(groups[0]);
      expect(newcomer.getObjectByName('hip')!.position.y).toBeCloseTo(.3 / (Math.PI * 2) * .4);
      layer.pushCharacter(1000, 'fedora', matrix, .9, false);
      expect(newcomer.getObjectByName('hip')!.position.y).toBe(0);
      expect(layer.cachedCharacterCount).toBe(0);
      expect(new THREE.Box3().setFromObject(newcomer).getSize(new THREE.Vector3()).y).toBeCloseTo(1.82);
    } finally { layer.dispose(); }
    expect(disposed).toHaveBeenCalledOnce(); expect(layer.characterCount).toBe(0);
  });

  it('bounds spare plus active rigs and releases a spare of the wrong style', async () => {
    const { scene, layer, matrix, groups } = await populated();
    const skeletons = groups.map(group => (group.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh).skeleton);
    const disposals = skeletons.map(skeleton => vi.spyOn(skeleton, 'dispose'));
    try {
      layer.resetCharacters(); layer.commitCharacters();
      expect(layer.characterCount).toBe(0); expect(layer.cachedCharacterCount).toBe(96);
      expect(groups.every(group => group.parent === null)).toBe(true);
      expect(layer.pushCharacter(1000, 'worker', matrix, .4, true)).toBe(true);
      expect(layer.characterCount).toBe(1); expect(layer.cachedCharacterCount).toBe(95);
      expect(disposals.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(1);
      const newcomer = scene.getObjectByName('sculpt-review-actor-1000')!;
      expect(new THREE.Box3().setFromObject(newcomer).getSize(new THREE.Vector3()).y).toBeCloseTo(1.79);
      for (let id = 1001; id < 1096; id++) expect(layer.pushCharacter(id, 'fedora', matrix, .4, true)).toBe(true);
      expect(layer.cachedCharacterCount).toBe(0); expect(layer.characterCount).toBe(96);
      expect(layer.pushCharacter(2000, 'fedora', matrix, .4, true)).toBe(false);
    } finally { layer.dispose(); layer.dispose(); }
    expect(disposals.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(layer.characterCount).toBe(0); expect(layer.cachedCharacterCount).toBe(0);
  });
});


describe('detailed model loading lifecycle',()=> {
 it('uses separate role meshes and replaces an existing actor when its role changes',async()=> {
  vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=> {
   const result=asset(true);result.scene.name=url.split('/').pop()!;return result;
  });
  const scene=new THREE.Scene(),layer=new SculptReviewLayer(scene,1,()=>{});await layer.load();
  try {
   const roles=[['fbi','fedora','fbi'],['fbiHead','fedora','fbiChief'],['policeChief','police','policeChief'],['judge','worker','judge'],['judge','woman','judgeWoman'],['reporter','worker','photographer']] as const;
   roles.forEach(([role,base,expected],i)=>{
    expect(layer.pushCharacter(i,base,new THREE.Matrix4(),0,false,{role,coat:0xff00ff})).toBe(true);
    const actor=scene.getObjectByName('sculpt-review-actor-'+i)!;
    expect(actor.userData.modelStyle).toBe(expected);expect(actor.getObjectByName(expected+'.glb')).toBeDefined();
    const mesh=actor.getObjectByProperty('isSkinnedMesh',true) as THREE.SkinnedMesh;
    expect(mesh.geometry.hasAttribute('aCloth')).toBe(false);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
   });
   const previous=scene.getObjectByName('sculpt-review-actor-0');
   layer.pushCharacter(0,'worker',new THREE.Matrix4(),0,false,{role:'reporter',coat:0});
   expect(scene.getObjectByName('sculpt-review-actor-0')).not.toBe(previous);
   expect(scene.getObjectByName('sculpt-review-actor-0')?.userData.modelStyle).toBe('photographer');
  } finally {layer.dispose();}
 });

 it('disables mipmaps for every generated texture while retaining single-owner cleanup',async()=> {
  const maps:THREE.Texture[]=[],disposals:ReturnType<typeof vi.spyOn>[]=[];
  vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async()=> {
   const result=asset(false);result.scene.traverse(o=>{if(o instanceof THREE.Mesh){
    const map=new THREE.Texture();maps.push(map);disposals.push(vi.spyOn(map,'dispose'));
    (o.material as THREE.MeshStandardMaterial).map=map;
   }});return result;
  });
  const layer=new SculptReviewLayer(new THREE.Scene(),1,()=>{});await layer.load();
  expect(layer.ready).toBe(true);expect(maps.length).toBeGreaterThan(6);
  for(const map of maps){expect(map.generateMipmaps).toBe(false);expect(map.minFilter).toBe(THREE.LinearFilter);}
  layer.dispose();layer.dispose();expect(disposals.every(spy=>spy.mock.calls.length===1)).toBe(true);
 });

 it('releases successful siblings when one model download fails',async()=> {
  const geometries:ReturnType<typeof vi.spyOn>[]=[];
  vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=> {
   if(url.endsWith('/worker.glb'))throw Error('worker unavailable');
   const result=asset(false);result.scene.traverse(o=> {if(o instanceof THREE.Mesh)geometries.push(vi.spyOn(o.geometry,'dispose'));});return result;
  });
  const scene=new THREE.Scene(),ready=vi.fn(),layer=new SculptReviewLayer(scene,1,ready);
  await layer.load();expect(layer.ready).toBe(false);expect(layer.error).toContain('worker unavailable');expect(scene.children).toHaveLength(0);
  expect(geometries).toHaveLength(20);expect(geometries.every(spy=>spy.mock.calls.length===1)).toBe(true);expect(ready).toHaveBeenCalledOnce();
  layer.dispose();expect(geometries.every(spy=>spy.mock.calls.length===1)).toBe(true);
 });
 it('cleans a late load after navigation without resurrecting the scene or callback',async()=> {
  const releases:(()=>void)[]=[],geometries:ReturnType<typeof vi.spyOn>[]=[];
  vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(()=>new Promise(resolve=> {
   const result=asset(false);result.scene.traverse(o=>{if(o instanceof THREE.Mesh)geometries.push(vi.spyOn(o.geometry,'dispose'));});
   releases.push(()=>resolve(result));
  }));
  const scene=new THREE.Scene(),ready=vi.fn(),layer=new SculptReviewLayer(scene,1,ready);
  const loading=layer.load();layer.dispose();releases.forEach(release=>release());await loading;
  expect(scene.children).toHaveLength(0);expect(layer.ready).toBe(false);expect(ready).not.toHaveBeenCalled();expect(geometries.every(spy=>spy.mock.calls.length===1)).toBe(true);
 });
 it('makes room for a selected newcomer before visiting the existing full pool',async()=> {
  const {layer,matrix,scene}=await populated();try{
   layer.resetCharacters();layer.retainCharacters(new Set([1000,...Array.from({length:95},(_,i)=>i+2)]));
   expect(layer.pushCharacter(1000,'fedora',matrix,0,false,{role:'fbi',coat:0x303840,weapon:'tommy'})).toBe(true);
   for(let id=2;id<=96;id++)layer.pushCharacter(id,'fedora',matrix,0,false);
   layer.commitCharacters();expect(layer.characterCount).toBe(96);expect(layer.cachedCharacterCount).toBe(0);
   expect(scene.getObjectByName('sculpt-review-actor-1000')).toBeDefined();expect(scene.getObjectByName('sculpt-review-actor-1')).toBeUndefined();
  }finally{layer.dispose();}
 });
});
