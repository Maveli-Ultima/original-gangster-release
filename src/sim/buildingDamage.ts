import type {Building,WorldState} from './types';
import {businessFrontReady} from './businessState';

export function fireDamageStage(b:Building,week:number):'scorched'|'awaiting-repair'|'repairing'|null {
  if(b.fireWeek==null||(b.state!=='damaged'&&b.state!=='destroyed'))return null;
  if(week<=b.fireWeek||b.state==='destroyed')return 'scorched';
  return b.repairCompleteWeek!=null?'repairing':'awaiting-repair';
}

/** Repair Damage is an explicit business order. Fire damage remains visible
 * through the incident week and a full repair week before reopening. */
export function finishBuildingRepairs(w:WorldState):void {
  for(const b of Object.values(w.buildings)){
    if(b.repairCompleteWeek==null||w.week<b.repairCompleteWeek)continue;
    delete b.repairCompleteWeek;
    if(b.state!=='damaged')continue;
    b.state=b.fbiClosedWeek!=null||b.ceasedWeek!=null||!businessFrontReady(w,b)?'ceased':'trading';delete b.fireWeek;b.repairCost=0;
    const hidden=b.hidesId==null?undefined:w.buildings[b.hidesId];
    if(hidden?.state==='ceased'&&hidden.fbiClosedWeek==null&&hidden.ceasedWeek==null&&businessFrontReady(w,hidden))hidden.state='trading';
  }
}
