import { afterEach, describe, expect, it, vi } from 'vitest';
import * as save from '../src/app/save';
import { useGame } from '../src/app/store';

afterEach(() => { vi.restoreAllMocks(); useGame.getState().endAttract(); useGame.setState({ screen: 'menu', sim: null }); });

describe('attract mode', () => {
  it('runs an autopilot week that plans the player gang too', () => {
    useGame.setState({ screen: 'menu', sim: null, attract: false });
    useGame.getState().startAttract();
    const { sim, attract, screen } = useGame.getState();
    expect(attract).toBe(true);
    expect(screen).toBe('game');
    expect(sim?.world.phase).toBe('week');
    const orders = Object.values(sim!.world.orders).filter(o => o.gangId === sim!.playerGang.id);
    expect(orders.length).toBeGreaterThan(0);
  }, 120_000);

  it('never writes the Autosave and returns to the menu', async () => {
    const write = vi.spyOn(save, 'saveGame').mockResolvedValue(undefined as never);
    useGame.setState({ screen: 'menu', sim: null, attract: false });
    useGame.getState().startAttract();
    expect(await useGame.getState().autosave(true)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    useGame.getState().endAttract();
    expect(useGame.getState()).toMatchObject({ screen: 'menu', sim: null, attract: false });
  }, 120_000);

  it('only starts from the menu', () => {
    useGame.setState({ screen: 'newGame', sim: null, attract: false });
    useGame.getState().startAttract();
    expect(useGame.getState().attract).toBe(false);
  });
});
