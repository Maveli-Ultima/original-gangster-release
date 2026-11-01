import { describe, expect, it, vi } from 'vitest';
import { waitForGpu } from '../src/render/waitForGpu';
import { yieldForPaint } from '../src/yieldForPaint';

vi.mock('../src/yieldForPaint', () => ({ yieldForPaint: vi.fn(async () => {}) }));
function context() {
  const fence = {};
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE:1, ALREADY_SIGNALED:2, CONDITION_SATISFIED:3, WAIT_FAILED:4, TIMEOUT_EXPIRED:5,
    fenceSync:vi.fn(() => fence), flush:vi.fn(), deleteSync:vi.fn(), clientWaitSync:vi.fn(() => 2),
  };
  return { gl, fence, context:gl as unknown as WebGL2RenderingContext };
}
describe('first street frame GPU completion', () => {
  it('does not reveal the city until the submitted frame has completed, and uses nonblocking polls', async () => {
    const f = context(); vi.mocked(yieldForPaint).mockClear();
    f.gl.clientWaitSync.mockReturnValueOnce(5).mockReturnValueOnce(5).mockReturnValueOnce(3);
    expect(await waitForGpu(f.context, () => true)).toBe(true);
    expect(f.gl.flush).toHaveBeenCalledTimes(1);
    expect(yieldForPaint).toHaveBeenCalledTimes(2);
    expect(f.gl.clientWaitSync.mock.calls).toEqual([[f.fence, 0, 0], [f.fence, 0, 0], [f.fence, 0, 0]]);
    expect(f.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(f.fence);
  });
  it('does no GPU work for an already replaced or disposed renderer', async () => {
    const f = context();
    expect(await waitForGpu(f.context, () => false)).toBe(false);
    expect(f.gl.fenceSync).not.toHaveBeenCalled();
  });
  it('cleans up its fence if navigation cancels while waiting', async () => {
    const f = context(); let current = true;
    f.gl.clientWaitSync.mockImplementationOnce(() => { current = false; return 5; });
    expect(await waitForGpu(f.context, () => current)).toBe(false);
    expect(f.gl.clientWaitSync).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(f.fence);
  });
  it('reports a failed frame and releases the fence for retry', async () => {
    const f = context(); f.gl.clientWaitSync.mockReturnValue(4);
    await expect(waitForGpu(f.context, () => true)).rejects.toThrow('could not finish loading');
    expect(f.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(f.fence);
  });
});
