import { yieldForPaint } from '../yieldForPaint';

/** Wait without blocking JS until the first city frame has actually finished. */
export async function waitForGpu(gl: WebGL2RenderingContext, isCurrent: () => boolean): Promise<boolean> {
  if (!isCurrent()) return false;
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) throw new Error('Could not prepare the city graphics.');
  gl.flush();
  try {
    while (isCurrent()) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return true;
      if (status === gl.WAIT_FAILED) throw new Error('The city graphics could not finish loading.');
      await yieldForPaint();
    }
    return false;
  } finally { gl.deleteSync(fence); }
}
