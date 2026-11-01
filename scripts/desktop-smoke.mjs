// Desktop smoke test with a throwaway profile (never the player's saves):
//  1. the page loads from app:// on a hardware GPU with no page errors;
//  2. a new campaign starts; the plan and the 3D working week hold a frame rate;
//  3. Exit (Ctrl+Q → Yes) writes the Autosave file to disk;
//  4. a second launch lists that Autosave on the Load Game button.
// Usage: npm run build && node scripts/desktop-smoke.mjs [packaged-exe]
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const profile = await mkdtemp(path.join(tmpdir(), 'og-desktop-'));
const exe = process.argv[2];
const shots = path.join(tmpdir(), 'og-desktop-smoke');
const launch = () => electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: ['.'] }),
  env: { ...process.env, OG_USER_DATA: profile } });

async function open(app, errors) {
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(String(e)));
  // (Resource Timing does not record the custom app:// scheme.)
  page.on('requestfinished', r => { if (r.url().endsWith('.glb')) report.models = (report.models ?? 0) + 1; });
  page.on('requestfailed', r => errors.push(`failed ${r.url()}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForLoadState('load');
  // The title card plays once a session; any key skips it to the menu.
  if (await page.locator('.title-sequence').count()) { await page.keyboard.press('Escape'); await page.locator('.title-sequence').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); }
  await page.getByText('NEW GAME', { exact: false }).first().waitFor({ timeout: 30000 });
  return page;
}

const report = { errors: [] };
try {
  let app = await launch();
  try {
    const page = await open(app, report.errors);
    Object.assign(report, await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      return { url: location.href, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : String(!!gl) };
    }));
    await page.getByText('NEW GAME', { exact: false }).first().click();
    await page.getByRole('button', { name: 'Start Game' }).click();
    await page.locator('canvas').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(15000);
    report.fps = await page.evaluate(() => new Promise(done => {
      let frames = 0; const start = performance.now();
      const tick = () => { frames++; if (performance.now() - start < 3000) requestAnimationFrame(tick); else done(Math.round(frames / 3)); };
      requestAnimationFrame(tick);
    }));
    await page.screenshot({ path: `${shots}-plan.png` });
    // The working week: the 3D streets.
    await page.getByRole('button', { name: /hit the streets/i }).click();
    await page.waitForTimeout(20000);
    report.streetFps = await page.evaluate(() => new Promise(done => {
      let frames = 0; const start = performance.now();
      const tick = () => { frames++; if (performance.now() - start < 5000) requestAnimationFrame(tick); else done(Math.round(frames / 5)); };
      requestAnimationFrame(tick);
    }));
    await page.screenshot({ path: `${shots}-streets.png` });
    // Close zoom loads the detailed (Sculpt) characters and cars.
    const box = await page.locator('canvas').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(150); }
    await page.waitForTimeout(12000);
    await page.screenshot({ path: `${shots}-close.png` });
    await page.keyboard.press('Control+q');
    await page.getByRole('button', { name: 'Yes' }).click();
    await page.getByText('LOAD GAME', { exact: false }).first().waitFor({ timeout: 60000 });
    report.filesAfterExit = (await readdir(path.join(profile, 'saves'))).filter(f => f.endsWith('.ogsave')).length;
  } finally { await app.close(); }

  app = await launch();
  try {
    const page = await open(app, report.errors);
    await page.waitForTimeout(3000);
    report.menuAfterRelaunch = (await page.locator('body').innerText()).replace(/\s+/g, ' ').match(/LOAD GAME.{0,60}/i)?.[0];
    await page.screenshot({ path: `${shots}-menu.png` });
  } finally { await app.close(); }

  console.log(JSON.stringify(report, null, 2));
  const problems = [];
  if (!exe && !report.url.startsWith('app://game/')) problems.push('not served from app://');
  if (/SwiftShader|false/i.test(report.gpu)) problems.push('no hardware WebGL');
  if (report.filesAfterExit !== 1) problems.push('Autosave file not written on exit');
  if (/No saves yet/i.test(report.menuAfterRelaunch ?? '')) problems.push('Autosave not listed after relaunch');
  if (!report.models) problems.push('no detailed models loaded at close zoom');
  if (report.errors.length) problems.push(`${report.errors.length} page errors`);
  if (problems.length) { console.error('FAILED:', problems.join('; ')); process.exitCode = 1; }
  else console.log('Desktop smoke passed.');
} finally {
  await rm(profile, { recursive: true, force: true });
}
