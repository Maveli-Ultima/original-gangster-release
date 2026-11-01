import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { useGame } from '../src/app/store';
import { defaultGameOptions } from '../src/app/newGame';
import { TaggedViews, type TaggedViewRect } from '../src/render/taggedView';

const initial = useGame.getState();
afterEach(() => useGame.setState(initial, true));

describe('independent watched characters', () => {
  let ids: number[];
  beforeEach(() => {
    useGame.getState().startGame({...defaultGameOptions(),seed:404,citySize:10});
    const sim = useGame.getState().sim!;
    sim.launchWeek();
    ids = Object.values(sim.world.people).filter(p => p.role === 'citizen').slice(0,3).map(p => p.id);
  });

  it('adds unique watches without replacing earlier windows; clearing selection keeps watches', () => {
    const state = useGame.getState();
    ids.forEach(id => state.selectPerson(id));
    state.selectPerson(ids[0]);
    expect(useGame.getState().taggedPersonIds).toEqual(ids);
    state.selectBuilding(10);
    state.selectPerson(null);
    expect(useGame.getState().taggedPersonIds).toEqual(ids);
    expect(useGame.getState().selectedPersonIds).toEqual([]);
  });

  it('keeps group selection independent of closing one or all windows', () => {
    const state = useGame.getState();
    ids.forEach(id => state.tagPerson(id));
    state.selectPeople(ids.slice(0,2));
    state.closeTaggedPerson(ids[1]);
    expect(useGame.getState().taggedPersonIds).toEqual([ids[0],ids[2]]);
    state.clearTaggedWindows();
    expect(useGame.getState().taggedPersonIds).toEqual([]);
    expect(useGame.getState().selectedPersonIds).toEqual(ids.slice(0,2));
    expect(useGame.getState().selectedPersonId).toBe(ids[1]);
  });

  it('ignores invalid and office-boss tags, and resets watches for a fresh world', () => {
    const state = useGame.getState(), sim = state.sim!;
    state.tagPerson(-1);
    state.tagPerson(Object.values(sim.world.people).find(p => p.role === 'boss')!.id);
    expect(useGame.getState().taggedPersonIds).toEqual([]);
    state.tagPerson(ids[0]);
    state.startGame({...defaultGameOptions(),seed:405,citySize:10});
    expect(useGame.getState().taggedPersonIds).toEqual([]);
    state.tagPerson(ids[0]); // planning cannot leave a stale watch for Monday
    expect(useGame.getState().taggedPersonIds).toEqual([]);
  });
});

const rect = (personId:number, patch:Partial<TaggedViewRect> = {}):TaggedViewRect => ({
  personId, mode:'street',x:0,y:0,width:294,height:154,clipTop:0,clipBottom:154,...patch,
});

describe('shared-scene watched cameras', () => {
  it('retains separate reversal, positions and zoom while a sibling changes or closes', () => {
    const views = new TaggedViews();
    views.set([rect(1),rect(2,{mode:'roof'})],false);
    const first = views.views.get(1)!, second = views.views.get(2)!;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(6,12,6),new THREE.MeshBasicMaterial(),1);
    mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(5,6,5));
    first.update(0,1,0,mesh,1);
    second.update(300,1,300,mesh,1);
    expect(first.side).toBe(-1); expect(second.side).toBe(1);
    expect(first.camera.top).toBe(4); expect(second.camera.top).toBe(23);
    expect(views.contains(300,300)).toBe(true); expect(views.contains(0,0)).toBe(true);
    views.set([rect(2,{mode:'roof'})],true);
    expect(views.views.get(2)).toBe(second); expect(second.side).toBe(1);
    expect(views.contains(0,0)).toBe(false);
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
  });

  it('excludes scrolled-out windows from actor detail/rendering without losing their state', () => {
    const views = new TaggedViews();
    views.set([rect(1),rect(2,{x:600,clipLeft:600,clipRight:500}),rect(3,{clipTop:200,clipBottom:154})],false);
    const third = views.views.get(3)!; third.side = -1;
    expect(views.watchedIds()).toEqual(new Set([1]));
    views.set([rect(1),rect(3)],false);
    expect(views.views.get(3)).toBe(third); expect(third.side).toBe(-1);
    expect(views.watchedIds()).toEqual(new Set([1,3]));
    views.set([],false); expect(views.views.size).toBe(0);
  });
});
