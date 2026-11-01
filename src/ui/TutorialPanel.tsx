import { useState } from 'react';
import { useGame } from '../app/store';
import { tutorialById } from '../app/tutorials';
import { Kicker, Rivets } from './common';

/** The lesson card: the tutorial's steps, ticked off as the world shows them done. */
export function TutorialPanel() {
  const sim = useGame((s) => s.sim);
  useGame((s) => s.version);
  const [dismissed, setDismissed] = useState(false);
  const [folded, setFolded] = useState(false);
  const tutorial = sim ? tutorialById(sim.world.options.tutorialId) : null;
  const ticked = sim?.world.tutorialProgress?.lessonId === tutorial?.id
    ? sim?.world.tutorialProgress?.completed ?? [] : [];
  const live = sim && tutorial ? tutorial.steps.map((s) => s.done(sim.world, sim.playerGang.id)) : [];
  if (!sim || dismissed || !tutorial) return null;
  const done = tutorial.steps.map((_, i) => live[i] || ticked.includes(i));
  const next = done.findIndex((d) => !d);
  const finished = next === -1;

  return (
    <div className="brass tutorial-card" role="region" aria-label={`Lesson ${tutorial.id}: ${tutorial.name}`}>
      <div className="paper">
        <Rivets />
        <div className="head">
          <div>
            <Kicker>Lesson {tutorial.id} of 4</Kicker>
            <h4>{tutorial.name}</h4>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => setFolded(!folded)} title={folded ? 'Open the card' : 'Fold the card'}>
              {folded ? '▾' : '▴'}
            </button>
            <button className="close" onClick={() => setDismissed(true)} aria-label="Close">
              ×
            </button>
          </div>
        </div>
        {!folded && (
          <ol className="steps">
            {tutorial.steps.map((step, i) => (
              <li key={i} className={done[i] ? 'done' : i === next ? 'now' : ''}>
                <span className="tick">{done[i] ? '✓' : i === next ? '▸' : ''}</span>
                <div>
                  <div className="step-text">{step.text}</div>
                  {i === next && <div className="hint">{step.hint}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {finished && !folded && (
          <div className="foot-note">That is the lesson. Play on, or start the next one from the main menu.</div>
        )}
      </div>
    </div>
  );
}
