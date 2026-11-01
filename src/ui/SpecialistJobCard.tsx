import { act, useGame } from '../app/store';
import { bribeOfficial, bribePrice, cancelSpecialistJob, employPoliceInArea, employPoliceOfficer, orderAudit } from '../sim/api';
import { reservedAudit, SPECIALIST_JOB_NAMES, specialistJobActive, specialistTargetEligible } from '../sim/specialistJobs';
import { money } from '../sim/world';
import { Hint, Panel } from './common';
import { MapAccess } from './MapAccess';

export function SpecialistJobCard() {
  const s = useGame(), sim = s.sim!, card = s.specialistCard;
  if (!card) return null;
  const w = sim.world, gang = sim.playerGang;
  const person = card.personId == null ? null : w.people[card.personId];
  const area = card.type === 'employPolice' && s.pickMode?.kind === 'policeArea';
  const reservation = card.type === 'audit' ? reservedAudit(w, gang.id) : undefined;
  const canConfirm = (!reservation || reservation.state === 'queued') &&
    (area ? s.policeAreaBlockIds.length > 0 : !!person && specialistTargetEligible(w, gang.id, card.type, person));
  const confirm = () => {
    const res = act(current => card.type === 'audit' ? orderAudit(current.world, gang.id, card.personId!)
      : card.type === 'bribeOfficials' ? bribeOfficial(current.world, gang.id, card.personId!)
      : area ? employPoliceInArea(current.world, gang.id, s.policeAreaBlockIds)
      : employPoliceOfficer(current.world, gang.id, card.personId!));
    s.notify(res); if (res?.ok) s.cancelSpecialistCard();
  };
  return <div className="job-card-inline" aria-label="Specialist job card">
    <Panel title={SPECIALIST_JOB_NAMES[card.type]}>
      <Hint>{card.type === 'audit' ? 'Audit reserves the accountant for the whole week. They visit your lieutenant or business manager, then prepare the report of money taken and handed over for Friday.'
        : card.type === 'bribeOfficials' ? 'The lawyer visits this official during the Working Week. The quoted bribe is paid when they meet.'
        : 'The lawyer tours the marked blocks during the Working Week and approaches the police he finds there.'}</Hint>
      <p role="status">{area ? `${s.policeAreaBlockIds.length} blocks selected` : person ? person.name : 'Choose a highlighted person or premises, or use the Clipboard.'}</p>
      {person && card.type === 'bribeOfficials' && <p>Payment on visit: <b>{money(bribePrice(w, person, gang.id))}</b></p>}
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn" onClick={() => s.setOrganizerCollapsed(true)}>Choose on map</button>
        <MapAccess label="Clipboard" />
        <button className="btn" onClick={() => { s.selectSpecialistTarget(null); s.clearPoliceArea(); }}>Clear selection</button>
      </div>
      {area && <Hint>Drag a box for several blocks, or click a block to add or remove it. Blue is available, red selected; yellow marks planned illegal jobs.</Hint>}
      <div className="row wrap" style={{ gap: 6, marginTop: 18 }}>
        <button className="btn brass" disabled={!canConfirm} onClick={confirm}>Confirm order</button>
        <button className="btn" onClick={s.cancelSpecialistCard}>Cancel</button>
      </div>
    </Panel>
  </div>;
}

export function SpecialistJobList({ role }: { role: 'accountant' | 'lawyer' }) {
  const sim = useGame(s => s.sim)!, notify = useGame(s => s.notify); useGame(s => s.version);
  const w = sim.world, gang = sim.playerGang;
  const jobs = Object.values(w.specialistJobs ?? {}).filter(j => j.gangId === gang.id && (j.type === 'audit' ? 'accountant' : 'lawyer') === role && j.week >= w.week - 1);
  if (!jobs.length) return null;
  return <Panel title="Jobs and reports">{jobs.map(j => <div className="panel" key={j.id}>
    <div className="row between tiny"><b>{SPECIALIST_JOB_NAMES[j.type]}</b><span>Week {j.week} · {j.type === 'audit' && j.state === 'done' && j.week === w.week ? 'Report due Friday' : j.state}</span></div>
    <p className="tiny">{j.blockIds.length ? `${j.blockIds.length} blocks` : w.people[j.targetPersonId ?? -1]?.name}{j.result && ` · ${j.result}`}</p>
    {specialistJobActive(j) && <button className="btn sm" onClick={() => notify(act(s => cancelSpecialistJob(s.world, gang.id, j.id)))}>Cancel order</button>}
  </div>)}</Panel>;
}
