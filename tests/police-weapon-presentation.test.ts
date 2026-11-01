import {describe,it,expect} from 'vitest';
import {Sim} from '../src/sim/sim';
import {defaultGameOptions} from '../src/app/newGame';
import {CharacterActions} from '../src/render/characterActions';
import {presentAttack} from '../src/sim/presentationEvents';
import {allocateWeapons} from '../src/sim/weapons';

function fixture(){
  const world=new Sim({...defaultGameOptions(),seed:404,citySize:8}).world;
  const officer=world.people[world.policeIds[0]],target=Object.values(world.people).find(p=>p.role==='hood')!;
  officer.skills.firearms=3;officer.inVehicle=false;officer.streetOrder=null;officer.dest=null;officer.path=[];
  const view=new CharacterActions(world);
  const respond=()=>{
    officer.streetOrder={type:'kill',targetPersonId:target.id,pos:{...target.pos}};
    officer.dest={...target.pos};officer.path=[{...target.pos}];
  };
  return {world,officer,target,view,respond};
}

describe('police drawn weapons',()=>{
  it('keeps idle officers and routine patrol, go-to, tail and unarmed assault movement holstered',()=>{
    const {officer,target,view}=fixture();
    expect(view.drawnWeapon(officer.id)).toBeUndefined();
    officer.dest={...target.pos};officer.path=[{...target.pos}];
    expect(view.drawnWeapon(officer.id)).toBeUndefined();
    for(const type of ['goTo','tail','assault'] as const){
      officer.streetOrder={type,targetPersonId:target.id,pos:{...target.pos}};
      expect(view.drawnWeapon(officer.id)).toBeUndefined();
    }
  });
  it('draws the actual issued firearm for a live threat pursuit and clears it on cancellation',()=>{
    const {world,officer,view,respond}=fixture();respond();
    const saved=JSON.stringify(world);
    expect(view.drawnWeapon(officer.id)).toBe(allocateWeapons(world).get(officer.id));
    expect(JSON.stringify(world)).toBe(saved);
    officer.skills.firearms=4;expect(view.drawnWeapon(officer.id)).toBe('tommy');
    officer.streetOrder=null;expect(view.drawnWeapon(officer.id)).toBeUndefined();
    respond();officer.path=[];expect(view.drawnWeapon(officer.id)).toBeUndefined();
    respond();officer.dest=null;expect(view.drawnWeapon(officer.id)).toBeUndefined();
  });
  it('does not draw for missing or incapacitated targets, even before the next simulation tick',()=>{
    const {world,officer,target,view,respond}=fixture();respond();
    for(const state of ['dead','beaten','arrested','jailed','kidnapped'] as const){
      target.status=state;expect(view.drawnWeapon(officer.id)).toBeUndefined();
    }
    target.status='active';target.hp=0;expect(view.drawnWeapon(officer.id)).toBeUndefined();
    target.hp=100;delete world.people[target.id];expect(view.drawnWeapon(officer.id)).toBeUndefined();
  });
  it('hides response weapons in vehicles or when the officer is incapacitated',()=>{
    const {officer,view,respond}=fixture();respond();
    officer.inVehicle=true;expect(view.drawnWeapon(officer.id)).toBeUndefined();
    officer.inVehicle=false;officer.status='beaten';expect(view.drawnWeapon(officer.id)).toBeUndefined();
  });
  it('shows real combat fire, then holsters when the threat ends or firing expires',()=>{
    const {world,officer,target,view}=fixture();
    presentAttack(world,officer,target,'pistol',false);view.update(world,0);
    expect(view.drawnWeapon(officer.id)).toBe('pistol');
    target.status='arrested';expect(view.drawnWeapon(officer.id)).toBeUndefined();
    target.status='active';expect(view.drawnWeapon(officer.id)).toBeUndefined();
    presentAttack(world,officer,target,'pistol',false);view.update(world,0);view.update(world,3.1);
    expect(view.drawnWeapon(officer.id)).toBeUndefined();
  });
});
