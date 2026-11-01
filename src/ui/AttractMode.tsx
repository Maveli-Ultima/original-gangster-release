import { useEffect } from 'react';
import { useGame } from '../app/store';
import { ArtImage } from './ArtImage';
import { art } from './art';

const SHOT_MS = 9000;

/**
 * The attract mode's overlay (the original's demo on an idle menu): the
 * wordmark and a "Demonstration" plate over the autopilot city, a camera that
 * cuts between gangsters at work, and any key or click back to the menu.
 */
export function AttractMode() {
  const endAttract = useGame((s) => s.endAttract);
  useEffect(() => {
    // Captured first, so nothing in the city or its keyboard handlers acts on it.
    const leave = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); endAttract(); };
    window.addEventListener('keydown', leave, true);
    window.addEventListener('pointerdown', leave, true);
    window.addEventListener('wheel', leave, { capture: true, passive: false });
    const cut = () => {
      const { sim, requestCamera } = useGame.getState();
      if (!sim || sim.world.phase !== 'week') return;
      const busy = Object.values(sim.world.people).filter(p => p.gangId != null && p.status === 'active' && !p.inVehicle && p.dest);
      const pick = busy[Math.floor(Math.random() * busy.length)];
      if (pick) requestCamera({ x: pick.pos.x, y: pick.pos.y });
    };
    const first = window.setTimeout(cut, 1500);
    const timer = window.setInterval(cut, SHOT_MS);
    return () => {
      window.removeEventListener('keydown', leave, true);
      window.removeEventListener('pointerdown', leave, true);
      window.removeEventListener('wheel', leave, true);
      window.clearTimeout(first); window.clearInterval(timer);
    };
  }, [endAttract]);

  return (
    <div className="attract" role="presentation">
      <ArtImage className="attract-plate" src={art('brand/wordmark.png')} alt="Original Gangster" draggable={false} />
      <div className="attract-banner">Demonstration</div>
      <div className="title-skip attract-skip">Press any key</div>
    </div>
  );
}
