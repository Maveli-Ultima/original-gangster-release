import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from '../sim/types';
import { addMuzzleAnchor } from './equipmentAnchors';

export type EquipmentModel = WeaponId | 'molotov' | 'camera' | 'cameraStrap' | 'badge' | 'gavel' | 'collar' | 'judgeHair' | 'fireHose' | 'crate';

/** Locally authored, exterior-only period props. Metres, +Z muzzle, grip at origin.
 * Fallback geometry and small fittings supplement the installed Sculpt props. */
function equipmentGeometry(kind: EquipmentModel): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const steel = 0x303840, walnut = 0x513321, silver = 0x9da5a7, leather = 0x252321;
  const add = (geometry: THREE.BufferGeometry, color: number, x=0, y=0, z=0, rx=0, rz=0) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.rotateX(rx); g.rotateZ(rz); g.translate(x,y,z);
    const c = new THREE.Color(color), n = g.getAttribute('position').count;
    const colors = new Float32Array(n*3);
    for(let i=0;i<n;i++) { colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b; }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    g.deleteAttribute('uv'); parts.push(g);
  };
  const box = (w:number,h:number,d:number,x:number,y:number,z:number,c:number,rx=0) =>
    add(new THREE.BoxGeometry(w,h,d),c,x,y,z,rx);
  const tube = (r:number,l:number,x:number,y:number,z:number,c:number,rx=Math.PI/2) =>
    add(new THREE.CylinderGeometry(r,r,l,12),c,x,y,z,rx);
  const loop = (r:number,t:number,x:number,y:number,z:number,c:number) => {
    const g=new THREE.TorusGeometry(r,t,5,12); g.rotateY(Math.PI/2); add(g,c,x,y,z);
  };
  const stock = (length:number) => {
    box(.047,.105,length,0,-.002,-length/2-.095,walnut,-.09);
    box(.052,.12,.017,0,-.015,-length-.09,leather);
    box(.038,.045,.12,0,.035,-.075,walnut,.15);
  };
  if(kind==='fireHose') {
    tube(.045,.18,0,0,0,0x8d7951);
    add(new THREE.CylinderGeometry(.025,.045,.23,10),0xb5a075,0,0,.2,Math.PI/2);
    tube(.055,.06,0,0,-.1,0x282923);
  } else if(kind==='pistol') {
    tube(.017,.19,0,.075,.112,steel);
    tube(.035,.058,0,.064,-.004,steel);
    box(.035,.05,.095,0,.044,-.016,steel);
    box(.036,.1,.048,0,-.018,-.044,walnut,-.28);
    loop(.023,.004,0,.002,.014,steel);
    box(.01,.014,.014,0,.097,.192,steel);
    box(.012,.024,.018,0,.093,-.046,steel,-.35);
  } else if(kind==='twinPistols') {
    // A single automatic; the equipment binder instantiates it in both hands.
    box(.029,.038,.214,0,.075,.038,steel);
    box(.026,.032,.122,0,.045,.01,steel);
    box(.033,.103,.047,0,-.017,-.036,walnut,-.2);
    box(.036,.014,.052,0,-.068,-.046,steel);
    loop(.022,.004,0,.011,.017,steel);
    box(.006,.009,.01,0,.098,.13,steel);
  } else if(kind==='tommy') {
    box(.045,.055,.24,0,.075,.075,steel);
    tube(.02,.28,0,.085,.332,steel);
    for(let i=0;i<9;i++) tube(.024,.009,0,.085,.23+i*.017,steel);
    stock(.28);
    box(.034,.092,.046,0,-.015,-.018,walnut,-.18);
    box(.03,.17,.05,0,-.047,.126,steel);
    box(.036,.111,.04,0,-.005,.244,walnut,-.1);
    loop(.024,.004,0,.015,.025,steel);
    box(.008,.028,.014,0,.113,.46,steel);
  } else if(kind==='shotgun' || kind==='rifle') {
    const shotgun=kind==='shotgun', barrel=shotgun?.68:.57;
    stock(.32);
    box(.038,.049,.17,0,.067,.026,steel);
    tube(shotgun?.016:.012,barrel,0,.078,.107+barrel/2,steel);
    if(shotgun) {
      tube(.013,.41,0,.049,.302,steel);
      box(.041,.045,.17,0,.039,.27,walnut);
      for(let i=0;i<6;i++) box(.043,.047,.007,0,.039,.204+i*.022,0x38291e);
    } else box(.034,.034,.36,0,.046,.25,walnut);
    loop(.028,.004,0,.008,.016,steel);
    box(.007,.016,.012,0,.093,.1+barrel-.018,steel);
  } else if(kind==='explosives') {
    for(let x=-1;x<=1;x++) tube(.024,.23,x*.047,0,0,0x985945);
    for(const z of [-.066,.066]) box(.146,.052,.022,0,0,z,leather);
    tube(.042,.022,0,.019,.027,silver,Math.PI/2);
    tube(.036,.024,0,.019,.03,0xc9bc9e,Math.PI/2);
    box(.003,.024,.003,0,.03,.044,steel); box(.02,.003,.003,.008,.019,.044,steel);
  } else if(kind==='crate') {
    // A slatted wooden goods case, carried in front of the chest.
    box(.50,.34,.36,0,0,0,0x7a5634);
    for(const y of [-.105,0,.105]) box(.512,.022,.372,0,y,0,0x5a3d22);
    for(const x of [-.235,.235]) box(.03,.35,.374,x,0,0,0x4b321c);
  } else if(kind==='molotov') {
    // A small opaque green bottle reads cleanly at street scale.
    add(new THREE.CylinderGeometry(.035,.041,.15,12),0x344e2e,0,-.045,0);
    add(new THREE.CylinderGeometry(.014,.035,.038,12),0x344e2e,0,.049,0);
    tube(.014,.063,0,.093,0,0x344e2e,0);
    box(.021,.048,.017,.012,.137,0,0xc4aa78,-.35);
  } else if(kind==='camera') {
    box(.225,.178,.075,0,0,0,leather);
    box(.192,.152,.016,0,0,.043,silver);
    box(.15,.121,.095,0,0,.079,leather);
    for(let i=0;i<5;i++) box(.157,.127,.008,0,0,.047+i*.016,0x3b3935);
    box(.162,.133,.014,0,0,.127,leather);
    tube(.033,.047,0,0,.156,steel);
    tube(.029,.005,0,0,.182,silver);
    tube(.023,.006,0,0,.187,0x17242c);
    box(.035,.038,.049,.065,.106,0,steel);
    tube(.009,.18,-.153,.105,0,silver,0);
    const dish=new THREE.SphereGeometry(.082,16,8,0,Math.PI*2,0,Math.PI/2);
    dish.rotateX(-Math.PI/2); dish.scale(1,1,.42); add(dish,silver,-.153,.206,.005);
    add(new THREE.SphereGeometry(.016,8,6),0xe3ddd1,-.153,.206,.035);
  } else if(kind==='cameraStrap') {
    // Kept separate so both imported and fallback cameras hang from the neck.
    for(const x of [-.095,.095]) box(.014,.30,.008,x,.216,-.07,leather,-.18);
  } else if(kind==='badge') {
    const shape=new THREE.Shape(); shape.moveTo(-.022,.028); shape.lineTo(.022,.028);
    shape.lineTo(.02,-.006); shape.lineTo(0,-.03); shape.lineTo(-.02,-.006); shape.closePath();
    add(new THREE.ExtrudeGeometry(shape,{depth:.005,bevelEnabled:false}),0xb9a171);
  } else if(kind==='gavel') {
    tube(.012,.17,0,0,.035,walnut);
    tube(.032,.094,0,0,.128,walnut,0);
    for(const y of [-.038,.038]) tube(.035,.012,0,y,.128,0x3b261b,0);
  } else if(kind==='judgeHair') {
    // A balding crown closes the removed cap; grey hair only at the sides/back.
    const crown=new THREE.SphereGeometry(1,16,12,0,Math.PI*2,0,Math.PI/2);
    crown.scale(.098,.105,.098);add(crown,0xc3a285);
    const hair=new THREE.SphereGeometry(1,16,8,Math.PI,Math.PI,1.04,.55);
    hair.scale(.099,.106,.099);add(hair,0x625e55);
  } else {
    for(const x of [-.028,.028]) box(.047,.12,.01,x,0,0,0xded9cc,-.1);
  }
  const geometry=mergeGeometries(parts,false)!; parts.forEach(p=>p.dispose());
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

/** One geometry and material per prop family, shared by every actor and LOD. */
export class EquipmentModels {
  private geometries=new Map<EquipmentModel,THREE.BufferGeometry>();
  private generated=new Map<EquipmentModel,THREE.Object3D>();
  /** Source resources remain owned by the model loader. Instances share them. */
  install(kind:EquipmentModel,template:THREE.Object3D):void { this.generated.set(kind,template); }
  readonly material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.76,metalness:.18});
  create(kind:EquipmentModel):THREE.Object3D {
    const template=this.generated.get(kind);
    if(template) { const root=template.clone(true);root.name=`equipment-${kind}`;return root; }
    let geometry=this.geometries.get(kind);
    if(!geometry) { geometry=equipmentGeometry(kind); this.geometries.set(kind,geometry); }
    const mesh=new THREE.Mesh(geometry,this.material);
    mesh.name=`equipment-${kind}`; mesh.castShadow=true; mesh.receiveShadow=false;
    mesh.raycast=()=>{}; addMuzzleAnchor(kind,mesh); return mesh;
  }
  dispose():void { this.generated.clear();this.geometries.forEach(g=>g.dispose());this.geometries.clear();this.material.dispose(); }
}
